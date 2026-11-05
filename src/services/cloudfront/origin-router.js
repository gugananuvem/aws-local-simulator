/**
 * CloudFront Origin Router
 * Redireciona requisições para origins reais (API Gateway, EC2/ALB, Lambda, S3, HTTP)
 * Permite que CloudFront funcione como reverse proxy para serviços reais
 */

const http = require('http');
const https = require('https');

class OriginRouter {
  constructor(servicesRegistry = {}) {
    this.servicesRegistry = servicesRegistry;
    this.requestCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Rotear requisição para origin real
   * @param {object} origin - Configuração da origin
   * @param {string} path - Path da requisição
   * @param {object} request - Objeto de requisição
   * @returns {Promise<object>} Response da origin
   */
  async routeToOrigin(origin, path, request = {}) {
    try {
      // Detectar tipo de origin
      const originType = this._detectOriginType(origin);

      switch (originType) {
        case 'apigateway':
          return await this._routeToApiGateway(origin, path, request);
        
        case 'alb':
        case 'ec2':
          return await this._routeToALB(origin, path, request);
        
        case 's3':
          return await this._routeToS3(origin, path, request);
        
        case 'lambda':
          return await this._routeToLambda(origin, path, request);
        
        case 'http':
        default:
          return await this._routeToHttp(origin, path, request);
      }
    } catch (error) {
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Bad Gateway',
          message: `Could not reach origin: ${error.message}`
        }),
        timestamp: new Date().toISOString(),
        originError: true
      };
    }
  }

  /**
   * Registrar serviço para routing
   * @param {string} serviceName - Nome do serviço (apigateway, ec2, etc)
   * @param {object} serviceInstance - Instância do serviço
   */
  registerService(serviceName, serviceInstance) {
    this.servicesRegistry[serviceName] = serviceInstance;
  }

  /**
   * Private Methods
   */

  _detectOriginType(origin) {
    if (!origin) return 'http';

    const domain = origin.DomainName || origin.domainName || '';

    // API Gateway
    if (domain.includes('apigateway') || domain.includes('execute-api')) {
      return 'apigateway';
    }

    // ALB/Load Balancer
    if (domain.includes('elb.amazonaws.com') || 
        domain.includes('alb') ||
        origin.ALBTargetGroup) {
      return 'alb';
    }

    // EC2
    if (domain.includes('ec2') || domain.includes('compute')) {
      return 'ec2';
    }

    // S3
    if (domain.includes('s3.amazonaws.com') || 
        domain.includes('s3-') ||
        origin.S3OriginConfig) {
      return 's3';
    }

    // Lambda
    if (domain.includes('lambda') || domain.startsWith('arn:aws:lambda')) {
      return 'lambda';
    }

    // HTTP/HTTPS
    return 'http';
  }

  /**
   * Rotear para API Gateway
   */
  async _routeToApiGateway(origin, path, request) {
    const apiGateway = this.servicesRegistry.apigateway;
    
    if (!apiGateway) {
      return this._simulatedResponse('API Gateway service not available');
    }

    try {
      const simulator = apiGateway.getSimulator?.() || apiGateway.simulator;
      
      if (!simulator) {
        return this._simulatedResponse('API Gateway simulator not available');
      }

      // Extrair API ID e stage da domain
      // Formato: {api-id}.execute-api.{region}.amazonaws.com/{stage}
      const domain = origin.DomainName || origin.domainName || '';
      const stagePath = (origin.originPath || '') + path;

      // Simular requisição ao API Gateway
      const response = simulator.processRequest?.({
        method: request.method || 'GET',
        path: stagePath,
        headers: request.headers || {},
        body: request.body
      });

      if (response) {
        return {
          status: response.status || 200,
          headers: response.headers || { 'Content-Type': 'application/json' },
          body: response.body || JSON.stringify(response),
          timestamp: new Date().toISOString(),
          origin: 'apigateway',
          originDomain: domain
        };
      }

      return this._simulatedResponse('API Gateway request processed', 200);
    } catch (error) {
      return this._errorResponse(`API Gateway error: ${error.message}`, 502);
    }
  }

  /**
   * Rotear para ALB/EC2
   */
  async _routeToALB(origin, path, request) {
    const ec2Service = this.servicesRegistry.ec2 || this.servicesRegistry.alb;
    
    if (!ec2Service) {
      return this._simulatedResponse('ALB/EC2 service not available');
    }

    try {
      const simulator = ec2Service.getSimulator?.() || ec2Service.simulator;
      
      if (!simulator) {
        return this._simulatedResponse('ALB simulator not available');
      }

      // Processar requisição no ALB
      const fullPath = (origin.OriginPath || origin.originPath || '') + path;

      // Simulação: o ALB roteia para instâncias EC2
      const response = simulator.handleRequest?.({
        method: request.method || 'GET',
        path: fullPath,
        headers: request.headers || {},
        host: origin.DomainName || origin.domainName,
        body: request.body
      });

      if (response) {
        return {
          status: response.status || 200,
          headers: response.headers || { 'Content-Type': 'text/html' },
          body: response.body || 'Response from ALB',
          timestamp: new Date().toISOString(),
          origin: 'alb',
          originDomain: origin.DomainName || origin.domainName
        };
      }

      return this._simulatedResponse('ALB request processed', 200);
    } catch (error) {
      return this._errorResponse(`ALB error: ${error.message}`, 502);
    }
  }

  /**
   * Rotear para S3
   */
  async _routeToS3(origin, path, request) {
    const s3Service = this.servicesRegistry.s3;
    
    if (!s3Service) {
      return this._simulatedResponse('S3 service not available');
    }

    try {
      const simulator = s3Service.getSimulator?.() || s3Service.simulator;
      
      if (!simulator) {
        return this._simulatedResponse('S3 simulator not available');
      }

      // Extrair bucket name da domain
      // Formato: bucket.s3.amazonaws.com ou s3.amazonaws.com/bucket
      const domain = origin.DomainName || origin.domainName || '';
      let bucketName = domain.split('.')[0];
      
      // Se for virtual-hosted style
      if (domain.includes('s3.amazonaws.com')) {
        const pathSegments = path.split('/');
        bucketName = pathSegments[1];
      }

      const objectPath = path.replace(`/${bucketName}`, '');

      // Verificar se CloudFront tem permissão no bucket
      const bucketPolicy = simulator.getBucketPolicy?.(bucketName);
      
      if (bucketPolicy) {
        // Se há política, verificar se permite acesso do CloudFront
        const hasCloudFrontAccess = this._checkS3BucketPolicy(
          bucketPolicy,
          origin,
          request
        );

        if (!hasCloudFrontAccess) {
          return this._errorResponse(
            `Access Denied to S3 bucket: ${bucketName}. CloudFront does not have permission.`,
            403
          );
        }
      }

      // Buscar objeto no S3
      try {
        const object = simulator.getObject(bucketName, objectPath);
        
        if (object && object.error) {
          // Objeto não existe ou bucket não existe
          return this._errorResponse(
            object.error.message,
            object.status || 404
          );
        }

        if (object) {
          return {
            status: 200,
            headers: {
              'Content-Type': object.contentType || 'application/octet-stream',
              'Content-Length': object.size || 0,
              'Last-Modified': object.lastModified || new Date().toUTCString(),
              'ETag': object.etag || ''
            },
            body: object.content,
            timestamp: new Date().toISOString(),
            origin: 's3',
            bucket: bucketName
          };
        }
      } catch (e) {
        // Object not found
      }

      return this._errorResponse('S3 object not found', 404);
    } catch (error) {
      return this._errorResponse(`S3 error: ${error.message}`, 502);
    }
  }

  /**
   * Rotear para Lambda
   */
  async _routeToLambda(origin, path, request) {
    const lambdaService = this.servicesRegistry.lambda;
    
    if (!lambdaService) {
      return this._simulatedResponse('Lambda service not available');
    }

    try {
      const simulator = lambdaService.getSimulator?.() || lambdaService.simulator;
      
      if (!simulator) {
        return this._simulatedResponse('Lambda simulator not available');
      }

      // Invocar função Lambda
      const functionName = this._extractLambdaFunctionName(origin);

      if (!functionName) {
        return this._errorResponse('Invalid Lambda function name', 400);
      }

      // Preparar payload
      const payload = {
        path: path,
        method: request.method || 'GET',
        headers: request.headers || {},
        body: request.body,
        queryStringParameters: this._parseQueryString(path)
      };

      // Invocar Lambda
      const response = await simulator.invoke(functionName, payload);

      if (response) {
        return {
          status: response.statusCode || 200,
          headers: response.headers || { 'Content-Type': 'application/json' },
          body: response.body,
          timestamp: new Date().toISOString(),
          origin: 'lambda',
          function: functionName
        };
      }

      return this._simulatedResponse('Lambda invocation processed', 200);
    } catch (error) {
      return this._errorResponse(`Lambda error: ${error.message}`, 502);
    }
  }

  /**
   * Rotear para HTTP/HTTPS externo
   */
  async _routeToHttp(origin, path, request) {
    return new Promise((resolve, reject) => {
      try {
        const domain = origin.DomainName || origin.domainName || '';
        const protocol = origin.CustomOriginConfig?.OriginProtocolPolicy?.includes('https') || domain.includes('https') 
          ? 'https' 
          : 'http';

        const fullPath = (origin.OriginPath || origin.originPath || '') + path;
        const url = new URL(`${protocol}://${domain}${fullPath}`);

        const client = protocol === 'https' ? https : http;

        const options = {
          hostname: url.hostname,
          port: url.port || (protocol === 'https' ? 443 : 80),
          path: url.pathname + url.search,
          method: request.method || 'GET',
          headers: {
            'Host': domain,
            ...request.headers
          },
          timeout: 5000
        };

        const req = client.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            resolve({
              status: res.statusCode || 200,
              headers: res.headers || {},
              body: data,
              timestamp: new Date().toISOString(),
              origin: 'http',
              originDomain: domain
            });
          });
        });

        req.on('error', (error) => {
          reject(new Error(`HTTP request failed: ${error.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('HTTP request timeout'));
        });

        if (request.body) {
          req.write(request.body);
        }

        req.end();
      } catch (error) {
        reject(error);
      }
    }).catch(error => {
      return this._errorResponse(`HTTP error: ${error.message}`, 502);
    });
  }

  /**
   * Utility Methods
   */

  _extractLambdaFunctionName(origin) {
    const domain = origin.DomainName || origin.domainName || '';
    
    // ARN format: arn:aws:lambda:region:account:function:name:version
    if (domain.startsWith('arn:aws:lambda')) {
      const parts = domain.split(':');
      return parts[6] || parts[5];
    }

    // Simple function name
    return domain.split('.')[0];
  }

  _parseQueryString(path) {
    const [, queryString] = path.split('?');
    if (!queryString) return null;

    const params = {};
    queryString.split('&').forEach(param => {
      const [key, value] = param.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });

    return params;
  }

  _simulatedResponse(message, status = 200) {
    return {
      status: status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      timestamp: new Date().toISOString(),
      simulated: true
    };
  }

  _errorResponse(message, status = 500) {
    return {
      status: status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
      timestamp: new Date().toISOString(),
      error: true
    };
  }

  /**
   * Verificar se CloudFront tem acesso ao bucket S3
   * Valida a bucket policy para permitir CloudFront
   */
  _checkS3BucketPolicy(bucketPolicy, origin, request) {
    if (!bucketPolicy) {
      return true; // Sem política = bucket público
    }

    try {
      // Padrão típico de CloudFront no S3
      const policyString = typeof bucketPolicy === 'string' 
        ? bucketPolicy 
        : JSON.stringify(bucketPolicy);

      const policy = typeof bucketPolicy === 'string'
        ? JSON.parse(policyString)
        : bucketPolicy;

      if (!policy.Statement || !Array.isArray(policy.Statement)) {
        return false; // Policy inválida
      }

      // Verificar se há permissão para GetObject
      for (const statement of policy.Statement) {
        // Verificar Effect
        if (statement.Effect !== 'Allow') {
          continue;
        }

        // Verificar Action
        const actions = Array.isArray(statement.Action) 
          ? statement.Action 
          : [statement.Action];
        
        const hasGetObject = actions.includes('s3:GetObject') || 
                            actions.includes('s3:*') ||
                            actions.includes('*');
        
        if (!hasGetObject) {
          continue;
        }

        // Verificar Principal (CloudFront pode ser identificado por ARN ou service)
        const principal = statement.Principal;
        if (!principal) {
          continue;
        }

        // Principal "*" = público
        if (principal === '*') {
          return true;
        }

        // CloudFront Service Principal
        if (principal === 'cloudfront.amazonaws.com' || 
            (principal.Service && principal.Service === 'cloudfront.amazonaws.com')) {
          return true;
        }

        // Origin Access Identity (OAI)
        if (origin.S3OriginConfig?.OriginAccessIdentity) {
          const oaiArn = `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/${origin.S3OriginConfig.OriginAccessIdentity.split('/').pop()}`;
          
          const principalArns = Array.isArray(principal.AWS) 
            ? principal.AWS 
            : (principal.AWS ? [principal.AWS] : []);
          
          if (principalArns.includes(oaiArn) || principalArns.includes('*')) {
            return true;
          }
        }

        // Service Principal format
        if (principal.Service && 
            (principal.Service === 'cloudfront.amazonaws.com' || principal.Service === '*')) {
          return true;
        }
      }

      // Nenhum statement permitiu
      return false;
    } catch (error) {
      // Se não conseguir validar, denegar por segurança
      return false;
    }
  }
}

module.exports = OriginRouter;
