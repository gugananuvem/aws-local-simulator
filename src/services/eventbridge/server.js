/**
 * @fileoverview EventBridge HTTP Server
 * Express server compatível com AWS EventBridge REST API (JSON)
 */

'use strict';

const express = require('express');
const cors = require('cors');

/**
 * Create EventBridge Express application
 * @param {Object} simulator - EventBridgeSimulator instance
 * @param {Object} config - Service configuration
 * @param {Object} logger - Logger instance
 * @returns {express.Application}
 */
function createEventBridgeServer(simulator, config, logger) {
  const app = express();

  if (config.cors?.enabled) {
    app.use(cors({ origin: config.cors.origin || '*' }));
  }

  app.use(express.json({ limit: '10mb' }));

  app.use((req, _res, next) => {
    logger.debug('EventBridge', `${req.method} ${req.path}`);
    next();
  });

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

  // ==================== Admin ====================

  app.get('/__admin/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'eventbridge',
      buses: simulator.buses.size,
      rules: simulator.rules.size,
      recentEvents: simulator.eventArchive.length,
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
