/**
 * DynamoDB exports para S3: ExportTableToPointInTime, DescribeExport e ListExports.
 *
 * Gera o layout da AWS dentro do bucket de destino:
 *   <prefixo>AWSDynamoDB/<exportId>/manifest-summary.json
 *   <prefixo>AWSDynamoDB/<exportId>/manifest-files.json
 *   <prefixo>AWSDynamoDB/<exportId>/data/<md5>.json.gz
 *
 * Suporta apenas DYNAMODB_JSON (cada linha do .json.gz é {"Item": {...}}) e FULL_EXPORT.
 * Como no DynamoDB real, o PITR precisa estar ativo na tabela. O export usa o estado no ExportTime
 * (ou o último instante restaurável) e termina de forma síncrona.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { apiError, toEpochSeconds } = require("./backups");

const REGION = "us-east-1";
const ACCOUNT_ID = "000000000000";
const ID_PATTERN = /^[a-f0-9]{32}$/;

function exportsDir(sim) {
  return path.join(sim.dataDir, "_exports");
}

function exportFileFor(sim, id) {
  return path.join(exportsDir(sim), `${id}.json`);
}

function tableNameFromArn(arn) {
  const match = typeof arn === "string" ? arn.match(/:table\/([^/]+)$/) : null;
  return match ? match[1] : null;
}

function requireTableName(TableArn) {
  if (!TableArn) throw apiError("ValidationException", "TableArn is required");
  const name = tableNameFromArn(TableArn);
  if (!name) throw apiError("ValidationException", `Invalid TableArn: ${TableArn}`);
  return name;
}

function normalizePrefix(prefix) {
  if (!prefix) return "";
  const trimmed = prefix.replace(/^\/+/, "");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function idFromExportArn(exportArn) {
  const marker = "/export/";
  const index = typeof exportArn === "string" ? exportArn.lastIndexOf(marker) : -1;
  return index === -1 ? null : exportArn.slice(index + marker.length);
}

function exportDescriptionOf(meta) {
  return {
    ExportArn: meta.ExportArn,
    ExportStatus: meta.ExportStatus,
    TableArn: meta.TableArn,
    ExportTime: toEpochSeconds(meta.ExportTime),
    StartTime: toEpochSeconds(meta.StartTime),
    EndTime: toEpochSeconds(meta.EndTime),
    ExportFormat: meta.ExportFormat,
    ExportType: "FULL_EXPORT",
    S3Bucket: meta.S3Bucket,
    S3Prefix: meta.S3Prefix,
    ItemCount: meta.ItemCount,
    BilledSizeBytes: meta.BilledSizeBytes,
    ExportManifest: meta.ExportManifest,
  };
}

function loadExport(sim, exportArn) {
  const id = idFromExportArn(exportArn);
  if (!id || !ID_PATTERN.test(id)) {
    throw apiError("ValidationException", `Invalid ExportArn: ${exportArn}`);
  }
  const file = exportFileFor(sim, id);
  if (!fs.existsSync(file)) {
    throw apiError("ExportNotFoundException", `Export not found: ${exportArn}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function putToS3(s3, bucket, key, body, contentType) {
  const result = s3.putObject(bucket, key, body, { "content-type": contentType });
  if (result && result.error) {
    throw apiError("InternalServerError", `Failed to write ${key} to S3: ${result.error.message}`);
  }
}

function exportTableToPointInTime(sim, params = {}) {
  const {
    TableArn,
    S3Bucket,
    S3Prefix,
    ExportFormat = "DYNAMODB_JSON",
    ExportType = "FULL_EXPORT",
    ExportTime,
  } = params;

  const tableName = requireTableName(TableArn);
  if (!S3Bucket) throw apiError("ValidationException", "S3Bucket is required");
  if (ExportFormat !== "DYNAMODB_JSON") {
    throw apiError("ValidationException", `ExportFormat ${ExportFormat} is not supported. Use DYNAMODB_JSON.`);
  }
  if (ExportType !== "FULL_EXPORT") {
    throw apiError("ValidationException", "Only FULL_EXPORT is supported.");
  }

  const s3 = sim.s3;
  if (!s3) throw apiError("ValidationException", "The S3 service is not available in this simulator.");
  if (!s3.getBucket(S3Bucket)) {
    throw apiError("ValidationException", "The S3 bucket that is being used as the export destination does not exist.");
  }

  const { definition, items, restoreMs } = sim.pitr.snapshotAt(tableName, {
    RestoreDateTime: ExportTime,
    UseLatestRestorableTime: ExportTime === undefined || ExportTime === null,
  });

  const id = crypto.randomBytes(16).toString("hex");
  const startTime = new Date();
  const prefix = normalizePrefix(S3Prefix);
  const base = `${prefix}AWSDynamoDB/${id}`;
  const exportArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${tableName}/export/${id}`;

  const lines = items.map((item) => JSON.stringify({ Item: sim.marshallItem(item, definition) }));
  const gzipped = zlib.gzipSync(Buffer.from(lines.map((line) => `${line}\n`).join("")));
  const dataMd5 = crypto.createHash("md5").update(gzipped).digest("hex");
  const dataKey = `${base}/data/${dataMd5}.json.gz`;

  const manifestFilesKey = `${base}/manifest-files.json`;
  const manifestSummaryKey = `${base}/manifest-summary.json`;
  const manifestFiles = JSON.stringify({
    itemCount: items.length,
    md5Checksum: dataMd5,
    etag: dataMd5,
    dataFileS3Key: dataKey,
  }) + "\n";
  const manifestSummary = {
    version: "2020-06-24",
    exportArn,
    startTime: startTime.toISOString(),
    endTime: new Date().toISOString(),
    tableArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${tableName}`,
    exportTime: new Date(restoreMs).toISOString(),
    s3Bucket: S3Bucket,
    s3Prefix: prefix,
    outputFormat: ExportFormat,
    manifestFilesS3Key: manifestFilesKey,
    itemCount: items.length,
    billedSizeBytes: gzipped.length,
  };

  putToS3(s3, S3Bucket, dataKey, gzipped, "application/gzip");
  putToS3(s3, S3Bucket, manifestFilesKey, Buffer.from(manifestFiles), "application/json");
  putToS3(s3, S3Bucket, manifestSummaryKey, Buffer.from(JSON.stringify(manifestSummary, null, 2)), "application/json");

  const meta = {
    ExportArn: exportArn,
    ExportStatus: "COMPLETED",
    TableArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${tableName}`,
    ExportTime: new Date(restoreMs).toISOString(),
    StartTime: startTime.toISOString(),
    EndTime: new Date().toISOString(),
    ExportFormat,
    S3Bucket,
    S3Prefix: prefix,
    ItemCount: items.length,
    BilledSizeBytes: gzipped.length,
    ExportManifest: manifestSummaryKey,
  };

  fs.mkdirSync(exportsDir(sim), { recursive: true });
  fs.writeFileSync(exportFileFor(sim, id), JSON.stringify(meta));

  return { ExportDescription: exportDescriptionOf(meta) };
}

function describeExport(sim, { ExportArn } = {}) {
  if (!ExportArn) throw apiError("ValidationException", "ExportArn is required");
  return { ExportDescription: exportDescriptionOf(loadExport(sim, ExportArn)) };
}

function listExports(sim, { TableArn, MaxResults = 25 } = {}) {
  const dir = exportsDir(sim);
  if (!fs.existsSync(dir)) return { ExportSummaries: [] };

  const tableName = TableArn ? requireTableName(TableArn) : null;
  const metas = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter((m) => !tableName || m.ExportArn.includes(`:table/${tableName}/export/`))
    .sort((a, b) => a.StartTime.localeCompare(b.StartTime))
    .slice(0, MaxResults);

  return {
    ExportSummaries: metas.map((m) => ({ ExportArn: m.ExportArn, ExportStatus: m.ExportStatus })),
  };
}

module.exports = { exportTableToPointInTime, describeExport, listExports };
