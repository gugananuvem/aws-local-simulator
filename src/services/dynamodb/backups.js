/**
 * DynamoDB on-demand backups: CreateBackup, ListBackups, DeleteBackup, RestoreTableFromBackup.
 *
 * Cada backup grava um snapshot em <dataDir>/_backups/<id>.json contendo os metadados,
 * a definição da tabela (chaves, tipos de atributo, GSIs) e todos os itens.
 * Os snapshots ficam fora do armazenamento de tabelas, então funcionam com LocalStore e SQLiteStore.
 *
 * Não suportado: vector indexes na restauração e pagamento por capacidade provisionada.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REGION = "us-east-1";
const ACCOUNT_ID = "000000000000";
const ID_PATTERN = /^[A-Za-z0-9-]+$/;

function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function backupsDir(sim) {
  return path.join(sim.dataDir, "_backups");
}

function snapshotPathFor(sim, id) {
  return path.join(backupsDir(sim), `${id}.json`);
}

function idFromArn(backupArn) {
  const marker = "/backup/";
  const index = typeof backupArn === "string" ? backupArn.lastIndexOf(marker) : -1;
  return index === -1 ? null : backupArn.slice(index + marker.length);
}

function loadSnapshot(sim, backupArn) {
  const id = idFromArn(backupArn);
  if (!id || !ID_PATTERN.test(id)) {
    throw apiError("ValidationException", `Invalid BackupArn: ${backupArn}`);
  }
  const file = snapshotPathFor(sim, id);
  if (!fs.existsSync(file)) {
    throw apiError("BackupNotFoundException", `Backup not found for ARN: ${backupArn}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listAllSnapshots(sim) {
  const dir = backupsDir(sim);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => a.meta.BackupCreationDateTime.localeCompare(b.meta.BackupCreationDateTime));
}

/**
 * O protocolo JSON do DynamoDB envia timestamps como segundos desde a época (número).
 * Strings ISO fazem o SDK falhar com "Expected real number, got implicit NaN".
 */
function toEpochSeconds(isoDate) {
  return Date.parse(isoDate) / 1000;
}

/** Descrição da tabela no formato esperado pelo SDK (CreationDateTime como epoch). */
function describeForSdk(sim, tableName) {
  const table = sim.describeTable(tableName).Table;
  return { ...table, CreationDateTime: toEpochSeconds(table.CreationDateTime) };
}

function summaryOf(meta) {
  return {
    TableName: meta.TableName,
    TableId: meta.TableId,
    TableArn: meta.TableArn,
    BackupArn: meta.BackupArn,
    BackupName: meta.BackupName,
    BackupCreationDateTime: toEpochSeconds(meta.BackupCreationDateTime),
    BackupStatus: meta.BackupStatus,
    BackupType: meta.BackupType,
    BackupSizeBytes: meta.BackupSizeBytes,
  };
}

/**
 * Cria uma tabela a partir de uma definição (hashKey, rangeKey, attributeTypes, GSIs)
 * e grava os itens informados, preservando os tipos de atributo originais.
 */
function materializeTable(sim, targetName, definition, items) {
  const { hashKey, rangeKey, attributeTypes, globalSecondaryIndexes = {} } = definition;

  const keyAttributes = new Set([hashKey, rangeKey, ...Object.values(globalSecondaryIndexes).flatMap((g) => [g.hashKey, g.rangeKey])].filter(Boolean));
  const KeySchema = [
    { AttributeName: hashKey, KeyType: "HASH" },
    ...(rangeKey ? [{ AttributeName: rangeKey, KeyType: "RANGE" }] : []),
  ];
  const GlobalSecondaryIndexes = Object.entries(globalSecondaryIndexes).map(([IndexName, gsi]) => ({
    IndexName,
    KeySchema: [
      { AttributeName: gsi.hashKey, KeyType: "HASH" },
      ...(gsi.rangeKey ? [{ AttributeName: gsi.rangeKey, KeyType: "RANGE" }] : []),
    ],
    Projection: { ProjectionType: "ALL" },
  }));
  const AttributeDefinitions = [...keyAttributes]
    .filter((name) => attributeTypes[name])
    .map((name) => ({ AttributeName: name, AttributeType: attributeTypes[name] }));

  sim.createTable({
    TableName: targetName,
    KeySchema,
    AttributeDefinitions,
    ...(GlobalSecondaryIndexes.length ? { GlobalSecondaryIndexes } : {}),
  });

  const restored = sim.tables.get(targetName);
  restored.attributeTypes = { ...attributeTypes };
  restored.itemCount = items.length;
  sim.store.write(targetName, items);
  sim.persistTables();
}

function createBackup(sim, { TableName, BackupName } = {}) {
  if (!TableName) throw apiError("ValidationException", "TableName is required");
  if (!BackupName || !String(BackupName).trim()) throw apiError("ValidationException", "BackupName is required");

  const table = sim.tables.get(TableName);
  if (!table) {
    throw apiError("ResourceNotFoundException", `Requested resource not found: Table: ${TableName} not found`);
  }

  const items = sim.store.read(TableName);
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tableId = crypto.randomUUID();
  const meta = {
    BackupArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TableName}/backup/${id}`,
    BackupName: String(BackupName).trim(),
    BackupStatus: "AVAILABLE",
    BackupType: "USER",
    BackupCreationDateTime: new Date().toISOString(),
    BackupSizeBytes: Buffer.byteLength(JSON.stringify(items)),
    TableName,
    TableId: tableId,
    TableArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TableName}`,
  };

  const snapshot = {
    meta,
    table: {
      hashKey: table.hashKey,
      rangeKey: table.rangeKey,
      attributeTypes: { ...table.attributeTypes },
      globalSecondaryIndexes: { ...(table.globalSecondaryIndexes || {}) },
    },
    items,
  };

  fs.mkdirSync(backupsDir(sim), { recursive: true });
  fs.writeFileSync(snapshotPathFor(sim, id), JSON.stringify(snapshot));

  return { BackupDetails: { BackupArn: meta.BackupArn, BackupName: meta.BackupName, BackupSizeBytes: meta.BackupSizeBytes, BackupStatus: meta.BackupStatus, BackupType: meta.BackupType, BackupCreationDateTime: toEpochSeconds(meta.BackupCreationDateTime) } };
}

function listBackups(sim, { TableName, Limit = 100, ExclusiveStartBackupArn } = {}) {
  let snapshots = listAllSnapshots(sim).map((s) => s.meta);
  if (TableName) snapshots = snapshots.filter((m) => m.TableName === TableName);

  let startIndex = 0;
  if (ExclusiveStartBackupArn) {
    const index = snapshots.findIndex((m) => m.BackupArn === ExclusiveStartBackupArn);
    if (index !== -1) startIndex = index + 1;
  }

  const page = snapshots.slice(startIndex, startIndex + Limit);
  const more = startIndex + Limit < snapshots.length;

  return {
    BackupSummaries: page.map(summaryOf),
    ...(more ? { LastEvaluatedBackupArn: page[page.length - 1].BackupArn } : {}),
  };
}

function deleteBackup(sim, { BackupArn } = {}) {
  if (!BackupArn) throw apiError("ValidationException", "BackupArn is required");
  const { meta } = loadSnapshot(sim, BackupArn);
  fs.unlinkSync(snapshotPathFor(sim, idFromArn(BackupArn)));

  return {
    BackupDescription: {
      BackupDetails: { ...summaryOf(meta), BackupStatus: "DELETED" },
      SourceTableDetails: { TableName: meta.TableName, TableId: meta.TableId, TableArn: meta.TableArn },
    },
  };
}

function restoreTableFromBackup(sim, { TargetTableName, BackupArn } = {}) {
  if (!TargetTableName) throw apiError("ValidationException", "TargetTableName is required");
  if (!BackupArn) throw apiError("ValidationException", "BackupArn is required");

  const snapshot = loadSnapshot(sim, BackupArn);
  if (sim.tables.has(TargetTableName)) {
    throw apiError("TableAlreadyExistsException", `Table already exists: ${TargetTableName}`);
  }

  materializeTable(sim, TargetTableName, snapshot.table, snapshot.items);
  return { TableDescription: describeForSdk(sim, TargetTableName) };
}

module.exports = { createBackup, listBackups, deleteBackup, restoreTableFromBackup, materializeTable, describeForSdk, toEpochSeconds, apiError };
