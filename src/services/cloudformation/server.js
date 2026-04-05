'use strict';

/**
 * @fileoverview CloudFormation HTTP Server
 *
 * Protocolo: application/x-www-form-urlencoded (Query API)
 * Action via body: Action=CreateStack&...
 * Compatível com AWS SDK v3 CloudFormationClient
 *
 * Ações suportadas:
 *  CreateStack, UpdateStack, DeleteStack
 *  DescribeStacks, ListStacks
 *  ValidateTemplate, GetTemplate
 *  DescribeStackResources, ListStackResources
 *  CreateChangeSet, DescribeChangeSet, ExecuteChangeSet, DeleteChangeSet, ListChangeSets
 */

const express = require('express');
const cors = require('cors');

/**
 * Converte objeto JS em XML CloudFormation simples
 */
function toXml(tag, value, indent = '') {
  if (value === null || value === undefined) return '';

  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<${tag}/>`;
    return `${indent}<${tag}>${value.map(v => toXml('member', v, indent + '  ')).join('')}</${tag}>`;
  }

  if (typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([k, v]) => toXml(k, v, indent + '  '))
      .join('');
    return `${indent}<${tag}>${inner}</${tag}>`;
  }

  return `${indent}<${tag}>${String(value)}</${tag}>`;
}

/**
 * Envolve uma resposta no padrão de wrapper XML da CloudFormation
 */
function wrapResponse(action, data) {
  const inner = Object.entries(data)
    .map(([k, v]) => toXml(k, v, '    '))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<${action}Response xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <${action}Result>
${inner}
  </${action}Result>
  <ResponseMetadata>
    <RequestId>${require('crypto').randomUUID()}</RequestId>
  </ResponseMetadata>
</${action}Response>`;
}

/**
 * Envolve erro no padrão XML da CloudFormation
 */
function wrapError(code, message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ErrorResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">
  <Error>
    <Type>Sender</Type>
    <Code>${code}</Code>
    <Message>${message}</Message>
  </Error>
  <RequestId>${require('crypto').randomUUID()}</RequestId>
</ErrorResponse>`;
}

/**
 * Parse de form-encoded body para objeto (inclui membros da AWS como param.1.key=, etc.)
 */
function parseFormBody(body) {
  if (!body || typeof body !== 'object') return body || {};
  return body;
}

/**
 * Converte Parameters.member.N.ParameterKey/Value para array
 */
function extractParameters(body) {
  const params = [];
  let i = 1;
  while (body[`Parameters.member.${i}.ParameterKey`]) {
    params.push({
      ParameterKey: body[`Parameters.member.${i}.ParameterKey`],
      ParameterValue: body[`Parameters.member.${i}.ParameterValue`] || '',
      UsePreviousValue: body[`Parameters.member.${i}.UsePreviousValue`] === 'true',
    });
    i++;
  }
  return params;
}

/**
 * Converte Tags.member.N.Key/Value para array
 */
function extractTags(body) {
  const tags = [];
  let i = 1;
  while (body[`Tags.member.${i}.Key`]) {
    tags.push({
      Key: body[`Tags.member.${i}.Key`],
      Value: body[`Tags.member.${i}.Value`] || '',
    });
    i++;
  }
  return tags;
}

/**
 * Converte Capabilities.member.N para array
 */
function extractCapabilities(body) {
  const caps = [];
  let i = 1;
  while (body[`Capabilities.member.${i}`]) {
    caps.push(body[`Capabilities.member.${i}`]);
    i++;
  }
  return caps;
}

/**
 * Converte StackStatusFilter.member.N para array
 */
function extractStackStatusFilter(body) {
  const filters = [];
  let i = 1;
  while (body[`StackStatusFilter.member.${i}`]) {
    filters.push(body[`StackStatusFilter.member.${i}`]);
    i++;
  }
  return filters;
}

/**
 * Cria Express app do CloudFormation
 */
function createCloudFormationServer(simulator, config, logger) {
  const app = express();

  // ── Middlewares ──────────────────────────────────────────────────
  if (config.cors?.enabled !== false) {
    app.use(cors({ origin: config.cors?.origin || '*' }));
  }

  // Suporte a form-encoded (protocolo Query da CloudFormation)
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.json({ limit: '10mb' }));

  // Logger
  app.use((req, _res, next) => {
    const action = req.body?.Action || req.query?.Action || '';
    if (action) logger.debug(`[CloudFormation] ${req.method} ${req.path} Action=${action}`);
    next();
  });

  // ── Rota principal ───────────────────────────────────────────────
  app.post('/', async (req, res) => {
    const body = parseFormBody(req.body || {});
    const action = body.Action || req.query?.Action;

    if (!action) {
      res.status(400).type('application/xml').send(wrapError('MissingAction', 'Action is required'));
      return;
    }

    try {
      return await dispatch(action, body, simulator, res, logger);
    } catch (err) {
      logger.error(`[CloudFormation] [${action}] ${err.message}`);
      const statusCode = err.statusCode || 500;
      res.status(statusCode).type('application/xml').send(
        wrapError(err.code || 'InternalError', err.message)
      );
    }
  });

  // ── Admin routes ─────────────────────────────────────────────────
  app.get('/__admin/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'cloudformation',
      ...simulator.getStats(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/__admin/stacks', (_req, res) => {
    try {
      const result = simulator.describeStacks({});
      res.json({ stacks: result.Stacks });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/__admin/stacks/:name', (req, res) => {
    try {
      const result = simulator.describeStacks({ StackName: req.params.name });
      res.json(result.Stacks[0] || {});
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.get('/__admin/stacks/:name/resources', (req, res) => {
    try {
      const result = simulator.listStackResources({ StackName: req.params.name });
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.get('/__admin/changesets', (req, res) => {
    try {
      const stackName = req.query.stackName || '';
      if (stackName) {
        const result = simulator.listChangeSets({ StackName: stackName });
        res.json(result);
      } else {
        // Retorna todos os change sets
        const all = Array.from(simulator.changeSets.values());
        res.json({ Summaries: all });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/__admin/reset', async (_req, res) => {
    await simulator.reset();
    res.json({ message: 'CloudFormation data reset complete' });
  });

  // ── Catch-all ─────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).type('application/xml').send(
      wrapError('NotFound', `Route not found: ${req.method} ${req.path}`)
    );
  });

  return app;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function dispatch(action, body, simulator, res, logger) {
  switch (action) {
    // ── Stacks ──────────────────────────────────────────────────────
    case 'CreateStack': {
      const result = await simulator.createStack({
        StackName: body.StackName,
        TemplateBody: body.TemplateBody,
        TemplateURL: body.TemplateURL,
        Parameters: extractParameters(body),
        Capabilities: extractCapabilities(body),
        Tags: extractTags(body),
        OnFailure: body.OnFailure,
        TimeoutInMinutes: body.TimeoutInMinutes ? parseInt(body.TimeoutInMinutes) : undefined,
        DisableRollback: body.DisableRollback === 'true',
        RoleARN: body.RoleARN,
      });
      res.type('application/xml').send(wrapResponse('CreateStack', result));
      return;
    }

    case 'UpdateStack': {
      const result = await simulator.updateStack({
        StackName: body.StackName,
        TemplateBody: body.TemplateBody,
        UsePreviousTemplate: body.UsePreviousTemplate === 'true',
        Parameters: extractParameters(body),
        Capabilities: extractCapabilities(body),
        Tags: extractTags(body).length ? extractTags(body) : undefined,
        RoleARN: body.RoleARN,
      });
      res.type('application/xml').send(wrapResponse('UpdateStack', result));
      return;
    }

    case 'DeleteStack': {
      await simulator.deleteStack({
        StackName: body.StackName,
      });
      res.type('application/xml').send(wrapResponse('DeleteStack', {}));
      return;
    }

    case 'DescribeStacks': {
      const result = simulator.describeStacks({ StackName: body.StackName });
      // Envolve Stacks no formato member esperado pelo AWS CLI
      res.type('application/xml').send(wrapResponse('DescribeStacks', {
        Stacks: result.Stacks
      }));
      return;
    }

    case 'ListStacks': {
      const result = simulator.listStacks({
        StackStatusFilter: extractStackStatusFilter(body),
        NextToken: body.NextToken,
      });
      res.type('application/xml').send(wrapResponse('ListStacks', result));
      return;
    }

    // ── Template ────────────────────────────────────────────────────
    case 'ValidateTemplate': {
      const result = simulator.validateTemplate({
        TemplateBody: body.TemplateBody,
        TemplateURL: body.TemplateURL,
      });
      res.type('application/xml').send(wrapResponse('ValidateTemplate', result));
      return;
    }

    case 'GetTemplate': {
      const result = simulator.getTemplate({
        StackName: body.StackName,
        TemplateStage: body.TemplateStage,
      });
      res.type('application/xml').send(wrapResponse('GetTemplate', result));
      return;
    }

    // ── StackResources ──────────────────────────────────────────────
    case 'DescribeStackResources': {
      const result = simulator.describeStackResources({
        StackName: body.StackName,
        LogicalResourceId: body.LogicalResourceId,
      });
      res.type('application/xml').send(wrapResponse('DescribeStackResources', result));
      return;
    }

    case 'ListStackResources': {
      const result = simulator.listStackResources({
        StackName: body.StackName,
        NextToken: body.NextToken,
      });
      res.type('application/xml').send(wrapResponse('ListStackResources', result));
      return;
    }

    // ── ChangeSets ──────────────────────────────────────────────────
    case 'CreateChangeSet': {
      const result = await simulator.createChangeSet({
        StackName: body.StackName,
        ChangeSetName: body.ChangeSetName,
        TemplateBody: body.TemplateBody,
        UsePreviousTemplate: body.UsePreviousTemplate === 'true',
        Parameters: extractParameters(body),
        Capabilities: extractCapabilities(body),
        Tags: extractTags(body),
        Description: body.Description || '',
        ChangeSetType: body.ChangeSetType || 'UPDATE',
      });
      res.type('application/xml').send(wrapResponse('CreateChangeSet', result));
      return;
    }

    case 'DescribeChangeSet': {
      const result = simulator.describeChangeSet({
        ChangeSetName: body.ChangeSetName,
        StackName: body.StackName,
        NextToken: body.NextToken,
      });
      res.type('application/xml').send(wrapResponse('DescribeChangeSet', result));
      return;
    }

    case 'ExecuteChangeSet': {
      const result = await simulator.executeChangeSet({
        ChangeSetName: body.ChangeSetName,
        StackName: body.StackName,
        ClientRequestToken: body.ClientRequestToken,
      });
      res.type('application/xml').send(wrapResponse('ExecuteChangeSet', result));
      return;
    }

    case 'DeleteChangeSet': {
      await simulator.deleteChangeSet({
        ChangeSetName: body.ChangeSetName,
        StackName: body.StackName,
      });
      res.type('application/xml').send(wrapResponse('DeleteChangeSet', {}));
      return;
    }

    case 'ListChangeSets': {
      const result = simulator.listChangeSets({
        StackName: body.StackName,
        NextToken: body.NextToken,
      });
      res.type('application/xml').send(wrapResponse('ListChangeSets', result));
      return;
    }

    default: {
      res.status(400).type('application/xml').send(
        wrapError('InvalidAction', `Action not supported: ${action}`)
      );
    }
  }
}

module.exports = { createCloudFormationServer };
