'use strict';

/**
 * @fileoverview X-Ray HTTP Server
 *
 * Protocolo: JSON com header X-Amz-Target
 * Compatível com @aws-sdk/client-xray (XRayClient)
 *
 * Target prefix: AmazonXRay
 *
 * Operações suportadas:
 *  - PutTraceSegments
 *  - BatchGetTraces
 *  - GetTraceSummaries
 *  - GetTraceGraph
 *  - GetServiceGraph
 *  - CreateGroup / UpdateGroup / DeleteGroup / GetGroup / GetGroups
 *  - CreateSamplingRule / UpdateSamplingRule / DeleteSamplingRule
 *  - GetSamplingRules / GetSamplingStatisticSummaries / GetSamplingTargets
 *  - PutEncryptionConfig / GetEncryptionConfig
 *  - TagResource / UntagResource / ListTagsForResource
 *  - GetInsight / GetInsightSummaries / GetInsightEvents / GetInsightImpactGraph
 *
 * Rotas admin:
 *  GET  /__admin/traces           - lista todos os traces
 *  GET  /__admin/groups           - lista todos os grupos
 *  GET  /__admin/sampling-rules   - lista sampling rules
 *  GET  /__admin/status           - status do simulador
 *  POST /__admin/reset            - reseta todos os dados
 *  GET  /__admin/health           - health check
 *
 * Rota interna:
 *  POST /__internal/record-service-call - usada pelos outros serviços para registrar traces
 */

const { XRaySimulator } = require('./simulador');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-amzn-RequestId': require('crypto').randomUUID(),
  });
  res.end(body);
}

function sendError(res, err) {
  const statusCode = err.statusCode || 400;
  sendJson(res, statusCode, {
    __type: err.code || 'ServiceException',
    message: err.message,
  });
}

// ─── Mapa de operações ────────────────────────────────────────────────────────

const OPERATION_MAP = {
  // Traces
  'PutTraceSegments':              (sim, body) => sim.putTraceSegments(body),
  'BatchGetTraces':                (sim, body) => sim.batchGetTraces(body),
  'GetTraceSummaries':             (sim, body) => sim.getTraceSummaries(body),
  'GetTraceGraph':                 (sim, body) => sim.getTraceGraph(body),

  // Service Graph
  'GetServiceGraph':               (sim, body) => sim.getServiceGraph(body),

  // Groups
  'CreateGroup':                   (sim, body) => sim.createGroup(body),
  'UpdateGroup':                   (sim, body) => sim.updateGroup(body),
  'DeleteGroup':                   (sim, body) => sim.deleteGroup(body),
  'GetGroup':                      (sim, body) => sim.getGroup(body),
  'GetGroups':                     (sim, body) => sim.getGroups(body),

  // Sampling Rules
  'CreateSamplingRule':            (sim, body) => sim.createSamplingRule(body),
  'UpdateSamplingRule':            (sim, body) => sim.updateSamplingRule(body),
  'DeleteSamplingRule':            (sim, body) => sim.deleteSamplingRule(body),
  'GetSamplingRules':              (sim, body) => sim.getSamplingRules(body),
  'GetSamplingStatisticSummaries': (sim, body) => sim.getSamplingStatisticSummaries(body),
  'GetSamplingTargets':            (sim, body) => sim.getSamplingTargets(body),

  // Encryption
  'PutEncryptionConfig':           (sim, body) => sim.putEncryptionConfig(body),
  'GetEncryptionConfig':           (sim, body) => sim.getEncryptionConfig(),

  // Tags
  'TagResource':                   (sim, body) => sim.tagResource(body),
  'UntagResource':                 (sim, body) => sim.untagResource(body),
  'ListTagsForResource':           (sim, body) => sim.listTagsForResource(body),

  // Insights
  'GetInsight':                    (sim, body) => sim.getInsight(body),
  'GetInsightSummaries':           (sim, body) => sim.getInsightSummaries(body),
  'GetInsightEvents':              (sim, body) => sim.getInsightEvents(body),
  'GetInsightImpactGraph':         (sim, body) => sim.getInsightImpactGraph(body),
};

// ─── Factory do servidor HTTP ─────────────────────────────────────────────────

function createXRayServer(simulator) {
  const http = require('http');

  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Amz-Target, Authorization, X-Amz-Date, X-Api-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ── Rotas Admin ───────────────────────────────────────────────────────────

    if (pathname.startsWith('/__admin/')) {
      const body = req.method !== 'GET' ? await parseBody(req) : {};

      try {
        if (req.method === 'GET' && pathname === '/__admin/traces') {
          const traces = Array.from(simulator._traces.values());
          return sendJson(res, 200, { traces, total: traces.length });
        }

        if (req.method === 'GET' && pathname === '/__admin/groups') {
          const groups = Array.from(simulator._groups.values());
          return sendJson(res, 200, { groups, total: groups.length });
        }

        if (req.method === 'GET' && pathname === '/__admin/sampling-rules') {
          const rules = Array.from(simulator._samplingRules.values());
          return sendJson(res, 200, { samplingRules: rules, total: rules.length });
        }

        if (req.method === 'GET' && pathname === '/__admin/status') {
          return sendJson(res, 200, simulator.getStatus());
        }

        if (req.method === 'GET' && pathname === '/__admin/health') {
          return sendJson(res, 200, {
            status: 'ok',
            service: 'xray',
            traces: simulator._traces.size,
            uptime: process.uptime(),
          });
        }

        if (req.method === 'POST' && pathname === '/__admin/reset') {
          await simulator.reset();
          return sendJson(res, 200, { message: 'X-Ray simulator reset successfully' });
        }

        return sendJson(res, 404, { message: 'Admin route not found' });
      } catch (err) {
        return sendError(res, err);
      }
    }

    // ── Rota interna: registro de chamadas de outros serviços ─────────────────

    if (req.method === 'POST' && pathname === '/__internal/record-service-call') {
      try {
        const body = await parseBody(req);
        const traceId = simulator.recordServiceCall(body);
        return sendJson(res, 200, { TraceId: traceId });
      } catch (err) {
        return sendError(res, err);
      }
    }

    // ── API X-Ray via X-Amz-Target ───────────────────────────────────────────

    const target = req.headers['x-amz-target'] || '';
    // Aceita: AmazonXRay.PutTraceSegments  ou  xray.PutTraceSegments
    const operation = target.split('.').pop();

    if (operation && OPERATION_MAP[operation]) {
      try {
        const body = await parseBody(req);
        const result = await OPERATION_MAP[operation](simulator, body);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendError(res, err);
      }
    }

    // ── Rotas REST alternativas (path-based) ──────────────────────────────────

    try {
      const body = req.method !== 'GET' ? await parseBody(req) : {};

      // POST /TraceSegments
      if (req.method === 'POST' && pathname === '/TraceSegments') {
        const result = await simulator.putTraceSegments(body);
        return sendJson(res, 200, result);
      }

      // POST /Traces (BatchGetTraces)
      if (req.method === 'POST' && pathname === '/Traces') {
        const result = await simulator.batchGetTraces(body);
        return sendJson(res, 200, result);
      }

      // GET /TraceSummaries
      if (req.method === 'GET' && pathname === '/TraceSummaries') {
        const params = Object.fromEntries(url.searchParams.entries());
        const result = await simulator.getTraceSummaries({
          StartTime: params.StartTime ? parseFloat(params.StartTime) : undefined,
          EndTime: params.EndTime ? parseFloat(params.EndTime) : undefined,
          FilterExpression: params.FilterExpression,
          NextToken: params.NextToken,
        });
        return sendJson(res, 200, result);
      }

      // POST /TraceGraph
      if (req.method === 'POST' && pathname === '/TraceGraph') {
        const result = await simulator.getTraceGraph(body);
        return sendJson(res, 200, result);
      }

      // GET /ServiceGraph
      if (req.method === 'GET' && pathname === '/ServiceGraph') {
        const params = Object.fromEntries(url.searchParams.entries());
        const result = await simulator.getServiceGraph({
          StartTime: params.StartTime ? parseFloat(params.StartTime) : undefined,
          EndTime: params.EndTime ? parseFloat(params.EndTime) : undefined,
          GroupName: params.GroupName,
          GroupARN: params.GroupARN,
          NextToken: params.NextToken,
        });
        return sendJson(res, 200, result);
      }

      // POST /Groups
      if (req.method === 'POST' && pathname === '/Groups') {
        const result = await simulator.createGroup(body);
        return sendJson(res, 200, result);
      }

      // GET /Groups
      if (req.method === 'GET' && pathname === '/Groups') {
        const params = Object.fromEntries(url.searchParams.entries());
        const result = await simulator.getGroups({ NextToken: params.NextToken });
        return sendJson(res, 200, result);
      }

      // POST /SamplingRules
      if (req.method === 'POST' && pathname === '/SamplingRules') {
        const result = await simulator.createSamplingRule(body);
        return sendJson(res, 201, result);
      }

      // GET /SamplingRules
      if (req.method === 'GET' && pathname === '/SamplingRules') {
        const params = Object.fromEntries(url.searchParams.entries());
        const result = await simulator.getSamplingRules({ NextToken: params.NextToken });
        return sendJson(res, 200, result);
      }

      // POST /SamplingTargets
      if (req.method === 'POST' && pathname === '/SamplingTargets') {
        const result = await simulator.getSamplingTargets(body);
        return sendJson(res, 200, result);
      }

      // GET /EncryptionConfig
      if (req.method === 'GET' && pathname === '/EncryptionConfig') {
        const result = await simulator.getEncryptionConfig();
        return sendJson(res, 200, result);
      }

      // PUT /EncryptionConfig
      if (req.method === 'PUT' && pathname === '/EncryptionConfig') {
        const result = await simulator.putEncryptionConfig(body);
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { message: `Route not found: ${req.method} ${pathname}` });
    } catch (err) {
      return sendError(res, err);
    }
  });

  return server;
}

module.exports = { createXRayServer };
