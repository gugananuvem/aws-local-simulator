'use strict';

/**
 * @fileoverview CloudTrail Simulator
 *
 * Suporta:
 *  Trails:
 *   - CreateTrail / DeleteTrail / UpdateTrail
 *   - DescribeTrails / GetTrail / GetTrailStatus
 *   - StartLogging / StopLogging
 *
 *  Events:
 *   - LookupEvents (filtro por ResourceName, EventName, Username, etc.)
 *   - GetEventSelectors / PutEventSelectors
 *
 *  Integração:
 *   - Registro automático de API calls dos outros serviços
 *   - Entrega de logs para S3 (simulado)
 *   - Integração com CloudWatch Logs
 *
 *  Persistência via LocalStore
 */

const { randomUUID } = require('crypto');

// ─── Erros tipados ────────────────────────────────────────────────────────────

class CloudTrailError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const Errors = {
  TrailNotFound: (name) =>
    new CloudTrailError('TrailNotFoundException', `Unknown trail: ${name}`, 404),
  TrailAlreadyExists: (name) =>
    new CloudTrailError('TrailAlreadyExistsException', `Trail already exists: ${name}`, 400),
  InvalidTrailName: (name) =>
    new CloudTrailError('InvalidTrailNameException', `Invalid trail name: ${name}`, 400),
  InvalidParameter: (msg) =>
    new CloudTrailError('InvalidParameterCombinationException', msg, 400),
  MaximumNumberOfTrails: () =>
    new CloudTrailError('MaximumNumberOfTrailsExceededException', 'Maximum number of trails exceeded (max: 5)', 400),
  S3BucketNotFound: (bucket) =>
    new CloudTrailError('S3BucketDoesNotExistException', `S3 bucket does not exist: ${bucket}`, 400),
  InsuficientSnsTopicPolicy: () =>
    new CloudTrailError('InsuficientSnsTopicPolicyException', 'Insufficient SNS topic policy', 400),
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const REGION = 'us-east-1';
const ACCOUNT_ID = '000000000000';
const MAX_TRAILS = 5;
const MAX_RESULTS_DEFAULT = 50;
const MAX_RESULTS_MAX = 50;

// ─── Utilitários ──────────────────────────────────────────────────────────────

function trailArn(name) {
  return `arn:aws:cloudtrail:${REGION}:${ACCOUNT_ID}:trail/${name}`;
}

function validateTrailName(name) {
  if (!name || typeof name !== 'string') throw Errors.InvalidTrailName(name);
  if (name.length < 3 || name.length > 128) throw Errors.InvalidTrailName(name);
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw Errors.InvalidTrailName(name);
  return true;
}

function matchesFilter(event, filter) {
  if (!filter) return true;

  if (filter.AttributeKey && filter.AttributeValue) {
    const key = filter.AttributeKey;
    const value = filter.AttributeValue;

    switch (key) {
      case 'EventId':
        if (event.EventId !== value) return false;
        break;
      case 'EventName':
        if (event.EventName !== value) return false;
        break;
      case 'ReadOnly':
        if (String(event.ReadOnly) !== value) return false;
        break;
      case 'Username':
        if (event.Username !== value) return false;
        break;
      case 'ResourceType':
        if (!event.Resources || !event.Resources.some(r => r.ResourceType === value)) return false;
        break;
      case 'ResourceName':
        if (!event.Resources || !event.Resources.some(r => r.ResourceName === value)) return false;
        break;
      case 'EventSource':
        if (event.EventSource !== value) return false;
        break;
      case 'AccessKeyId':
        if (event.AccessKeyId !== value) return false;
        break;
      default:
        break;
    }
  }

  return true;
}

// ─── Simulador Principal ──────────────────────────────────────────────────────

class CloudTrailSimulator {
  /**
   * @param {Object} config - Global simulator config
   * @param {Object} store  - LocalStore instance
   * @param {Object} logger - Logger instance
   */
  constructor(config, store, logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;

    // Trails: Map<name, TrailConfig>
    this.trails = new Map();

    // Trail status: Map<name, { isLogging, latestDelivery, latestNotification }>
    this.trailStatus = new Map();

    // Event selectors: Map<name, EventSelector[]>
    this.eventSelectors = new Map();

    // Events log: Array de CloudTrail events
    this.events = [];

    // Injeções cross-service
    this.s3Simulator = null;
    this.cloudwatchSimulator = null;
  }

  // ─── Persistência ───────────────────────────────────────────────────────────

  async load() {
    try {
      const data = await this.store.load('cloudtrail');
      if (data) {
        if (data.trails) this.trails = new Map(Object.entries(data.trails));
        if (data.trailStatus) this.trailStatus = new Map(Object.entries(data.trailStatus));
        if (data.eventSelectors) this.eventSelectors = new Map(Object.entries(data.eventSelectors));
        if (data.events) this.events = data.events;
        this.logger.info(`[CloudTrail] Loaded ${this.trails.size} trails, ${this.events.length} events`);
      }
    } catch (err) {
      this.logger.warn('[CloudTrail] No persisted data found, starting fresh');
    }

    // Garante que existe um trail padrão com logging ativo
    if (this.trails.size === 0) {
      const defaultName = 'local-default-trail';
      this.trails.set(defaultName, { Name: defaultName, S3BucketName: null });
      this.trailStatus.set(defaultName, { isLogging: true });
      // Event selectors: captura management events + todos os data events
      this.eventSelectors.set(defaultName, [
        {
          ReadWriteType: 'All',
          IncludeManagementEvents: true,
          DataResources: [
            { Type: 'AWS::S3::Object',              Values: ['arn:aws:s3:::*'] },
            { Type: 'AWS::DynamoDB::Table',          Values: ['arn:aws:dynamodb:::*'] },
            { Type: 'AWS::Lambda::Function',         Values: ['arn:aws:lambda:::*'] },
            { Type: 'AWS::APIGateway::Stage',        Values: ['arn:aws:execute-api:::*'] },
            { Type: 'AWS::SecretsManager::Secret',   Values: ['arn:aws:secretsmanager:::*'] },
            { Type: 'AWS::SSM::Parameter',           Values: ['arn:aws:ssm:::*'] },
            { Type: 'AWS::Cognito::UserPool',        Values: ['arn:aws:cognito-idp:::*'] },
            { Type: 'AWS::KMS::Key',                 Values: ['arn:aws:kms:::*'] },
          ],
        },
      ]);
      this.logger.debug('[CloudTrail] Trail padrão criado com logging ativo');
    }
  }

  async save() {
    try {
      const data = {
        trails: Object.fromEntries(this.trails),
        trailStatus: Object.fromEntries(this.trailStatus),
        eventSelectors: Object.fromEntries(this.eventSelectors),
        events: this.events.slice(-10000), // mantém os últimos 10.000 eventos
      };
      await this.store.save('cloudtrail', data);
    } catch (err) {
      this.logger.error('[CloudTrail] Failed to save data:', err.message);
    }
  }

  reset() {
    this.trails.clear();
    this.trailStatus.clear();
    this.eventSelectors.clear();
    this.events = [];
  }

  // ─── Registro de Evento (uso interno / cross-service) ───────────────────────

  /**
   * Registra um API call como evento CloudTrail.
   * Chamado pelos outros serviços via injeção.
   *
   * @param {Object} params
   * @param {string} params.eventName   - Ex: "CreateBucket"
   * @param {string} params.eventSource - Ex: "s3.amazonaws.com"
   * @param {string} params.username    - Ex: "test-user"
   * @param {boolean} params.readOnly   - true se operação de leitura
   * @param {Array}  params.resources   - [{ ResourceType, ResourceName }]
   * @param {Object} params.requestParameters - Parâmetros da requisição
   * @param {Object} params.responseElements  - Resposta da operação
   * @param {string} params.sourceIPAddress   - IP da requisição
   * @param {string} params.userAgent         - User-Agent da requisição
   */
  recordEvent(params = {}) {
    const event = {
      EventId: randomUUID(),
      EventName: params.eventName || 'UnknownEvent',
      EventSource: params.eventSource || 'local.amazonaws.com',
      EventTime: new Date().toISOString(),
      Username: params.username || 'local-user',
      ReadOnly: params.readOnly !== undefined ? params.readOnly : false,
      AccessKeyId: params.accessKeyId || 'AKIAIOSFODNN7EXAMPLE',
      Resources: params.resources || [],
      RequestParameters: params.requestParameters || null,
      ResponseElements: params.responseElements || null,
      SourceIPAddress: params.sourceIPAddress || '127.0.0.1',
      UserAgent: params.userAgent || 'aws-local-simulator',
      CloudTrailEvent: JSON.stringify({
        eventVersion: '1.08',
        userIdentity: {
          type: 'IAMUser',
          principalId: 'AIDIOSFODNN7EXAMPLE',
          arn: `arn:aws:iam::${ACCOUNT_ID}:user/${params.username || 'local-user'}`,
          accountId: ACCOUNT_ID,
          accessKeyId: params.accessKeyId || 'AKIAIOSFODNN7EXAMPLE',
          userName: params.username || 'local-user',
        },
        eventTime: new Date().toISOString(),
        eventSource: params.eventSource || 'local.amazonaws.com',
        eventName: params.eventName || 'UnknownEvent',
        awsRegion: REGION,
        sourceIPAddress: params.sourceIPAddress || '127.0.0.1',
        userAgent: params.userAgent || 'aws-local-simulator',
        requestParameters: params.requestParameters || null,
        responseElements: params.responseElements || null,
        requestID: randomUUID(),
        eventID: randomUUID(),
        readOnly: params.readOnly !== undefined ? params.readOnly : false,
        resources: params.resources || [],
        eventType: 'AwsApiCall',
        managementEvent: true,
        recipientAccountId: ACCOUNT_ID,
      }),
    };

    this.events.push(event);

    // Persiste no disco
    this.save();

    // Entrega para S3 (simula escrita de log file)
    this._deliverToS3(event);

    // Entrega para CloudWatch Logs se configurado
    this._deliverToCloudWatch(event);

    return event;
  }

  async _deliverToS3(event) {
    // Verifica se há trails ativos com S3 configurado
    for (const [name, trail] of this.trails) {
      const status = this.trailStatus.get(name) || {};
      if (!status.isLogging) continue;
      if (!trail.S3BucketName) continue;

      if (this.s3Simulator) {
        try {
          const date = new Date(event.EventTime);
          const key = `${trail.S3KeyPrefix || 'AWSLogs/'}${ACCOUNT_ID}/CloudTrail/${REGION}/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${randomUUID()}.json`;

          await this.s3Simulator.putObject({
            Bucket: trail.S3BucketName,
            Key: key,
            Body: JSON.stringify({ Records: [JSON.parse(event.CloudTrailEvent)] }),
            ContentType: 'application/json',
          });

          // Atualiza status
          const s = this.trailStatus.get(name) || {};
          s.LatestDeliveryTime = new Date().toISOString();
          s.LatestDeliveryAttemptTime = new Date().toISOString();
          this.trailStatus.set(name, s);
        } catch (err) {
          this.logger.warn(`[CloudTrail] Failed to deliver to S3 for trail ${name}: ${err.message}`);
          const s = this.trailStatus.get(name) || {};
          s.LatestDeliveryError = err.message;
          s.LatestDeliveryAttemptTime = new Date().toISOString();
          this.trailStatus.set(name, s);
        }
      }
    }
  }

  _deliverToCloudWatch(event) {
    for (const [name, trail] of this.trails) {
      const status = this.trailStatus.get(name) || {};
      if (!status.isLogging) continue;
      if (!trail.CloudWatchLogsLogGroupArn) continue;

      if (this.cloudwatchSimulator) {
        try {
          // Extrai o log group name do ARN
          const match = trail.CloudWatchLogsLogGroupArn.match(/log-group:([^:]+)/);
          if (!match) continue;
          const logGroupName = match[1];

          this.cloudwatchSimulator.putLambdaLogs(logGroupName, 'cloudtrail', [
            { timestamp: Date.now(), message: event.CloudTrailEvent },
          ]);
        } catch (err) {
          this.logger.warn(`[CloudTrail] Failed to deliver to CloudWatch for trail ${name}: ${err.message}`);
        }
      }
    }
  }

  // ─── Trails ─────────────────────────────────────────────────────────────────

  createTrail(params = {}) {
    const name = params.Name;
    validateTrailName(name);

    if (this.trails.has(name)) throw Errors.TrailAlreadyExists(name);
    if (this.trails.size >= MAX_TRAILS) throw Errors.MaximumNumberOfTrails();

    const trail = {
      Name: name,
      S3BucketName: params.S3BucketName || null,
      S3KeyPrefix: params.S3KeyPrefix || null,
      SnsTopicName: params.SnsTopicName || null,
      SnsTopicARN: params.SnsTopicName
        ? `arn:aws:sns:${REGION}:${ACCOUNT_ID}:${params.SnsTopicName}`
        : null,
      IncludeGlobalServiceEvents: params.IncludeGlobalServiceEvents !== false,
      IsMultiRegionTrail: params.IsMultiRegionTrail === true,
      HomeRegion: REGION,
      TrailARN: trailArn(name),
      LogFileValidationEnabled: params.EnableLogFileValidation === true,
      CloudWatchLogsLogGroupArn: params.CloudWatchLogsLogGroupArn || null,
      CloudWatchLogsRoleArn: params.CloudWatchLogsRoleArn || null,
      HasCustomEventSelectors: false,
      HasInsightSelectors: false,
      IsOrganizationTrail: false,
      CreatedAt: new Date().toISOString(),
      Tags: params.TagsList || [],
    };

    this.trails.set(name, trail);
    this.trailStatus.set(name, {
      isLogging: false,
      LatestDeliveryTime: null,
      LatestDeliveryAttemptTime: null,
      LatestDeliveryError: null,
      LatestNotificationTime: null,
      LatestNotificationAttemptTime: null,
      LatestNotificationError: null,
      LatestCloudWatchLogsDeliveryTime: null,
      LatestCloudWatchLogsDeliveryError: null,
      StartLoggingTime: null,
      StopLoggingTime: null,
    });

    // Seletores padrão
    this.eventSelectors.set(name, [{
      ReadWriteType: 'All',
      IncludeManagementEvents: true,
      DataResources: [],
      ExcludeManagementEventSources: [],
    }]);

    this.logger.info(`[CloudTrail] Trail created: ${name}`);
    this.save();

    return {
      Name: trail.Name,
      S3BucketName: trail.S3BucketName,
      S3KeyPrefix: trail.S3KeyPrefix,
      SnsTopicName: trail.SnsTopicName,
      SnsTopicARN: trail.SnsTopicARN,
      IncludeGlobalServiceEvents: trail.IncludeGlobalServiceEvents,
      IsMultiRegionTrail: trail.IsMultiRegionTrail,
      TrailARN: trail.TrailARN,
      LogFileValidationEnabled: trail.LogFileValidationEnabled,
      CloudWatchLogsLogGroupArn: trail.CloudWatchLogsLogGroupArn,
      CloudWatchLogsRoleArn: trail.CloudWatchLogsRoleArn,
    };
  }

  updateTrail(params = {}) {
    const name = params.Name;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    const trail = this.trails.get(name);

    if (params.S3BucketName !== undefined) trail.S3BucketName = params.S3BucketName;
    if (params.S3KeyPrefix !== undefined) trail.S3KeyPrefix = params.S3KeyPrefix;
    if (params.SnsTopicName !== undefined) {
      trail.SnsTopicName = params.SnsTopicName;
      trail.SnsTopicARN = params.SnsTopicName
        ? `arn:aws:sns:${REGION}:${ACCOUNT_ID}:${params.SnsTopicName}`
        : null;
    }
    if (params.IncludeGlobalServiceEvents !== undefined) trail.IncludeGlobalServiceEvents = params.IncludeGlobalServiceEvents;
    if (params.IsMultiRegionTrail !== undefined) trail.IsMultiRegionTrail = params.IsMultiRegionTrail;
    if (params.EnableLogFileValidation !== undefined) trail.LogFileValidationEnabled = params.EnableLogFileValidation;
    if (params.CloudWatchLogsLogGroupArn !== undefined) trail.CloudWatchLogsLogGroupArn = params.CloudWatchLogsLogGroupArn;
    if (params.CloudWatchLogsRoleArn !== undefined) trail.CloudWatchLogsRoleArn = params.CloudWatchLogsRoleArn;

    this.trails.set(name, trail);
    this.logger.info(`[CloudTrail] Trail updated: ${name}`);
    this.save();

    return {
      Name: trail.Name,
      S3BucketName: trail.S3BucketName,
      S3KeyPrefix: trail.S3KeyPrefix,
      SnsTopicName: trail.SnsTopicName,
      SnsTopicARN: trail.SnsTopicARN,
      IncludeGlobalServiceEvents: trail.IncludeGlobalServiceEvents,
      IsMultiRegionTrail: trail.IsMultiRegionTrail,
      TrailARN: trail.TrailARN,
      LogFileValidationEnabled: trail.LogFileValidationEnabled,
      CloudWatchLogsLogGroupArn: trail.CloudWatchLogsLogGroupArn,
      CloudWatchLogsRoleArn: trail.CloudWatchLogsRoleArn,
    };
  }

  deleteTrail(params = {}) {
    const name = params.Name;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    this.trails.delete(name);
    this.trailStatus.delete(name);
    this.eventSelectors.delete(name);

    this.logger.info(`[CloudTrail] Trail deleted: ${name}`);
    this.save();

    return {};
  }

  describeTrails(params = {}) {
    const includeShadow = params.includeShadowTrails !== false;
    let trailList = [...this.trails.values()];

    if (params.trailNameList && params.trailNameList.length > 0) {
      trailList = trailList.filter(t =>
        params.trailNameList.includes(t.Name) || params.trailNameList.includes(t.TrailARN)
      );
    }

    return {
      trailList: trailList.map(t => ({
        Name: t.Name,
        S3BucketName: t.S3BucketName,
        S3KeyPrefix: t.S3KeyPrefix,
        SnsTopicName: t.SnsTopicName,
        SnsTopicARN: t.SnsTopicARN,
        IncludeGlobalServiceEvents: t.IncludeGlobalServiceEvents,
        IsMultiRegionTrail: t.IsMultiRegionTrail,
        HomeRegion: t.HomeRegion,
        TrailARN: t.TrailARN,
        LogFileValidationEnabled: t.LogFileValidationEnabled,
        CloudWatchLogsLogGroupArn: t.CloudWatchLogsLogGroupArn,
        CloudWatchLogsRoleArn: t.CloudWatchLogsRoleArn,
        HasCustomEventSelectors: t.HasCustomEventSelectors,
        HasInsightSelectors: t.HasInsightSelectors,
        IsOrganizationTrail: t.IsOrganizationTrail,
      })),
    };
  }

  getTrail(params = {}) {
    const name = params.Name;
    const trail = this.trails.get(name);
    if (!trail) throw Errors.TrailNotFound(name);

    return {
      Trail: {
        Name: trail.Name,
        S3BucketName: trail.S3BucketName,
        S3KeyPrefix: trail.S3KeyPrefix,
        SnsTopicName: trail.SnsTopicName,
        SnsTopicARN: trail.SnsTopicARN,
        IncludeGlobalServiceEvents: trail.IncludeGlobalServiceEvents,
        IsMultiRegionTrail: trail.IsMultiRegionTrail,
        HomeRegion: trail.HomeRegion,
        TrailARN: trail.TrailARN,
        LogFileValidationEnabled: trail.LogFileValidationEnabled,
        CloudWatchLogsLogGroupArn: trail.CloudWatchLogsLogGroupArn,
        CloudWatchLogsRoleArn: trail.CloudWatchLogsRoleArn,
        HasCustomEventSelectors: trail.HasCustomEventSelectors,
        HasInsightSelectors: trail.HasInsightSelectors,
        IsOrganizationTrail: trail.IsOrganizationTrail,
      },
    };
  }

  getTrailStatus(params = {}) {
    const name = params.Name;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    const status = this.trailStatus.get(name) || {};

    return {
      IsLogging: status.isLogging === true,
      LatestDeliveryError: status.LatestDeliveryError || null,
      LatestNotificationError: status.LatestNotificationError || null,
      LatestDeliveryTime: status.LatestDeliveryTime || null,
      LatestNotificationTime: status.LatestNotificationTime || null,
      StartLoggingTime: status.StartLoggingTime || null,
      StopLoggingTime: status.StopLoggingTime || null,
      LatestCloudWatchLogsDeliveryError: status.LatestCloudWatchLogsDeliveryError || null,
      LatestCloudWatchLogsDeliveryTime: status.LatestCloudWatchLogsDeliveryTime || null,
      LatestDeliveryAttemptTime: status.LatestDeliveryAttemptTime || '',
      LatestNotificationAttemptTime: status.LatestNotificationAttemptTime || '',
      LatestNotificationAttemptSucceeded: status.LatestNotificationAttemptSucceeded || '',
      LatestDeliveryAttemptSucceeded: status.LatestDeliveryAttemptSucceeded || '',
      TimeLoggingStarted: status.StartLoggingTime || '',
      TimeLoggingStopped: status.StopLoggingTime || '',
    };
  }

  startLogging(params = {}) {
    const name = params.Name;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    const status = this.trailStatus.get(name) || {};
    status.isLogging = true;
    status.StartLoggingTime = new Date().toISOString();
    this.trailStatus.set(name, status);

    this.logger.info(`[CloudTrail] Started logging for trail: ${name}`);
    this.save();

    return {};
  }

  stopLogging(params = {}) {
    const name = params.Name;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    const status = this.trailStatus.get(name) || {};
    status.isLogging = false;
    status.StopLoggingTime = new Date().toISOString();
    this.trailStatus.set(name, status);

    this.logger.info(`[CloudTrail] Stopped logging for trail: ${name}`);
    this.save();

    return {};
  }

  // ─── Event Selectors ────────────────────────────────────────────────────────

  getEventSelectors(params = {}) {
    const name = params.TrailName;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    const trail = this.trails.get(name);
    const selectors = this.eventSelectors.get(name) || [];

    return {
      TrailARN: trail.TrailARN,
      EventSelectors: selectors,
    };
  }

  putEventSelectors(params = {}) {
    const name = params.TrailName;
    if (!this.trails.has(name)) throw Errors.TrailNotFound(name);

    const selectors = params.EventSelectors || [];
    this.eventSelectors.set(name, selectors);

    const trail = this.trails.get(name);
    trail.HasCustomEventSelectors = selectors.length > 0;
    this.trails.set(name, trail);

    this.logger.info(`[CloudTrail] Event selectors updated for trail: ${name}`);
    this.save();

    return {
      TrailARN: trail.TrailARN,
      EventSelectors: selectors,
    };
  }

  // ─── LookupEvents ───────────────────────────────────────────────────────────

  lookupEvents(params = {}) {
    let events = [...this.events];

    // Filtro por tempo
    if (params.StartTime) {
      const startTime = new Date(params.StartTime).getTime();
      events = events.filter(e => new Date(e.EventTime).getTime() >= startTime);
    }
    if (params.EndTime) {
      const endTime = new Date(params.EndTime).getTime();
      events = events.filter(e => new Date(e.EventTime).getTime() <= endTime);
    }

    // Filtro por atributo
    if (params.LookupAttributes && params.LookupAttributes.length > 0) {
      for (const attr of params.LookupAttributes) {
        events = events.filter(e => matchesFilter(e, attr));
      }
    }

    // Ordem: mais recente primeiro
    events = events.sort((a, b) => new Date(b.EventTime) - new Date(a.EventTime));

    // Paginação
    const maxResults = Math.min(params.MaxResults || MAX_RESULTS_DEFAULT, MAX_RESULTS_MAX);
    let startIdx = 0;

    if (params.NextToken) {
      try {
        startIdx = parseInt(Buffer.from(params.NextToken, 'base64').toString(), 10);
      } catch {
        startIdx = 0;
      }
    }

    const page = events.slice(startIdx, startIdx + maxResults);
    const nextIdx = startIdx + maxResults;
    const nextToken = nextIdx < events.length
      ? Buffer.from(String(nextIdx)).toString('base64')
      : null;

    return {
      Events: page,
      NextToken: nextToken,
    };
  }

  // ─── Tags ───────────────────────────────────────────────────────────────────

  addTags(params = {}) {
    const arn = params.ResourceId;
    // Encontra trail pelo ARN ou nome
    for (const [name, trail] of this.trails) {
      if (trail.TrailARN === arn || trail.Name === arn) {
        trail.Tags = trail.Tags || [];
        for (const tag of (params.TagsList || [])) {
          const existing = trail.Tags.findIndex(t => t.Key === tag.Key);
          if (existing >= 0) trail.Tags[existing] = tag;
          else trail.Tags.push(tag);
        }
        this.trails.set(name, trail);
        this.save();
        return {};
      }
    }
    throw Errors.TrailNotFound(arn);
  }

  removeTags(params = {}) {
    const arn = params.ResourceId;
    for (const [name, trail] of this.trails) {
      if (trail.TrailARN === arn || trail.Name === arn) {
        const keysToRemove = (params.TagsList || []).map(t => t.Key);
        trail.Tags = (trail.Tags || []).filter(t => !keysToRemove.includes(t.Key));
        this.trails.set(name, trail);
        this.save();
        return {};
      }
    }
    throw Errors.TrailNotFound(arn);
  }

  listTags(params = {}) {
    const result = [];
    for (const arn of (params.ResourceIdList || [])) {
      for (const [, trail] of this.trails) {
        if (trail.TrailARN === arn || trail.Name === arn) {
          result.push({ ResourceId: trail.TrailARN, TagsList: trail.Tags || [] });
          break;
        }
      }
    }
    return { ResourceTagList: result };
  }

  // ─── Admin ──────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      service: 'cloudtrail',
      trails: this.trails.size,
      events: this.events.length,
      activeTrails: [...this.trailStatus.values()].filter(s => s.isLogging).length,
    };
  }
}

module.exports = { CloudTrailSimulator };
