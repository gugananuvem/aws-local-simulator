'use strict';

/**
 * Gerenciador de metadados de clusters SQL Server.
 * Persiste clusters, instâncias, bancos, tags e credenciais em metadata.db
 * e mantém uma cópia de recuperação em __rds-sqlserver__.json via LocalStore.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../utils/logger');

// Motores e versões aceitos pelo simulador
const VALID_ENGINES = ['sqlserver-se', 'sqlserver-ex', 'sqlserver-web', 'sqlserver-ee'];
const VALID_ENGINE_VERSIONS = [
  '14.00.3281.6.v1',
  '15.00.4388.7.v1',
  '16.00.4035.2.v1'
];

// Padrões de validação
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const INSTANCE_CLASS_PATTERN = /^db\.(t3|t4g|t5|r5|r5b|r6g|r6i|x1e|x1)\.[a-z0-9]+$/;

const DEFAULT_PORT = 1433;
const DEFAULT_LICENSE_MODEL = 'license-included';
const DEFAULT_CHARACTER_SET = 'SQL_Latin1_General_CP1_CI_AS';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_AVAILABILITY_ZONES = ['us-east-1a', 'us-east-1b', 'us-east-1c'];

class ClusterManager {
  constructor(dataDir, store = null) {
    this.dataDir = dataDir;
    this.metaDb = null;
    this.store = store;
    this.isClosed = false;

    fs.mkdirSync(dataDir, { recursive: true });
  }

  /**
   * Abre o banco de metadados e carrega o estado persistido em JSON.
   * Pode ser chamado várias vezes sem efeito colateral.
   */
  initialize() {
    if (this.metaDb && !this.isClosed) {
      return;
    }

    const dbPath = path.join(this.dataDir, 'metadata.db');
    this.metaDb = new Database(dbPath);
    this.metaDb.pragma('journal_mode = WAL');
    this.metaDb.pragma('foreign_keys = ON');
    this.isClosed = false;

    this._createSchema();
    this.loadClusters();
    logger.debug('[SQL Server ClusterManager] metadata.db inicializado');
  }

  /**
   * Cria as tabelas de metadados, se ainda não existirem.
   * @private
   */
  _createSchema() {
    this.metaDb.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        db_cluster_identifier TEXT PRIMARY KEY,
        db_cluster_arn TEXT UNIQUE NOT NULL,
        engine TEXT NOT NULL CHECK(engine IN ('sqlserver-se','sqlserver-ex','sqlserver-web','sqlserver-ee')),
        engine_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        endpoint TEXT,
        reader_endpoint TEXT,
        port INTEGER NOT NULL DEFAULT 1433,
        database_name TEXT,
        master_username TEXT NOT NULL,
        master_password_hash TEXT NOT NULL,
        master_password_salt TEXT NOT NULL,
        storage_encrypted INTEGER DEFAULT 0,
        kms_key_id TEXT,
        db_cluster_resource_id TEXT UNIQUE NOT NULL,
        license_model TEXT,
        character_set TEXT,
        timezone TEXT,
        availability_zones TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS instances (
        db_instance_identifier TEXT PRIMARY KEY,
        db_instance_arn TEXT UNIQUE NOT NULL,
        db_cluster_identifier TEXT NOT NULL REFERENCES clusters(db_cluster_identifier),
        db_instance_class TEXT NOT NULL,
        engine TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        db_instance_status TEXT NOT NULL DEFAULT 'available',
        endpoint_address TEXT,
        endpoint_port INTEGER,
        is_cluster_writer INTEGER DEFAULT 0,
        availability_zone TEXT,
        license_model TEXT,
        character_set TEXT,
        timezone TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS databases (
        name TEXT NOT NULL,
        cluster_identifier TEXT NOT NULL REFERENCES clusters(db_cluster_identifier),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (name, cluster_identifier)
      );

      CREATE TABLE IF NOT EXISTS tags (
        resource_arn TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (resource_arn, key)
      );
    `);
  }

  // ─── Operações de cluster ───────────────────────────────────────────────────

  /**
   * Cria um cluster SQL Server com validação completa e senha salgada+hasheada.
   * @param {Object} params - Parâmetros de criação do cluster
   * @returns {Object} Cluster formatado no padrão AWS
   */
  createCluster(params = {}) {
    const {
      DBClusterIdentifier,
      Engine,
      EngineVersion,
      MasterUsername,
      MasterUserPassword,
      Port,
      DatabaseName,
      StorageEncrypted,
      KmsKeyId,
      LicenseModel,
      CharacterSet,
      Timezone,
      AvailabilityZones
    } = params;

    this._validateIdentifier(DBClusterIdentifier, 'DBClusterIdentifier');

    if (!VALID_ENGINES.includes(Engine)) {
      this._throwError(
        'InvalidParameterValue',
        `Motor inválido: ${Engine}. Motores válidos: ${VALID_ENGINES.join(', ')}.`,
        400
      );
    }

    if (!VALID_ENGINE_VERSIONS.includes(EngineVersion)) {
      this._throwError(
        'InvalidParameterValue',
        `Versão inválida: ${EngineVersion}. Versões válidas: ${VALID_ENGINE_VERSIONS.join(', ')}.`,
        400
      );
    }

    if (typeof MasterUsername !== 'string' || MasterUsername.length < 1 || MasterUsername.length > 128) {
      this._throwError('InvalidParameterValue', 'MasterUsername deve ter entre 1 e 128 caracteres.', 400);
    }

    if (typeof MasterUserPassword !== 'string' || MasterUserPassword.length < 8 || MasterUserPassword.length > 128) {
      this._throwError('InvalidParameterValue', 'MasterUserPassword deve ter entre 8 e 128 caracteres.', 400);
    }

    const port = this._normalizePort(Port);
    const zones = AvailabilityZones && AvailabilityZones.length > 0
      ? AvailabilityZones
      : DEFAULT_AVAILABILITY_ZONES;

    if (this._getClusterRow(DBClusterIdentifier)) {
      this._throwError(
        'DBClusterAlreadyExistsFault',
        `Cluster já existe: ${DBClusterIdentifier}`,
        400
      );
    }

    const arn = `arn:aws:rds:us-east-1:000000000000:cluster:${DBClusterIdentifier}`;
    const endpoint = `${DBClusterIdentifier}.cluster-local.us-east-1.rds.amazonaws.com`;
    const readerEndpoint = `${DBClusterIdentifier}.cluster-ro-local.us-east-1.rds.amazonaws.com`;
    const resourceId = `cluster-${crypto.randomUUID().replace(/-/g, '').substring(0, 26)}`;

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(MasterUserPassword, salt, 64).toString('hex');

    this.metaDb.prepare(`
      INSERT INTO clusters (
        db_cluster_identifier, db_cluster_arn, engine, engine_version,
        status, endpoint, reader_endpoint, port, database_name,
        master_username, master_password_hash, master_password_salt,
        storage_encrypted, kms_key_id, db_cluster_resource_id,
        license_model, character_set, timezone, availability_zones
      ) VALUES (?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      DBClusterIdentifier,
      arn,
      Engine,
      EngineVersion,
      endpoint,
      readerEndpoint,
      port,
      DatabaseName || null,
      MasterUsername,
      passwordHash,
      salt,
      StorageEncrypted ? 1 : 0,
      KmsKeyId || null,
      resourceId,
      LicenseModel || DEFAULT_LICENSE_MODEL,
      CharacterSet || DEFAULT_CHARACTER_SET,
      Timezone || DEFAULT_TIMEZONE,
      JSON.stringify(zones)
    );

    this._registerDatabase(DatabaseName, DBClusterIdentifier);

    logger.debug(`[SQL Server ClusterManager] Cluster '${DBClusterIdentifier}' criado`);
    this._persistClusters();

    return this._formatCluster(this._getClusterRow(DBClusterIdentifier));
  }

  /**
   * Remove um cluster e todos os registros associados.
   * @param {string} identifier - DBClusterIdentifier
   */
  deleteCluster(identifier) {
    const cluster = this._getClusterRow(identifier);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `Cluster não encontrado: ${identifier}`, 404);
    }

    const instanceArns = this.metaDb.prepare(
      'SELECT db_instance_arn FROM instances WHERE db_cluster_identifier = ?'
    ).all(identifier).map(row => row.db_instance_arn);

    this.metaDb.prepare('DELETE FROM databases WHERE cluster_identifier = ?').run(identifier);
    this.metaDb.prepare('DELETE FROM instances WHERE db_cluster_identifier = ?').run(identifier);
    this.metaDb.prepare('DELETE FROM clusters WHERE db_cluster_identifier = ?').run(identifier);

    for (const arn of [cluster.db_cluster_arn, ...instanceArns]) {
      this.metaDb.prepare('DELETE FROM tags WHERE resource_arn = ?').run(arn);
    }

    logger.debug(`[SQL Server ClusterManager] Cluster '${identifier}' removido`);
    this._persistClusters();
  }

  /**
   * Busca um cluster pelo identificador.
   * @param {string} identifier - DBClusterIdentifier
   * @returns {Object} Cluster formatado
   */
  getCluster(identifier) {
    const row = this._getClusterRow(identifier);
    if (!row) {
      this._throwError('DBClusterNotFoundFault', `Cluster não encontrado: ${identifier}`, 404);
    }
    return this._formatCluster(row);
  }

  /**
   * Lista clusters, opcionalmente filtrando por DBClusterIdentifier.
   * @param {Object} [filters] - Filtros opcionais
   * @returns {Object[]} Clusters formatados
   */
  listClusters(filters) {
    if (filters && filters.DBClusterIdentifier) {
      const row = this._getClusterRow(filters.DBClusterIdentifier);
      if (!row) {
        this._throwError(
          'DBClusterNotFoundFault',
          `Cluster não encontrado: ${filters.DBClusterIdentifier}`,
          404
        );
      }
      return [this._formatCluster(row)];
    }

    return this.metaDb.prepare('SELECT * FROM clusters').all().map(row => this._formatCluster(row));
  }

  /**
   * Busca um cluster pelo ARN (usado pela API de dados).
   * @param {string} arn - ARN do cluster
   * @returns {Object|null} Cluster formatado ou null
   */
  getClusterByArn(arn) {
    const row = this.metaDb.prepare('SELECT * FROM clusters WHERE db_cluster_arn = ?').get(arn);
    return row ? this._formatCluster(row) : null;
  }

  /**
   * Atualiza campos permitidos de um cluster.
   * @param {string} identifier - DBClusterIdentifier
   * @param {Object} fields - Campos a alterar
   * @returns {Object} Cluster atualizado
   */
  updateCluster(identifier, fields = {}) {
    const cluster = this._getClusterRow(identifier);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `Cluster não encontrado: ${identifier}`, 404);
    }

    const allowedFields = {
      engine_version: fields.EngineVersion,
      port: fields.Port === undefined ? undefined : this._normalizePort(fields.Port),
      master_username: fields.MasterUsername,
      database_name: fields.DatabaseName,
      storage_encrypted: fields.StorageEncrypted === undefined
        ? undefined
        : (fields.StorageEncrypted ? 1 : 0),
      kms_key_id: fields.KmsKeyId,
      status: fields.Status,
      license_model: fields.LicenseModel,
      character_set: fields.CharacterSet,
      timezone: fields.Timezone
    };

    if (fields.EngineVersion !== undefined && !VALID_ENGINE_VERSIONS.includes(fields.EngineVersion)) {
      this._throwError(
        'InvalidParameterValue',
        `Versão inválida: ${fields.EngineVersion}. Versões válidas: ${VALID_ENGINE_VERSIONS.join(', ')}.`,
        400
      );
    }

    if (fields.MasterUsername !== undefined &&
        (typeof fields.MasterUsername !== 'string' || fields.MasterUsername.length < 1 || fields.MasterUsername.length > 128)) {
      this._throwError('InvalidParameterValue', 'MasterUsername deve ter entre 1 e 128 caracteres.', 400);
    }

    const setClauses = [];
    const values = [];

    for (const [column, value] of Object.entries(allowedFields)) {
      if (value !== undefined) {
        setClauses.push(`${column} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = datetime('now')");
      values.push(identifier);
      this.metaDb.prepare(
        `UPDATE clusters SET ${setClauses.join(', ')} WHERE db_cluster_identifier = ?`
      ).run(...values);
    }

    this._registerDatabase(fields.DatabaseName, identifier);

    logger.debug(`[SQL Server ClusterManager] Cluster '${identifier}' atualizado`);
    this._persistClusters();

    return this._formatCluster(this._getClusterRow(identifier));
  }

  // ─── Operações de instância ─────────────────────────────────────────────────

  /**
   * Cria uma instância dentro de um cluster. A primeira é escritora.
   * @param {Object} params - Parâmetros de criação da instância
   * @returns {Object} Instância formatada
   */
  createInstance(params = {}) {
    const {
      DBInstanceIdentifier,
      DBClusterIdentifier,
      DBInstanceClass,
      Engine,
      EngineVersion,
      AvailabilityZone,
      LicenseModel,
      CharacterSet,
      Timezone
    } = params;

    this._validateIdentifier(DBInstanceIdentifier, 'DBInstanceIdentifier');

    if (!DBInstanceClass || !INSTANCE_CLASS_PATTERN.test(DBInstanceClass)) {
      this._throwError(
        'InvalidParameterValue',
        `Classe de instância inválida: ${DBInstanceClass}. Use uma classe db.* das famílias t3, t4g, t5, r5, r5b, r6g, r6i, x1e ou x1.`,
        400
      );
    }

    const cluster = this._getClusterRow(DBClusterIdentifier);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `Cluster não encontrado: ${DBClusterIdentifier}`, 404);
    }

    if (this._getInstanceRow(DBInstanceIdentifier)) {
      this._throwError(
        'InvalidParameterValue',
        `Instância já existe: ${DBInstanceIdentifier}`,
        400
      );
    }

    const arn = `arn:aws:rds:us-east-1:000000000000:db:${DBInstanceIdentifier}`;
    const endpointAddress = `${DBInstanceIdentifier}.local.us-east-1.rds.amazonaws.com`;
    const count = this.metaDb.prepare(
      'SELECT COUNT(*) AS total FROM instances WHERE db_cluster_identifier = ?'
    ).get(DBClusterIdentifier).total;

    this.metaDb.prepare(`
      INSERT INTO instances (
        db_instance_identifier, db_instance_arn, db_cluster_identifier,
        db_instance_class, engine, engine_version, db_instance_status,
        endpoint_address, endpoint_port, is_cluster_writer, availability_zone,
        license_model, character_set, timezone
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      DBInstanceIdentifier,
      arn,
      DBClusterIdentifier,
      DBInstanceClass,
      Engine || cluster.engine,
      EngineVersion || cluster.engine_version,
      endpointAddress,
      cluster.port,
      count === 0 ? 1 : 0,
      AvailabilityZone || 'us-east-1a',
      LicenseModel || cluster.license_model,
      CharacterSet || cluster.character_set,
      Timezone || cluster.timezone
    );

    logger.debug(
      `[SQL Server ClusterManager] Instância '${DBInstanceIdentifier}' criada no cluster '${DBClusterIdentifier}'`
    );
    this._persistClusters();

    return this._formatInstance(this._getInstanceRow(DBInstanceIdentifier));
  }

  /**
   * Remove uma instância.
   * @param {string} identifier - DBInstanceIdentifier
   */
  deleteInstance(identifier) {
    const instance = this._getInstanceRow(identifier);
    if (!instance) {
      this._throwError('DBInstanceNotFoundFault', `Instância não encontrada: ${identifier}`, 404);
    }

    this.metaDb.prepare('DELETE FROM instances WHERE db_instance_identifier = ?').run(identifier);
    this.metaDb.prepare('DELETE FROM tags WHERE resource_arn = ?').run(instance.db_instance_arn);

    logger.debug(`[SQL Server ClusterManager] Instância '${identifier}' removida`);
    this._persistClusters();
  }

  /**
   * Busca uma instância pelo identificador.
   * @param {string} identifier - DBInstanceIdentifier
   * @returns {Object} Instância formatada
   */
  getInstance(identifier) {
    const row = this._getInstanceRow(identifier);
    if (!row) {
      this._throwError('DBInstanceNotFoundFault', `Instância não encontrada: ${identifier}`, 404);
    }
    return this._formatInstance(row);
  }

  /**
   * Lista instâncias, opcionalmente filtrando por identificador ou cluster.
   * @param {Object} [filters] - Filtros opcionais
   * @returns {Object[]} Instâncias formatadas
   */
  listInstances(filters) {
    if (filters && filters.DBInstanceIdentifier) {
      const row = this._getInstanceRow(filters.DBInstanceIdentifier);
      if (!row) {
        this._throwError(
          'DBInstanceNotFoundFault',
          `Instância não encontrada: ${filters.DBInstanceIdentifier}`,
          404
        );
      }
      return [this._formatInstance(row)];
    }

    if (filters && filters.DBClusterIdentifier) {
      return this.metaDb.prepare(
        'SELECT * FROM instances WHERE db_cluster_identifier = ?'
      ).all(filters.DBClusterIdentifier).map(row => this._formatInstance(row));
    }

    return this.metaDb.prepare('SELECT * FROM instances').all().map(row => this._formatInstance(row));
  }

  // ─── Bancos de dados lógicos ────────────────────────────────────────────────

  /**
   * Registra um banco de dados lógico pertencente a um cluster.
   * @param {string} name - Nome do banco
   * @param {string} clusterId - Identificador do cluster
   * @returns {Object} Registro criado
   */
  createDatabase(name, clusterId) {
    this._validateDatabaseName(name);

    const cluster = this._getClusterRow(clusterId);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `Cluster não encontrado: ${clusterId}`, 404);
    }

    if (this.metaDb.prepare(
      'SELECT 1 FROM databases WHERE name = ? AND cluster_identifier = ?'
    ).get(name, clusterId)) {
      this._throwError('InvalidParameterValue', `Banco de dados já existe: ${name}`, 400);
    }

    this._registerDatabase(name, clusterId);
    logger.debug(`[SQL Server ClusterManager] Banco '${name}' registrado no cluster '${clusterId}'`);

    return this.metaDb.prepare(
      'SELECT * FROM databases WHERE name = ? AND cluster_identifier = ?'
    ).get(name, clusterId);
  }

  /**
   * Lista os bancos registrados em um cluster.
   * @param {string} clusterId - Identificador do cluster
   * @returns {Object[]} Registros de bancos
   */
  listDatabases(clusterId) {
    return this.metaDb.prepare(
      'SELECT * FROM databases WHERE cluster_identifier = ? ORDER BY name'
    ).all(clusterId);
  }

  /**
   * Remove o registro de um banco de dados lógico.
   * @param {string} name - Nome do banco
   * @param {string} clusterId - Identificador do cluster
   */
  deleteDatabase(name, clusterId) {
    this._validateDatabaseName(name);

    const result = this.metaDb.prepare(
      'DELETE FROM databases WHERE name = ? AND cluster_identifier = ?'
    ).run(name, clusterId);

    if (result.changes === 0) {
      this._throwError('InvalidParameterValue', `Banco de dados não encontrado: ${name}`, 404);
    }

    logger.debug(`[SQL Server ClusterManager] Banco '${name}' removido do cluster '${clusterId}'`);
    this._persistClusters();
  }

  // ─── Tags ───────────────────────────────────────────────────────────────────

  /**
   * Adiciona ou substitui tags de um recurso.
   * @param {string} resourceArn - ARN do recurso
   * @param {Array} tags - Lista de objetos { Key, Value }
   * @returns {Array} Tags resultantes
   */
  addTags(resourceArn, tags) {
    if (!Array.isArray(tags)) {
      this._throwError('InvalidParameterValue', 'Tags devem ser uma lista.', 400);
    }

    const stmt = this.metaDb.prepare(`
      INSERT INTO tags (resource_arn, key, value) VALUES (?, ?, ?)
      ON CONFLICT(resource_arn, key) DO UPDATE SET value = excluded.value
    `);

    for (const tag of tags) {
      if (!tag || !tag.Key) {
        this._throwError('InvalidParameterValue', 'Toda tag deve possuir Key.', 400);
      }
      stmt.run(resourceArn, tag.Key, String(tag.Value === undefined ? '' : tag.Value));
    }

    this._persistClusters();
    return this.listTags(resourceArn);
  }

  /**
   * Remove chaves de tag de um recurso.
   * @param {string} resourceArn - ARN do recurso
   * @param {string[]} keys - Chaves a remover
   * @returns {Array} Tags restantes
   */
  removeTags(resourceArn, keys) {
    if (!Array.isArray(keys)) {
      this._throwError('InvalidParameterValue', 'Keys devem ser uma lista.', 400);
    }

    const stmt = this.metaDb.prepare('DELETE FROM tags WHERE resource_arn = ? AND key = ?');
    for (const key of keys) {
      stmt.run(resourceArn, key);
    }

    this._persistClusters();
    return this.listTags(resourceArn);
  }

  /**
   * Lista as tags de um recurso no formato AWS.
   * @param {string} resourceArn - ARN do recurso
   * @returns {Array<{Key: string, Value: string}>} Tags do recurso
   */
  listTags(resourceArn) {
    return this.metaDb.prepare(
      'SELECT key, value FROM tags WHERE resource_arn = ? ORDER BY key'
    ).all(resourceArn).map(row => ({ Key: row.key, Value: row.value }));
  }

  // ─── Autenticação ───────────────────────────────────────────────────────────

  /**
   * Valida credenciais para o LOGIN7 do TDS.
   * @param {string} username - Nome de usuário mestre
   * @param {string} password - Senha informada
   * @param {string} [serverName] - Nome do servidor/instância solicitado
   * @returns {Object|null} Cluster autenticado ou null
   */
  verifyCredentials(username, password, serverName) {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return null;
    }

    const candidates = this.metaDb.prepare(
      'SELECT * FROM clusters WHERE master_username = ?'
    ).all(username);

    if (candidates.length === 0) {
      return null;
    }

    const alvo = typeof serverName === 'string' ? serverName.toLowerCase() : '';
    candidates.sort((a, b) => this._matchScore(b, alvo) - this._matchScore(a, alvo));

    for (const cluster of candidates) {
      if (this._checkPassword(password, cluster.master_password_salt, cluster.master_password_hash)) {
        return this._formatCluster(cluster);
      }
    }

    return null;
  }

  /**
   * Pontua a preferência de um cluster pelo nome de servidor informado.
   * @private
   */
  _matchScore(cluster, serverName) {
    if (!serverName) return 0;
    const identificador = String(cluster.db_cluster_identifier || '').toLowerCase();
    const endpoint = String(cluster.endpoint || '').toLowerCase();
    if (identificador === serverName || endpoint === serverName) return 3;
    if (identificador.startsWith(serverName) || endpoint.startsWith(serverName)) return 2;
    if (serverName.startsWith(identificador) || serverName.startsWith(endpoint)) return 1;
    return 0;
  }

  /**
   * Compara a senha informada com o hash salvo usando comparação de tempo constante.
   * @private
   */
  _checkPassword(password, salt, expectedHash) {
    if (!salt || !expectedHash) return false;

    const esperado = Buffer.from(expectedHash, 'hex');
    const calculado = crypto.scryptSync(password, salt, 64);

    return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
  }

  // ─── Persistência ───────────────────────────────────────────────────────────

  /**
   * Salva clusters, instâncias, tags e hash de senha no LocalStore.
   * @private
   */
  _persistClusters() {
    if (!this.store) return;

    const clusters = {};
    const clusterRows = this.metaDb.prepare('SELECT * FROM clusters').all();

    for (const row of clusterRows) {
      const formatado = this._formatCluster(row);
      const instancias = this.metaDb.prepare(
        'SELECT * FROM instances WHERE db_cluster_identifier = ? ORDER BY created_at, db_instance_identifier'
      ).all(row.db_cluster_identifier);

      clusters[row.db_cluster_identifier] = {
        ...formatado,
        MasterPasswordHash: row.master_password_hash,
        MasterPasswordSalt: row.master_password_salt,
        Engine: row.engine,
        EngineVersion: row.engine_version,
        instances: instancias.map(inst => ({
          DBInstanceIdentifier: inst.db_instance_identifier,
          DBInstanceArn: inst.db_instance_arn,
          DBClusterIdentifier: inst.db_cluster_identifier,
          DBInstanceClass: inst.db_instance_class,
          Engine: inst.engine,
          EngineVersion: inst.engine_version,
          Status: inst.db_instance_status,
          DBInstanceStatus: inst.db_instance_status,
          Endpoint: {
            Address: inst.endpoint_address,
            Port: inst.endpoint_port,
            HostedZoneId: 'Z1234567890'
          },
          IsClusterWriter: inst.is_cluster_writer === 1,
          AvailabilityZone: inst.availability_zone,
          LicenseModel: inst.license_model,
          CharacterSet: inst.character_set,
          Timezone: inst.timezone,
          CreatedAt: inst.created_at,
          UpdatedAt: inst.updated_at
        })),
        Tags: this.listTags(row.db_cluster_arn)
      };
    }

    const tags = {};
    for (const row of this.metaDb.prepare('SELECT * FROM tags ORDER BY key').all()) {
      if (!tags[row.resource_arn]) tags[row.resource_arn] = [];
      tags[row.resource_arn].push({ Key: row.key, Value: row.value });
    }

    this.store.write('__rds-sqlserver__', { clusters, tags });
    logger.debug('[SQL Server ClusterManager] Estado persistido em __rds-sqlserver__.json');
  }

  /**
   * Carrega o estado do LocalStore para o metadata.db. Idempotente.
   */
  loadClusters() {
    if (!this.store) return;

    const data = this.store.read('__rds-sqlserver__');
    if (!data || Array.isArray(data) || !data.clusters) {
      return;
    }

    const insertCluster = this.metaDb.prepare(`
      INSERT OR IGNORE INTO clusters (
        db_cluster_identifier, db_cluster_arn, engine, engine_version,
        status, endpoint, reader_endpoint, port, database_name,
        master_username, master_password_hash, master_password_salt,
        storage_encrypted, kms_key_id, db_cluster_resource_id,
        license_model, character_set, timezone, availability_zones,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertInstance = this.metaDb.prepare(`
      INSERT OR IGNORE INTO instances (
        db_instance_identifier, db_instance_arn, db_cluster_identifier,
        db_instance_class, engine, engine_version, db_instance_status,
        endpoint_address, endpoint_port, is_cluster_writer, availability_zone,
        license_model, character_set, timezone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTag = this.metaDb.prepare(`
      INSERT OR REPLACE INTO tags (resource_arn, key, value) VALUES (?, ?, ?)
    `);

    let carregados = 0;

    for (const clusterId of Object.keys(data.clusters)) {
      const cluster = data.clusters[clusterId] || {};
      const arn = cluster.DBClusterArn ||
        `arn:aws:rds:us-east-1:000000000000:cluster:${clusterId}`;
      const zones = cluster.AvailabilityZones || [];

      insertCluster.run(
        cluster.DBClusterIdentifier || clusterId,
        arn,
        cluster.Engine,
        cluster.EngineVersion,
        cluster.Status || 'available',
        cluster.Endpoint || `${clusterId}.cluster-local.us-east-1.rds.amazonaws.com`,
        cluster.ReaderEndpoint || `${clusterId}.cluster-ro-local.us-east-1.rds.amazonaws.com`,
        cluster.Port || DEFAULT_PORT,
        cluster.DatabaseName || null,
        cluster.MasterUsername,
        cluster.MasterPasswordHash || cluster.master_password_hash || '',
        cluster.MasterPasswordSalt || cluster.master_password_salt || '',
        cluster.StorageEncrypted ? 1 : 0,
        cluster.KmsKeyId || null,
        cluster.DbClusterResourceId ||
          `cluster-${crypto.randomUUID().replace(/-/g, '').substring(0, 26)}`,
        cluster.LicenseModel || DEFAULT_LICENSE_MODEL,
        cluster.CharacterSet || DEFAULT_CHARACTER_SET,
        cluster.Timezone || DEFAULT_TIMEZONE,
        JSON.stringify(zones),
        cluster.CreatedAt || new Date().toISOString(),
        cluster.UpdatedAt || cluster.CreatedAt || new Date().toISOString()
      );

      carregados++;

      if (cluster.DatabaseName) {
        this._registerDatabase(cluster.DatabaseName, clusterId);
      }

      if (Array.isArray(cluster.instances)) {
        cluster.instances.forEach((inst, index) => {
          insertInstance.run(
            inst.DBInstanceIdentifier,
            inst.DBInstanceArn ||
              `arn:aws:rds:us-east-1:000000000000:db:${inst.DBInstanceIdentifier}`,
            clusterId,
            inst.DBInstanceClass,
            inst.Engine || cluster.Engine,
            inst.EngineVersion || cluster.EngineVersion,
            inst.Status || inst.DBInstanceStatus || 'available',
            (inst.Endpoint && inst.Endpoint.Address) ||
              `${inst.DBInstanceIdentifier}.local.us-east-1.rds.amazonaws.com`,
            (inst.Endpoint && inst.Endpoint.Port) || cluster.Port || DEFAULT_PORT,
            inst.IsClusterWriter === undefined ? (index === 0 ? 1 : 0) : (inst.IsClusterWriter ? 1 : 0),
            inst.AvailabilityZone || 'us-east-1a',
            inst.LicenseModel || cluster.LicenseModel,
            inst.CharacterSet || cluster.CharacterSet,
            inst.Timezone || cluster.Timezone,
            inst.CreatedAt || new Date().toISOString(),
            inst.UpdatedAt || inst.CreatedAt || new Date().toISOString()
          );

          if (inst.DBInstanceArn && data.tags && data.tags[inst.DBInstanceArn]) {
            for (const tag of data.tags[inst.DBInstanceArn]) {
              insertTag.run(inst.DBInstanceArn, tag.Key, tag.Value);
            }
          }
        });
      }

      for (const tag of (cluster.Tags || (data.tags && data.tags[arn]) || [])) {
        insertTag.run(arn, tag.Key, tag.Value);
      }
    }

    if (carregados > 0) {
      logger.debug(`[SQL Server ClusterManager] ${carregados} cluster(s) carregado(s) de __rds-sqlserver__.json`);
    }
  }

  // ─── Ciclo de vida ──────────────────────────────────────────────────────────

  /**
   * Fecha a conexão com o metadata.db (idempotente).
   */
  close() {
    if (this.isClosed) return;

    try {
      if (this.metaDb) {
        this.metaDb.close();
      }
    } catch (err) {
      logger.debug(`[SQL Server ClusterManager] Erro ao fechar metadata.db: ${err.message}`);
    }

    this.metaDb = null;
    this.isClosed = true;
  }

  /**
   * Limpa todos os metadados sem fechar o banco antes da exclusão das linhas.
   */
  reset() {
    if (!this.metaDb) {
      this.initialize();
    }

    this.metaDb.prepare('DELETE FROM tags').run();
    this.metaDb.prepare('DELETE FROM databases').run();
    this.metaDb.prepare('DELETE FROM instances').run();
    this.metaDb.prepare('DELETE FROM clusters').run();

    logger.debug('[SQL Server ClusterManager] Metadados removidos');
    this._persistClusters();
  }

  // ─── Auxiliares privados ────────────────────────────────────────────────────

  /**
   * Valida identificadores de cluster e instância.
   * @private
   */
  _validateIdentifier(identifier, fieldName) {
    if (typeof identifier !== 'string' || !IDENTIFIER_PATTERN.test(identifier)) {
      this._throwError(
        'InvalidParameterValue',
        `${fieldName} inválido: '${identifier}'. Use de 1 a 63 caracteres, começando com letra minúscula e contendo apenas letras minúsculas, números e hífens.`,
        400
      );
    }
  }

  /**
   * Valida e normaliza a porta informada.
   * @private
   */
  _normalizePort(port) {
    if (port === undefined || port === null || port === '') {
      return DEFAULT_PORT;
    }

    const normalizada = Number(port);
    if (!Number.isInteger(normalizada) || normalizada < 1 || normalizada > 65535) {
      this._throwError(
        'InvalidParameterValue',
        `Porta inválida: ${port}. Deve estar entre 1 e 65535.`,
        400
      );
    }

    return normalizada;
  }

  /**
   * Valida o nome de um banco de dados lógico.
   * @private
   */
  _validateDatabaseName(name) {
    if (typeof name !== 'string' || name.length < 1 || name.length > 128) {
      this._throwError('InvalidParameterValue', 'Nome de banco de dados inválido.', 400);
    }
  }

  /**
   * Registra um banco de dados, se informado.
   * @private
   */
  _registerDatabase(name, clusterId) {
    if (!name || !clusterId) return;

    this.metaDb.prepare(
      'INSERT OR IGNORE INTO databases (name, cluster_identifier) VALUES (?, ?)'
    ).run(name, clusterId);
  }

  /**
   * Busca a linha bruta de um cluster.
   * @private
   */
  _getClusterRow(identifier) {
    return this.metaDb.prepare(
      'SELECT * FROM clusters WHERE db_cluster_identifier = ?'
    ).get(identifier);
  }

  /**
   * Busca a linha bruta de uma instância.
   * @private
   */
  _getInstanceRow(identifier) {
    return this.metaDb.prepare(
      'SELECT * FROM instances WHERE db_instance_identifier = ?'
    ).get(identifier);
  }

  /**
   * Formata uma linha de cluster no formato da API AWS.
   * @private
   */
  _formatCluster(row) {
    if (!row) return null;

    const members = this.metaDb.prepare(
      'SELECT db_instance_identifier, is_cluster_writer FROM instances WHERE db_cluster_identifier = ?'
    ).all(row.db_cluster_identifier).map(inst => ({
      DBInstanceIdentifier: inst.db_instance_identifier,
      IsClusterWriter: inst.is_cluster_writer === 1
    }));

    return {
      DBClusterIdentifier: row.db_cluster_identifier,
      DBClusterArn: row.db_cluster_arn,
      Engine: row.engine,
      EngineVersion: row.engine_version,
      Status: row.status,
      Endpoint: row.endpoint,
      ReaderEndpoint: row.reader_endpoint,
      Port: row.port,
      DatabaseName: row.database_name,
      MasterUsername: row.master_username,
      StorageEncrypted: row.storage_encrypted === 1,
      KmsKeyId: row.kms_key_id,
      DbClusterResourceId: row.db_cluster_resource_id,
      LicenseModel: row.license_model,
      CharacterSet: row.character_set,
      Timezone: row.timezone,
      AvailabilityZones: row.availability_zones ? JSON.parse(row.availability_zones) : [],
      DBClusterMembers: members,
      CreatedAt: row.created_at,
      UpdatedAt: row.updated_at
    };
  }

  /**
   * Formata uma linha de instância no formato da API AWS.
   * @private
   */
  _formatInstance(row) {
    if (!row) return null;

    return {
      DBInstanceIdentifier: row.db_instance_identifier,
      DBInstanceArn: row.db_instance_arn,
      DBClusterIdentifier: row.db_cluster_identifier,
      DBInstanceClass: row.db_instance_class,
      Engine: row.engine,
      EngineVersion: row.engine_version,
      DBInstanceStatus: row.db_instance_status,
      Endpoint: {
        Address: row.endpoint_address,
        Port: row.endpoint_port,
        HostedZoneId: 'Z1234567890'
      },
      IsClusterWriter: row.is_cluster_writer === 1,
      AvailabilityZone: row.availability_zone,
      LicenseModel: row.license_model,
      CharacterSet: row.character_set,
      Timezone: row.timezone,
      CreatedAt: row.created_at,
      UpdatedAt: row.updated_at
    };
  }

  /**
   * Lança erro estruturado no formato AWS.
   * @private
   */
  _throwError(code, message, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    throw error;
  }
}

module.exports = { ClusterManager };
