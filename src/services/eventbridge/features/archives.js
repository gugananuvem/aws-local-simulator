/**
 * @fileoverview Archives e Replays do EventBridge.
 *
 * Archives guardam eventos que casam com um EventPattern. Replays republicam
 * esses eventos no barramento de destino, sem realimentar o próprio archive.
 */

'use strict';

const {
  nowIso, buildArn, awsError, paginate,
} = require('./shared');

const MAX_EVENTS_PER_ARCHIVE = 10000;

/** Extrai o nome do barramento a partir de um ARN. */
function busNameFromArn(arn) {
  if (!arn) return null;
  const match = String(arn).match(/:event-bus\/(.+)$/);
  return match ? match[1] : null;
}

class ArchiveFeature {
  /** @param {Object} simulator */
  constructor(simulator) {
    this.simulator = simulator;
    this.store = simulator.store;
    this.logger = simulator.logger;
    /** @type {Map<string, Object>} */
    this.archives = new Map();
    /** @type {Map<string, Object>} */
    this.replays = new Map();
    /** @type {Map<string, {timer: any, cancelled: boolean}>} */
    this.replayRuns = new Map();
  }

  async load() {
    const archives = await this.store.read('eventbridge/archives');
    if (Array.isArray(archives)) {
      for (const archive of archives) {
        if (archive && archive.ArchiveName) {
          archive.ParsedPattern = archive.EventPattern ? this._parsePattern(archive.EventPattern) : null;
          archive.Events = Array.isArray(archive.Events) ? archive.Events : [];
          this.archives.set(archive.ArchiveName, archive);
        }
      }
    }

    const replays = await this.store.read('eventbridge/replays');
    if (Array.isArray(replays)) {
      for (const replay of replays) {
        if (!replay || !replay.ReplayName) continue;
        // Replays em execução não sobrevivem a um restart do processo.
        if (replay.State === 'RUNNING') {
          replay.State = 'FAILED';
          replay.StateReason = 'Replay interrompido pelo restart do simulador';
          replay.ReplayEndTime = nowIso();
        }
        this.replays.set(replay.ReplayName, replay);
      }
    }
  }

  async save() {
    await this.store.write('eventbridge/archives', null, Array.from(this.archives.values()));
    await this.store.write('eventbridge/replays', null, Array.from(this.replays.values()));
  }

  async reset() {
    for (const run of this.replayRuns.values()) {
      if (run.timer) clearTimeout(run.timer);
    }
    this.replayRuns.clear();
    this.archives.clear();
    this.replays.clear();
  }

  _parsePattern(pattern) {
    if (pattern === undefined || pattern === null || pattern === '') return null;
    if (typeof pattern === 'object') return pattern;
    try {
      return JSON.parse(pattern);
    } catch {
      throw awsError('InvalidEventPatternException', 'EventPattern do archive não é um JSON válido');
    }
  }

  _findArchive(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.archives.has(nameOrArn)) return this.archives.get(nameOrArn);
    return Array.from(this.archives.values())
      .find((archive) => archive.ArchiveArn === nameOrArn) || null;
  }

  _trimArchive(archive) {
    if (archive.Events.length > MAX_EVENTS_PER_ARCHIVE) {
      archive.Events = archive.Events.slice(-MAX_EVENTS_PER_ARCHIVE);
    }
    archive.EventCount = archive.Events.length;
    archive.SizeBytes = Buffer.byteLength(JSON.stringify(archive.Events), 'utf8');
  }

  /**
   * Registra um evento em todos os archives habilitados do barramento.
   * @param {string} busName
   * @param {Object} event
   */
  async record(busName, event) {
    if (!this.archives.size) return;
    if (event && event.replayName) return;

    let changed = false;
    const busArn = buildArn(this.simulator, 'events', `event-bus/${busName}`);

    for (const archive of this.archives.values()) {
      if (archive.State !== 'ENABLED') continue;
      if (archive.EventSourceArn !== busArn && archive.BusName !== busName) continue;
      if (archive.ParsedPattern && !this.simulator._matchesPattern(event, archive.ParsedPattern)) {
        continue;
      }

      archive.Events.push({
        ...event,
        EventBusName: busName,
        ArchiveTime: nowIso(),
      });
      this._trimArchive(archive);
      changed = true;
    }

    if (changed) await this.save();
  }

  /**
   * CreateArchive
   * @param {Object} params
   */
  async createArchive(params = {}) {
    const { ArchiveName, EventSourceArn, Description, EventPattern, RetentionDays } = params;
    if (!ArchiveName) throw awsError('ValidationException', 'ArchiveName é obrigatório');
    if (!EventSourceArn) throw awsError('ValidationException', 'EventSourceArn é obrigatório');
    if (this.archives.has(ArchiveName)) {
      throw awsError('ResourceAlreadyExistsException', `Archive ${ArchiveName} já existe`);
    }

    const busName = busNameFromArn(EventSourceArn);
    if (!busName || !this.simulator.buses.has(busName)) {
      throw awsError('ResourceNotFoundException', `Event bus não encontrado: ${EventSourceArn}`);
    }

    const archive = {
      ArchiveName,
      ArchiveArn: buildArn(this.simulator, 'events', `archive/${ArchiveName}`),
      EventSourceArn,
      BusName: busName,
      Description: Description || '',
      EventPattern: EventPattern ? (typeof EventPattern === 'string' ? EventPattern : JSON.stringify(EventPattern)) : null,
      ParsedPattern: this._parsePattern(EventPattern),
      State: 'ENABLED',
      RetentionDays: Number(RetentionDays) || 0,
      EventCount: 0,
      SizeBytes: 0,
      CreationTime: nowIso(),
      Events: [],
    };

    this.archives.set(ArchiveName, archive);
    await this.save();
    this.logger.info('EventBridge', `Archive criado: ${ArchiveName}`);

    return {
      ArchiveArn: archive.ArchiveArn,
      State: archive.State,
      CreationTime: archive.CreationTime,
    };
  }

  async deleteArchive(params = {}) {
    const archive = this._findArchive(params.ArchiveName);
    if (!archive) throw awsError('ResourceNotFoundException', `Archive não encontrado: ${params.ArchiveName}`);
    this.archives.delete(archive.ArchiveName);
    await this.save();
    return {};
  }

  describeArchive(params = {}) {
    const archive = this._findArchive(params.ArchiveName);
    if (!archive) throw awsError('ResourceNotFoundException', `Archive não encontrado: ${params.ArchiveName}`);
    return {
      ArchiveName: archive.ArchiveName,
      ArchiveArn: archive.ArchiveArn,
      Description: archive.Description,
      EventSourceArn: archive.EventSourceArn,
      EventPattern: archive.EventPattern,
      State: archive.State,
      RetentionDays: archive.RetentionDays,
      SizeBytes: archive.SizeBytes,
      EventCount: archive.EventCount,
      CreationTime: archive.CreationTime,
    };
  }

  listArchives(params = {}) {
    let archives = Array.from(this.archives.values());
    if (params.NamePrefix) {
      archives = archives.filter((archive) => archive.ArchiveName.startsWith(params.NamePrefix));
    }
    const list = archives.map((archive) => this.describeArchive({ ArchiveName: archive.ArchiveName }));
    return paginate(list, params, 'Archives');
  }

  async updateArchive(params = {}) {
    const archive = this._findArchive(params.ArchiveName);
    if (!archive) throw awsError('ResourceNotFoundException', `Archive não encontrado: ${params.ArchiveName}`);

    if (params.Description !== undefined) archive.Description = params.Description;
    if (params.EventPattern !== undefined) {
      archive.EventPattern = params.EventPattern
        ? (typeof params.EventPattern === 'string' ? params.EventPattern : JSON.stringify(params.EventPattern))
        : null;
      archive.ParsedPattern = this._parsePattern(params.EventPattern);
    }
    if (params.RetentionDays !== undefined) archive.RetentionDays = Number(params.RetentionDays) || 0;
    if (params.State !== undefined) archive.State = params.State;

    await this.save();
    return this.describeArchive({ ArchiveName: archive.ArchiveName });
  }

  /** Eventos crus de um archive (usado pelo replay). */
  getArchiveEvents(nameOrArn) {
    const archive = this._findArchive(nameOrArn);
    return archive ? archive.Events.slice() : [];
  }

  /**
   * StartReplay
   * @param {Object} params
   */
  async startReplay(params = {}) {
    const { ReplayName, EventSourceArn, Destination, Description } = params;
    if (!ReplayName) throw awsError('ValidationException', 'ReplayName é obrigatório');
    if (!EventSourceArn) throw awsError('ValidationException', 'EventSourceArn é obrigatório');
    if (!Destination || !Destination.Arn) throw awsError('ValidationException', 'Destination.Arn é obrigatório');
    if (this.replays.has(ReplayName)) {
      throw awsError('ResourceAlreadyExistsException', `Replay ${ReplayName} já existe`);
    }

    const archive = this._findArchive(EventSourceArn);
    if (!archive) throw awsError('ResourceNotFoundException', `Archive não encontrado: ${EventSourceArn}`);

    const destinationBus = busNameFromArn(Destination.Arn);
    if (!destinationBus || !this.simulator.buses.has(destinationBus)) {
      throw awsError('ResourceNotFoundException', `Event bus de destino não encontrado: ${Destination.Arn}`);
    }

    const replay = {
      ReplayName,
      ReplayArn: buildArn(this.simulator, 'events', `replay/${ReplayName}`),
      EventSourceArn: archive.ArchiveArn,
      Destination,
      Description: Description || '',
      State: 'RUNNING',
      ReplayStartTime: nowIso(),
      ReplayEndTime: null,
      EventStartTime: params.EventStartTime ? new Date(params.EventStartTime).toISOString() : null,
      EventEndTime: params.EventEndTime ? new Date(params.EventEndTime).toISOString() : null,
      EventCount: 0,
      ReplayedEventCount: 0,
    };

    this.replays.set(ReplayName, replay);
    await this.save();

    const events = this._selectReplayEvents(archive, replay);
    replay.EventCount = events.length;
    await this.save();

    const run = { timer: null, cancelled: false };
    this.replayRuns.set(ReplayName, run);
    this._runReplay(replay, events, destinationBus, run);

    this.logger.info('EventBridge', `Replay iniciado: ${ReplayName} (${events.length} eventos)`);
    return {
      ReplayArn: replay.ReplayArn,
      State: replay.State,
      ReplayStartTime: replay.ReplayStartTime,
    };
  }

  _selectReplayEvents(archive, replay) {
    const start = replay.EventStartTime ? new Date(replay.EventStartTime).getTime() : null;
    const end = replay.EventEndTime ? new Date(replay.EventEndTime).getTime() : null;
    return archive.Events.filter((event) => {
      const time = new Date(event.time).getTime();
      if (start !== null && time < start) return false;
      if (end !== null && time > end) return false;
      return true;
    });
  }

  _runReplay(replay, events, destinationBus, run) {
    const chunkSize = 25;
    let offset = 0;

    const processChunk = async () => {
      if (run.cancelled) return;

      const chunk = events.slice(offset, offset + chunkSize);
      offset += chunk.length;

      if (chunk.length) {
        const entries = chunk.map((event) => ({
          EventBusName: destinationBus,
          Source: event.source,
          DetailType: event['detail-type'],
          Detail: JSON.stringify(event.detail || {}),
          Resources: event.resources || [],
          Time: event.time,
          ReplayName: replay.ReplayName,
        }));

        try {
          const result = await this.simulator.putEvents({ Entries: entries });
          replay.ReplayedEventCount += chunk.length - (result.FailedEntryCount || 0);
        } catch (err) {
          replay.State = 'FAILED';
          replay.StateReason = err.message;
          replay.ReplayEndTime = nowIso();
          this.replayRuns.delete(replay.ReplayName);
          await this.save();
          return;
        }
      }

      if (offset >= events.length) {
        replay.State = 'COMPLETED';
        replay.ReplayEndTime = nowIso();
        this.replayRuns.delete(replay.ReplayName);
        await this.save();
        return;
      }

      run.timer = setTimeout(() => { processChunk(); }, 25);
      if (run.timer.unref) run.timer.unref();
    };

    run.timer = setTimeout(() => { processChunk(); }, 0);
    if (run.timer.unref) run.timer.unref();
  }

  async cancelReplay(params = {}) {
    const replay = this.replays.get(params.ReplayName)
      || Array.from(this.replays.values()).find((item) => item.ReplayArn === params.ReplayName);
    if (!replay) throw awsError('ResourceNotFoundException', `Replay não encontrado: ${params.ReplayName}`);
    if (replay.State !== 'RUNNING') return { ReplayArn: replay.ReplayArn, State: replay.State };

    const run = this.replayRuns.get(replay.ReplayName);
    if (run) {
      run.cancelled = true;
      if (run.timer) clearTimeout(run.timer);
      this.replayRuns.delete(replay.ReplayName);
    }

    replay.State = 'CANCELLED';
    replay.StateReason = 'Cancelado pelo usuário';
    replay.ReplayEndTime = nowIso();
    await this.save();
    return { ReplayArn: replay.ReplayArn, State: replay.State };
  }

  describeReplay(params = {}) {
    const replay = this.replays.get(params.ReplayName)
      || Array.from(this.replays.values()).find((item) => item.ReplayArn === params.ReplayName);
    if (!replay) throw awsError('ResourceNotFoundException', `Replay não encontrado: ${params.ReplayName}`);
    return { ...replay };
  }

  listReplays(params = {}) {
    let replays = Array.from(this.replays.values());
    if (params.NamePrefix) {
      replays = replays.filter((replay) => replay.ReplayName.startsWith(params.NamePrefix));
    }
    const list = replays.map((replay) => ({ ...replay }));
    return paginate(list, params, 'Replays');
  }

  /** Remove archives e replays de um barramento excluído. */
  async deleteForBus(busName) {
    let changed = false;
    for (const [name, archive] of this.archives.entries()) {
      if (archive.BusName === busName || archive.EventSourceArn.endsWith(`:event-bus/${busName}`)) {
        this.archives.delete(name);
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  getStats() {
    return {
      archives: this.archives.size,
      replays: this.replays.size,
    };
  }
}

module.exports = { ArchiveFeature, busNameFromArn };
