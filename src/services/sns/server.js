/**
 * @fileoverview SNS HTTP Server — Query Protocol completo
 * Compatível com AWS SDK v3 SNS Client
 *
 * Wire Protocol: Query (application/x-www-form-urlencoded) + respostas XML
 * Endpoint principal: POST /
 * Ações suportadas: CreateTopic, DeleteTopic, ListTopics, GetTopicAttributes,
 *   SetTopicAttributes, Subscribe, Unsubscribe, ConfirmSubscription,
 *   ListSubscriptions, ListSubscriptionsByTopic, GetSubscriptionAttributes,
 *   SetSubscriptionAttributes, Publish, PublishBatch,
 *   TagResource, UntagResource, ListTagsForResource,
 *   CreatePlatformApplication, DeletePlatformApplication, ListPlatformApplications,
 *   CreatePlatformEndpoint, DeleteEndpoint, GetEndpointAttributes,
 *   SetEndpointAttributes, ListEndpointsByPlatformApplication,
 *   CheckIfPhoneNumberIsOptedOut, ListPhoneNumbersOptedOut, OptInPhoneNumber,
 *   SetSMSAttributes, GetSMSAttributes
 */

'use strict';

const express = require('express');
const cors    = require('cors');

/**
 * Cria Express application do SNS
 * @param {Object} simulator - SNSSimulator instance
 * @param {Object} config    - Service configuration
 * @param {Object} logger    - Logger instance
 * @returns {import('express').Application}
 */
function createSNSServer(simulator, config, logger) {
  const app = express();

  // ── Middlewares globais ──────────────────────────────────────
  if (config.cors?.enabled !== false) {
    app.use(cors({ origin: config.cors?.origin || '*' }));
  }

  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.json({ limit: '10mb' }));

  app.use((req, _res, next) => {
    const action = req.body?.Action || req.query?.Action;
    if (action) logger.debug('SNS', `${req.method} ${req.path} Action=${action}`);
    next();
  });

  // ── Endpoint principal (Query Protocol) ─────────────────────
  app.post('/', async (req, res) => {
    const body   = req.body || {};
    const action = body.Action || req.query.Action;

    if (!action) {
      return res.status(400).set('Content-Type', 'text/xml').send(
        xmlError('MissingAction', 'Action is required')
      );
    }

    try {
      return await handleAction(action, body, simulator, res, logger);
    } catch (err) {
      logger.error('SNS', `[${action}] ${err.message}`);
      const status = err.statusCode || 400;
      return res.status(status).set('Content-Type', 'text/xml').send(
        xmlError(err.code || 'InternalFailure', err.message)
      );
    }
  });

  // ── Admin routes ─────────────────────────────────────────────
  app.get('/__admin/health', (_req, res) => {
    res.json({
      status:        'healthy',
      service:       'sns',
      topics:        simulator.topics.size,
      subscriptions: simulator.subscriptions.size,
      platformApps:  simulator.platformApps.size,
      endpoints:     simulator.platformEndpoints.size,
      timestamp:     new Date().toISOString()
    });
  });

  app.get('/__admin/topics', (_req, res) => {
    res.json({ topics: Array.from(simulator.topics.values()) });
  });

  app.get('/__admin/subscriptions', (_req, res) => {
    res.json({ subscriptions: Array.from(simulator.subscriptions.values()) });
  });

  app.get('/__admin/subscriptions/:topicName', (req, res) => {
    const arn  = `arn:aws:sns:us-east-1:123456789012:${req.params.topicName}`;
    const subs = Array.from(simulator.subscriptions.values()).filter(s => s.TopicArn === arn);
    res.json({ subscriptions: subs });
  });

  app.get('/__admin/publish-log', (_req, res) => {
    res.json({ messages: simulator.publishLog });
  });

  app.get('/__admin/platform-apps', (_req, res) => {
    res.json({ platformApplications: Array.from(simulator.platformApps.values()) });
  });

  app.delete('/__admin/topics/:topicName', async (req, res) => {
    try {
      const arn = `arn:aws:sns:us-east-1:123456789012:${req.params.topicName}`;
      await simulator.deleteTopic({ TopicArn: arn });
      res.json({ message: `Topic ${req.params.topicName} deleted` });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post('/__admin/reset', async (_req, res) => {
    await simulator.reset();
    res.json({ message: 'SNS data reset complete' });
  });

  // ── Catch-all ───────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  return app;
}

// ─────────────────────────────────────────────────────────────
//  Action dispatcher
// ─────────────────────────────────────────────────────────────

/**
 * Despacha a ação SNS para o método correto do simulador
 * @param {string} action
 * @param {Object} body      - request body (urlencoded)
 * @param {Object} simulator - SNSSimulator
 * @param {Object} res       - Express response
 * @param {Object} logger
 * @returns {Promise<void>}
 */
async function handleAction(action, body, simulator, res, logger) {
  const xml = (tag, content) => wrapResponse(action, tag, content, res);

  switch (action) {

    // ── Topics ────────────────────────────────────────────────
    case 'CreateTopic': {
      const attrs = parseNumberedParams(body, 'Attributes.entry');
      const tags  = parseTagList(body, 'Tags.member');
      const r     = await simulator.createTopic({ ...parseParams(body), Attributes: attrs, Tags: tags });
      return xml('CreateTopicResult', `<TopicArn>${r.TopicArn}</TopicArn>`);
    }

    case 'DeleteTopic':
      await simulator.deleteTopic(parseParams(body));
      return xml('DeleteTopicResult', '');

    case 'ListTopics': {
      const r       = simulator.listTopics(parseParams(body));
      const topicXml = (r.Topics || []).map(t => `<member><TopicArn>${t.TopicArn}</TopicArn></member>`).join('');
      const nt       = r.NextToken ? `<NextToken>${r.NextToken}</NextToken>` : '';
      return xml('ListTopicsResult', `<Topics>${topicXml}</Topics>${nt}`);
    }

    case 'GetTopicAttributes': {
      const r       = simulator.getTopicAttributes(parseParams(body));
      const attrsXml = buildAttributesXml(r.Attributes);
      return xml('GetTopicAttributesResult', `<Attributes>${attrsXml}</Attributes>`);
    }

    case 'SetTopicAttributes':
      await simulator.setTopicAttributes(parseParams(body));
      return xml('SetTopicAttributesResult', '');

    // ── Subscriptions ──────────────────────────────────────────
    case 'Subscribe': {
      const attrs = parseNumberedParams(body, 'Attributes.entry');
      const r     = await simulator.subscribe({ ...parseParams(body), Attributes: attrs });
      return xml('SubscribeResult', `<SubscriptionArn>${r.SubscriptionArn}</SubscriptionArn>`);
    }

    case 'ConfirmSubscription': {
      const r = await simulator.confirmSubscription(parseParams(body));
      return xml('ConfirmSubscriptionResult', `<SubscriptionArn>${r.SubscriptionArn}</SubscriptionArn>`);
    }

    case 'Unsubscribe':
      await simulator.unsubscribe(parseParams(body));
      return xml('UnsubscribeResult', '');

    case 'ListSubscriptions': {
      const r      = simulator.listSubscriptions(parseParams(body));
      const subsXml = formatSubscriptionsXml(r.Subscriptions || []);
      const nt      = r.NextToken ? `<NextToken>${r.NextToken}</NextToken>` : '';
      return xml('ListSubscriptionsResult', `<Subscriptions>${subsXml}</Subscriptions>${nt}`);
    }

    case 'ListSubscriptionsByTopic': {
      const r      = simulator.listSubscriptionsByTopic(parseParams(body));
      const subsXml = formatSubscriptionsXml(r.Subscriptions || []);
      const nt      = r.NextToken ? `<NextToken>${r.NextToken}</NextToken>` : '';
      return xml('ListSubscriptionsByTopicResult', `<Subscriptions>${subsXml}</Subscriptions>${nt}`);
    }

    case 'GetSubscriptionAttributes': {
      const r       = simulator.getSubscriptionAttributes(parseParams(body));
      const attrsXml = buildAttributesXml(r.Attributes);
      return xml('GetSubscriptionAttributesResult', `<Attributes>${attrsXml}</Attributes>`);
    }

    case 'SetSubscriptionAttributes':
      await simulator.setSubscriptionAttributes(parseParams(body));
      return xml('SetSubscriptionAttributesResult', '');

    // ── Publish ────────────────────────────────────────────────
    case 'Publish': {
      const msgAttrs = parseMessageAttributes(body);
      const r        = await simulator.publish({ ...parseParams(body), MessageAttributes: msgAttrs });
      const seqXml   = r.SequenceNumber ? `<SequenceNumber>${r.SequenceNumber}</SequenceNumber>` : '';
      return xml('PublishResult', `<MessageId>${r.MessageId}</MessageId>${seqXml}`);
    }

    case 'PublishBatch': {
      const entries = parsePublishBatchEntries(body);
      const r       = await simulator.publishBatch({ TopicArn: body.TopicArn, PublishBatchRequestEntries: entries });
      const succXml = (r.Successful || []).map(s =>
        `<member><Id>${s.Id}</Id><MessageId>${s.MessageId}</MessageId>${s.SequenceNumber ? `<SequenceNumber>${s.SequenceNumber}</SequenceNumber>` : ''}</member>`
      ).join('');
      const failXml = (r.Failed || []).map(f =>
        `<member><Id>${f.Id}</Id><Code>${f.Code}</Code><Message>${escapeXml(f.Message)}</Message><SenderFault>${f.SenderFault}</SenderFault></member>`
      ).join('');
      return xml('PublishBatchResult',
        `<Successful>${succXml}</Successful><Failed>${failXml}</Failed>`
      );
    }

    // ── Tags ───────────────────────────────────────────────────
    case 'TagResource': {
      const tags = parseTagList(body, 'Tags.member');
      await simulator.tagResource({ ResourceArn: body.ResourceArn, Tags: tags });
      return xml('TagResourceResult', '');
    }

    case 'UntagResource': {
      const tagKeys = parseTagKeys(body);
      await simulator.untagResource({ ResourceArn: body.ResourceArn, TagKeys: tagKeys });
      return xml('UntagResourceResult', '');
    }

    case 'ListTagsForResource': {
      const r      = simulator.listTagsForResource(parseParams(body));
      const tagXml = (r.Tags || []).map(t =>
        `<member><Key>${escapeXml(t.Key)}</Key><Value>${escapeXml(t.Value)}</Value></member>`
      ).join('');
      return xml('ListTagsForResourceResult', `<Tags>${tagXml}</Tags>`);
    }

    // ── Platform Applications ──────────────────────────────────
    case 'CreatePlatformApplication': {
      const attrs = parseNumberedParams(body, 'Attributes.entry');
      const r     = await simulator.createPlatformApplication({ ...parseParams(body), Attributes: attrs });
      return xml('CreatePlatformApplicationResult', `<PlatformApplicationArn>${r.PlatformApplicationArn}</PlatformApplicationArn>`);
    }

    case 'DeletePlatformApplication':
      await simulator.deletePlatformApplication(parseParams(body));
      return xml('DeletePlatformApplicationResult', '');

    case 'ListPlatformApplications': {
      const r     = simulator.listPlatformApplications(parseParams(body));
      const apXml = (r.PlatformApplications || []).map(a =>
        `<member><PlatformApplicationArn>${a.PlatformApplicationArn}</PlatformApplicationArn>${buildAttributesXml(a.Attributes)}</member>`
      ).join('');
      const nt    = r.NextToken ? `<NextToken>${r.NextToken}</NextToken>` : '';
      return xml('ListPlatformApplicationsResult', `<PlatformApplications>${apXml}</PlatformApplications>${nt}`);
    }

    case 'CreatePlatformEndpoint': {
      const r = await simulator.createPlatformEndpoint(parseParams(body));
      return xml('CreatePlatformEndpointResult', `<EndpointArn>${r.EndpointArn}</EndpointArn>`);
    }

    case 'DeleteEndpoint':
      await simulator.deleteEndpoint(parseParams(body));
      return xml('DeleteEndpointResult', '');

    case 'GetEndpointAttributes': {
      const r       = simulator.getEndpointAttributes(parseParams(body));
      const attrsXml = buildAttributesXml(r.Attributes);
      return xml('GetEndpointAttributesResult', `<Attributes>${attrsXml}</Attributes>`);
    }

    case 'SetEndpointAttributes': {
      const attrs = parseNumberedParams(body, 'Attributes.entry');
      await simulator.setEndpointAttributes({ EndpointArn: body.EndpointArn, Attributes: attrs });
      return xml('SetEndpointAttributesResult', '');
    }

    case 'ListEndpointsByPlatformApplication': {
      const r      = simulator.listEndpointsByPlatformApplication(parseParams(body));
      const epXml  = (r.Endpoints || []).map(e =>
        `<member><EndpointArn>${e.EndpointArn}</EndpointArn>${buildAttributesXml(e.Attributes)}</member>`
      ).join('');
      const nt     = r.NextToken ? `<NextToken>${r.NextToken}</NextToken>` : '';
      return xml('ListEndpointsByPlatformApplicationResult', `<Endpoints>${epXml}</Endpoints>${nt}`);
    }

    // ── SMS Opt-out ────────────────────────────────────────────
    case 'CheckIfPhoneNumberIsOptedOut': {
      const r = simulator.checkIfPhoneNumberIsOptedOut(parseParams(body));
      return xml('CheckIfPhoneNumberIsOptedOutResult', `<isOptedOut>${r.isOptedOut}</isOptedOut>`);
    }

    case 'ListPhoneNumbersOptedOut': {
      const r        = simulator.listPhoneNumbersOptedOut();
      const phonesXml = (r.phoneNumbers || []).map(p => `<member>${escapeXml(p)}</member>`).join('');
      return xml('ListPhoneNumbersOptedOutResult', `<phoneNumbers>${phonesXml}</phoneNumbers>`);
    }

    case 'OptInPhoneNumber':
      await simulator.optInPhoneNumber(parseParams(body));
      return xml('OptInPhoneNumberResult', '');

    // ── SMS Attributes ─────────────────────────────────────────
    case 'SetSMSAttributes': {
      const attrs = parseNumberedParams(body, 'attributes.entry');
      await simulator.setSmsAttributes({ attributes: attrs });
      return xml('SetSMSAttributesResult', '');
    }

    case 'GetSMSAttributes': {
      const attrKeys = Object.entries(body)
        .filter(([k]) => k.startsWith('attributes.member.'))
        .map(([, v]) => v);
      const r        = simulator.getSmsAttributes({ attributes: attrKeys });
      const attrsXml = buildAttributesXml(r.attributes);
      return xml('GetSMSAttributesResult', `<attributes>${attrsXml}</attributes>`);
    }

    default:
      logger.warn('SNS', `Unknown action: ${action}`);
      return res.status(400).set('Content-Type', 'text/xml').send(
        xmlError('InvalidAction', `Action not supported: ${action}`)
      );
  }
}

// ─────────────────────────────────────────────────────────────
//  XML Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Envolve resultado em envelope XML SNS e envia resposta
 * @param {string} action
 * @param {string} resultTag
 * @param {string} content
 * @param {Object} res - Express response
 */
function wrapResponse(action, resultTag, content, res) {
  const requestId = require('crypto').randomUUID();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<${action}Response xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
  <${resultTag}>
    ${content}
  </${resultTag}>
  <ResponseMetadata>
    <RequestId>${requestId}</RequestId>
  </ResponseMetadata>
</${action}Response>`;

  return res.set('Content-Type', 'text/xml').send(xml);
}

/**
 * Cria resposta de erro XML
 * @param {string} code
 * @param {string} message
 * @returns {string}
 */
function xmlError(code, message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
  <Error>
    <Type>Sender</Type>
    <Code>${escapeXml(code)}</Code>
    <Message>${escapeXml(message)}</Message>
  </Error>
  <RequestId>${require('crypto').randomUUID()}</RequestId>
</ErrorResponse>`;
}

/**
 * Formata lista de subscriptions como XML
 * @param {Array} subs
 * @returns {string}
 */
function formatSubscriptionsXml(subs) {
  return subs.map(s => `
    <member>
      <TopicArn>${escapeXml(s.TopicArn)}</TopicArn>
      <Protocol>${escapeXml(s.Protocol)}</Protocol>
      <SubscriptionArn>${escapeXml(s.SubscriptionArn)}</SubscriptionArn>
      <Owner>${escapeXml(s.Owner)}</Owner>
      <Endpoint>${escapeXml(s.Endpoint)}</Endpoint>
    </member>`).join('');
}

/**
 * Constrói XML de atributos (entry key/value)
 * @param {Object} attrs
 * @returns {string}
 */
function buildAttributesXml(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<entry><key>${escapeXml(k)}</key><value>${escapeXml(String(v))}</value></entry>`)
    .join('');
}

/**
 * Escapa caracteres especiais XML
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

// ─────────────────────────────────────────────────────────────
//  Parameter Parsers
// ─────────────────────────────────────────────────────────────

/**
 * Extrai parâmetros simples do body (exclui Action/Version)
 * @param {Object} body
 * @returns {Object}
 */
function parseParams(body) {
  const skip   = new Set(['Action', 'Version', 'AWSAccessKeyId', 'Signature', 'SignatureMethod', 'SignatureVersion', 'Timestamp']);
  const result = {};

  for (const [key, value] of Object.entries(body)) {
    if (skip.has(key) || key.includes('.')) continue;
    result[key] = value;
  }

  return result;
}

/**
 * Parseia entradas numeradas tipo "Attributes.entry.N.key / .value"
 * @param {Object} body
 * @param {string} prefix - ex: 'Attributes.entry'
 * @returns {Object}
 */
function parseNumberedParams(body, prefix) {
  const result  = {};
  const entries = {};

  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith(prefix + '.')) continue;

    const rest  = key.slice(prefix.length + 1); // '1.key' ou '1.value'
    const parts = rest.split('.');
    const idx   = parts[0];
    const field = parts.slice(1).join('.');

    if (!entries[idx]) entries[idx] = {};
    entries[idx][field] = value;
  }

  for (const entry of Object.values(entries)) {
    if (entry.key && entry.value !== undefined) {
      result[entry.key] = entry.value;
    }
  }

  return result;
}

/**
 * Parseia lista de tags no formato "Tags.member.N.Key / .Value"
 * @param {Object} body
 * @param {string} prefix - ex: 'Tags.member'
 * @returns {Array<{Key:string, Value:string}>}
 */
function parseTagList(body, prefix) {
  const entries = {};

  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith(prefix + '.')) continue;

    const rest  = key.slice(prefix.length + 1);
    const parts = rest.split('.');
    const idx   = parts[0];
    const field = parts[1]; // 'Key' ou 'Value'

    if (!entries[idx]) entries[idx] = {};
    entries[idx][field] = value;
  }

  return Object.values(entries).filter(e => e.Key).map(e => ({ Key: e.Key, Value: e.Value || '' }));
}

/**
 * Parseia lista de chaves de tag no formato "TagKeys.member.N"
 * @param {Object} body
 * @returns {string[]}
 */
function parseTagKeys(body) {
  const keys = [];

  for (const [key, value] of Object.entries(body)) {
    if (/^TagKeys\.member\.\d+$/.test(key)) keys.push(value);
  }

  return keys;
}

/**
 * Parseia MessageAttributes do body SNS
 * Formato: MessageAttributes.entry.N.Name / .Value.DataType / .Value.StringValue
 * @param {Object} body
 * @returns {Object}
 */
function parseMessageAttributes(body) {
  const entries = {};

  for (const [key, value] of Object.entries(body)) {
    const m = key.match(/^MessageAttributes\.entry\.(\d+)\.(Name|Value\.(DataType|StringValue|BinaryValue))$/);
    if (!m) continue;

    const idx   = m[1];
    const field = m[2];

    if (!entries[idx]) entries[idx] = { Value: {} };

    if (field === 'Name')                 entries[idx].Name                 = value;
    else if (field === 'Value.DataType')  entries[idx].Value.DataType        = value;
    else if (field === 'Value.StringValue') entries[idx].Value.StringValue   = value;
    else if (field === 'Value.BinaryValue') entries[idx].Value.BinaryValue   = value;
  }

  const result = {};
  for (const entry of Object.values(entries)) {
    if (entry.Name) result[entry.Name] = entry.Value;
  }

  return result;
}

/**
 * Parseia entradas de PublishBatch
 * Formato: PublishBatchRequestEntries.member.N.Id / .Message / etc.
 * @param {Object} body
 * @returns {Array}
 */
function parsePublishBatchEntries(body) {
  const entries = {};

  for (const [key, value] of Object.entries(body)) {
    const m = key.match(/^PublishBatchRequestEntries\.member\.(\d+)\.(.+)$/);
    if (!m) continue;

    const idx   = m[1];
    const field = m[2];

    if (!entries[idx]) entries[idx] = {};
    entries[idx][field] = value;
  }

  return Object.values(entries);
}

module.exports = { createSNSServer };
