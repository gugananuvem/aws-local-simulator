/**
 * @fileoverview EventBridge HTTP Server
 * Express server compatível com AWS EventBridge REST API (JSON)
 */

'use strict';

const express = require('express');
const cors = require('cors');
const { createAwsProtocol } = require('./server-aws-protocol');

/**
 * Create EventBridge Express application
 * @param {Object} simulator - EventBridgeSimulator instance
 * @param {Object} config - Service configuration
 * @param {Object} logger - Logger instance
 * @returns {express.Application}
 */
function createEventBridgeServer(simulator, config, logger) {
  const app = express();

  if (config.cors?.enabled !== false) {
    app.use(cors({ origin: config.cors?.origin || '*' }));
  }

  app.use(express.json({ limit: '10mb' }));

  app.use((req, _res, next) => {
    logger.debug('EventBridge', `${req.method} ${req.path}`);
    next();
  });

  // AWS JSON protocol via X-Amz-Target
  const awsProtocol = createAwsProtocol(simulator, logger);
  app.post('/', awsProtocol);

  // ==================== Event Buses ====================

  app.post('/event-buses', async (req, res) => {
    try {
      const result = await simulator.createEventBus(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });

  app.delete('/event-buses/:name', async (req, res) => {
    try {
      await simulator.deleteEventBus({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  app.get('/event-buses', (_req, res) => {
    try {
      const result = simulator.listEventBuses();
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  app.get('/event-buses/:name', (req, res) => {
    try {
      const result = simulator.describeEventBus({ Name: req.params.name });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  // ==================== JSON routes for React frontend ====================

  app.post('/json/eventbridge/rules', async (req, res) => {
    try {
      const result = await simulator.putRule(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });

  app.delete('/json/eventbridge/rules/:name', async (req, res) => {
    try {
      await simulator.deleteRule({
        Name: req.params.name,
        EventBusName: req.query.eventBusName,
        Force: req.query.force === 'true'
      });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  app.get('/json/eventbridge/rules', (req, res) => {
    try {
      const result = simulator.listRules({
        EventBusName: req.query.EventBusName || 'default',
        NamePrefix: req.query.NamePrefix,
        Limit: req.query.Limit ? parseInt(req.query.Limit) : undefined
      });
      // Return just the array, not the wrapper object
      res.json(result.Rules || []);
    } catch (err) { sendError(res, err); }
  });

  app.get('/json/eventbridge/buses', (req, res) => {
    try {
      const result = simulator.listEventBuses();
      // Return just the array, not the wrapper object
      res.json(result.EventBuses || []);
    } catch (err) { sendError(res, err); }
  });

  // ==================== Rules ====================

  app.put('/rules', async (req, res) => {
    try {
      const result = await simulator.putRule(req.body);
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  app.delete('/rules/:name', async (req, res) => {
    try {
      await simulator.deleteRule({ Name: req.params.name, EventBusName: req.query.eventBusName });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  app.get('/rules', (req, res) => {
    try {
      const result = simulator.listRules({
        EventBusName: req.query.EventBusName || 'default',
        NamePrefix: req.query.NamePrefix,
        Limit: req.query.Limit ? parseInt(req.query.Limit) : undefined
      });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  app.get('/rules/:name', (req, res) => {
    try {
      const result = simulator.describeRule({
        Name: req.params.name,
        EventBusName: req.query.EventBusName || 'default'
      });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  app.patch('/rules/:name/enable', async (req, res) => {
    try {
      await simulator.enableRule({ Name: req.params.name, EventBusName: req.query.EventBusName || 'default' });
      res.json({ message: 'Rule enabled' });
    } catch (err) { sendError(res, err); }
  });

  app.patch('/rules/:name/disable', async (req, res) => {
    try {
      await simulator.disableRule({ Name: req.params.name, EventBusName: req.query.EventBusName || 'default' });
      res.json({ message: 'Rule disabled' });
    } catch (err) { sendError(res, err); }
  });

  // ==================== Targets ====================

  app.put('/rules/:name/targets', async (req, res) => {
    try {
      const result = await simulator.putTargets({
        Rule: req.params.name,
        EventBusName: req.body.EventBusName || 'default',
        Targets: req.body.Targets
      });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  app.delete('/rules/:name/targets', async (req, res) => {
    try {
      const result = await simulator.removeTargets({
        Rule: req.params.name,
        EventBusName: req.query.EventBusName || 'default',
        Ids: req.body.Ids || []
      });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  app.get('/rules/:name/targets', (req, res) => {
    try {
      const result = simulator.listTargetsByRule({
        Rule: req.params.name,
        EventBusName: req.query.EventBusName || 'default'
      });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  // ==================== PutEvents ====================

  app.post('/events', async (req, res) => {
    try {
      const result = await simulator.putEvents(req.body);
      res.json(result);
    } catch (err) { sendError(res, err); }
  });

  // ==================== Pipes (REST/JSON) ====================

  app.get('/pipes', (req, res) => {
    try {
      res.json(simulator.features.pipes.listPipes(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/pipes', async (req, res) => {
    try {
      const result = await simulator.features.pipes.createPipe(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/pipes/:name', (req, res) => {
    try {
      res.json(simulator.features.pipes.describePipe({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.put('/pipes/:name', async (req, res) => {
    try {
      const result = await simulator.features.pipes.updatePipe({ Name: req.params.name, ...req.body });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });
  app.delete('/pipes/:name', async (req, res) => {
    try {
      await simulator.features.pipes.deletePipe({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });
  app.post('/pipes/:name/start', async (req, res) => {
    try {
      res.json(await simulator.features.pipes.startPipe({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.post('/pipes/:name/stop', async (req, res) => {
    try {
      res.json(await simulator.features.pipes.stopPipe({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });

  // ==================== Scheduler (REST/JSON) ====================

  app.get('/schedules', (req, res) => {
    try {
      res.json(simulator.features.scheduler.listSchedules(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/schedules', async (req, res) => {
    try {
      const result = await simulator.features.scheduler.createSchedule(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/schedules/:name', (req, res) => {
    try {
      res.json(simulator.features.scheduler.getSchedule({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.put('/schedules/:name', async (req, res) => {
    try {
      const result = await simulator.features.scheduler.updateSchedule({ Name: req.params.name, ...req.body });
      res.json(result);
    } catch (err) { sendError(res, err); }
  });
  app.delete('/schedules/:name', async (req, res) => {
    try {
      await simulator.features.scheduler.deleteSchedule({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  app.get('/schedule-groups', (req, res) => {
    try {
      res.json(simulator.features.scheduler.listScheduleGroups(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/schedule-groups', async (req, res) => {
    try {
      const result = await simulator.features.scheduler.createScheduleGroup(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.delete('/schedule-groups/:name', async (req, res) => {
    try {
      await simulator.features.scheduler.deleteScheduleGroup({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  // ==================== Archives & Replays ====================

  app.get('/archives', (req, res) => {
    try {
      res.json(simulator.features.archives.listArchives(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/archives', async (req, res) => {
    try {
      const result = await simulator.features.archives.createArchive(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/archives/:name', (req, res) => {
    try {
      res.json(simulator.features.archives.describeArchive({ ArchiveName: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.delete('/archives/:name', async (req, res) => {
    try {
      await simulator.features.archives.deleteArchive({ ArchiveName: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });
  app.put('/archives/:name', async (req, res) => {
    try {
      res.json(await simulator.features.archives.updateArchive({ ArchiveName: req.params.name, ...req.body }));
    } catch (err) { sendError(res, err); }
  });

  app.get('/replays', (req, res) => {
    try {
      res.json(simulator.features.archives.listReplays(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/replays', async (req, res) => {
    try {
      const result = await simulator.features.archives.startReplay(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/replays/:name', (req, res) => {
    try {
      res.json(simulator.features.archives.describeReplay({ ReplayName: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.post('/replays/:name/cancel', async (req, res) => {
    try {
      res.json(await simulator.features.archives.cancelReplay({ ReplayName: req.params.name }));
    } catch (err) { sendError(res, err); }
  });

  // ==================== Connections & API destinations ====================

  app.get('/connections', (req, res) => {
    try {
      res.json(simulator.features.integrations.listConnections(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/connections', async (req, res) => {
    try {
      const result = await simulator.features.integrations.createConnection(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/connections/:name', (req, res) => {
    try {
      res.json(simulator.features.integrations.describeConnection({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.put('/connections/:name', async (req, res) => {
    try {
      res.json(await simulator.features.integrations.updateConnection({ Name: req.params.name, ...req.body }));
    } catch (err) { sendError(res, err); }
  });
  app.delete('/connections/:name', async (req, res) => {
    try {
      await simulator.features.integrations.deleteConnection({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  app.get('/api-destinations', (req, res) => {
    try {
      res.json(simulator.features.integrations.listApiDestinations(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/api-destinations', async (req, res) => {
    try {
      const result = await simulator.features.integrations.createApiDestination(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/api-destinations/:name', (req, res) => {
    try {
      res.json(simulator.features.integrations.describeApiDestination({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.put('/api-destinations/:name', async (req, res) => {
    try {
      res.json(await simulator.features.integrations.updateApiDestination({ Name: req.params.name, ...req.body }));
    } catch (err) { sendError(res, err); }
  });
  app.delete('/api-destinations/:name', async (req, res) => {
    try {
      await simulator.features.integrations.deleteApiDestination({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  // ==================== Schema registry ====================

  app.get('/schemas/registries', (req, res) => {
    try {
      res.json(simulator.features.schemas.listRegistries(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/schemas/registries', async (req, res) => {
    try {
      const result = await simulator.features.schemas.createRegistry(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/schemas', (req, res) => {
    try {
      res.json(simulator.features.schemas.listSchemas(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/schemas', async (req, res) => {
    try {
      const result = await simulator.features.schemas.createSchema(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/schemas/:name', (req, res) => {
    try {
      res.json(simulator.features.schemas.describeSchema({ SchemaName: req.params.name, RegistryName: req.query.RegistryName }));
    } catch (err) { sendError(res, err); }
  });
  app.put('/schemas/:name', async (req, res) => {
    try {
      res.json(await simulator.features.schemas.updateSchema({ SchemaName: req.params.name, RegistryName: req.query.RegistryName, ...req.body }));
    } catch (err) { sendError(res, err); }
  });
  app.delete('/schemas/:name', async (req, res) => {
    try {
      await simulator.features.schemas.deleteSchema({ SchemaName: req.params.name, RegistryName: req.query.RegistryName });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });
  app.get('/schemas/:name/versions', (req, res) => {
    try {
      res.json(simulator.features.schemas.listSchemaVersions({ SchemaName: req.params.name, RegistryName: req.query.RegistryName, ...req.query }));
    } catch (err) { sendError(res, err); }
  });

  // ==================== Global endpoints ====================

  app.get('/endpoints', (req, res) => {
    try {
      res.json(simulator.features.globalEndpoints.listEndpoints(req.query));
    } catch (err) { sendError(res, err); }
  });
  app.post('/endpoints', async (req, res) => {
    try {
      const result = await simulator.features.globalEndpoints.createEndpoint(req.body);
      res.status(201).json(result);
    } catch (err) { sendError(res, err); }
  });
  app.get('/endpoints/:name', (req, res) => {
    try {
      res.json(simulator.features.globalEndpoints.describeEndpoint({ Name: req.params.name }));
    } catch (err) { sendError(res, err); }
  });
  app.put('/endpoints/:name', async (req, res) => {
    try {
      res.json(await simulator.features.globalEndpoints.updateEndpoint({ Name: req.params.name, ...req.body }));
    } catch (err) { sendError(res, err); }
  });
  app.delete('/endpoints/:name', async (req, res) => {
    try {
      await simulator.features.globalEndpoints.deleteEndpoint({ Name: req.params.name });
      res.status(200).json({});
    } catch (err) { sendError(res, err); }
  });

  // ==================== Admin ====================

  app.get('/__admin/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'eventbridge',
      buses: simulator.buses.size,
      rules: simulator.rules.size,
      recentEvents: simulator.eventArchive.length,
      pipes: simulator.features?.pipes?.getStats ? simulator.features.pipes.getStats() : undefined,
      schedules: simulator.features?.scheduler?.getStats ? simulator.features.scheduler.getStats() : undefined,
      archives: simulator.features?.archives?.getStats ? simulator.features.archives.getStats() : undefined,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/__admin/buses', (_req, res) => {
    res.json({ buses: Array.from(simulator.buses.values()) });
  });

  app.get('/__admin/rules', (_req, res) => {
    res.json({ rules: Array.from(simulator.rules.values()) });
  });

  app.get('/__admin/events', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const events = simulator.eventArchive.slice(-limit);
    res.json({ events, total: simulator.eventArchive.length });
  });

  app.post('/__admin/reset', async (_req, res) => {
    await simulator.reset();
    res.json({ message: 'EventBridge data reset' });
  });

  app.use((_req, res) => res.status(404).json({ message: 'Not Found' }));

  return app;
}

/**
 * Send error response
 * @param {express.Response} res
 * @param {Error} err
 */
function sendError(res, err) {
  const statusMap = {
    ValidationException: 400,
    ResourceNotFoundException: 404,
    ResourceAlreadyExistsException: 409,
    InvalidEventPatternException: 400
  };
  const status = statusMap[err.code] || statusMap[err.__type] || 500;
  res.status(status).json({ message: err.message, __type: err.__type || err.code });
}

module.exports = { createEventBridgeServer };
