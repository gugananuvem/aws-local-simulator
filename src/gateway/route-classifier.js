/**
 * Classificador de rotas do gateway (ponto de entrada unico).
 *
 * Funcao pura: recebe metodo, URL, headers e um objeto `lookup` com duas consultas ao estado
 * dos simuladores (bucket existe, apiId existe). Devolve o nome interno do servico ou um erro.
 *
 * Regras, na ordem. A primeira que casa vence:
 *   R1  X-Amz-Target (prefixo do protocolo JSON).
 *   R2  Escopo da assinatura (Authorization ou X-Amz-Credential na query).
 *   R3  Protocolo query: Action + Version (query string ou corpo de formulario).
 *   R4  Prefixo de caminho exato.
 *   R5  Sem assinatura e sem target: primeiro segmento e bucket (a) ou apiId de execucao (b).
 *   R6  Host com rotulo de bucket (virtual-hosted), bucket existente.
 */

const querystring = require('querystring');
const { bucketFromHost } = require('../services/s3/host-bucket');

/** R1: prefixo do X-Amz-Target -> servico. A chave inclui o ponto final. */
const TARGET_PREFIXES = {
  'DynamoDB_20120810.': 'dynamodb',
  'AmazonSSM.': 'parameter-store',
  'secretsmanager.': 'secret-manager',
  'TrentService.': 'kms',
  'AWSCognitoIdentityProviderService.': 'cognito',
  'Logs_20140328.': 'cloudwatch',
  'AWSEvents.': 'eventbridge',
  'AmazonEventBridge.': 'eventbridge',
  'AmazonAthena.': 'athena',
  'RDSDataService.': 'aurora',
  'AWSOrganizationsV20161128.': 'organizations',
  'Kinesis_20131202.': 'kinesis-data-streams',
  'Firehose_20150804.': 'kinesis-firehose',
  'KinesisAnalytics_20180523.': 'kinesis-analytics',
  'com.amazonaws.cloudtrail.v20131101.': 'cloudtrail',
  'StarlingDoveService.': 'config',
  'AmazonSQS.': 'sqs',
  'CertificateManager.': 'acm',
  'AmazonDAXV3.': 'dax',
};

/** R2: nome de escopo da assinatura SigV4 -> servico. */
const SCOPE_SERVICES = {
  s3: 's3',
  sqs: 'sqs',
  sns: 'sns',
  lambda: 'lambda',
  sts: 'sts',
  iam: 'iam',
  ec2: 'ec2',
  elasticloadbalancing: 'alb',
  autoscaling: 'asg',
  rds: 'aurora',
  cloudformation: 'cloudformation',
  'cognito-idp': 'cognito',
  kms: 'kms',
  secretsmanager: 'secret-manager',
  ssm: 'parameter-store',
  events: 'eventbridge',
  kinesis: 'kinesis-data-streams',
  firehose: 'kinesis-firehose',
  kinesisanalytics: 'kinesis-analytics',
  es: 'opensearch',
  route53: 'route53',
  acm: 'acm',
  athena: 'athena',
  organizations: 'organizations',
  dynamodb: 'dynamodb',
  logs: 'cloudwatch',
  monitoring: 'cloudwatch',
  xray: 'xray',
  cloudtrail: 'cloudtrail',
  config: 'config',
  cloudfront: 'cloudfront',
  apigateway: 'apigateway',
  'rds-data': 'aurora',
};

/** R3: Version do protocolo query -> servico. */
const VERSION_SERVICES = {
  '2012-11-05': 'sqs',
  '2010-03-31': 'sns',
  '2011-06-15': 'sts',
  '2010-05-08': 'iam',
  '2016-11-15': 'ec2',
  '2015-12-01': 'alb',
  '2011-01-01': 'asg',
  '2014-10-31': 'aurora',
  '2010-05-15': 'cloudformation',
  '2010-08-01': 'cloudwatch',
};

/** R4: prefixos de caminho -> servico (casam por segmento inteiro). */
const PATH_PREFIXES = [
  { prefix: '/2015-03-31/', service: 'lambda' },
  { prefix: '/2018-10-31/', service: 'lambda' },
  { prefix: '/2020-04-22/', service: 'lambda' },
  { prefix: '/2021-10-31/functions', service: 'lambda' },
  { prefix: '/2013-04-01/', service: 'route53' },
  { prefix: '/restapis', service: 'apigateway' },
  { prefix: '/apis', service: 'apigateway' },
  { prefix: '/apikeys', service: 'apigateway' },
  { prefix: '/usageplans', service: 'apigateway' },
  { prefix: '/domainnames', service: 'apigateway' },
  { prefix: '/vpclinks', service: 'apigateway' },
  { prefix: '/_plugin', service: 'opensearch' },
  { prefix: '/_cat', service: 'opensearch' },
  { prefix: '/_cluster', service: 'opensearch' },
  { prefix: '/_bulk', service: 'opensearch' },
  { prefix: '/queue/', service: 'sqs' },
];

const UNKNOWN_SERVICE = {
  status: 400,
  code: 'UnknownService',
  message:
    'aws-local-simulator: could not route request. No X-Amz-Target, credential scope, Action/Version, or known URL path matched.',
};

const SCOPE_RE = /Credential=[^/,\s]+\/[^/]+\/[^/]+\/([^/,\s]+)\/aws4_request/;
const PRESIGNED_SCOPE_RE = /^[^/]+\/[^/]+\/[^/]+\/([^/]+)\/aws4_request$/;

function splitUrl(rawUrl) {
  const url = String(rawUrl || '/');
  const i = url.indexOf('?');
  return i === -1 ? { path: url, query: '' } : { path: url.slice(0, i), query: url.slice(i + 1) };
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Escopo de servico da assinatura (header ou query presigned). Null se nao houver. */
function signingScope(headers, query) {
  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('AWS4-HMAC-SHA256')) {
    const m = SCOPE_RE.exec(authorization);
    if (m) return m[1];
  }
  const credential = first(query['X-Amz-Credential']);
  if (credential) {
    const m = PRESIGNED_SCOPE_RE.exec(safeDecode(credential));
    if (m) return m[1];
  }
  return null;
}

function isSigned(headers, query) {
  if (typeof headers.authorization === 'string' && headers.authorization.startsWith('AWS4-HMAC-SHA256')) return true;
  return first(query['X-Amz-Algorithm']) !== undefined;
}

function isFormBody(headers) {
  return String(headers['content-type'] || '').toLowerCase().includes('application/x-www-form-urlencoded');
}

/**
 * Diz se a classificacao precisa do corpo de formulario (Action/Version no corpo). Isso so
 * acontece quando nao ha X-Amz-Target, nem escopo reconhecido, nem Action na query.
 */
function needsFormBody(request) {
  const { headers } = request;
  const { query: rawQuery } = splitUrl(request.url);
  const query = querystring.parse(rawQuery);
  if (!isFormBody(headers)) return false;
  if (headers['x-amz-target']) return false;
  const scope = signingScope(headers, query);
  if (scope && SCOPE_SERVICES[scope]) return false;
  return first(query.Action) === undefined;
}

function matchTarget(target) {
  if (!target) return null;
  for (const [prefix, service] of Object.entries(TARGET_PREFIXES)) {
    if (target.startsWith(prefix)) return service;
  }
  return null;
}

function matchPath(path) {
  for (const { prefix, service } of PATH_PREFIXES) {
    const base = prefix.replace(/\/$/, '');
    if (path === base || path.startsWith(base + '/') || (prefix.endsWith('/') && path.startsWith(prefix))) {
      return service;
    }
  }
  return null;
}

/**
 * Classifica uma requisicao.
 * @param {{method: string, url: string, headers: object, form?: object}} request
 *        `form` e o corpo de formulario ja interpretado (so quando needsFormBody e true).
 * @param {{bucketExists?: (name: string) => boolean, apiExists?: (id: string) => boolean}} lookup
 * @returns {{service: string, rule: string} | {service: null, error: object}}
 */
function classify(request, lookup = {}) {
  const headers = request.headers || {};
  const { path, query: rawQuery } = splitUrl(request.url);
  const query = querystring.parse(rawQuery);
  const form = request.form || {};
  const bucketExists = lookup.bucketExists || (() => false);
  const apiExists = lookup.apiExists || (() => false);

  // R1
  const fromTarget = matchTarget(headers['x-amz-target']);
  if (fromTarget) return { service: fromTarget, rule: 'R1' };

  // R2
  const scope = signingScope(headers, query);
  if (scope && SCOPE_SERVICES[scope]) return { service: SCOPE_SERVICES[scope], rule: 'R2' };

  // R3
  const action = first(query.Action) ?? first(form.Action);
  const version = first(query.Version) ?? first(form.Version);
  if (action !== undefined && version !== undefined && VERSION_SERVICES[version]) {
    return { service: VERSION_SERVICES[version], rule: 'R3' };
  }

  // R4
  const fromPath = matchPath(path);
  if (fromPath) return { service: fromPath, rule: 'R4' };

  const segments = path.split('/').filter(Boolean);

  // R5 (sem assinatura e sem target)
  if (!isSigned(headers, query)) {
    if (segments.length >= 1 && bucketExists(segments[0])) {
      return { service: 's3', rule: 'R5a' };
    }
    if (segments.length >= 2 && apiExists(segments[0])) {
      return { service: 'apigateway', rule: 'R5b' };
    }
  }

  // R6 (virtual-hosted)
  const bucket = bucketFromHost(headers.host);
  if (bucket && bucketExists(bucket)) {
    return { service: 's3', rule: 'R6' };
  }

  return { service: null, error: { ...UNKNOWN_SERVICE } };
}

module.exports = {
  classify,
  needsFormBody,
  TARGET_PREFIXES,
  SCOPE_SERVICES,
  VERSION_SERVICES,
  PATH_PREFIXES,
  UNKNOWN_SERVICE,
};
