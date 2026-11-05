/**
 * @fileoverview Dispatcher AWS JSON/REST compatível com X-Amz-Target.
 * Suporta as operações usadas pelo console/SDK para EventBridge, Pipes,
 * Scheduler, Schemas e APIs relacionadas.
 */

'use strict';

const { ScheduleExpressionError } = require('./features/schedule-expression');

function sendAwsError(res, err) {
  if (err instanceof ScheduleExpressionError) {
    return res.status(400).json({ message: err.message, __type: err.code, code: err.code });
  }
  const statusMap = {
    ValidationException: 400,
    InvalidEventPatternException: 400,
    BadRequestException: 400,
    LimitExceededException: 429,
    ResourceNotFoundException: 404,
    ResourceAlreadyExistsException: 409,
    ResourceInUseException: 409,
    InternalException: 500,
    InternalFailure: 500,
  };
  const code = err.code || err.__type || 'InternalException';
  const status = statusMap[code] || 500;
  res.status(status).json({ message: err.message, __type: code, code });
}

function createAwsProtocol(simulator, logger) {
  const router = (req, res) => {
    const target = req.headers['x-amz-target'] || req.headers['X-Amz-Target'];
    if (!target) return res.status(400).json({ message: 'X-Amz-Target header is required', __type: 'MissingHeader' });

    const [service, action] = String(target).split('.');
    const body = req.body || {};
    const features = simulator.features;

    logger.debug('EventBridge', `AWS Protocol: ${target}`);

    try {
      // ==================== EventBridge core ====================
      if (service === 'AWSEvents' || service === 'AmazonEventBridge') {
        switch (action) {
          case 'CreateEventBus': {
            simulator.createEventBus(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteEventBus': {
            simulator.deleteEventBus(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'ListEventBuses': {
            return res.json(simulator.listEventBuses(body));
          }
          case 'DescribeEventBus': {
            return res.json(simulator.describeEventBus(body));
          }
          case 'PutRule': {
            simulator.putRule(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteRule': {
            simulator.deleteRule(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'ListRules': {
            return res.json(simulator.listRules(body));
          }
          case 'DescribeRule': {
            return res.json(simulator.describeRule(body));
          }
          case 'EnableRule': {
            simulator.enableRule(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DisableRule': {
            simulator.disableRule(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'PutTargets': {
            simulator.putTargets(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'RemoveTargets': {
            simulator.removeTargets(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'ListTargetsByRule': {
            return res.json(simulator.listTargetsByRule(body));
          }
          case 'PutEvents': {
            simulator.putEvents(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          // Archives
          case 'CreateArchive': {
            features.archives.createArchive(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteArchive': {
            features.archives.deleteArchive(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeArchive': {
            return res.json(features.archives.describeArchive(body));
          }
          case 'ListArchives': {
            return res.json(features.archives.listArchives(body));
          }
          case 'UpdateArchive': {
            features.archives.updateArchive(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          // Replays
          case 'StartReplay': {
            features.archives.startReplay(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'CancelReplay': {
            features.archives.cancelReplay(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeReplay': {
            return res.json(features.archives.describeReplay(body));
          }
          case 'ListReplays': {
            return res.json(features.archives.listReplays(body));
          }
          // Connections
          case 'CreateConnection': {
            features.integrations.createConnection(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'UpdateConnection': {
            features.integrations.updateConnection(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteConnection': {
            features.integrations.deleteConnection(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeConnection': {
            return res.json(features.integrations.describeConnection(body));
          }
          case 'ListConnections': {
            return res.json(features.integrations.listConnections(body));
          }
          // API destinations
          case 'CreateApiDestination': {
            features.integrations.createApiDestination(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'UpdateApiDestination': {
            features.integrations.updateApiDestination(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteApiDestination': {
            features.integrations.deleteApiDestination(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeApiDestination': {
            return res.json(features.integrations.describeApiDestination(body));
          }
          case 'ListApiDestinations': {
            return res.json(features.integrations.listApiDestinations(body));
          }
          // Global endpoints
          case 'CreateEndpoint': {
            features.globalEndpoints.createEndpoint(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'UpdateEndpoint': {
            features.globalEndpoints.updateEndpoint(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteEndpoint': {
            features.globalEndpoints.deleteEndpoint(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeEndpoint': {
            return res.json(features.globalEndpoints.describeEndpoint(body));
          }
          case 'ListEndpoints': {
            return res.json(features.globalEndpoints.listEndpoints(body));
          }
        }
      }

      // ==================== Pipes ====================
      if (service === 'Pipes' || service === 'AmazonEventBridgePipes') {
        switch (action) {
          case 'CreatePipe': {
            features.pipes.createPipe(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'UpdatePipe': {
            features.pipes.updatePipe(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeletePipe': {
            features.pipes.deletePipe(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribePipe': {
            return res.json(features.pipes.describePipe(body));
          }
          case 'ListPipes': {
            return res.json(features.pipes.listPipes(body));
          }
          case 'StartPipe': {
            features.pipes.startPipe(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'StopPipe': {
            features.pipes.stopPipe(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
        }
      }

      // ==================== Scheduler ====================
      if (service === 'AWSScheduler' || service === 'Scheduler') {
        switch (action) {
          case 'CreateScheduleGroup': {
            features.scheduler.createScheduleGroup(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteScheduleGroup': {
            features.scheduler.deleteScheduleGroup(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'GetScheduleGroup': {
            return res.json(features.scheduler.getScheduleGroup(body));
          }
          case 'ListScheduleGroups': {
            return res.json(features.scheduler.listScheduleGroups(body));
          }
          case 'CreateSchedule': {
            features.scheduler.createSchedule(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'UpdateSchedule': {
            features.scheduler.updateSchedule(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteSchedule': {
            features.scheduler.deleteSchedule(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'GetSchedule': {
            return res.json(features.scheduler.getSchedule(body));
          }
          case 'ListSchedules': {
            return res.json(features.scheduler.listSchedules(body));
          }
        }
      }

      // ==================== Schemas ====================
      if (service === 'schemas' || service === 'AWSSchemas' || service === 'Schemas') {
        switch (action) {
          case 'CreateRegistry': {
            features.schemas.createRegistry(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeRegistry': {
            return res.json(features.schemas.describeRegistry(body));
          }
          case 'ListRegistries': {
            return res.json(features.schemas.listRegistries(body));
          }
          case 'DeleteRegistry': {
            features.schemas.deleteRegistry(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'CreateSchema': {
            features.schemas.createSchema(body).then((r) => res.status(201).json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DescribeSchema': {
            return res.json(features.schemas.describeSchema(body));
          }
          case 'UpdateSchema': {
            features.schemas.updateSchema(body).then((r) => res.json(r)).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'DeleteSchema': {
            features.schemas.deleteSchema(body).then(() => res.status(200).json({})).catch((e) => sendAwsError(res, e));
            return;
          }
          case 'ListSchemas': {
            return res.json(features.schemas.listSchemas(body));
          }
          case 'ListSchemaVersions': {
            return res.json(features.schemas.listSchemaVersions(body));
          }
          case 'GetCodeBindingSource': {
            return res.json(features.schemas.getCodeBindingSource(body));
          }
        }
      }

      res.status(400).json({ message: `Unsupported action: ${target}`, __type: 'UnsupportedOperation' });
    } catch (err) {
      sendAwsError(res, err);
    }
  };

  return router;
}

module.exports = { createAwsProtocol };
