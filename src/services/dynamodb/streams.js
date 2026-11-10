/**
 * DynamoDB Streams: captura das mudanças nos itens e leitura pelo shard da tabela.
 *
 * Cada tabela com stream ativo grava um registro por item alterado (INSERT, MODIFY ou REMOVE)
 * em <dataDir>/_streams/<tabela>.jsonl. Há um único shard por tabela, com números de sequência
 * crescentes. O formato dos registros segue o da API (eventName, dynamodb.Keys, NewImage, OldImage...).
 *
 * A captura usa o mesmo hook de escrita do store que o PITR usa. Ela compara o estado anterior
 * com o gravado, então PutItem, UpdateItem, DeleteItem, lotes, transações e PartiQL são cobertos.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { apiError } = require("./backups");

const REGION = "us-east-1";
const ACCOUNT_ID = "000000000000";
const VIEW_TYPES = ["KEYS_ONLY", "NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES"];
const SEQ_WIDTH = 21;

function streamsDir(sim) {
  return path.join(sim.dataDir, "_streams");
}

function logFileFor(sim, tableName) {
  return path.join(streamsDir(sim), `${tableName}.jsonl`);
}

function tableFromStreamArn(streamArn) {
  const match = typeof streamArn === "string" ? streamArn.match(/:table\/([^/]+)\/stream\//) : null;
  return match ? match[1] : null;
}

function streamArnOf(tableName, label) {
  return `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${tableName}/stream/${label}`;
}

function shardIdFor(tableName) {
  const digest = crypto.createHash("md5").update(tableName).digest("hex").slice(0, 8);
  return `shardId-00000000000000000000-${digest}`;
}

function seqString(n) {
  return String(n).padStart(SEQ_WIDTH, "0");
}

class DynamoDBStreams {
  constructor(sim) {
    this.sim = sim;
    this.lastSeq = new Map(); // tabela -> último número de sequência gravado
    this._installWriteHook();
  }

  // ---------- captura ----------

  _installWriteHook() {
    const store = this.sim.store;
    const originalWrite = store.write.bind(store);

    store.write = (entity, data, extra) => {
      if (!this._isEnabled(entity)) return originalWrite(entity, data, extra);

      const before = store.read(entity);
      const payload = data === null || data === undefined ? extra : data;
      this._capture(entity, before, Array.isArray(payload) ? payload : []);
      return originalWrite(entity, data, extra);
    };
  }

  _isEnabled(tableName) {
    const definition = this.sim.tables.get(tableName);
    return !!definition?.streamSpecification?.StreamEnabled;
  }

  _capture(tableName, before, after) {
    const definition = this.sim.tables.get(tableName);
    if (!definition) return;

    const keyOf = (item) => this.sim.getItemKey(item, definition);
    const beforeMap = new Map(before.map((item) => [keyOf(item), item]));
    const afterMap = new Map(after.map((item) => [keyOf(item), item]));

    const records = [];
    for (const [key, oldItem] of beforeMap) {
      const newItem = afterMap.get(key);
      if (newItem === undefined) {
        records.push(this._buildRecord(tableName, definition, "REMOVE", oldItem, null));
      } else if (JSON.stringify(newItem) !== JSON.stringify(oldItem)) {
        records.push(this._buildRecord(tableName, definition, "MODIFY", oldItem, newItem));
      }
    }
    for (const [key, newItem] of afterMap) {
      if (!beforeMap.has(key)) records.push(this._buildRecord(tableName, definition, "INSERT", null, newItem));
    }
    if (!records.length) return;

    fs.mkdirSync(streamsDir(this.sim), { recursive: true });
    let seq = this._currentSeq(tableName);
    const lines = records.map((record) => {
      seq += 1;
      record.dynamodb.SequenceNumber = seqString(seq);
      return JSON.stringify(record) + "\n";
    });
    fs.appendFileSync(logFileFor(this.sim, tableName), lines.join(""));
    this.lastSeq.set(tableName, seq);
  }

  _buildRecord(tableName, definition, eventName, oldItem, newItem) {
    const { StreamViewType } = definition.streamSpecification;
    const sourceItem = newItem ?? oldItem;

    const keyAttributes = [definition.hashKey, definition.rangeKey].filter(Boolean);
    const keys = {};
    for (const attr of keyAttributes) keys[attr] = sourceItem[attr];

    const dynamodb = {
      ApproximateCreationDateTime: Date.now() / 1000,
      Keys: this.sim.marshallItem(keys, definition),
      SizeBytes: Buffer.byteLength(JSON.stringify(sourceItem)),
      StreamViewType,
    };
    const includeNew = newItem && (StreamViewType === "NEW_IMAGE" || StreamViewType === "NEW_AND_OLD_IMAGES");
    const includeOld = oldItem && (StreamViewType === "OLD_IMAGE" || StreamViewType === "NEW_AND_OLD_IMAGES");
    if (includeNew) dynamodb.NewImage = this.sim.marshallItem(newItem, definition);
    if (includeOld) dynamodb.OldImage = this.sim.marshallItem(oldItem, definition);

    return {
      eventID: crypto.randomUUID(),
      eventName,
      eventVersion: "1.1",
      eventSource: "aws:dynamodb",
      awsRegion: REGION,
      eventSourceARN: streamArnOf(tableName, definition.latestStreamLabel),
      dynamodb,
    };
  }

  _readAll(tableName) {
    const file = logFileFor(this.sim, tableName);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  _currentSeq(tableName) {
    if (!this.lastSeq.has(tableName)) {
      const records = this._readAll(tableName);
      const last = records.length ? Number(records[records.length - 1].dynamodb.SequenceNumber) : 0;
      this.lastSeq.set(tableName, last);
    }
    return this.lastSeq.get(tableName);
  }

  // ---------- configuração ----------

  /** Ativa ou desativa o stream de uma tabela. Ativar cria um novo label; a ARN é derivada dele. */
  applySpecification(tableName, spec = {}) {
    const definition = this.sim.tables.get(tableName);
    if (!definition) {
      throw apiError("ResourceNotFoundException", `Requested resource not found: Table: ${tableName} not found`);
    }

    const current = definition.streamSpecification || {};
    if (spec.StreamEnabled) {
      if (!VIEW_TYPES.includes(spec.StreamViewType)) {
        throw apiError("ValidationException", `StreamViewType must be one of: ${VIEW_TYPES.join(", ")}`);
      }
      if (!current.StreamEnabled) definition.latestStreamLabel = new Date().toISOString();
      definition.streamSpecification = { StreamEnabled: true, StreamViewType: spec.StreamViewType };
    } else {
      definition.streamSpecification = { StreamEnabled: false, StreamViewType: current.StreamViewType };
    }
    this.sim.persistTables();
  }

  dropTable(tableName) {
    fs.rmSync(logFileFor(this.sim, tableName), { force: true });
    this.lastSeq.delete(tableName);
  }

  // ---------- API DynamoDB Streams ----------

  _describeTableOf(streamArn) {
    const tableName = tableFromStreamArn(streamArn);
    const definition = tableName ? this.sim.tables.get(tableName) : null;
    if (!definition || !definition.latestStreamLabel || streamArnOf(tableName, definition.latestStreamLabel) !== streamArn) {
      throw apiError("ResourceNotFoundException", `Requested resource not found: Stream: ${streamArn} not found`);
    }
    return { tableName, definition };
  }

  listStreams({ TableName } = {}) {
    const streams = [];
    for (const [name, definition] of this.sim.tables.entries()) {
      if (!definition.latestStreamLabel) continue;
      if (TableName && name !== TableName) continue;
      streams.push({
        StreamArn: streamArnOf(name, definition.latestStreamLabel),
        StreamLabel: definition.latestStreamLabel,
        TableName: name,
      });
    }
    return { Streams: streams };
  }

  describeStream({ StreamArn } = {}) {
    if (!StreamArn) throw apiError("ValidationException", "StreamArn is required");
    const { tableName, definition } = this._describeTableOf(StreamArn);
    const enabled = !!definition.streamSpecification?.StreamEnabled;

    return {
      StreamDescription: {
        StreamArn,
        StreamLabel: definition.latestStreamLabel,
        StreamStatus: enabled ? "ENABLED" : "DISABLED",
        StreamViewType: definition.streamSpecification?.StreamViewType,
        CreationRequestDateTime: Date.parse(definition.latestStreamLabel) / 1000,
        TableName: tableName,
        KeySchema: [
          { AttributeName: definition.hashKey, KeyType: "HASH" },
          ...(definition.rangeKey ? [{ AttributeName: definition.rangeKey, KeyType: "RANGE" }] : []),
        ],
        Shards: [{
          ShardId: shardIdFor(tableName),
          SequenceNumberRange: { StartingSequenceNumber: seqString(1) },
        }],
      },
    };
  }

  getShardIterator({ StreamArn, ShardId, ShardIteratorType, SequenceNumber } = {}) {
    const { tableName } = this._describeTableOf(StreamArn);
    if (ShardId !== shardIdFor(tableName)) {
      throw apiError("ResourceNotFoundException", `Shard ${ShardId} not found`);
    }

    const last = this._currentSeq(tableName);
    let next;
    switch (ShardIteratorType) {
      case "TRIM_HORIZON": next = 1; break;
      case "LATEST": next = last + 1; break;
      case "AT_SEQUENCE_NUMBER": next = Number(SequenceNumber); break;
      case "AFTER_SEQUENCE_NUMBER": next = Number(SequenceNumber) + 1; break;
      default: throw apiError("ValidationException", `Unsupported ShardIteratorType: ${ShardIteratorType}`);
    }
    if (!Number.isFinite(next)) throw apiError("ValidationException", "SequenceNumber is required for this iterator type");

    return { ShardIterator: encodeIterator(tableName, next) };
  }

  getRecords({ ShardIterator, Limit = 1000 } = {}) {
    const { table: tableName, next } = decodeIterator(ShardIterator);
    const page = this._readAll(tableName)
      .filter((record) => Number(record.dynamodb.SequenceNumber) >= next)
      .slice(0, Limit);

    const nextSeq = page.length ? Number(page[page.length - 1].dynamodb.SequenceNumber) + 1 : next;
    return { Records: page, NextShardIterator: encodeIterator(tableName, nextSeq) };
  }

  // ---------- uso interno (mapeamentos de evento do Lambda) ----------

  isStreamArn(streamArn) {
    return tableFromStreamArn(streamArn) !== null;
  }

  latestSequenceNumber(streamArn) {
    const { tableName } = this._describeTableOf(streamArn);
    return this._currentSeq(tableName);
  }

  /** Registros a partir de fromSeq (até limit) e o próximo número de sequência a ler. */
  readRecords(streamArn, fromSeq, limit = 100) {
    const tableName = tableFromStreamArn(streamArn);
    if (!tableName) return { records: [], nextSeq: fromSeq };

    const page = this._readAll(tableName)
      .filter((record) => Number(record.dynamodb.SequenceNumber) >= fromSeq)
      .slice(0, limit);
    const nextSeq = page.length ? Number(page[page.length - 1].dynamodb.SequenceNumber) + 1 : fromSeq;
    return { records: page, nextSeq };
  }
}

function encodeIterator(tableName, next) {
  return Buffer.from(JSON.stringify({ table: tableName, next })).toString("base64");
}

function decodeIterator(iterator) {
  try {
    const parsed = JSON.parse(Buffer.from(String(iterator), "base64").toString("utf8"));
    if (!parsed.table || !Number.isInteger(parsed.next)) throw new Error("invalid");
    return parsed;
  } catch {
    throw apiError("ValidationException", "Invalid ShardIterator");
  }
}

module.exports = { DynamoDBStreams, tableFromStreamArn };
