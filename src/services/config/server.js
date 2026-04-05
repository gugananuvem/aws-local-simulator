'use strict';

/**
 * @fileoverview AWS Config HTTP Server
 *
 * Protocolo: JSON com header X-Amz-Target
 * Compatível com @aws-sdk/client-config-service (ConfigServiceClient)
 *
 * Target prefix: com.amazonaws.config.v20141112.
 *
 * Rotas admin:
 *  GET  /__admin/rules            → lista config rules
 *  GET  /__admin/recorders        → lista recorders
 *  GET  /__admin/resources        → lista recursos descobertos
 *  GET  /__admin/health           → health check
 *  POST /__admin/reset            → reset state
 *  POST /__internal/record-resource → registra recurso (cross-service)
 */

function createConfigServer(simulator, logger) {
  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
      'Content-Type': 'application/x-amz-json-1.1',
      'Content-Length': Buffer.byteLength(payload),
      'x-amzn-RequestId': require('crypto').randomUUID(),
    });
    res.end(payload);
  }

  function sendError(res, err) {
    const statusCode = err.statusCode || 400;
    const code = err.code || 'InternalError';
    logger.error(`[Config] Error: ${code} — ${err.message}`);
    sendJson(res, statusCode, {
      __type: code,
      message: err.message,
    });
  }

  // Mapeamento target → método do simulador
  const TARGET_MAP = {
    // Configuration Recorders
    'PutConfigurationRecorder': (body) => simulator.putConfigurationRecorder(body),
    'DeleteConfigurationRecorder': (body) => simulator.deleteConfigurationRecorder(body),
    'DescribeConfigurationRecorders': (body) => simulator.describeConfigurationRecorders(body),
    'DescribeConfigurationRecorderStatus': (body) => simulator.describeConfigurationRecorderStatus(body),
    'StartConfigurationRecorder': (body) => simulator.startConfigurationRecorder(body),
    'StopConfigurationRecorder': (body) => simulator.stopConfigurationRecorder(body),

    // Delivery Channels
    'PutDeliveryChannel': (body) => simulator.putDeliveryChannel(body),
    'DeleteDeliveryChannel': (body) => simulator.deleteDeliveryChannel(body),
    'DescribeDeliveryChannels': (body) => simulator.describeDeliveryChannels(body),
    'DescribeDeliveryChannelStatus': (body) => simulator.describeDeliveryChannelStatus(body),
    'DeliverConfigSnapshot': (body) => simulator.deliverConfigSnapshot(body),

    // Config Rules
    'PutConfigRule': (body) => simulator.putConfigRule(body),
    'DeleteConfigRule': (body) => simulator.deleteConfigRule(body),
    'DescribeConfigRules': (body) => simulator.describeConfigRules(body),
    'DescribeConfigRuleEvaluationStatus': (body) => simulator.describeConfigRuleEvaluationStatus(body),
    'StartConfigRulesEvaluation': (body) => simulator.startConfigRulesEvaluation(body),
    'GetComplianceDetailsByConfigRule': (body) => simulator.getComplianceDetailsByConfigRule(body),
    'GetComplianceDetailsByResource': (body) => simulator.getComplianceDetailsByResource(body),
    'GetComplianceSummaryByConfigRule': (body) => simulator.getComplianceSummaryByConfigRule(body),
    'GetComplianceSummaryByResourceType': (body) => simulator.getComplianceSummaryByResourceType(body),

    // Resource Configuration
    'GetResourceConfigHistory': (body) => simulator.getResourceConfigHistory(body),
    'ListDiscoveredResources': (body) => simulator.listDiscoveredResources(body),
    'GetDiscoveredResourceCounts': (body) => simulator.getDiscoveredResourceCounts(body),
    'BatchGetResourceConfig': (body) => simulator.batchGetResourceConfig(body),

    // Conformance Packs
    'PutConformancePack': (body) => simulator.putConformancePack(body),
    'DeleteConformancePack': (body) => simulator.deleteConformancePack(body),
    'DescribeConformancePacks': (body) => simulator.describeConformancePacks(body),
    'DescribeConformancePackStatus': (body) => simulator.describeConformancePackStatus(body),
    'GetConformancePackComplianceSummary': (body) => simulator.getConformancePackComplianceSummary(body),

    // Aggregators
    'PutConfigurationAggregator': (body) => simulator.putConfigurationAggregator(body),
    'DeleteConfigurationAggregator': (body) => simulator.deleteConfigurationAggregator(body),
    'DescribeConfigurationAggregators': (body) => simulator.describeConfigurationAggregators(body),

    // Remediation
    'PutRemediationConfigurations': (body) => simulator.putRemediationConfigurations(body),
    'DeleteRemediationConfigurations': (body) => simulator.deleteRemediationConfigurations(body),
    'DescribeRemediationConfigurations': (body) => simulator.describeRemediationConfigurations(body),
    'StartRemediationExecution': (body) => simulator.startRemediationExecution(body),

    // Tags
    'TagResource': (body) => simulator.tagResource(body),
    'UntagResource': (body) => simulator.untagResource(body),
    'ListTagsForResource': (body) => simulator.listTagsForResource(body),
  };

  async function handler(req, res) {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // ── Rota interna cross-service ────────────────────────────────────────────
    if (url === '/__internal/record-resource' && method === 'POST') {
      try {
        const body = await parseBody(req);
        simulator.recordResource(body.resourceType, body.resourceId, body.configuration);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendError(res, err);
      }
    }

    // ── Rotas admin ───────────────────────────────────────────────────────────
    if (url.startsWith('/__admin')) {
      try {
        if (url === '/__admin/health' && method === 'GET') {
          return sendJson(res, 200, { status: 'ok', service: 'config', ...simulator.getStatus() });
        }

        if (url === '/__admin/rules' && method === 'GET') {
          return sendJson(res, 200, {
            rules: Array.from(simulator.configRules.values()),
            total: simulator.configRules.size,
          });
        }

        if (url === '/__admin/recorders' && method === 'GET') {
          return sendJson(res, 200, {
            recorders: Array.from(simulator.recorders.values()),
            status: Array.from(simulator.recorderStatus.values()),
          });
        }

        if (url === '/__admin/resources' && method === 'GET') {
          return sendJson(res, 200, {
            resources: Array.from(simulator.discoveredResources.values()),
            total: simulator.discoveredResources.size,
          });
        }

        if (url === '/__admin/conformance-packs' && method === 'GET') {
          return sendJson(res, 200, {
            packs: Array.from(simulator.conformancePacks.values()),
            total: simulator.conformancePacks.size,
          });
        }

        if (url === '/__admin/aggregators' && method === 'GET') {
          return sendJson(res, 200, {
            aggregators: Array.from(simulator.aggregators.values()),
            total: simulator.aggregators.size,
          });
        }

        if (url === '/__admin/reset' && method === 'POST') {
          simulator.reset();
          return sendJson(res, 200, { ok: true, message: 'Config state reset' });
        }

        return sendJson(res, 404, { __type: 'ResourceNotFoundException', message: `Admin route not found: ${url}` });
      } catch (err) {
        return sendError(res, err);
      }
    }

    // ── Rota principal AWS Config API ─────────────────────────────────────────
    if (method === 'POST' && (url === '/' || url === '')) {
      const rawTarget = req.headers['x-amz-target'] || '';
      // Remove prefixo: "com.amazonaws.config.v20141112.ConfigService."
      const action = rawTarget.split('.').pop();

      if (!action || !TARGET_MAP[action]) {
        return sendJson(res, 400, {
          __type: 'InvalidAction',
          message: `Unknown action: ${rawTarget}`,
        });
      }

      try {
        const body = await parseBody(req);
        logger.debug(`[Config] Action: ${action}`);
        const result = await TARGET_MAP[action](body);
        return sendJson(res, 200, result || {});
      } catch (err) {
        return sendError(res, err);
      }
    }

    // 404 fallback
    sendJson(res, 404, {
      __type: 'ResourceNotFoundException',
      message: `Route not found: ${method} ${url}`,
    });
  }

  return { handler };
}

module.exports = { createConfigServer };
