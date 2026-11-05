/**
 * @fileoverview Pipes do EventBridge.
 *
 * Um pipe conecta uma origem (SQS ou regra do EventBridge) a um destino,
 * com filtro opcional, enriquecimento via Lambda e template de entrada.
 * Pipes em execução com origem SQS são consumidos por polling.
 */

'use strict';

const {
  nowIso, buildArn, awsError, normalizeTags, paginate, clone,
} = require('./shared');
const { busNameFromArn } = require('./archives');

const POLL_INTERVAL_MS = 1000;

/** Extrai o nome da fila a partir de um ARN/URL do SQS. */
function queueNameFromArn(arn) {
  if (!arn) return null;
  const match = String(arn).match(/:queue\/([^/:]+)$/);
  if (match) return match[1];
  const urlMatch = String(arn).match(/\/queue\/([^/?]+)/);
  return urlMatch ? urlMatch[1] : null;
}

class PipeFeature {
  /** @param {Object} simulator */
  constructor(simulator) {
    this.simulator = simulator;
    this.store = simulator.store;
    this.logger = simulator.logger;
    /** @type {Map<string, Object>} */
    this.pipes = new Map();
    /** @type {Set<string>} pipes com polling em andamento */
    this.polling = new Set();
    this._warnedSqs = false;
    this._timer = null;
  }

  /** Inicia o polling de pipes com origem SQS. */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.tick().catch((err) => {
        if (this.logger) this.logger.warn('EventBridge', `Erro no poll de pipes: ${err.message}`);
      });
    }, POLL_INTERVAL_MS);
    if (this._timer.unref) this._timer.unref();
    if (this.logger) this.logger.debug('EventBridge', 'Pipes polling iniciado');
  }

  /** Para o polling de pipes. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async load() {
    const pipes = await this.store.read('eventbridge/pipes');
    if (Array.isArray(pipes)) {
      for (const pipe of pipes) {
        if (!pipe || !pipe.Name) continue;
        // Um pipe que estava rodando volta a rodar após o restart.
        if (pipe.DesiredState === 'RUNNING') pipe.CurrentState = 'RUNNING';
        this.pipes.set(pipe.Name, pipe);
      }
    }
  }

  async save() {
    await this.store.write('eventbridge/pipes', null, Array.from(this.pipes.values()));
  }

  async reset() {
    this.pipes.clear();
    this.polling.clear();
  }

  _getRecords(pipe) {
    if (pipe.DesiredState !== 'RUNNING' || pipe.CurrentState !== 'RUNNING') return [];
    const source = String(pipe.Source || '');
    if (source.includes(':sqs:') || source.includes(':queue/')) return this._pollSqs(pipe);
    return [];
  }

  /**
   * Executa um ciclo de polling de todos os pipes habilitados.
   * Chamado pelo timer único das features.
   */
  async tick() {
    for (const pipe of this.pipes.values()) {
      const source = String(pipe.Source || '');
      if (!(source.includes(':sqs:') || source.includes(':queue/'))) continue;
      if (pipe.DesiredState !== 'RUNNING' || pipe.CurrentState !== 'RUNNING') continue;
      if (this.polling.has(pipe.Name)) continue;

      this.polling.add(pipe.Name);
      try {
        await this._pollSqs(pipe);
      } catch (err) {
        this.logger.warn('EventBridge', `Pipe ${pipe.Name} falhou no polling: ${err.message}`);
      } finally {
        this.polling.delete(pipe.Name);
      }
    }
  }

  async _pollSqs(pipe) {
    const sqsService = this.simulator.sqsService;
    if (!sqsService || !sqsService.simulator) {
      if (!this._warnedSqs) {
        this.logger.warn('EventBridge', 'Pipe SQS aguardando o serviço SQS ficar disponível');
        this._warnedSqs = true;
      }
      return;
    }

    const sqs = sqsService.simulator;
    const queueUrl = this.simulator._resolveSqsQueueUrl(pipe.Source);
    if (!queueUrl) {
      throw new Error(`Fila SQS não encontrada: ${pipe.Source}`);
    }

    const batchSize = Math.min(
      Math.max(Number(pipe.SourceParameters?.SqsQueueParameters?.BatchSize) || 10, 1),
      10,
    );

    const result = sqs.receiveMessageAction({
      query: { QueueUrl: queueUrl, MaxNumberOfMessages: String(batchSize) },
    });
    if (result.error) throw new Error(result.error.message);
    const messages = result.messages || [];

    for (const message of messages) {
      try {
        await this._processSqsMessage(pipe, message);
        sqs.deleteMessageAction({ query: { QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle } });
      } catch (err) {
        this.logger.warn('EventBridge', `Pipe ${pipe.Name}: falha ao processar mensagem ${message.MessageId}: ${err.message}`);
        // A mensagem volta a ficar visível após o visibility timeout.
      }
    }
  }

  async _processSqsMessage(pipe, message) {
    let parsedBody = message.Body;
    try {
      parsedBody = JSON.parse(message.Body);
    } catch {
      // Corpo não-JSON é mantido como string.
    }

    const envelope = {
      source: 'aws.sqs',
      'detail-type': 'SQS Message',
      detail: {
        body: parsedBody,
        messageId: message.MessageId,
        receiptHandle: message.ReceiptHandle,
        attributes: message.Attributes,
      },
      body: parsedBody,
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
    };

    if (!this._matchesFilter(pipe, envelope, parsedBody)) return;

    let payload = message.Body;
    if (pipe.Enrichment) {
      payload = await this._enrich(pipe, payload);
    }

    const rendered = this._renderInput(pipe, envelope, payload);
    await this._deliver(pipe, rendered, envelope);
  }

  _matchesFilter(pipe, envelope, parsedBody) {
    const filters = pipe.FilterCriteria?.Filters;
    if (!Array.isArray(filters) || !filters.length) return true;

    return filters.some((filter) => {
      if (!filter || !filter.Pattern) return true;
      let pattern;
      try {
        pattern = typeof filter.Pattern === 'string' ? JSON.parse(filter.Pattern) : filter.Pattern;
      } catch {
        return true;
      }
      const target = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody : envelope;
      return this.simulator._matchesPattern(target, pattern);
    });
  }

  async _enrich(pipe, payload) {
    if (!this.simulator.lambdaService) return payload;
    let functionName = null;
    const match = String(pipe.Enrichment).match(/:function:([^:/]+)/);
    functionName = match ? match[1] : pipe.Enrichment;
    let parsed = payload;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // mantém string
    }
    try {
      const enriched = await this.simulator.lambdaService.simulator.invokeFunction(functionName, parsed);
      return enriched ?? payload;
    } catch (err) {
      this.logger.warn('EventBridge', `Enrichment do pipe ${pipe.Name} falhou: ${err.message}`);
      return payload;
    }
  }

  _renderInput(pipe, envelope, payload) {
    const template = pipe.TargetParameters?.InputTemplate;
    if (!template) return payload;

    let result = String(template);
    const reserved = {
      'aws.pipes.pipe-arn': pipe.Arn,
      'aws.pipes.pipe-name': pipe.Name,
    };
    for (const [key, value] of Object.entries(reserved)) {
      result = result.split(`<${key}>`).join(value);
    }

    result = result.replace(/<(\$[^>]+)>/g, (_, path) => {
      const value = this.simulator._extractPath(envelope, path);
      return typeof value === 'string' ? value : JSON.stringify(value);
    });

    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  async _deliver(pipe, payload, envelope) {
    if (String(pipe.Target).includes(':api-destination/')) {
      return this.simulator.features.integrations.deliverApiDestination(pipe.Target, payload);
    }

    return this.simulator._deliverToTarget(
      { Id: pipe.Name, Arn: pipe.Target, Input: null },
      typeof payload === 'string' ? payload : payload,
      { ruleArn: pipe.Arn, ruleName: pipe.Name, eventBusName: 'default' },
    );
  }

  /**
   * Alimenta pipes cuja origem é um barramento ou uma regra do EventBridge.
   * @param {string} busName
   * @param {Object} event
   */
  async onEventBridgeEvent(busName, event) {
    const busArn = buildArn(this.simulator, 'events', `event-bus/${busName}`);

    for (const pipe of this.pipes.values()) {
      if (pipe.DesiredState !== 'RUNNING' || pipe.CurrentState !== 'RUNNING') continue;
      const source = String(pipe.Source || '');
      if (!source.startsWith('arn:aws:events:')) continue;

      let matchesSource = false;
      if (source === busArn) {
        matchesSource = true;
      } else if (source.includes(':rule/')) {
        const rulePart = source.split(':rule/')[1] || '';
        const ruleName = rulePart.includes('/') ? rulePart.split('/').pop() : rulePart;
        const rule = this.simulator.describeRule({ Name: ruleName, EventBusName: busName });
        matchesSource = Boolean(rule && rule.ParsedPattern && this.simulator._matchesPattern(event, rule.ParsedPattern));
      }

      if (!matchesSource) continue;
      if (!this._matchesFilter(pipe, event, event.detail)) continue;

      try {
        const rendered = this._renderInput(pipe, event, event);
        await this._deliver(pipe, rendered, event);
      } catch (err) {
        this.logger.warn('EventBridge', `Pipe ${pipe.Name} falhou ao entregar evento: ${err.message}`);
      }
    }
  }

  // ==================== CRUD ====================

  async createPipe(params = {}) {
    const { Name, Source, Target, RoleArn } = params;
    if (!Name) throw awsError('ValidationException', 'Name é obrigatório');
    if (!Source) throw awsError('ValidationException', 'Source é obrigatório');
    if (!Target) throw awsError('ValidationException', 'Target é obrigatório');
    if (this.pipes.has(Name)) {
      throw awsError('ResourceAlreadyExistsException', `Pipe ${Name} já existe`);
    }

    this._validateSource(Source);
    this._validateTarget(Target);

    const pipe = {
      Name,
      Arn: buildArn(this.simulator, 'pipes', `pipe/${Name}`),
      Description: params.Description || '',
      RoleArn: RoleArn || null,
      Source,
      SourceParameters: params.SourceParameters || {},
      Enrichment: params.Enrichment || null,
      EnrichmentParameters: params.EnrichmentParameters || null,
      Target,
      TargetParameters: params.TargetParameters || {},
      FilterCriteria: params.FilterCriteria || null,
      DesiredState: params.DesiredState === 'STOPPED' ? 'STOPPED' : 'RUNNING',
      CurrentState: params.DesiredState === 'STOPPED' ? 'STOPPED' : 'RUNNING',
      StateReason: null,
      Tags: normalizeTags(params.Tags),
      CreationTime: nowIso(),
      LastModifiedTime: nowIso(),
    };

    this.pipes.set(Name, pipe);
    await this.save();
    this.logger.info('EventBridge', `Pipe criado: ${Name}`);
    return this.describePipe({ Name });
  }

  async updatePipe(params = {}) {
    const pipe = this.pipes.get(params.Name);
    if (!pipe) throw awsError('ResourceNotFoundException', `Pipe não encontrado: ${params.Name}`);

    if (params.Source !== undefined) {
      this._validateSource(params.Source);
      pipe.Source = params.Source;
    }
    if (params.Target !== undefined) {
      this._validateTarget(params.Target);
      pipe.Target = params.Target;
    }
    if (params.RoleArn !== undefined) pipe.RoleArn = params.RoleArn;
    if (params.Description !== undefined) pipe.Description = params.Description;
    if (params.SourceParameters !== undefined) pipe.SourceParameters = params.SourceParameters;
    if (params.TargetParameters !== undefined) pipe.TargetParameters = params.TargetParameters;
    if (params.Enrichment !== undefined) pipe.Enrichment = params.Enrichment;
    if (params.FilterCriteria !== undefined) pipe.FilterCriteria = params.FilterCriteria;
    if (params.DesiredState !== undefined) {
      pipe.DesiredState = params.DesiredState;
      pipe.CurrentState = params.DesiredState;
    }
    pipe.LastModifiedTime = nowIso();

    await this.save();
    return this.describePipe({ Name: pipe.Name });
  }

  async deletePipe(params = {}) {
    const pipe = this._findPipe(params.Name);
    if (!pipe) throw awsError('ResourceNotFoundException', `Pipe não encontrado: ${params.Name}`);
    this.pipes.delete(pipe.Name);
    this.polling.delete(pipe.Name);
    await this.save();
    return {};
  }

  async startPipe(params = {}) {
    return this._setPipeState(params.Name, 'RUNNING');
  }

  async stopPipe(params = {}) {
    return this._setPipeState(params.Name, 'STOPPED');
  }

  async _setPipeState(name, state) {
    const pipe = this._findPipe(name);
    if (!pipe) throw awsError('ResourceNotFoundException', `Pipe não encontrado: ${name}`);
    pipe.DesiredState = state;
    pipe.CurrentState = state;
    pipe.LastModifiedTime = nowIso();
    await this.save();
    return { Name: pipe.Name, DesiredState: state, CurrentState: state, LastModifiedTime: pipe.LastModifiedTime };
  }

  describePipe(params = {}) {
    const pipe = this._findPipe(params.Name);
    if (!pipe) throw awsError('ResourceNotFoundException', `Pipe não encontrado: ${params.Name}`);
    return clone(pipe);
  }

  listPipes(params = {}) {
    let pipes = Array.from(this.pipes.values());
    if (params.NamePrefix) {
      pipes = pipes.filter((pipe) => pipe.Name.startsWith(params.NamePrefix));
    }
    if (params.SourcePrefix) {
      pipes = pipes.filter((pipe) => pipe.Source.startsWith(params.SourcePrefix));
    }
    if (params.TargetPrefix) {
      pipes = pipes.filter((pipe) => pipe.Target.startsWith(params.TargetPrefix));
    }
    if (params.CurrentState) {
      pipes = pipes.filter((pipe) => pipe.CurrentState === params.CurrentState);
    }
    const list = pipes.map((pipe) => ({
      Name: pipe.Name,
      Arn: pipe.Arn,
      Source: pipe.Source,
      Target: pipe.Target,
      CurrentState: pipe.CurrentState,
      DesiredState: pipe.DesiredState,
      CreationTime: pipe.CreationTime,
      LastModifiedTime: pipe.LastModifiedTime,
    }));
    return paginate(list, params, 'Pipes');
  }

  _findPipe(nameOrArn) {
    if (!nameOrArn) return null;
    if (this.pipes.has(nameOrArn)) return this.pipes.get(nameOrArn);
    return Array.from(this.pipes.values()).find((pipe) => pipe.Arn === nameOrArn) || null;
  }

  _validateSource(source) {
    const valid = source.includes(':sqs:') || source.includes(':queue/')
      || source.startsWith('arn:aws:events:') || source.includes(':kinesis:')
      || source.includes(':dynamodb:');
    if (!valid) throw awsError('ValidationException', `Origem de pipe não suportada: ${source}`);
    if (source.includes(':kinesis:') || source.includes(':dynamodb:')) {
      this.logger.warn('EventBridge', 'Pipes com origem Kinesis/DynamoDB são somente metadados neste simulador');
    }
  }

  _validateTarget(target) {
    const valid = target.includes(':lambda:') || target.includes(':sqs:')
      || target.includes(':sns:') || target.includes(':api-destination/')
      || target.startsWith('arn:aws:events:') || target.includes(':stepfunctions:');
    if (!valid) throw awsError('ValidationException', `Destino de pipe não suportado: ${target}`);
  }

  /** Remove pipes que apontam para um barramento excluído. */
  async deleteForBus(busName) {
    const busArn = buildArn(this.simulator, 'events', `event-bus/${busName}`);
    let changed = false;
    for (const [name, pipe] of this.pipes.entries()) {
      if (pipe.Source === busArn) {
        this.pipes.delete(name);
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  getStats() {
    const running = Array.from(this.pipes.values()).filter((pipe) => pipe.CurrentState === 'RUNNING').length;
    return { pipes: this.pipes.size, runningPipes: running };
  }
}

module.exports = { PipeFeature, queueNameFromArn, busNameFromArn };
