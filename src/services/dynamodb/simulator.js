/**
 * DynamoDB Simulator Core
 */

const LocalStore = require("../../utils/local-store");
const logger = require("../../utils/logger");
const crypto = require("crypto");
const path = require("path");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");

class DynamoDBSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || "./.aws-local-simulator-data";

    if (!dataDir) {
      throw new Error("AWS_LOCAL_SIMULATOR_DATA_DIR not set");
    }

    this.dataDir = path.join(dataDir, "dynamodb");
    this.store = new LocalStore(this.dataDir);
    this.tables = new Map();
    this.audit = new CloudTrailAudit("dynamodb.amazonaws.com");
  }
  async initialize() {
    logger.debug("Inicializando DynamoDB Simulator...");
    this.loadTables();
    logger.debug(`✅ DynamoDB Simulator inicializado com ${this.tables.size} tabelas`);
  }

  loadTables() {
    // Carrega tabelas existentes do disco PRIMEIRO para evitar sobrescrever definições persistidas
    const savedTables = this.store.read("__tables__");
    if (savedTables) {
      for (const [name, definition] of Object.entries(savedTables)) {
        this.tables.set(name, definition);
      }
    }

    // Cria tabelas da configuração apenas se ainda não existirem no disco
    if (this.config.dynamodb?.tables) {
      for (const tableDef of this.config.dynamodb.tables) {
        this.createTable(tableDef);
      }
    }
  }

  createTable(params) {
    const { TableName, KeySchema, AttributeDefinitions, ProvisionedThroughput, GlobalSecondaryIndexes } = params;

    if (this.tables.has(TableName)) {
      logger.warn(`Tabela ${TableName} já existe`);
      return { TableDescription: { TableName, TableStatus: "ACTIVE" } };
    }

    const hashKey = KeySchema.find((k) => k.KeyType === "HASH").AttributeName;
    const rangeKey = KeySchema.find((k) => k.KeyType === "RANGE")?.AttributeName;

    const attributeTypes = {};
    AttributeDefinitions.forEach((attr) => {
      attributeTypes[attr.AttributeName] = attr.AttributeType;
    });

    const globalSecondaryIndexes = {};
    if (GlobalSecondaryIndexes) {
      for (const gsi of GlobalSecondaryIndexes) {
        const gsiHashKey = gsi.KeySchema.find((k) => k.KeyType === "HASH").AttributeName;
        const gsiRangeKey = gsi.KeySchema.find((k) => k.KeyType === "RANGE")?.AttributeName;
        globalSecondaryIndexes[gsi.IndexName] = { hashKey: gsiHashKey, rangeKey: gsiRangeKey };
      }
    }

    const table = {
      name: TableName,
      hashKey,
      rangeKey,
      attributeTypes,
      globalSecondaryIndexes,
      createdAt: new Date().toISOString(),
      itemCount: 0,
      sizeBytes: 0,
    };

    this.tables.set(TableName, table);
    this.persistTables();

    // Inicializa arquivo de dados apenas se não existir (preserva dados entre reinicializações)
    if (!this.store.exists(TableName)) {
      this.store.write(TableName, []);
    }

    logger.debug(`✅ Tabela criada: ${TableName}`);
    this.audit.record({ eventName: "CreateTable", readOnly: false, resources: [{ ARN: `arn:aws:dynamodb:local:000000000000:table/${TableName}`, type: "AWS::DynamoDB::Table" }], requestParameters: { tableName: TableName } });

    return {
      TableDescription: {
        TableName,
        TableStatus: "ACTIVE",
        CreationDateTime: new Date().toISOString(),
        KeySchema,
        AttributeDefinitions,
        ProvisionedThroughput: ProvisionedThroughput || {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
        ItemCount: 0,
        TableSizeBytes: 0,
      },
    };
  }

  async handleRequest(target, params) {
    const action = target.split(".")[1];

    logger.verboso(`DynamoDB Action: ${action}`, params);

    const readActions = new Set(["GetItem", "BatchGetItem", "Query", "Scan", "DescribeTable", "ListTables"]);
    const dataActions = new Set(["PutItem", "GetItem", "UpdateItem", "DeleteItem", "BatchWriteItem", "BatchGetItem", "Query", "Scan"]);

    const result = (() => {
      switch (action) {
        case "CreateTable":    return this.createTable(params);
        case "DescribeTable":  return this.describeTable(params.TableName);
        case "ListTables":     return this.listTables(params);
        case "DeleteTable":    return this.deleteTable(params);
        case "PutItem":        return this.putItem(params);
        case "GetItem":        return this.getItem(params);
        case "UpdateItem":     return this.updateItem(params);
        case "DeleteItem":     return this.deleteItem(params);
        case "BatchWriteItem": return this.batchWriteItem(params);
        case "BatchGetItem":   return this.batchGetItem(params);
        case "Query":          return this.query(params);
        case "Scan":           return this.scan(params);
        default: throw new Error(`Unsupported action: ${action}`);
      }
    })();

    const tableName = params.TableName;
    if (tableName) {
      this.audit.record({
        eventName: action,
        readOnly: readActions.has(action),
        isDataEvent: dataActions.has(action),
        resources: [{ ARN: `arn:aws:dynamodb:local:000000000000:table/${tableName}`, type: "AWS::DynamoDB::Table" }],
        requestParameters: { tableName },
      });
    }

    return result;
  }

  describeTable(tableName) {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    const items = this.store.read(tableName);

    return {
      Table: {
        TableName: table.name,
        TableStatus: "ACTIVE",
        CreationDateTime: table.createdAt,
        KeySchema: [{ AttributeName: table.hashKey, KeyType: "HASH" }, ...(table.rangeKey ? [{ AttributeName: table.rangeKey, KeyType: "RANGE" }] : [])],
        AttributeDefinitions: Object.entries(table.attributeTypes).map(([name, type]) => ({
          AttributeName: name,
          AttributeType: type,
        })),
        ItemCount: items.length,
        TableSizeBytes: JSON.stringify(items).length,
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    };
  }

  listTables(params = {}) {
    const tableNames = Array.from(this.tables.keys());
    const { Limit = 100, ExclusiveStartTableName } = params;

    let startIndex = 0;
    if (ExclusiveStartTableName) {
      const index = tableNames.indexOf(ExclusiveStartTableName);
      if (index !== -1) startIndex = index + 1;
    }

    const result = tableNames.slice(startIndex, startIndex + Limit);

    return {
      TableNames: result,
      LastEvaluatedTableName: result.length === Limit ? result[result.length - 1] : undefined,
    };
  }

  deleteTable(params) {
    const { TableName } = params;

    if (!this.tables.has(TableName)) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    this.tables.delete(TableName);
    this.store.delete(TableName);
    this.persistTables();

    return { TableDescription: { TableName, TableStatus: "DELETING" } };
  }

  putItem(params) {
    const { TableName, Item, ReturnValues = "NONE" } = params;
    const table = this.tables.get(TableName);

    if (!table) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    // Normaliza o item
    const normalizedItem = this.normalizeItem(Item, table);
    normalizedItem._createdAt = normalizedItem._createdAt || new Date().toISOString();
    normalizedItem._updatedAt = new Date().toISOString();

    // Carrega dados existentes
    let items = this.store.read(TableName);
    const itemKey = this.getItemKey(normalizedItem, table);

    // Encontra e substitui ou adiciona
    const existingIndex = items.findIndex((item) => this.getItemKey(item, table) === itemKey);

    let oldItem = null;
    if (existingIndex !== -1) {
      oldItem = { ...items[existingIndex] };
      items[existingIndex] = normalizedItem;
    } else {
      items.push(normalizedItem);
      table.itemCount++;
    }

    // Salva no store
    this.store.write(TableName, items);
    this.persistTables();

    logger.verboso(`PutItem: ${TableName}/${itemKey}`);

    const response = {};
    if (ReturnValues === "ALL_OLD" && oldItem) {
      response.Attributes = this.marshallItem(oldItem, table);
    }

    return response;
  }

  getItem(params) {
    const { TableName, Key } = params;
    const table = this.tables.get(TableName);

    if (!table) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    const items = this.store.read(TableName);
    const itemKey = this.getItemKeyFromKeys(Key, table);

    const item = items.find((item) => this.getItemKey(item, table) === itemKey);

    logger.verboso(`GetItem: ${TableName}/${itemKey} - ${item ? "found" : "not found"}`);

    return item ? { Item: this.marshallItem(item, table) } : {};
  }

  updateItem(params) {
    const { TableName, Key, UpdateExpression, ExpressionAttributeNames = {}, ExpressionAttributeValues = {}, ReturnValues = "NONE" } = params;
    const table = this.tables.get(TableName);

    if (!table) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    // Busca o item atual (upsert: cria se não existir, como o DynamoDB real)
    const items = this.store.read(TableName);
    const itemKey = this.getItemKeyFromKeys(Key, table);
    const index = items.findIndex((item) => this.getItemKey(item, table) === itemKey);

    // Se não existe, cria um novo item com as chaves fornecidas
    if (index === -1) {
      const newItem = this.normalizeItem(Key, table);
      newItem._createdAt = new Date().toISOString();
      newItem._updatedAt = new Date().toISOString();
      if (UpdateExpression) {
        this.processUpdateExpression(newItem, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues, table);
      }
      items.push(newItem);
      this.store.write(TableName, items);
      logger.verboso(`UpdateItem (upsert): ${TableName}/${itemKey}`);
      const response = {};
      if (ReturnValues === "ALL_NEW" || ReturnValues === "UPDATED_NEW") {
        response.Attributes = this.marshallItem(newItem, table);
      }
      return response;
    }

    const currentItem = items[index];
    const updatedItem = { ...currentItem };
    updatedItem._updatedAt = new Date().toISOString();

    // Processa a UpdateExpression
    if (UpdateExpression) {
      this.processUpdateExpression(updatedItem, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues, table);
    }

    // Salva o item atualizado
    const oldItem = { ...items[index] };
    items[index] = updatedItem;
    this.store.write(TableName, items);

    logger.verboso(`UpdateItem: ${TableName}/${itemKey}`);

    const response = {};
    switch (ReturnValues) {
      case "ALL_OLD":
        response.Attributes = this.marshallItem(oldItem, table);
        break;
      case "ALL_NEW":
        response.Attributes = this.marshallItem(updatedItem, table);
        break;
      default:
        break;
    }

    return response;
  }

  deleteItem(params) {
    const { TableName, Key, ReturnValues = "NONE" } = params;
    const table = this.tables.get(TableName);

    if (!table) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    const items = this.store.read(TableName);
    const itemKey = this.getItemKeyFromKeys(Key, table);
    const index = items.findIndex((item) => this.getItemKey(item, table) === itemKey);

    if (index === -1) {
      return {};
    }

    const oldItem = { ...items[index] };
    items.splice(index, 1);
    this.store.write(TableName, items);
    table.itemCount--;
    this.persistTables();

    logger.verboso(`DeleteItem: ${TableName}/${itemKey}`);

    const response = {};
    if (ReturnValues === "ALL_OLD") {
      response.Attributes = this.marshallItem(oldItem, table);
    }

    return response;
  }

  batchWriteItem(params) {
    const { RequestItems } = params;
    const responses = {};

    for (const [tableName, operations] of Object.entries(RequestItems)) {
      const table = this.tables.get(tableName);
      if (!table) continue;

      let items = this.store.read(tableName);
      const unprocessedItems = [];

      for (const op of operations) {
        if (op.PutRequest) {
          const item = this.normalizeItem(op.PutRequest.Item, table);
          const itemKey = this.getItemKey(item, table);
          const index = items.findIndex((i) => this.getItemKey(i, table) === itemKey);

          if (index !== -1) {
            items[index] = item;
          } else {
            items.push(item);
            table.itemCount++;
          }
        } else if (op.DeleteRequest) {
          const key = op.DeleteRequest.Key;
          const itemKey = this.getItemKeyFromKeys(key, table);
          const index = items.findIndex((i) => this.getItemKey(i, table) === itemKey);

          if (index !== -1) {
            items.splice(index, 1);
            table.itemCount--;
          } else {
            unprocessedItems.push(op);
          }
        }
      }

      this.store.write(tableName, items);
      responses[tableName] = { UnprocessedItems: unprocessedItems };
    }

    this.persistTables();

    return { UnprocessedItems: responses };
  }

  batchGetItem(params) {
    const { RequestItems } = params;
    const responses = {};

    for (const [tableName, request] of Object.entries(RequestItems)) {
      const table = this.tables.get(tableName);
      if (!table) continue;

      const items = this.store.read(tableName);
      const { Keys } = request;
      const foundItems = [];

      for (const key of Keys) {
        const itemKey = this.getItemKeyFromKeys(key, table);
        const item = items.find((i) => this.getItemKey(i, table) === itemKey);
        if (item) {
          foundItems.push(this.marshallItem(item, table));
        }
      }

      responses[tableName] = { Items: foundItems };
    }

    return { Responses: responses };
  }

  query(params) {
    const { TableName, KeyConditionExpression, ExpressionAttributeValues, IndexName } = params;
    const table = this.tables.get(TableName);

    if (!table) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    let items = this.store.read(TableName);

    // Resolve hash key e range key: usa GSI se IndexName estiver presente, caso contrário usa a tabela principal
    let hashKey;
    let rangeKey;

    if (IndexName != null) {
      const gsiDefs = table.globalSecondaryIndexes || {};
      const gsi = gsiDefs[IndexName];
      if (!gsi) {
        throw new Error(`GSI "${IndexName}" not found on table "${TableName}"`);
      }
      hashKey = gsi.hashKey;
      rangeKey = gsi.rangeKey;
    } else {
      hashKey = table.hashKey;
      rangeKey = table.rangeKey;
    }

    // Filtra pela chave de partição
    const hashValueMatch = KeyConditionExpression.match(new RegExp(`${hashKey}\\s*=\\s*([^\\s]+)`));

    if (hashValueMatch) {
      const hashValuePlaceholder = hashValueMatch[1];
      const rawHashValue = ExpressionAttributeValues[hashValuePlaceholder];
      const hashValue = rawHashValue && typeof rawHashValue === 'object' ? Object.values(rawHashValue)[0] : rawHashValue;
      items = items.filter((item) => item[hashKey] === hashValue);
    }

    // Filtra pela chave de ordenação se existir
    if (rangeKey) {
      const rangeConditionMatch = KeyConditionExpression.match(new RegExp(`${rangeKey}\\s*(=|>|<|>=|<=)\\s*([^\\s]+)`));

      if (rangeConditionMatch) {
        const operator = rangeConditionMatch[1];
        const rangeValuePlaceholder = rangeConditionMatch[2];
        const rawRangeValue = ExpressionAttributeValues[rangeValuePlaceholder];
        const rangeValue = rawRangeValue && typeof rawRangeValue === 'object' ? Object.values(rawRangeValue)[0] : rawRangeValue;

        items = items.filter((item) => {
          const itemValue = item[rangeKey];
          switch (operator) {
            case "=":
              return itemValue === rangeValue;
            case ">":
              return itemValue > rangeValue;
            case "<":
              return itemValue < rangeValue;
            case ">=":
              return itemValue >= rangeValue;
            case "<=":
              return itemValue <= rangeValue;
            default:
              return true;
          }
        });
      }
    }

    const marshalledItems = items.map((item) => this.marshallItem(item, table));

    return {
      Items: marshalledItems,
      Count: marshalledItems.length,
      ScannedCount: items.length,
    };
  }

  scan(params) {
    const { TableName, FilterExpression, ExpressionAttributeValues, Limit } = params;
    const table = this.tables.get(TableName);

    if (!table) {
      throw new Error(`Table ${TableName} does not exist`);
    }

    let items = this.store.read(TableName);

    // Aplica filtro se existir
    if (FilterExpression) {
      items = this.applyFilter(items, FilterExpression, ExpressionAttributeValues, table);
    }

    // Aplica limite
    if (Limit && items.length > Limit) {
      items = items.slice(0, Limit);
    }

    const marshalledItems = items.map((item) => this.marshallItem(item, table));

    return {
      Items: marshalledItems,
      Count: marshalledItems.length,
      ScannedCount: items.length,
    };
  }

  // Métodos auxiliares
  normalizeItem(item, table) {
    const normalized = { ...item };

    // Remove os tipos do DynamoDB (S, N, etc)
    for (const [key, value] of Object.entries(normalized)) {
      if (value && typeof value === "object") {
        if (value.S !== undefined) normalized[key] = value.S;
        else if (value.N !== undefined) normalized[key] = parseFloat(value.N);
        else if (value.BOOL !== undefined) normalized[key] = value.BOOL;
        else if (value.L !== undefined) normalized[key] = value.L.map((v) => this.normalizeItem(v, table));
        else if (value.M !== undefined) normalized[key] = this.normalizeItem(value.M, table);
      }
    }

    return normalized;
  }

  marshallItem(item, table) {
    const marshalled = {};

    for (const [key, value] of Object.entries(item)) {
      if (key.startsWith("_")) continue; // Pula campos internos

      const type = table.attributeTypes[key];
      if (type === "S") {
        marshalled[key] = { S: String(value) };
      } else if (type === "N") {
        marshalled[key] = { N: String(value) };
      } else if (type === "BOOL") {
        marshalled[key] = { BOOL: Boolean(value) };
      } else if (Array.isArray(value)) {
        marshalled[key] = { L: value.map((v) => ({ S: String(v) })) };
      } else if (typeof value === "object") {
        marshalled[key] = { M: this.marshallItem(value, table) };
      } else {
        marshalled[key] = { S: String(value) };
      }
    }

    return marshalled;
  }

  getItemKey(item, table) {
    const hashValue = item[table.hashKey];
    const rangeValue = table.rangeKey ? item[table.rangeKey] : null;
    return rangeValue ? `${hashValue}|${rangeValue}` : String(hashValue);
  }

  getItemKeyFromKeys(keys, table) {
    const rawHash = keys[table.hashKey];
    const hashValue = rawHash && typeof rawHash === 'object' ? Object.values(rawHash)[0] : rawHash;
    const rawRange = table.rangeKey ? keys[table.rangeKey] : null;
    const rangeValue = rawRange && typeof rawRange === 'object' ? Object.values(rawRange)[0] : rawRange;
    return rangeValue ? `${hashValue}|${rangeValue}` : String(hashValue);
  }

  processUpdateExpression(item, expression, nameMap, valueMap, table) {
    // SET clause
    const setMatch = expression.match(/SET\s+([^]+?)(?=\s+(?:REMOVE|ADD|DELETE)\s|\s*$)/i);
    if (setMatch) {
      const assignments = setMatch[1].split(",").map((a) => a.trim());
      for (const assignment of assignments) {
        const [path, valueExpr] = assignment.split("=").map((s) => s.trim());
        const attributeName = nameMap[path] || path.replace(/#/g, "");
        const rawValue = valueMap[valueExpr];
        const value = rawValue && typeof rawValue === 'object' ? Object.values(rawValue)[0] : rawValue;
        item[attributeName] = value;
      }
    }

    // ADD clause — incrementa números ou adiciona a sets (upsert-friendly)
    const addMatch = expression.match(/ADD\s+([^]+?)(?=\s+(?:SET|REMOVE|DELETE)\s|\s*$)/i);
    if (addMatch) {
      const assignments = addMatch[1].split(",").map((a) => a.trim());
      for (const assignment of assignments) {
        const parts = assignment.split(/\s+/);
        const attributeName = nameMap[parts[0]] || parts[0].replace(/#/g, "");
        const rawValue = valueMap[parts[1]];
        const delta = rawValue && typeof rawValue === 'object' ? Object.values(rawValue)[0] : rawValue;
        const current = item[attributeName];
        if (current === undefined || current === null) {
          item[attributeName] = typeof delta === 'number' ? delta : parseFloat(delta) || 0;
        } else {
          item[attributeName] = (parseFloat(current) || 0) + (parseFloat(delta) || 0);
        }
      }
    }

    // REMOVE clause
    const removeMatch = expression.match(/REMOVE\s+([^]+?)(?=\s+(?:SET|ADD|DELETE)\s|\s*$)/i);
    if (removeMatch) {
      const attributes = removeMatch[1].split(",").map((a) => a.trim());
      for (const attr of attributes) {
        const attributeName = nameMap[attr] || attr.replace(/#/g, "");
        delete item[attributeName];
      }
    }
  }

  applyFilter(items, expression, values, table) {
    // Implementação simplificada
    return items.filter((item) => {
      const match = expression.match(/([^\s]+)\s*=\s*([^\s]+)/);
      if (match) {
        const [, attribute, placeholder] = match;
        const rawValue = values[placeholder];
        const expectedValue = rawValue && typeof rawValue === 'object' ? Object.values(rawValue)[0] : rawValue;
        const actualValue = item[attribute];
        return actualValue === expectedValue;
      }
      return true;
    });
  }

  persistTables() {
    const tablesObj = {};
    for (const [name, table] of this.tables.entries()) {
      tablesObj[name] = table;
    }
    this.store.write("__tables__", tablesObj);
  }

  async reset() {
    for (const [tableName] of this.tables) {
      this.store.write(tableName, []);
    }
    logger.debug("DynamoDB: Todos os dados resetados");
  }

  getTablesCount() {
    return this.tables.size;
  }

  getTotalItems() {
    let total = 0;
    for (const [tableName] of this.tables) {
      const items = this.store.read(tableName);
      total += items.length;
    }
    return total;
  }

  listTables() {
    return { TableNames: Array.from(this.tables.keys()) };
  }
}

module.exports = DynamoDBSimulator;
