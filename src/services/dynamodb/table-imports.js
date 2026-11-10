/**
 * DynamoDB imports do S3: ImportTable, DescribeImport e ListImports.
 *
 * Lê os arquivos DYNAMODB_JSON do prefixo informado (.json ou .json.gz; arquivos manifest-* são ignorados),
 * cria a tabela de destino com a KeySchema informada e grava os itens.
 * A importação termina de forma síncrona. Se o conteúdo não puder ser lido, o import fica FAILED
 * e a tabela não é criada, como a AWS registra a falha em vez de lançar erro na chamada.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { apiError, toEpochSeconds } = require("./backups");

const REGION = "us-east-1";
const ACCOUNT_ID = "000000000000";
const ID_PATTERN = /^[a-f0-9]{32}$/;
const DATA_FILE = /\.(json|json\.gz|gz)$/i;
const MANIFEST_FILE = /(^|\/)manifest-[^/]*$/i;

function importsDir(sim) {
  return path.join(sim.dataDir, "_imports");
}

function importFileFor(sim, id) {
  return path.join(importsDir(sim), `${id}.json`);
}

function tableArnOf(tableName) {
  return `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${tableName}`;
}

function idFromImportArn(importArn) {
  const marker = "/import/";
  const index = typeof importArn === "string" ? importArn.lastIndexOf(marker) : -1;
  return index === -1 ? null : importArn.slice(index + marker.length);
}

function describeOf(meta) {
  return {
    ImportArn: meta.ImportArn,
    ImportStatus: meta.ImportStatus,
    TableArn: meta.TableArn,
    S3BucketSource: meta.S3BucketSource,
    InputFormat: meta.InputFormat,
    ProcessedItemCount: meta.ProcessedItemCount,
    ImportedItemCount: meta.ImportedItemCount,
    ErrorCount: meta.ErrorCount,
    StartTime: toEpochSeconds(meta.StartTime),
    EndTime: toEpochSeconds(meta.EndTime),
    ...(meta.FailureMessage ? { FailureCode: meta.FailureCode, FailureMessage: meta.FailureMessage } : {}),
  };
}

function saveImport(sim, meta) {
  const id = idFromImportArn(meta.ImportArn);
  fs.mkdirSync(importsDir(sim), { recursive: true });
  fs.writeFileSync(importFileFor(sim, id), JSON.stringify(meta));
}

/** Lê e interpreta todos os itens DYNAMODB_JSON do prefixo. Lança erro se algum arquivo for inválido. */
function readItemsFromS3(s3, bucket, prefix) {
  const { contents = [] } = s3.listObjects(bucket, { prefix, maxKeys: 100000 });
  const keys = contents
    .map((c) => c.Key)
    .filter((key) => DATA_FILE.test(key) && !MANIFEST_FILE.test(key));

  if (!keys.length) {
    throw new Error(`No DYNAMODB_JSON data files found under prefix "${prefix}"`);
  }

  const items = [];
  let processed = 0;
  for (const key of keys) {
    let content = s3._readObjectContent(bucket, key);
    if (!content) continue;
    if (/\.gz$/i.test(key)) content = zlib.gunzipSync(content);

    for (const line of content.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      processed++;
      const parsed = JSON.parse(line);
      if (!parsed.Item || typeof parsed.Item !== "object") {
        throw new Error(`Line ${processed} of ${key} does not contain an Item object`);
      }
      items.push(parsed.Item);
    }
  }
  return { items, processed };
}

function importTable(sim, params = {}) {
  const { S3BucketSource = {}, InputFormat = "DYNAMODB_JSON", TableCreationParameters = {} } = params;
  const { S3Bucket, S3KeyPrefix = "" } = S3BucketSource;
  const { TableName, KeySchema = [], AttributeDefinitions = [] } = TableCreationParameters;

  if (!S3Bucket) throw apiError("ValidationException", "S3BucketSource.S3Bucket is required");
  if (InputFormat !== "DYNAMODB_JSON") {
    throw apiError("ValidationException", `InputFormat ${InputFormat} is not supported. Use DYNAMODB_JSON.`);
  }
  if (!TableName) throw apiError("ValidationException", "TableCreationParameters.TableName is required");
  if (!KeySchema.length) throw apiError("ValidationException", "TableCreationParameters.KeySchema is required");

  const s3 = sim.s3;
  if (!s3) throw apiError("ValidationException", "The S3 service is not available in this simulator.");
  if (!s3.getBucket(S3Bucket)) throw apiError("ValidationException", "The specified S3 bucket does not exist.");
  if (sim.tables.has(TableName)) {
    throw apiError("ResourceInUseException", `Table already exists: ${TableName}`);
  }

  const id = crypto.randomBytes(16).toString("hex");
  const meta = {
    ImportArn: `${tableArnOf(TableName)}/import/${id}`,
    ImportStatus: "IN_PROGRESS",
    TableArn: tableArnOf(TableName),
    S3BucketSource: { S3Bucket, S3KeyPrefix },
    InputFormat,
    ProcessedItemCount: 0,
    ImportedItemCount: 0,
    ErrorCount: 0,
    StartTime: new Date().toISOString(),
    EndTime: null,
  };

  let read;
  try {
    read = readItemsFromS3(s3, S3Bucket, S3KeyPrefix);
  } catch (err) {
    meta.ImportStatus = "FAILED";
    meta.FailureCode = "ImportFailed";
    meta.FailureMessage = err.message;
    meta.EndTime = new Date().toISOString();
    saveImport(sim, meta);
    return { ImportTableDescription: describeOf(meta) };
  }

  sim.createTable({ TableName, KeySchema, AttributeDefinitions });
  const table = sim.tables.get(TableName);

  // Itens sem a chave da tabela são contados como erro; chaves repetidas ficam com a última ocorrência.
  const now = new Date().toISOString();
  const byKey = new Map();
  let errorCount = 0;
  for (const typedItem of read.items) {
    const item = sim.normalizeItem(typedItem, table);
    const hasKeys = [table.hashKey, table.rangeKey].filter(Boolean).every((k) => item[k] !== undefined && item[k] !== null);
    if (!hasKeys) {
      errorCount++;
      continue;
    }
    byKey.set(sim.getItemKey(item, table), { ...item, _createdAt: now, _updatedAt: now });
  }

  const finalItems = Array.from(byKey.values());
  sim.store.write(TableName, finalItems);
  table.itemCount = finalItems.length;
  sim.persistTables();

  meta.ImportStatus = "COMPLETED";
  meta.ProcessedItemCount = read.processed;
  meta.ImportedItemCount = finalItems.length;
  meta.ErrorCount = errorCount;
  meta.EndTime = new Date().toISOString();
  saveImport(sim, meta);

  return { ImportTableDescription: describeOf(meta) };
}

function describeImport(sim, { ImportArn } = {}) {
  if (!ImportArn) throw apiError("ValidationException", "ImportArn is required");
  const id = idFromImportArn(ImportArn);
  if (!id || !ID_PATTERN.test(id)) throw apiError("ValidationException", `Invalid ImportArn: ${ImportArn}`);

  const file = importFileFor(sim, id);
  if (!fs.existsSync(file)) throw apiError("ImportNotFoundException", `Import not found: ${ImportArn}`);

  return { ImportTableDescription: describeOf(JSON.parse(fs.readFileSync(file, "utf8"))) };
}

function listImports(sim, { TableArn } = {}) {
  const dir = importsDir(sim);
  if (!fs.existsSync(dir)) return { ImportSummaryList: [] };

  const summaries = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter((m) => !TableArn || m.TableArn === TableArn)
    .sort((a, b) => a.StartTime.localeCompare(b.StartTime))
    .map((m) => ({
      ImportArn: m.ImportArn,
      ImportStatus: m.ImportStatus,
      TableArn: m.TableArn,
      S3BucketSource: m.S3BucketSource,
      InputFormat: m.InputFormat,
      StartTime: toEpochSeconds(m.StartTime),
      EndTime: toEpochSeconds(m.EndTime),
    }));

  return { ImportSummaryList: summaries };
}

module.exports = { importTable, describeImport, listImports };
