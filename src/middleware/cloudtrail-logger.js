/**
 * CloudTrail Logger Middleware
 * 
 * Loga todos os acessos (permitidos e negados) em CloudTrail
 * para auditoria e compliance
 */

const logger = require('../utils/logger');

class CloudTrailLoggerMiddleware {
  constructor(cloudtrailService) {
    this.cloudtrailService = cloudtrailService;
  }

  /**
   * Middleware para logar eventos no CloudTrail
   */
  middleware(serviceName = 'unknown') {
    return async (req, res, next) => {
      try {
        // Interceptar resposta para capturar status
        const originalJson = res.json;
        const originalSend = res.send;

        let responseData = null;
        let responseStatus = res.statusCode;

        res.json = function(data) {
          responseData = data;
          responseStatus = res.statusCode;
          return originalJson.call(this, data);
        };

        res.send = function(data) {
          responseData = data;
          responseStatus = res.statusCode;
          return originalSend.call(this, data);
        };

        // Logar após resposta ser enviada
        res.on('finish', async () => {
          try {
            await this.logToCloudTrail(
              req,
              responseStatus,
              serviceName,
              responseData
            );
          } catch (error) {
            logger.debug('Error logging to CloudTrail:', error.message);
          }
        });

        next();
      } catch (error) {
        logger.error('CloudTrail logger error:', error.message);
        next();
      }
    };
  }

  /**
   * Registrar evento no CloudTrail
   */
  async logToCloudTrail(req, statusCode, serviceName, responseData) {
    try {
      if (!this.cloudtrailService || !this.cloudtrailService.simulador) {
        return;
      }

      // Extrair informações do request
      const {
        method,
        path,
        headers,
        body,
        principal,
        accountId,
        roleArn,
        policyDecision
      } = req;

      const eventName = this.mapRequestToEventName(method, path, serviceName);
      const resourceName = this.mapPathToResourceName(path);
      const sourceIPAddress = this.getSourceIP(req);

      // Determinar sucesso/falha
      const isSuccess = statusCode >= 200 && statusCode < 400;
      const isAccessDenied = statusCode === 403;

      // Construir evento CloudTrail
      const event = {
        eventTime: new Date(),
        eventName,
        eventSource: `${serviceName}.amazonaws.com`,
        awsRegion: headers['x-amz-target']?.split('.')[0] || 'us-east-1',
        sourceIPAddress,
        userAgent: headers['user-agent'] || 'AWS-CLI',
        userIdentity: {
          type: principal?.type || 'Unknown',
          principalId: principal?.roleArn || principal?.credentials?.accessKeyId || 'Unknown',
          arn: roleArn || 'Unknown',
          accountId: accountId || 'Unknown',
          invokedBy: principal?.sessionName || 'Unknown',
          accessKeyId: principal?.credentials?.accessKeyId || 'Unknown',
          sessionContext: {
            attributes: {
              mfaAuthenticated: !!principal?.credentials?.sessionToken,
              creationDate: principal?.issuedAt
            },
            sessionIssuer: {
              type: 'Role',
              principalId: roleArn || 'Unknown',
              arn: roleArn || 'Unknown',
              accountId: accountId || 'Unknown',
              userName: principal?.sessionName || 'Unknown'
            }
          }
        },
        requestParameters: {
          method,
          path,
          resourceName,
          ...this.extractRequestParams(body)
        },
        responseElements: isAccessDenied ? null : this.extractResponseElements(responseData),
        additionalEventData: {
          x_amzn_requestId: req.requestId,
          principalOrgId: accountId,
          policyDecision: policyDecision || null
        },
        requestId: req.requestId,
        eventId: this.generateEventId(),
        resources: [
          {
            arn: this.constructResourceARN(serviceName, resourceName, accountId),
            accountId,
            type: this.mapServiceToResourceType(serviceName)
          }
        ],
        eventType: 'AwsApiCall',
        recipientAccountId: accountId || 'Unknown',
        sharedEventID: this.generateEventId(),
        vpcEndpointId: null
      };

      // Logar resultado
      if (isSuccess) {
        event.requestStatus = 'Success';
        logger.debug(`CloudTrail: ${eventName} - SUCCESS`, {
          principal: roleArn,
          resource: resourceName,
          account: accountId
        });
      } else if (isAccessDenied) {
        event.requestStatus = 'AccessDenied';
        event.errorCode = 'AccessDenied';
        event.errorMessage = policyDecision?.message || 'User is not authorized';
        logger.debug(`CloudTrail: ${eventName} - ACCESS DENIED`, {
          principal: roleArn,
          deniedBy: policyDecision?.deniedBy,
          resource: resourceName
        });
      } else {
        event.requestStatus = 'Failure';
        event.errorCode = this.mapStatusToErrorCode(statusCode);
        logger.debug(`CloudTrail: ${eventName} - FAILURE (${statusCode})`, {
          principal: roleArn,
          resource: resourceName
        });
      }

      // Registrar no CloudTrail
      this.cloudtrailService.simulador.recordEvent(event);
    } catch (error) {
      logger.debug('Error constructing CloudTrail event:', error.message);
    }
  }

  /**
   * Mapear HTTP method + path → CloudTrail event name
   */
  mapRequestToEventName(method, path, serviceName) {
    const pathParts = path.toLowerCase().split('/').filter(p => p);
    const resource = pathParts[0] || 'unknown';

    const methodMap = {
      POST: 'Create',
      PUT: 'Put',
      GET: 'Get',
      DELETE: 'Delete',
      PATCH: 'Update',
      HEAD: 'Head'
    };

    const verb = methodMap[method] || 'Invoke';
    const resourceName = resource.charAt(0).toUpperCase() + resource.slice(1, -1);

    return `${verb}${resourceName}`;
  }

  /**
   * Extrair nome do recurso do path
   */
  mapPathToResourceName(path) {
    const parts = path.split('/').filter(p => p && p !== '__admin');
    return parts[0] || 'resource';
  }

  /**
   * Obter IP de origem
   */
  getSourceIP(req) {
    return (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Extrair parâmetros do request
   */
  extractRequestParams(body) {
    if (!body) return {};

    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (e) {
        return { rawBody: body.substring(0, 100) };
      }
    }

    if (typeof body === 'object') {
      return body;
    }

    return {};
  }

  /**
   * Extrair elementos da resposta (sem dados sensíveis)
   */
  extractResponseElements(data) {
    if (!data) return null;

    if (typeof data === 'object') {
      return {
        ...data,
        // Remover dados sensíveis
        SecretAccessKey: '***',
        Password: '***',
        PrivateKey: '***'
      };
    }

    return null;
  }

  /**
   * Construir ARN do recurso
   */
  constructResourceARN(serviceName, resourceName, accountId) {
    const account = accountId || '*';
    const region = '*';

    switch (serviceName) {
      case 's3':
        return `arn:aws:s3:::${resourceName}`;
      case 'sqs':
        return `arn:aws:sqs:${region}:${account}:${resourceName}`;
      case 'sns':
        return `arn:aws:sns:${region}:${account}:${resourceName}`;
      case 'dynamodb':
        return `arn:aws:dynamodb:${region}:${account}:table/${resourceName}`;
      case 'lambda':
        return `arn:aws:lambda:${region}:${account}:function:${resourceName}`;
      case 'kms':
        return `arn:aws:kms:${region}:${account}:key/${resourceName}`;
      case 'ec2':
        return `arn:aws:ec2:${region}:${account}:${resourceName}/*`;
      default:
        return `arn:aws:${serviceName}:${region}:${account}:${resourceName}`;
    }
  }

  /**
   * Mapear service → resource type do CloudTrail
   */
  mapServiceToResourceType(serviceName) {
    const typeMap = {
      s3: 'AWS::S3::Bucket',
      sqs: 'AWS::SQS::Queue',
      sns: 'AWS::SNS::Topic',
      dynamodb: 'AWS::DynamoDB::Table',
      lambda: 'AWS::Lambda::Function',
      kms: 'AWS::KMS::Key',
      ec2: 'AWS::EC2::Instance',
      iam: 'AWS::IAM::Role',
      sts: 'AWS::STS::AssumedRole'
    };

    return typeMap[serviceName] || 'AWS::Unknown::Resource';
  }

  /**
   * Mapear HTTP status → CloudTrail error code
   */
  mapStatusToErrorCode(statusCode) {
    const codeMap = {
      400: 'BadRequest',
      401: 'Unauthorized',
      403: 'AccessDenied',
      404: 'NotFound',
      409: 'Conflict',
      429: 'ThrottlingException',
      500: 'InternalError',
      503: 'ServiceUnavailable'
    };

    return codeMap[statusCode] || 'UnknownError';
  }

  /**
   * Gerar ID único para evento
   */
  generateEventId() {
    return require('crypto').randomUUID();
  }
}

module.exports = CloudTrailLoggerMiddleware;
