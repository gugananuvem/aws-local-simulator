/**
 * SQLite Store - Um arquivo .db por tabela + __tables__.json para metadados
 * Mantém compatibilidade 100% com LocalStore API
 * Com índices otimizados para DynamoDB queries
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../utils/logger');

class SQLiteStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.databases = new Map();
    this.metadataFile = path.join(dataDir, '__tables__.json');
    this.preparedStatements = new Map(); // Cache de statements preparados
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Carrega metadados do arquivo JSON (compatível com LocalStore)
   */
  loadMetadata() {
    if (fs.existsSync(this.metadataFile)) {
      try {
        const data = fs.readFileSync(this.metadataFile, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        logger.warn(`Erro ao ler ${this.metadataFile}: ${error.message}`);
        return {};
      }
    }
    return {};
  }

  /**
   * Salva metadados no arquivo JSON (compatível com LocalStore)
   */
  saveMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
      logger.verboso(`Metadados salvos em ${this.metadataFile}`);
    } catch (error) {
      logger.error(`Erro ao salvar ${this.metadataFile}: ${error.message}`);
    }
  }

  /**
   * Obtém ou cria conexão com banco da tabela
   */
  getDatabase(tableName) {
    if (this.databases.has(tableName)) {
      return this.databases.get(tableName);
    }
    
    const dbPath = path.join(this.dataDir, `${tableName}.db`);
    const isNew = !fs.existsSync(dbPath);
    
    const db = new Database(dbPath);
    
    // Otimizações de performance
    db.pragma('journal_mode = WAL');
    db.pragma('cache_size = -20000'); // 20MB cache
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456'); // 256MB mmap
    db.pragma('page_size = 4096');
    
    this.databases.set(tableName, db);
    
    if (isNew) {
      this.initTableDatabase(db, tableName);
    } else {
      this.prepareStatements(db, tableName);
    }
    
    return db;
  }

  /**
   * Prepara statements otimizados para a tabela
   */
  prepareStatements(db, tableName) {
    const statementCache = new Map();
    
    statementCache.set('getItem', db.prepare(`
      SELECT data, _created_at, _updated_at 
      FROM items 
      WHERE pk_hash = ? AND (pk_range = ? OR (pk_range IS NULL AND ? IS NULL))
    `));
    
    statementCache.set('putItem', db.prepare(`
      INSERT OR REPLACE INTO items (pk_hash, pk_range, data, _created_at, _updated_at)
      VALUES (?, ?, ?, ?, ?)
    `));
    
    statementCache.set('deleteItem', db.prepare(`
      DELETE FROM items 
      WHERE pk_hash = ? AND (pk_range = ? OR (pk_range IS NULL AND ? IS NULL))
    `));
    
    statementCache.set('countItems', db.prepare(`SELECT COUNT(*) as count FROM items`));
    statementCache.set('truncate', db.prepare(`DELETE FROM items`));
    statementCache.set('tableSize', db.prepare(`SELECT SUM(LENGTH(data)) as size FROM items`));
    
    this.preparedStatements.set(tableName, statementCache);
  }

  /**
   * Inicializa schema do banco da tabela
   */
  initTableDatabase(db, tableName) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        pk_hash TEXT NOT NULL,
        pk_range TEXT,
        data TEXT NOT NULL,
        _created_at TEXT NOT NULL,
        _updated_at TEXT NOT NULL,
        PRIMARY KEY (pk_hash, pk_range)
      );
      
      CREATE INDEX IF NOT EXISTS idx_items_updated 
      ON items (_updated_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_items_pk_hash 
      ON items (pk_hash);
      
      CREATE INDEX IF NOT EXISTS idx_items_pk_range 
      ON items (pk_range);
    `);
    
    this.prepareStatements(db, tableName);
    logger.debug(`Banco de dados inicializado: ${tableName}.db`);
  }

  /**
   * Sanitiza nome para uso em SQL
   */
  sanitizeIdentifier(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Extrai valor de atributo do DynamoDB (suporta tipos S/N)
   */
  extractAttributeValue(attribute) {
    if (!attribute || typeof attribute !== 'object') return attribute;
    
    if (attribute.S !== undefined) return attribute.S;
    if (attribute.N !== undefined) return parseFloat(attribute.N);
    if (attribute.BOOL !== undefined) return attribute.BOOL;
    if (attribute.NULL !== undefined) return null;
    
    return attribute;
  }

  /**
   * Cria índices para Global Secondary Indexes
   */
  createGSIIndices(db, tableName, globalSecondaryIndexes) {
    if (!globalSecondaryIndexes) return;
    
    for (const [indexName, gsi] of Object.entries(globalSecondaryIndexes)) {
      try {
        const safeIndexName = this.sanitizeIdentifier(indexName);
        const hashKey = this.sanitizeIdentifier(gsi.hashKey);
        
        // Drop existing index if any
        db.exec(`DROP INDEX IF EXISTS idx_gsi_${safeIndexName}`);
        
        if (gsi.rangeKey) {
          const rangeKey = this.sanitizeIdentifier(gsi.rangeKey);
          const indexSQL = `
            CREATE INDEX IF NOT EXISTS idx_gsi_${safeIndexName}
            ON items (json_extract(data, '$."${hashKey}"'), json_extract(data, '$."${rangeKey}"'))
            WHERE json_extract(data, '$."${hashKey}"') IS NOT NULL
          `;
          db.exec(indexSQL);
          logger.debug(`Índice GSI composto criado: ${tableName}.${indexName}`);
        } else {
          const indexSQL = `
            CREATE INDEX IF NOT EXISTS idx_gsi_${safeIndexName}
            ON items (json_extract(data, '$."${hashKey}"'))
            WHERE json_extract(data, '$."${hashKey}"') IS NOT NULL
          `;
          db.exec(indexSQL);
          logger.debug(`Índice GSI simples criado: ${tableName}.${indexName}`);
        }
        
        // Índice adicional para queries com begins_with
        if (gsi.rangeKey) {
          const rangeKey = this.sanitizeIdentifier(gsi.rangeKey);
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_gsi_${safeIndexName}_prefix
            ON items (json_extract(data, '$."${hashKey}"'), json_extract(data, '$."${rangeKey}"') COLLATE NOCASE)
          `);
        }
      } catch (error) {
        logger.warn(`Erro ao criar índice GSI ${indexName}: ${error.message}`);
      }
    }
  }

  /**
   * Cria tabela (API compatível com LocalStore)
   */
  createTable(tableDef) {
    const metadata = this.loadMetadata();
    
    metadata[tableDef.name] = {
      name: tableDef.name,
      hashKey: tableDef.hashKey,
      rangeKey: tableDef.rangeKey,
      attributeTypes: tableDef.attributeTypes,
      globalSecondaryIndexes: tableDef.globalSecondaryIndexes,
      createdAt: tableDef.createdAt || new Date().toISOString(),
      itemCount: tableDef.itemCount || 0,
      sizeBytes: tableDef.sizeBytes || 0
    };
    
    this.saveMetadata(metadata);
    
    const db = this.getDatabase(tableDef.name);
    
    if (tableDef.globalSecondaryIndexes && Object.keys(tableDef.globalSecondaryIndexes).length > 0) {
      this.createGSIIndices(db, tableDef.name, tableDef.globalSecondaryIndexes);
    }
    
    logger.debug(`Tabela criada: ${tableDef.name}.db`);
    return metadata[tableDef.name];
  }

  /**
   * Obtém definição da tabela
   */
  getTable(tableName) {
    const metadata = this.loadMetadata();
    return metadata[tableName] || null;
  }

  /**
   * Obtém todas as tabelas
   */
  getAllTables() {
    const metadata = this.loadMetadata();
    const tables = new Map();
    
    for (const [tableName, tableDef] of Object.entries(metadata)) {
      tables.set(tableName, tableDef);
    }
    
    return tables;
  }

  /**
   * Verifica se tabela existe
   */
  exists(tableName) {
    const metadata = this.loadMetadata();
    return !!metadata[tableName];
  }

  /**
   * Remove tabela
   */
  deleteTable(tableName) {
    const metadata = this.loadMetadata();
    delete metadata[tableName];
    this.saveMetadata(metadata);
    
    if (this.databases.has(tableName)) {
      this.databases.get(tableName).close();
      this.databases.delete(tableName);
    }
    
    this.preparedStatements.delete(tableName);
    
    const dbPath = path.join(this.dataDir, `${tableName}.db`);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      logger.debug(`Arquivo removido: ${tableName}.db`);
    }
    
    const walPath = path.join(this.dataDir, `${tableName}.db-wal`);
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    
    const shmPath = path.join(this.dataDir, `${tableName}.db-shm`);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    
    logger.debug(`Tabela removida: ${tableName}`);
  }

  /**
   * Atualiza estatísticas da tabela
   */
  updateTableStats(tableName, itemCount, sizeBytes) {
    const metadata = this.loadMetadata();
    
    if (metadata[tableName]) {
      metadata[tableName].itemCount = itemCount;
      metadata[tableName].sizeBytes = sizeBytes;
      this.saveMetadata(metadata);
    }
  }

  /**
   * Insere ou atualiza item (API otimizada)
   */
  putItem(tableName, pkHash, pkRange, item, createdAt, updatedAt) {
    const db = this.getDatabase(tableName);
    const stmtCache = this.preparedStatements.get(tableName);
    const stmt = stmtCache ? stmtCache.get('putItem') : 
                 db.prepare(`INSERT OR REPLACE INTO items (pk_hash, pk_range, data, _created_at, _updated_at) VALUES (?, ?, ?, ?, ?)`);
    
    // Remove campos internos do data
    const { _createdAt, _updatedAt, ...itemData } = item;
    
    stmt.run(
      pkHash,
      pkRange || null,
      JSON.stringify(itemData),
      createdAt || updatedAt,
      updatedAt
    );
    
    return { success: true };
  }

  /**
   * Obtém item por chave
   */
  getItem(tableName, pkHash, pkRange) {
    const db = this.getDatabase(tableName);
    const stmtCache = this.preparedStatements.get(tableName);
    const stmt = stmtCache ? stmtCache.get('getItem') : 
                 db.prepare(`SELECT data, _created_at, _updated_at FROM items WHERE pk_hash = ? AND (pk_range = ? OR (pk_range IS NULL AND ? IS NULL))`);
    
    const row = stmt.get(pkHash, pkRange, pkRange);
    if (!row) return null;
    
    const item = JSON.parse(row.data);
    item._createdAt = row._created_at;
    item._updatedAt = row._updated_at;
    
    return item;
  }

  /**
   * Remove item
   */
  deleteItem(tableName, pkHash, pkRange) {
    const db = this.getDatabase(tableName);
    const stmtCache = this.preparedStatements.get(tableName);
    const stmt = stmtCache ? stmtCache.get('deleteItem') : 
                 db.prepare(`DELETE FROM items WHERE pk_hash = ? AND (pk_range = ? OR (pk_range IS NULL AND ? IS NULL))`);
    
    const result = stmt.run(pkHash, pkRange, pkRange);
    return result.changes > 0;
  }

  /**
   * Busca com paginação otimizada para DynamoDB Query
   */
  queryItemsOptimized(tableName, options = {}) {
    const db = this.getDatabase(tableName);
    let sql = `SELECT data, _created_at, _updated_at FROM items WHERE 1=1`;
    const params = [];
    
    // Filtro por partition key
    if (options.hashKeyValue !== undefined) {
      sql += ` AND pk_hash = ?`;
      params.push(String(options.hashKeyValue));
    }
    
    // Filtro por sort key (suporta begins_with, between, comparison)
    if (options.rangeKeyCondition) {
      const { operator, value, value2 } = options.rangeKeyCondition;
      
      switch (operator) {
        case '=':
          sql += ` AND pk_range = ?`;
          params.push(String(value));
          break;
        case '>':
          sql += ` AND pk_range > ?`;
          params.push(String(value));
          break;
        case '<':
          sql += ` AND pk_range < ?`;
          params.push(String(value));
          break;
        case '>=':
          sql += ` AND pk_range >= ?`;
          params.push(String(value));
          break;
        case '<=':
          sql += ` AND pk_range <= ?`;
          params.push(String(value));
          break;
        case 'BEGINS_WITH':
          sql += ` AND pk_range LIKE ?`;
          params.push(`${value}%`);
          break;
        case 'BETWEEN':
          sql += ` AND pk_range BETWEEN ? AND ?`;
          params.push(String(value), String(value2));
          break;
      }
    }
    
    // Ordenação
    if (options.sortKey) {
      const direction = options.scanIndexForward !== false ? 'ASC' : 'DESC';
      sql += ` ORDER BY json_extract(data, '$."${options.sortKey}"') ${direction}`;
    } else if (options.sortByRangeKey !== false) {
      const direction = options.scanIndexForward !== false ? 'ASC' : 'DESC';
      sql += ` ORDER BY pk_range ${direction}`;
    }
    
    // Paginação com ExclusiveStartKey
    if (options.exclusiveStartKey) {
      if (options.exclusiveStartKey.rangeKey !== undefined && options.exclusiveStartKey.rangeKey !== null) {
        const op = options.scanIndexForward !== false ? '>' : '<';
        sql += ` AND (pk_hash > ? OR (pk_hash = ? AND pk_range ${op} ?))`;
        params.push(options.exclusiveStartKey.hashKey, options.exclusiveStartKey.hashKey, options.exclusiveStartKey.rangeKey);
      } else if (options.exclusiveStartKey.hashKey) {
        const op = options.scanIndexForward !== false ? '>' : '<';
        sql += ` AND pk_hash ${op} ?`;
        params.push(options.exclusiveStartKey.hashKey);
      }
    }
    
    // Limite
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit + 1); // +1 para saber se tem próxima página
    }
    
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    
    let lastEvaluatedKey = null;
    let results = rows;
    
    if (options.limit && rows.length > options.limit) {
      const lastItem = rows[options.limit - 1];
      const lastItemData = JSON.parse(lastItem.data);
      lastEvaluatedKey = {
        hashKey: lastItem.pk_hash,
        rangeKey: lastItem.pk_range
      };
      results = rows.slice(0, options.limit);
    }
    
    const items = results.map(row => {
      const item = JSON.parse(row.data);
      item._createdAt = row._created_at;
      item._updatedAt = row._updated_at;
      return item;
    });
    
    return { items, lastEvaluatedKey };
  }

  /**
   * Busca com GSI otimizada
   */
  queryWithGSI(tableName, gsi, options = {}) {
    const db = this.getDatabase(tableName);
    const safeIndexName = this.sanitizeIdentifier(gsi.indexName);
    const hashKey = this.sanitizeIdentifier(gsi.hashKey);
    
    let sql = `
      SELECT data, _created_at, _updated_at FROM items 
      WHERE json_extract(data, '$."${hashKey}"') IS NOT NULL
    `;
    const params = [];
    
    // Filtro por hash key do GSI
    if (options.hashKeyValue !== undefined) {
      sql += ` AND json_extract(data, '$."${hashKey}"') = ?`;
      params.push(options.hashKeyValue);
    }
    
    // Filtro por range key do GSI
    if (gsi.rangeKey && options.rangeKeyCondition) {
      const rangeKey = this.sanitizeIdentifier(gsi.rangeKey);
      const { operator, value, value2 } = options.rangeKeyCondition;
      
      switch (operator) {
        case '=':
          sql += ` AND json_extract(data, '$."${rangeKey}"') = ?`;
          params.push(value);
          break;
        case '>':
          sql += ` AND json_extract(data, '$."${rangeKey}"') > ?`;
          params.push(value);
          break;
        case '<':
          sql += ` AND json_extract(data, '$."${rangeKey}"') < ?`;
          params.push(value);
          break;
        case 'BEGINS_WITH':
          sql += ` AND json_extract(data, '$."${rangeKey}"') LIKE ?`;
          params.push(`${value}%`);
          break;
      }
    }
    
    // Ordenação pelo range key do GSI
    if (gsi.rangeKey) {
      const rangeKey = this.sanitizeIdentifier(gsi.rangeKey);
      const direction = options.scanIndexForward !== false ? 'ASC' : 'DESC';
      sql += ` ORDER BY json_extract(data, '$."${rangeKey}"') ${direction}`;
    }
    
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    
    return rows.map(row => {
      const item = JSON.parse(row.data);
      item._createdAt = row._created_at;
      item._updatedAt = row._updated_at;
      return item;
    });
  }

  /**
   * Scan otimizado (com streaming)
   */
  scanTableOptimized(tableName, options = {}) {
    const db = this.getDatabase(tableName);
    let sql = `SELECT data, _created_at, _updated_at FROM items`;
    const params = [];
    
    // Ordenação padrão
    sql += ` ORDER BY pk_hash, pk_range`;
    
    // Paginação
    if (options.exclusiveStartKey) {
      if (options.exclusiveStartKey.rangeKey !== undefined && options.exclusiveStartKey.rangeKey !== null) {
        sql += ` AND (pk_hash > ? OR (pk_hash = ? AND pk_range > ?))`;
        params.push(options.exclusiveStartKey.hashKey, options.exclusiveStartKey.hashKey, options.exclusiveStartKey.rangeKey);
      } else if (options.exclusiveStartKey.hashKey) {
        sql += ` AND pk_hash > ?`;
        params.push(options.exclusiveStartKey.hashKey);
      }
    }
    
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    
    return rows.map(row => {
      const item = JSON.parse(row.data);
      item._createdAt = row._created_at;
      item._updatedAt = row._updated_at;
      return item;
    });
  }

  /**
   * Escrita em lote (transação)
   */
  batchWrite(tableName, operations) {
    const db = this.getDatabase(tableName);
    
    const transaction = db.transaction((ops) => {
      for (const op of ops) {
        if (op.type === 'put') {
          this.putItem(tableName, op.pkHash, op.pkRange, op.item, op.createdAt, op.updatedAt);
        } else if (op.type === 'delete') {
          this.deleteItem(tableName, op.pkHash, op.pkRange);
        }
      }
    });
    
    return transaction(operations);
  }

  /**
   * Limpa todos os dados da tabela
   */
  truncateTable(tableName) {
    const db = this.getDatabase(tableName);
    const stmtCache = this.preparedStatements.get(tableName);
    const stmt = stmtCache ? stmtCache.get('truncate') : db.prepare(`DELETE FROM items`);
    
    const result = stmt.run();
    this.updateTableStats(tableName, 0, 0);
    
    // Vacuum para recuperar espaço
    db.exec('VACUUM');
    
    return result.changes;
  }

  /**
   * Conta total de itens na tabela
   */
  getTotalItems(tableName) {
    const db = this.getDatabase(tableName);
    const stmtCache = this.preparedStatements.get(tableName);
    const stmt = stmtCache ? stmtCache.get('countItems') : db.prepare(`SELECT COUNT(*) as count FROM items`);
    
    const row = stmt.get();
    return row.count;
  }

  /**
   * Calcula tamanho aproximado da tabela
   */
  getTableSize(tableName) {
    const db = this.getDatabase(tableName);
    const stmtCache = this.preparedStatements.get(tableName);
    const stmt = stmtCache ? stmtCache.get('tableSize') : db.prepare(`SELECT SUM(LENGTH(data)) as size FROM items`);
    
    const row = stmt.get();
    return row.size || 0;
  }

  /**
   * API compatível com LocalStore - Lê todos os itens
   */
  read(tableName) {
    return this.scanTableOptimized(tableName);
  }

  /**
   * API compatível com LocalStore - Escreve todos os itens (substitui)
   */
  write(tableName, items) {
    this.truncateTable(tableName);
    
    const table = this.getTable(tableName);
    if (!table) return;
    
    const batchOps = items.map(item => ({
      type: 'put',
      pkHash: String(item[table.hashKey]),
      pkRange: table.rangeKey ? String(item[table.rangeKey]) : null,
      item: item,
      createdAt: item._createdAt,
      updatedAt: item._updatedAt || new Date().toISOString()
    }));
    
    if (batchOps.length > 0) {
      this.batchWrite(tableName, batchOps);
      this.updateTableStats(tableName, items.length, JSON.stringify(items).length);
    }
  }

  /**
   * API compatível com LocalStore - Delete (por nome do arquivo)
   */
  delete(filePath) {
    const tableName = path.basename(filePath, '.json');
    if (this.exists(tableName)) {
      this.deleteTable(tableName);
    }
  }

  /**
   * API compatível com LocalStore - Get file path
   */
  getFilePath(name) {
    return path.join(this.dataDir, `${name}.db`);
  }

  /**
   * Fecha todas as conexões
   */
  closeAll() {
    for (const [tableName, db] of this.databases.entries()) {
      db.close();
    }
    this.databases.clear();
    this.preparedStatements.clear();
  }

  /**
   * Fecha conexão específica
   */
  close(tableName) {
    if (this.databases.has(tableName)) {
      this.databases.get(tableName).close();
      this.databases.delete(tableName);
      this.preparedStatements.delete(tableName);
    }
  }

  /**
   * Obtém caminho do arquivo de metadados
   */
  getMetadataFilePath() {
    return this.metadataFile;
  }

  /**
   * Obtém todos os itens (alias para read)
   */
  getAllItems(tableName) {
    return this.read(tableName);
  }
}

module.exports = SQLiteStore;