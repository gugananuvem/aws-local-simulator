/**
 * Point-in-time recovery (PITR) do DynamoDB.
 *
 * Com o PITR ativo em uma tabela, cada alteração nos itens é registrada em
 * <dataDir>/_pitr/<tabela>.jsonl com a imagem anterior do item (before, ou null se o item não existia).
 * A captura é feita no store: toda gravação de tabela é comparada com o estado anterior,
 * então PutItem, UpdateItem, DeleteItem, lotes, transações e PartiQL são cobertos sem alterações nesses fluxos.
 *
 * Para restaurar no instante T, parte-se do estado atual e desfazem-se, do mais recente para o mais antigo,
 * as alterações registradas depois de T.
 *
 * O histórico é mantido por 35 dias e apagado quando o PITR é desativado ou a tabela é removida.
 */

const fs = require("fs");
const path = require("path");
const { materializeTable, describeForSdk, apiError } = require("./backups");

const RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;

class PointInTimeRecovery {
  constructor(sim) {
    this.sim = sim;
    this.dir = path.join(sim.dataDir, "_pitr");
    this.settings = this._loadSettings();
    this.lastPrune = new Map();
    this._installWriteHook();
  }

  // ---------- persistência de configuração e histórico ----------

  _configFile() {
    return path.join(this.dir, "config.json");
  }

  _journalFile(table) {
    return path.join(this.dir, `${table}.jsonl`);
  }

  _loadSettings() {
    const file = this._configFile();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  _saveSettings() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this._configFile(), JSON.stringify(this.settings, null, 2));
  }

  _readJournal(table) {
    const file = this._journalFile(table);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  _writeJournal(table, entries) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this._journalFile(table), entries.map((e) => JSON.stringify(e) + "\n").join(""));
  }

  // ---------- captura de alterações ----------

  _installWriteHook() {
    const store = this.sim.store;
    const originalWrite = store.write.bind(store);

    store.write = (entity, data, extra) => {
      if (!this.settings[entity]) return originalWrite(entity, data, extra);

      const before = store.read(entity);
      const payload = data === null || data === undefined ? extra : data;
      this._record(entity, before, Array.isArray(payload) ? payload : []);
      return originalWrite(entity, data, extra);
    };
  }

  _record(table, before, after) {
    const definition = this.sim.tables.get(table);
    if (!definition) return;

    const keyOf = (item) => this.sim.getItemKey(item, definition);
    const beforeMap = new Map(before.map((item) => [keyOf(item), item]));
    const afterMap = new Map(after.map((item) => [keyOf(item), item]));

    const ts = new Date().toISOString();
    const entries = [];

    for (const [key, item] of beforeMap) {
      const next = afterMap.get(key);
      if (next === undefined || JSON.stringify(next) !== JSON.stringify(item)) {
        entries.push({ ts, key, before: item });
      }
    }
    for (const key of afterMap.keys()) {
      if (!beforeMap.has(key)) entries.push({ ts, key, before: null });
    }

    if (!entries.length) return;

    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this._journalFile(table), entries.map((e) => JSON.stringify(e) + "\n").join(""));
    this._pruneIfDue(table);
  }

  _pruneIfDue(table) {
    const now = Date.now();
    if (now - (this.lastPrune.get(table) || 0) < PRUNE_INTERVAL_MS) return;
    this.lastPrune.set(table, now);

    const cutoff = now - RETENTION_MS;
    const kept = this._readJournal(table).filter((e) => Date.parse(e.ts) >= cutoff);
    this._writeJournal(table, kept);
  }

  dropTable(table) {
    if (this.settings[table]) {
      delete this.settings[table];
      this._saveSettings();
    }
    fs.rmSync(this._journalFile(table), { force: true });
    this.lastPrune.delete(table);
  }

  // ---------- API DynamoDB ----------

  _requireTable(tableName) {
    if (!tableName) throw apiError("ValidationException", "TableName is required");
    if (!this.sim.tables.has(tableName)) {
      throw apiError("ResourceNotFoundException", `Requested resource not found: Table: ${tableName} not found`);
    }
  }

  // O SDK envia e recebe datas com precisão de segundo: o início arredonda para baixo.
  _earliestRestorable(cfg, now) {
    return Math.floor(Math.max(cfg.enabledAt, now - RETENTION_MS) / 1000) * 1000;
  }

  _describe(tableName) {
    const cfg = this.settings[tableName];
    if (!cfg) {
      return {
        ContinuousBackupsStatus: "DISABLED",
        PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: "DISABLED" },
      };
    }
    const now = Date.now();
    return {
      ContinuousBackupsStatus: "ENABLED",
      PointInTimeRecoveryDescription: {
        PointInTimeRecoveryStatus: "ENABLED",
        EarliestRestorableDateTime: this._earliestRestorable(cfg, now) / 1000,
        LatestRestorableDateTime: now / 1000,
      },
    };
  }

  describeContinuousBackups({ TableName } = {}) {
    this._requireTable(TableName);
    return { ContinuousBackupsDescription: this._describe(TableName) };
  }

  updateContinuousBackups({ TableName, PointInTimeRecoverySpecification } = {}) {
    this._requireTable(TableName);
    if (!PointInTimeRecoverySpecification || typeof PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled !== "boolean") {
      throw apiError("ValidationException", "PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled is required");
    }

    if (PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled) {
      if (!this.settings[TableName]) {
        // Histórico começa do zero: qualquer arquivo antigo é descartado.
        fs.rmSync(this._journalFile(TableName), { force: true });
        this.settings[TableName] = { enabledAt: Date.now() };
        this._saveSettings();
      }
    } else {
      this.dropTable(TableName);
    }

    return { ContinuousBackupsDescription: this._describe(TableName) };
  }

  /** Estado dos itens no instante restoreMs: desfaz, do mais recente ao mais antigo, as alterações posteriores. */
  _stateAt(tableName, restoreMs) {
    const definition = this.sim.tables.get(tableName);
    const state = this.sim.store.read(tableName);
    const later = this._readJournal(tableName).filter((e) => Date.parse(e.ts) > restoreMs);

    for (let i = later.length - 1; i >= 0; i--) {
      const { key, before } = later[i];
      const index = state.findIndex((item) => this.sim.getItemKey(item, definition) === key);
      if (before === null) {
        if (index !== -1) state.splice(index, 1);
      } else if (index !== -1) {
        state[index] = before;
      } else {
        state.push(before);
      }
    }
    return state;
  }

  /**
   * Definição e itens da tabela no instante pedido (RestoreDateTime ou o último instante restaurável).
   * Usado pela restauração e pelo export; valida a tabela, o PITR e a janela de tempo.
   */
  snapshotAt(tableName, { RestoreDateTime, UseLatestRestorableTime } = {}) {
    const definition = this.sim.tables.get(tableName);
    if (!definition) throw apiError("TableNotFoundException", `Source table not found: ${tableName}`);

    const cfg = this.settings[tableName];
    if (!cfg) {
      throw apiError("PointInTimeRecoveryUnavailableException", "Point in time recovery has not been enabled for this source table.");
    }

    const now = Date.now();
    let restoreMs;
    if (UseLatestRestorableTime) {
      restoreMs = now;
    } else if (RestoreDateTime !== undefined && RestoreDateTime !== null) {
      // O SDK envia timestamps como segundos desde a época; strings ISO também são aceitas.
      restoreMs = typeof RestoreDateTime === "number" ? RestoreDateTime * 1000 : Date.parse(RestoreDateTime);
    } else {
      throw apiError("ValidationException", "Either RestoreDateTime or UseLatestRestorableTime must be specified");
    }

    if (!Number.isFinite(restoreMs)) throw apiError("ValidationException", "RestoreDateTime is not a valid date");

    // O fim arredonda para cima, para aceitar o segundo corrente enviado pelo SDK.
    const earliest = this._earliestRestorable(cfg, now);
    const latest = Math.ceil(now / 1000) * 1000;
    if (restoreMs < earliest || restoreMs > latest) {
      throw apiError(
        "InvalidRestoreTimeException",
        `Restore time must be between ${new Date(earliest).toISOString()} and ${new Date(latest).toISOString()}`
      );
    }

    return { definition, items: this._stateAt(tableName, restoreMs), restoreMs };
  }

  restoreTableToPointInTime({ SourceTableName, TargetTableName, RestoreDateTime, UseLatestRestorableTime } = {}) {
    if (!SourceTableName) throw apiError("ValidationException", "SourceTableName is required");
    if (!TargetTableName) throw apiError("ValidationException", "TargetTableName is required");

    const { definition, items } = this.snapshotAt(SourceTableName, { RestoreDateTime, UseLatestRestorableTime });

    if (this.sim.tables.has(TargetTableName)) {
      throw apiError("TableAlreadyExistsException", `Table already exists: ${TargetTableName}`);
    }

    materializeTable(this.sim, TargetTableName, definition, items);
    return { TableDescription: describeForSdk(this.sim, TargetTableName) };
  }
}

module.exports = { PointInTimeRecovery };
