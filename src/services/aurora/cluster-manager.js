'use strict';

/**
 * Cluster Manager - Gerencia metadados de clusters e instâncias Aurora.
 * Persiste dados em metadata.db usando better-sqlite3.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../utils/logger');

// Valid engine versions
const VALID_ENGINE_VERSIONS = {
  'aurora-mysql': [
    '5.7.mysql_aurora.2.11.3',
    '8.0.mysql_aurora.3.04.0',
    '8.0.mysql_aurora.3.05.2'
  ],
  'aurora-postgresql': [
    '13.12',
    '14.9',
    '15.4',
    '16.1'
  ]
};

// Validation patterns
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const INSTANCE_CLASS_PATTERN = /^db\..+$/;

// Default ports by engine
const DEFAULT_PORTS = {
  'aurora-mysql': 3306,
  'aurora-postgresql': 5432
};

class ClusterManager {
  constructor(dataDir, store = null) {
    this.dataDir = dataDir;
    this.metaDb = null;
    this.store = store;

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });
  }

  /**
   * Initializes the metadata database and creates schema tables.
   */
  initialize() {
    const dbPath = path.join(this.dataDir, 'metadata.db');
    this.metaDb = new Database(dbPath);

    // Performance optimizations
    this.metaDb.pragma('journal_mode = WAL');
    this.metaDb.pragma('foreign_keys = ON');

    this._createSchema();
    this.loadClusters();
    logger.debug('[Aurora ClusterManager] Initialized metadata.db');
  }

  /**
   * Creates the schema tables if they don't exist.
   * @private
   */
  _createSchema() {
    this.metaDb.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        db_cluster_identifier TEXT PRIMARY KEY,
        db_cluster_arn TEXT UNIQUE NOT NULL,
        engine TEXT NOT NULL CHECK(engine IN ('aurora-mysql', 'aurora-postgresql')),
        engine_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        endpoint TEXT,
        reader_endpoint TEXT,
        port INTEGER NOT NULL,
        database_name TEXT,
        master_username TEXT NOT NULL,
        storage_encrypted INTEGER DEFAULT 0,
        kms_key_id TEXT,
        db_cluster_resource_id TEXT UNIQUE NOT NULL,
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS databases (
        name TEXT NOT NULL,
        cluster_identifier TEXT NOT NULL REFERENCES clusters(db_cluster_identifier),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (name, cluster_identifier)
      );
    `);
  }

  // ─── Cluster Operations ─────────────────────────────────────────────────────

  /**
   * Creates a new Aurora cluster with full validation.
   * @param {Object} params - Cluster creation parameters
   * @returns {Object} The created cluster object
   */
  createCluster(params) {
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
      AvailabilityZones
    } = params;

    // Validate identifier
    this._validateIdentifier(DBClusterIdentifier, 'DBClusterIdentifier');

    // Validate engine
    if (!['aurora-mysql', 'aurora-postgresql'].includes(Engine)) {
      this._throwError('InvalidParameterValue', `Invalid engine: ${Engine}. Must be 'aurora-mysql' or 'aurora-postgresql'.`, 400);
    }

    // Validate engine version
    const validVersions = VALID_ENGINE_VERSIONS[Engine];
    if (!validVersions || !validVersions.includes(EngineVersion)) {
      this._throwError('InvalidParameterValue', `Invalid engine version: ${EngineVersion} for engine ${Engine}. Valid versions: ${validVersions.join(', ')}`, 400);
    }

    // Validate master username
    const maxUsernameLen = Engine === 'aurora-mysql' ? 16 : 63;
    if (!MasterUsername || MasterUsername.length < 1 || MasterUsername.length > maxUsernameLen) {
      this._throwError('InvalidParameterValue', `MasterUsername must be 1-${maxUsernameLen} characters for ${Engine}.`, 400);
    }

    // Validate master password
    if (!MasterUserPassword || MasterUserPassword.length < 8 || MasterUserPassword.length > 128) {
      this._throwError('InvalidParameterValue', 'MasterUserPassword must be 8-128 characters.', 400);
    }

    // Validate port
    const port = Port || DEFAULT_PORTS[Engine];
    if (port < 1150 || port > 65535) {
      this._throwError('InvalidParameterValue', `Port must be between 1150 and 65535. Got: ${port}`, 400);
    }

    // Check for duplicates
    const existing = this._getClusterRow(DBClusterIdentifier);
    if (existing) {
      this._throwError('DBClusterAlreadyExistsFault', `DB Cluster already exists: ${DBClusterIdentifier}`, 400);
    }

    // Generate ARN and endpoints
    const arn = `arn:aws:rds:us-east-1:000000000000:cluster:${DBClusterIdentifier}`;
    const endpoint = `${DBClusterIdentifier}.cluster-local.us-east-1.rds.amazonaws.com`;
    const readerEndpoint = `${DBClusterIdentifier}.cluster-ro-local.us-east-1.rds.amazonaws.com`;
    const resourceId = `cluster-${crypto.randomUUID().replace(/-/g, '').substring(0, 26)}`;
    const zones = AvailabilityZones || ['us-east-1a', 'us-east-1b', 'us-east-1c'];

    // Insert into database
    const stmt = this.metaDb.prepare(`
      INSERT INTO clusters (
        db_cluster_identifier, db_cluster_arn, engine, engine_version,
        status, endpoint, reader_endpoint, port, database_name,
        master_username, storage_encrypted, kms_key_id,
        db_cluster_resource_id, availability_zones
      ) VALUES (?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      DBClusterIdentifier,
      arn,
      Engine,
      EngineVersion,
      endpoint,
      readerEndpoint,
      port,
      DatabaseName || null,
      MasterUsername,
      StorageEncrypted ? 1 : 0,
      KmsKeyId || null,
      resourceId,
      JSON.stringify(zones)
    );

    // If a DatabaseName is provided, register it in the databases table
    if (DatabaseName) {
      const dbStmt = this.metaDb.prepare(
        'INSERT OR IGNORE INTO databases (name, cluster_identifier) VALUES (?, ?)'
      );
      dbStmt.run(DatabaseName, DBClusterIdentifier);
    }

    logger.debug(`[Aurora ClusterManager] Cluster '${DBClusterIdentifier}' created`);
    this._persistClusters();

    return this._formatCluster(this._getClusterRow(DBClusterIdentifier));
  }

  /**
   * Deletes a cluster and all associated instances and databases.
   * @param {string} identifier - DBClusterIdentifier
   */
  deleteCluster(identifier) {
    const cluster = this._getClusterRow(identifier);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `DB Cluster not found: ${identifier}`, 404);
    }

    // Delete associated databases
    this.metaDb.prepare('DELETE FROM databases WHERE cluster_identifier = ?').run(identifier);

    // Delete associated instances
    this.metaDb.prepare('DELETE FROM instances WHERE db_cluster_identifier = ?').run(identifier);

    // Delete the cluster
    this.metaDb.prepare('DELETE FROM clusters WHERE db_cluster_identifier = ?').run(identifier);

    logger.debug(`[Aurora ClusterManager] Cluster '${identifier}' deleted`);
    this._persistClusters();
  }

  /**
   * Gets a single cluster by identifier.
   * @param {string} identifier - DBClusterIdentifier
   * @returns {Object} The cluster object
   */
  getCluster(identifier) {
    const row = this._getClusterRow(identifier);
    if (!row) {
      this._throwError('DBClusterNotFoundFault', `DB Cluster not found: ${identifier}`, 404);
    }
    return this._formatCluster(row);
  }

  /**
   * Lists all clusters, optionally filtered.
   * @param {Object} [filters] - Optional filters (e.g., { DBClusterIdentifier })
   * @returns {Object[]} Array of cluster objects
   */
  listClusters(filters) {
    if (filters && filters.DBClusterIdentifier) {
      const row = this._getClusterRow(filters.DBClusterIdentifier);
      if (!row) {
        this._throwError('DBClusterNotFoundFault', `DB Cluster not found: ${filters.DBClusterIdentifier}`, 404);
      }
      return [this._formatCluster(row)];
    }

    const rows = this.metaDb.prepare('SELECT * FROM clusters').all();
    return rows.map(row => this._formatCluster(row));
  }

  /**
   * Gets a cluster by its ARN (used by Data API for resourceArn resolution).
   * @param {string} arn - The cluster ARN
   * @returns {Object|null} The cluster object or null if not found
   */
  getClusterByArn(arn) {
    const row = this.metaDb.prepare('SELECT * FROM clusters WHERE db_cluster_arn = ?').get(arn);
    if (!row) {
      return null;
    }
    return this._formatCluster(row);
  }

  /**
   * Updates a cluster's fields.
   * @param {string} identifier - DBClusterIdentifier
   * @param {Object} fields - Fields to update
   * @returns {Object} The updated cluster object
   */
  updateCluster(identifier, fields) {
    const cluster = this._getClusterRow(identifier);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `DB Cluster not found: ${identifier}`, 404);
    }

    const allowedFields = {
      engine_version: fields.EngineVersion,
      port: fields.Port,
      master_username: fields.MasterUsername,
      database_name: fields.DatabaseName,
      storage_encrypted: fields.StorageEncrypted !== undefined ? (fields.StorageEncrypted ? 1 : 0) : undefined,
      kms_key_id: fields.KmsKeyId,
      status: fields.Status
    };

    const setClauses = [];
    const values = [];

    for (const [col, val] of Object.entries(allowedFields)) {
      if (val !== undefined) {
        setClauses.push(`${col} = ?`);
        values.push(val);
      }
    }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = datetime('now')");
      values.push(identifier);

      const sql = `UPDATE clusters SET ${setClauses.join(', ')} WHERE db_cluster_identifier = ?`;
      this.metaDb.prepare(sql).run(...values);
    }

    logger.debug(`[Aurora ClusterManager] Cluster '${identifier}' updated`);
    this._persistClusters();
    return this._formatCluster(this._getClusterRow(identifier));
  }

  // ─── Instance Operations ────────────────────────────────────────────────────

  /**
   * Creates a new instance within a cluster.
   * @param {Object} params - Instance creation parameters
   * @returns {Object} The created instance object
   */
  createInstance(params) {
    const {
      DBInstanceIdentifier,
      DBClusterIdentifier,
      DBInstanceClass,
      Engine,
      EngineVersion
    } = params;

    // Validate instance identifier
    this._validateIdentifier(DBInstanceIdentifier, 'DBInstanceIdentifier');

    // Validate instance class
    if (!DBInstanceClass || !INSTANCE_CLASS_PATTERN.test(DBInstanceClass)) {
      this._throwError('InvalidParameterValue', `Invalid DBInstanceClass: ${DBInstanceClass}. Must match pattern 'db.*' (e.g., db.r5.large).`, 400);
    }

    // Verify cluster exists
    const cluster = this._getClusterRow(DBClusterIdentifier);
    if (!cluster) {
      this._throwError('DBClusterNotFoundFault', `DB Cluster not found: ${DBClusterIdentifier}`, 404);
    }

    // Check for duplicate instance
    const existingInstance = this._getInstanceRow(DBInstanceIdentifier);
    if (existingInstance) {
      this._throwError('InvalidParameterValue', `DB Instance already exists: ${DBInstanceIdentifier}`, 400);
    }

    // Determine engine info from cluster if not provided
    const engine = Engine || cluster.engine;
    const engineVersion = EngineVersion || cluster.engine_version;

    // Generate ARN and endpoint
    const arn = `arn:aws:rds:us-east-1:000000000000:db:${DBInstanceIdentifier}`;
    const endpointAddress = `${DBInstanceIdentifier}.local.us-east-1.rds.amazonaws.com`;
    const endpointPort = cluster.port;

    // Determine if this is the first instance (writer)
    const existingInstances = this.metaDb.prepare(
      'SELECT COUNT(*) as count FROM instances WHERE db_cluster_identifier = ?'
    ).get(DBClusterIdentifier);
    const isWriter = existingInstances.count === 0 ? 1 : 0;

    const availabilityZone = 'us-east-1a';

    // Insert into database
    const stmt = this.metaDb.prepare(`
      INSERT INTO instances (
        db_instance_identifier, db_instance_arn, db_cluster_identifier,
        db_instance_class, engine, engine_version, db_instance_status,
        endpoint_address, endpoint_port, is_cluster_writer, availability_zone
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?)
    `);

    stmt.run(
      DBInstanceIdentifier,
      arn,
      DBClusterIdentifier,
      DBInstanceClass,
      engine,
      engineVersion,
      endpointAddress,
      endpointPort,
      isWriter,
      availabilityZone
    );

    logger.debug(`[Aurora ClusterManager] Instance '${DBInstanceIdentifier}' created in cluster '${DBClusterIdentifier}'`);
    this._persistClusters();

    return this._formatInstance(this._getInstanceRow(DBInstanceIdentifier));
  }

  /**
   * Deletes an instance.
   * @param {string} identifier - DBInstanceIdentifier
   */
  deleteInstance(identifier) {
    const instance = this._getInstanceRow(identifier);
    if (!instance) {
      this._throwError('DBInstanceNotFoundFault', `DB Instance not found: ${identifier}`, 404);
    }

    this.metaDb.prepare('DELETE FROM instances WHERE db_instance_identifier = ?').run(identifier);
    logger.debug(`[Aurora ClusterManager] Instance '${identifier}' deleted`);
    this._persistClusters();
  }

  /**
   * Gets a single instance by identifier.
   * @param {string} identifier - DBInstanceIdentifier
   * @returns {Object} The instance object
   */
  getInstance(identifier) {
    const row = this._getInstanceRow(identifier);
    if (!row) {
      this._throwError('DBInstanceNotFoundFault', `DB Instance not found: ${identifier}`, 404);
    }
    return this._formatInstance(row);
  }

  /**
   * Lists all instances, optionally filtered.
   * @param {Object} [filters] - Optional filters
   * @returns {Object[]} Array of instance objects
   */
  listInstances(filters) {
    if (filters && filters.DBInstanceIdentifier) {
      const row = this._getInstanceRow(filters.DBInstanceIdentifier);
      if (!row) {
        this._throwError('DBInstanceNotFoundFault', `DB Instance not found: ${filters.DBInstanceIdentifier}`, 404);
      }
      return [this._formatInstance(row)];
    }

    if (filters && filters.DBClusterIdentifier) {
      const rows = this.metaDb.prepare(
        'SELECT * FROM instances WHERE db_cluster_identifier = ?'
      ).all(filters.DBClusterIdentifier);
      return rows.map(row => this._formatInstance(row));
    }

    const rows = this.metaDb.prepare('SELECT * FROM instances').all();
    return rows.map(row => this._formatInstance(row));
  }

  // ─── Reset ──────────────────────────────────────────────────────────────────

  /**
   * Clears all metadata (clusters, instances, databases).
   */
  reset() {
    this.metaDb.prepare('DELETE FROM databases').run();
    this.metaDb.prepare('DELETE FROM instances').run();
    this.metaDb.prepare('DELETE FROM clusters').run();
    logger.debug('[Aurora ClusterManager] All metadata cleared');
  }

  /**
   * Persists all clusters and instances to __aurora__.json via LocalStore.
   * No-op if store is null.
   * @private
   */
  _persistClusters() {
    if (!this.store) return;

    const clusters = this.listClusters();
    const clustersObj = {};

    for (const cluster of clusters) {
      const instances = this.listInstances({ DBClusterIdentifier: cluster.DBClusterIdentifier });
      
      clustersObj[cluster.DBClusterIdentifier] = {
        DBClusterIdentifier: cluster.DBClusterIdentifier,
        DBClusterArn: cluster.DBClusterArn,
        Engine: cluster.Engine,
        EngineVersion: cluster.EngineVersion,
        Status: cluster.Status,
        Endpoint: cluster.Endpoint,
        ReaderEndpoint: cluster.ReaderEndpoint,
        Port: cluster.Port,
        DatabaseName: cluster.DatabaseName,
        MasterUsername: cluster.MasterUsername,
        StorageEncrypted: cluster.StorageEncrypted,
        KmsKeyId: cluster.KmsKeyId,
        DbClusterResourceId: cluster.DbClusterResourceId,
        AvailabilityZones: cluster.AvailabilityZones,
        CreatedAt: cluster.CreatedAt,
        UpdatedAt: cluster.UpdatedAt,
        instances: instances.map(inst => ({
          DBInstanceIdentifier: inst.DBInstanceIdentifier,
          DBInstanceArn: inst.DBInstanceArn,
          DBInstanceClass: inst.DBInstanceClass,
          Status: inst.DBInstanceStatus,
          CreatedAt: inst.CreatedAt,
          UpdatedAt: inst.UpdatedAt
        }))
      };
    }

    this.store.write('__aurora__', { clusters: clustersObj });
    logger.debug('[Aurora ClusterManager] Persisted clusters to __aurora__.json');
  }

  /**
   * Loads clusters and instances from __aurora__.json if it exists.
   * Idempotent: skips clusters/instances that already exist in metadata.db.
   * No-op if store is null.
   */
  loadClusters() {
    if (!this.store) return;

    const data = this.store.read('__aurora__');
    if (!data || !data.clusters) {
      // File doesn't exist or is malformed
      return;
    }

    let loadedCount = 0;
    const clusterIds = Object.keys(data.clusters);

    for (const clusterId of clusterIds) {
      const clusterData = data.clusters[clusterId];

      // Check if cluster already exists (idempotent)
      if (this._getClusterRow(clusterId)) {
        continue;
      }

      // Insert cluster row
      try {
        const stmt = this.metaDb.prepare(`
          INSERT OR IGNORE INTO clusters (
            db_cluster_identifier, db_cluster_arn, engine, engine_version,
            status, endpoint, reader_endpoint, port, database_name,
            master_username, storage_encrypted, kms_key_id,
            db_cluster_resource_id, availability_zones, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          clusterData.DBClusterIdentifier,
          clusterData.DBClusterArn,
          clusterData.Engine,
          clusterData.EngineVersion,
          clusterData.Status,
          clusterData.Endpoint,
          clusterData.ReaderEndpoint,
          clusterData.Port,
          clusterData.DatabaseName || null,
          clusterData.MasterUsername,
          clusterData.StorageEncrypted ? 1 : 0,
          clusterData.KmsKeyId || null,
          clusterData.DbClusterResourceId,
          JSON.stringify(clusterData.AvailabilityZones || []),
          clusterData.CreatedAt,
          clusterData.UpdatedAt
        );

        loadedCount++;

        // Insert instances for this cluster
        if (clusterData.instances && Array.isArray(clusterData.instances)) {
          const instStmt = this.metaDb.prepare(`
            INSERT OR IGNORE INTO instances (
              db_instance_identifier, db_instance_arn, db_cluster_identifier,
              db_instance_class, engine, engine_version, db_instance_status,
              endpoint_address, endpoint_port, is_cluster_writer, availability_zone,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          // Infer engine info from cluster
          for (let i = 0; i < clusterData.instances.length; i++) {
            const inst = clusterData.instances[i];
            instStmt.run(
              inst.DBInstanceIdentifier,
              inst.DBInstanceArn,
              clusterId,
              inst.DBInstanceClass,
              clusterData.Engine,
              clusterData.EngineVersion,
              inst.Status,
              `${inst.DBInstanceIdentifier}.local.us-east-1.rds.amazonaws.com`,
              clusterData.Port,
              i === 0 ? 1 : 0, // First instance is writer
              'us-east-1a',
              inst.CreatedAt,
              inst.UpdatedAt
            );
          }
        }
      } catch (e) {
        logger.debug(`[Aurora ClusterManager] Failed to load cluster ${clusterId}: ${e.message}`);
      }
    }

    if (loadedCount > 0) {
      logger.debug(`[Aurora ClusterManager] Loaded ${loadedCount} clusters from __aurora__.json`);
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Validates a cluster or instance identifier.
   * @private
   */
  _validateIdentifier(identifier, fieldName) {
    if (!identifier || !IDENTIFIER_PATTERN.test(identifier)) {
      this._throwError(
        'InvalidParameterValue',
        `Invalid ${fieldName}: '${identifier}'. Must be 1-63 characters, start with a letter, and contain only lowercase letters, numbers, and hyphens.`,
        400
      );
    }
  }

  /**
   * Gets a raw cluster row from the database.
   * @private
   */
  _getClusterRow(identifier) {
    return this.metaDb.prepare('SELECT * FROM clusters WHERE db_cluster_identifier = ?').get(identifier);
  }

  /**
   * Gets a raw instance row from the database.
   * @private
   */
  _getInstanceRow(identifier) {
    return this.metaDb.prepare('SELECT * FROM instances WHERE db_instance_identifier = ?').get(identifier);
  }

  /**
   * Formats a raw cluster row into the AuroraCluster object shape.
   * @private
   */
  _formatCluster(row) {
    if (!row) return null;

    // Get associated instances
    const instances = this.metaDb.prepare(
      'SELECT db_instance_identifier, is_cluster_writer FROM instances WHERE db_cluster_identifier = ?'
    ).all(row.db_cluster_identifier);

    const members = instances.map(inst => ({
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
      AvailabilityZones: row.availability_zones ? JSON.parse(row.availability_zones) : [],
      DBClusterMembers: members,
      CreatedAt: row.created_at,
      UpdatedAt: row.updated_at
    };
  }

  /**
   * Formats a raw instance row into the AuroraInstance object shape.
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
      CreatedAt: row.created_at,
      UpdatedAt: row.updated_at
    };
  }

  /**
   * Throws a structured error matching AWS error format.
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
