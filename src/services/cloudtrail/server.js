'use strict';

/**
 * @fileoverview CloudTrail HTTP Server
 *
 * Protocolo: JSON com header X-Amz-Target
 * Compatível com @aws-sdk/client-cloudtrail (CloudTrailClient)
 *
 * Target prefix: com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101
 *
 * Operações suportadas:
 *  - CreateTrail
 *  - UpdateTrail
 *  - DeleteTrail
 *  - DescribeTrails
 *  - GetTrail
 *  - GetTrailStatus
 *  - StartLogging
 *  - StopLogging
 *  - LookupEvents
 *  - GetEventSelectors
 *  - PutEventSelectors
 *  - AddTags
 *  - RemoveTags
 *  - ListTags
 *
 * Rotas admin:
 *  GET  /__admin/trails          - lista todos os trails
 *  GET  /__admin/events          - lista todos os eventos registrados
 *  POST /__admin/events/record   - registra evento manualmente
 *  GET  /__admin/health          - health check
 *  POST /__admin/reset           - reseta todos os dados
 *
 * Rota interna:
 *  POST /__internal/record-event - usada pelos outros serviços para registrar API calls
 */

const { CloudTrailSimulator } = require('./simulador');

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
    'Content-Type': 'application/x-amz-json-1.1',
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
  // Trails
  'CreateTrail': (sim, body) => sim.createTrail(body),
  'UpdateTrail': (sim, body) => sim.updateTrail(body),
  'DeleteTrail': (sim, body) => sim.deleteTrail(body),
  'DescribeTrails': (sim, body) => sim.describeTrails(body),
  'GetTrail': (sim, body) => sim.getTrail(body),
  'GetTrailStatus': (sim, body) => sim.getTrailStatus(body),
  'StartLogging': (sim, body) => sim.startLogging(body),
  'StopLogging': (sim, body) => sim.stopLogging(body),

  // Events
  'LookupEvents': (sim, body) => sim.lookupEvents(body),

  // Event selectors
  'GetEventSelectors': (sim, body) => sim.getEventSelectors(body),
  'PutEventSelectors': (sim, body) => sim.putEventSelectors(body),

  // Tags
  'AddTags': (sim, body) => sim.addTags(body),
  'RemoveTags': (sim, body) => sim.removeTags(body),
  'ListTags': (sim, body) => sim.listTags(body),
};

// ─── Extrai nome da operação do header X-Amz-Target ──────────────────────────

function extractOperation(target) {
  if (!target) return null;
  // Formato: com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.CreateTrail
  const parts = target.split('.');
  return parts[parts.length - 1];
}

// ─── Factory do servidor ──────────────────────────────────────────────────────

function createCloudTrailServer(simulator, logger) {
  const http = require('http');

  const server = http.createServer(async (req, res) => {
    const { method, url } = req;

    // ── CORS ────────────────────────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Amz-Target, Authorization, X-Amz-Date, X-Amz-Security-Token');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Admin routes ────────────────────────────────────────────────────────
    if (url.startsWith('/__admin')) {
      return handleAdmin(req, res, simulator, logger);
    }

    // ── Internal route (cross-service) ──────────────────────────────────────
    if (url === '/__internal/record-event' && method === 'POST') {
      const body = await parseBody(req);
      try {
        const event = simulator.recordEvent(body);
        sendJson(res, 200, { event });
      } catch (err) {
        sendError(res, err);
      }
      return;
    }

    // ── AWS SDK v3 — X-Amz-Target ────────────────────────────────────────────
    const target = req.headers['x-amz-target'] || '';
    const operation = extractOperation(target);

    if (!operation) {
      sendJson(res, 400, {
        __type: 'MissingAction',
        message: 'Missing X-Amz-Target header',
      });
      return;
    }

    const handler = OPERATION_MAP[operation];
    if (!handler) {
      sendJson(res, 400, {
        __type: 'InvalidAction',
        message: `Operation not supported: ${operation}`,
      });
      return;
    }

    try {
      const body = await parseBody(req);
      logger.debug(`[CloudTrail] ${operation}`, body);
      const result = await handler(simulator, body);
      sendJson(res, 200, result || {});
    } catch (err) {
      logger.error(`[CloudTrail] ${operation} error:`, err.message);
      sendError(res, err);
    }
  });

  return server;
}

// ─── Admin handlers ───────────────────────────────────────────────────────────

async function handleAdmin(req, res, simulator, logger) {
  const { method, url } = req;
  const path = url.split('?')[0];

  // GET /__admin/health
  if (path === '/__admin/health' && method === 'GET') {
    sendJson(res, 200, {
      service: 'cloudtrail',
      status: 'ok',
      ...simulator.getStatus(),
    });
    return;
  }

  // GET /__admin/trails
  if (path === '/__admin/trails' && method === 'GET') {
    const result = simulator.describeTrails({});
    sendJson(res, 200, result);
    return;
  }

  // GET /__admin/events
  if (path === '/__admin/events' && method === 'GET') {
    const urlObj = new URL(url, 'http://localhost');
    const maxResults = parseInt(urlObj.searchParams.get('maxResults') || '50', 10);
    const result = simulator.lookupEvents({ MaxResults: maxResults });
    sendJson(res, 200, result);
    return;
  }

  // POST /__admin/events/record
  if (path === '/__admin/events/record' && method === 'POST') {
    const body = await parseBody(req);
    try {
      const event = simulator.recordEvent(body);
      sendJson(res, 200, { event });
    } catch (err) {
      sendError(res, err);
    }
    return;
  }

  // POST /__admin/reset
  if (path === '/__admin/reset' && method === 'POST') {
    simulator.reset();
    await simulator.save();
    logger.info('[CloudTrail] State reset via admin');
    sendJson(res, 200, { message: 'CloudTrail state reset successfully' });
    return;
  }

  sendJson(res, 404, { message: `Admin route not found: ${path}` });
}

module.exports = { createCloudTrailServer };
