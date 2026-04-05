'use strict';

const express = require('express');
const cors = require('cors');

/**
 * Athena Server - protocolo JSON via x-amz-target
 */
function createAthenaServer(simulator, logger) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb', type: () => true }));

  app.use((req, _res, next) => {
    const target = req.headers['x-amz-target'] || '';
    if (target) logger.debug(`[Athena] ${req.method} ${req.path} target=${target}`);
    next();
  });

  // ── Rota principal ───────────────────────────────────────────────
  app.post('/', async (req, res) => {
    const target = (req.headers['x-amz-target'] || '').replace('AmazonAthena.', '');
    const body = req.body || {};

    try {
      let result;

      switch (target) {
        case 'StartQueryExecution':
          result = await simulator.startQueryExecution(body);
          break;
        case 'GetQueryExecution':
          result = simulator.getQueryExecution(body);
          break;
        case 'GetQueryResults':
          result = simulator.getQueryResults(body);
          break;
        case 'StopQueryExecution':
          result = await simulator.stopQueryExecution(body);
          break;
        case 'ListQueryExecutions':
          result = simulator.listQueryExecutions(body);
          break;
        case 'CreateNamedQuery':
          result = await simulator.createNamedQuery(body);
          break;
        case 'GetNamedQuery':
          result = simulator.getNamedQuery(body);
          break;
        case 'ListNamedQueries':
          result = simulator.listNamedQueries(body);
          break;
        case 'DeleteNamedQuery':
          result = await simulator.deleteNamedQuery(body);
          break;
        case 'CreateWorkGroup':
          result = await simulator.createWorkGroup(body);
          break;
        case 'GetWorkGroup':
          result = simulator.getWorkGroup(body);
          break;
        case 'ListWorkGroups':
          result = simulator.listWorkGroups(body);
          break;
        case 'DeleteWorkGroup':
          result = await simulator.deleteWorkGroup(body);
          break;
        default:
          return res.status(400).json({ __type: 'InvalidRequestException', message: `Unknown action: ${target}` });
      }

      res.json(result || {});
    } catch (err) {
      logger.error(`[Athena] Error in ${target}: ${err.message}`);
      res.status(err.statusCode || 500).json({ __type: err.code || 'InternalServerError', message: err.message });
    }
  });

  // ── Admin ────────────────────────────────────────────────────────
  app.get('/__admin/health', (_req, res) => {
    res.json({ status: 'healthy', service: 'athena', ...simulator.getStats() });
  });

  app.get('/__admin/executions', (_req, res) => {
    res.json({ executions: Array.from(simulator.queryExecutions.values()).map(({ _results, ...e }) => e) });
  });

  app.get('/__admin/workgroups', (_req, res) => {
    res.json({ workGroups: Array.from(simulator.workGroups.values()) });
  });

  app.post('/__admin/reset', async (_req, res) => {
    await simulator.reset();
    res.json({ message: 'Athena data reset complete' });
  });

  return app;
}

module.exports = { createAthenaServer };
