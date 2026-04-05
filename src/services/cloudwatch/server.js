'use strict';

/**
 * @fileoverview CloudWatch HTTP Server
 *
 * Protocolo: JSON com header X-Amz-Target
 * Compatível com AWS SDK v3:
 *   - @aws-sdk/client-cloudwatch-logs  (CloudWatchLogsClient)
 *   - @aws-sdk/client-cloudwatch       (CloudWatchClient)
 *
 * Targets suportados (Logs):
 *   CreateLogGroup, DeleteLogGroup, DescribeLogGroups
 *   CreateLogStream, DeleteLogStream, DescribeLogStreams
 *   PutLogEvents, GetLogEvents, FilterLogEvents
 *   PutRetentionPolicy, DeleteRetentionPolicy
 *   PutSubscriptionFilter, DeleteSubscriptionFilter, DescribeSubscriptionFilters
 *
 * Targets suportados (Metrics & Alarms):
 *   PutMetricData, GetMetricStatistics, ListMetrics
 *   PutMetricAlarm, DeleteAlarms, DescribeAlarms
 *   DescribeAlarmsForMetric, SetAlarmState
 */

const express = require('express');
const cors = require('cors');

/**
 * Cria e retorna o servidor Express do CloudWatch
 * @param {CloudWatchSimulator} simulator
 * @param {Object} logger
 * @returns {express.Application}
 */
function createCloudWatchServer(simulator, logger) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: 'application/x-amz-json-1.1', limit: '10mb' }));

  // Middleware: parseia body se vier como string
  app.use((req, res, next) => {
    if (typeof req.body === 'string') {
      try { req.body = JSON.parse(req.body); } catch (_) {}
    }
    next();
  });

  // ─── Roteador principal: X-Amz-Target ────────────────────────────────────

  app.post('/', async (req, res) => {
    const target = req.headers['x-amz-target'] || '';
    const body = req.body || {};

    logger.debug(`[CloudWatch] Request: ${target}`);

    try {
      let result;

      switch (target) {
        // ── Log Groups ──────────────────────────────────────────────────────
        case 'Logs_20140328.CreateLogGroup':
          simulator.createLogGroup({
            logGroupName: body.logGroupName,
            retentionInDays: body.retentionInDays,
            tags: body.tags,
          });
          result = {};
          break;

        case 'Logs_20140328.DeleteLogGroup':
          simulator.deleteLogGroup({ logGroupName: body.logGroupName });
          result = {};
          break;

        case 'Logs_20140328.DescribeLogGroups':
          result = simulator.describeLogGroups({
            logGroupNamePrefix: body.logGroupNamePrefix,
            logGroupNamePattern: body.logGroupNamePattern,
            limit: body.limit,
            nextToken: body.nextToken,
          });
          break;

        case 'Logs_20140328.PutRetentionPolicy':
          simulator.putRetentionPolicy({
            logGroupName: body.logGroupName,
            retentionInDays: body.retentionInDays,
          });
          result = {};
          break;

        case 'Logs_20140328.DeleteRetentionPolicy':
          simulator.deleteRetentionPolicy({ logGroupName: body.logGroupName });
          result = {};
          break;

        // ── Log Streams ─────────────────────────────────────────────────────
        case 'Logs_20140328.CreateLogStream':
          simulator.createLogStream({
            logGroupName: body.logGroupName,
            logStreamName: body.logStreamName,
          });
          result = {};
          break;

        case 'Logs_20140328.DeleteLogStream':
          simulator.deleteLogStream({
            logGroupName: body.logGroupName,
            logStreamName: body.logStreamName,
          });
          result = {};
          break;

        case 'Logs_20140328.DescribeLogStreams':
          result = simulator.describeLogStreams({
            logGroupName: body.logGroupName,
            logStreamNamePrefix: body.logStreamNamePrefix,
            orderBy: body.orderBy,
            descending: body.descending,
            limit: body.limit,
            nextToken: body.nextToken,
          });
          break;

        // ── Log Events ──────────────────────────────────────────────────────
        case 'Logs_20140328.PutLogEvents':
          result = await simulator.putLogEvents({
            logGroupName: body.logGroupName,
            logStreamName: body.logStreamName,
            logEvents: body.logEvents,
            sequenceToken: body.sequenceToken,
          });
          break;

        case 'Logs_20140328.GetLogEvents':
          result = simulator.getLogEvents({
            logGroupName: body.logGroupName,
            logStreamName: body.logStreamName,
            startTime: body.startTime,
            endTime: body.endTime,
            nextToken: body.nextToken,
            limit: body.limit,
            startFromHead: body.startFromHead,
          });
          break;

        case 'Logs_20140328.FilterLogEvents':
          result = simulator.filterLogEvents({
            logGroupName: body.logGroupName,
            logStreamNames: body.logStreamNames,
            startTime: body.startTime,
            endTime: body.endTime,
            filterPattern: body.filterPattern,
            nextToken: body.nextToken,
            limit: body.limit,
          });
          break;

        // ── Subscription Filters ────────────────────────────────────────────
        case 'Logs_20140328.PutSubscriptionFilter':
          simulator.putSubscriptionFilter({
            logGroupName: body.logGroupName,
            filterName: body.filterName,
            filterPattern: body.filterPattern,
            destinationArn: body.destinationArn,
            distribution: body.distribution,
          });
          result = {};
          break;

        case 'Logs_20140328.DeleteSubscriptionFilter':
          simulator.deleteSubscriptionFilter({
            logGroupName: body.logGroupName,
            filterName: body.filterName,
          });
          result = {};
          break;

        case 'Logs_20140328.DescribeSubscriptionFilters':
          result = simulator.describeSubscriptionFilters({
            logGroupName: body.logGroupName,
            filterNamePrefix: body.filterNamePrefix,
            limit: body.limit,
            nextToken: body.nextToken,
          });
          break;

        // ── Metrics ─────────────────────────────────────────────────────────
        case 'GraniteServiceVersion20100801.PutMetricData':
          simulator.putMetricData({
            namespace: body.Namespace || body.namespace,
            metricData: (body.MetricData || body.metricData || []).map(m => ({
              metricName: m.MetricName || m.metricName,
              dimensions: (m.Dimensions || m.dimensions || []).map(d => ({
                name: d.Name || d.name,
                value: d.Value || d.value,
              })),
              timestamp: m.Timestamp || m.timestamp,
              value: m.Value !== undefined ? m.Value : m.value,
              unit: m.Unit || m.unit,
              statistic: m.StatisticValues || m.statistic,
              storageResolution: m.StorageResolution || m.storageResolution,
            })),
          });
          result = {};
          break;

        case 'GraniteServiceVersion20100801.GetMetricStatistics':
          result = simulator.getMetricStatistics({
            namespace: body.Namespace || body.namespace,
            metricName: body.MetricName || body.metricName,
            dimensions: (body.Dimensions || body.dimensions || []).map(d => ({
              name: d.Name || d.name,
              value: d.Value || d.value,
            })),
            startTime: body.StartTime || body.startTime,
            endTime: body.EndTime || body.endTime,
            period: body.Period || body.period,
            statistics: body.Statistics || body.statistics,
            unit: body.Unit || body.unit,
          });
          break;

        case 'GraniteServiceVersion20100801.ListMetrics':
          result = simulator.listMetrics({
            namespace: body.Namespace || body.namespace,
            metricName: body.MetricName || body.metricName,
            dimensions: (body.Dimensions || body.dimensions || []).map(d => ({
              name: d.Name || d.name,
              value: d.Value || d.value,
            })),
            nextToken: body.NextToken || body.nextToken,
          });
          break;

        // ── Alarms ──────────────────────────────────────────────────────────
        case 'GraniteServiceVersion20100801.PutMetricAlarm':
          simulator.putMetricAlarm({
            alarmName: body.AlarmName || body.alarmName,
            alarmDescription: body.AlarmDescription || body.alarmDescription,
            actionsEnabled: body.ActionsEnabled !== undefined ? body.ActionsEnabled : body.actionsEnabled,
            okActions: body.OKActions || body.okActions,
            alarmActions: body.AlarmActions || body.alarmActions,
            insufficientDataActions: body.InsufficientDataActions || body.insufficientDataActions,
            metricName: body.MetricName || body.metricName,
            namespace: body.Namespace || body.namespace,
            statistic: body.Statistic || body.statistic,
            dimensions: (body.Dimensions || body.dimensions || []).map(d => ({
              name: d.Name || d.name,
              value: d.Value || d.value,
            })),
            period: body.Period || body.period,
            evaluationPeriods: body.EvaluationPeriods || body.evaluationPeriods,
            datapointsToAlarm: body.DatapointsToAlarm || body.datapointsToAlarm,
            threshold: body.Threshold !== undefined ? body.Threshold : body.threshold,
            comparisonOperator: body.ComparisonOperator || body.comparisonOperator,
            treatMissingData: body.TreatMissingData || body.treatMissingData,
            unit: body.Unit || body.unit,
          });
          result = {};
          break;

        case 'GraniteServiceVersion20100801.DeleteAlarms':
          simulator.deleteAlarms({
            alarmNames: body.AlarmNames || body.alarmNames,
          });
          result = {};
          break;

        case 'GraniteServiceVersion20100801.DescribeAlarms':
          result = simulator.describeAlarms({
            alarmNames: body.AlarmNames || body.alarmNames,
            alarmNamePrefix: body.AlarmNamePrefix || body.alarmNamePrefix,
            stateValue: body.StateValue || body.stateValue,
            actionPrefix: body.ActionPrefix || body.actionPrefix,
            maxRecords: body.MaxRecords || body.maxRecords,
            nextToken: body.NextToken || body.nextToken,
          });
          break;

        case 'GraniteServiceVersion20100801.DescribeAlarmsForMetric':
          result = simulator.describeAlarmsForMetric({
            metricName: body.MetricName || body.metricName,
            namespace: body.Namespace || body.namespace,
            statistic: body.Statistic || body.statistic,
            dimensions: (body.Dimensions || body.dimensions || []).map(d => ({
              name: d.Name || d.name,
              value: d.Value || d.value,
            })),
            period: body.Period || body.period,
            unit: body.Unit || body.unit,
          });
          break;

        case 'GraniteServiceVersion20100801.SetAlarmState':
          simulator.setAlarmState({
            alarmName: body.AlarmName || body.alarmName,
            stateValue: body.StateValue || body.stateValue,
            stateReason: body.StateReason || body.stateReason,
            stateReasonData: body.StateReasonData || body.stateReasonData,
          });
          result = {};
          break;

        default:
          logger.warn(`[CloudWatch] Unknown target: ${target}`);
          return res.status(400).json({
            __type: 'UnknownOperationException',
            message: `Unknown operation: ${target}`,
          });
      }

      res.status(200).json(result || {});

    } catch (err) {
      logger.error(`[CloudWatch] Error on ${target}: ${err.message}`);
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({
        __type: err.code || 'InternalFailure',
        message: err.message,
      });
    }
  });

  // ─── Rotas Admin ─────────────────────────────────────────────────────────

  app.get('/__admin/health', (req, res) => {
    res.json({ status: 'ok', service: 'cloudwatch' });
  });

  app.get('/__admin/status', (req, res) => {
    res.json(simulator.getStatus());
  });

  app.get('/__admin/log-groups', (req, res) => {
    res.json(simulator.listAdminLogGroups());
  });

  app.get('/__admin/alarms', (req, res) => {
    res.json(simulator.listAdminAlarms());
  });

  app.get('/__admin/metrics', (req, res) => {
    res.json(simulator.listAdminMetrics());
  });

  app.post('/__admin/reset', (req, res) => {
    simulator.reset();
    res.json({ message: 'CloudWatch state reset' });
  });

  // Rota de log de Lambda (chamada internamente pelo simulador Lambda)
  app.post('/__internal/lambda-logs', async (req, res) => {
    const { functionName, requestId, logs } = req.body || {};
    try {
      await simulator.putLambdaLogs(functionName, requestId, logs || []);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = { createCloudWatchServer };
