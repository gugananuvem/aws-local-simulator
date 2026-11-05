/**
 * Middleware Index
 * 
 * Exporta todos os middlewares para fácil integração nos serviços
 */

const AuthorizationMiddleware = require('./authorization');
const PolicyEnforcementMiddleware = require('./policy-enforcement');
const ErrorHandlerMiddleware = require('./error-handler');
const CloudTrailLoggerMiddleware = require('./cloudtrail-logger');

/**
 * Factory para criar middlewares configurados
 */
class MiddlewareFactory {
  static createAuthorizationMiddleware(organizationsService, stsService) {
    const auth = new AuthorizationMiddleware(organizationsService, stsService);
    return auth.middleware();
  }

  static createPolicyEnforcementMiddleware(organizationsService, service = 'unknown') {
    const enforcement = new PolicyEnforcementMiddleware(organizationsService);
    return enforcement.middleware(service);
  }

  static createErrorHandler() {
    return ErrorHandlerMiddleware.errorHandler();
  }

  static createNotFoundHandler() {
    return ErrorHandlerMiddleware.notFound();
  }

  static createRequestIdMiddleware() {
    return ErrorHandlerMiddleware.requestIdMiddleware();
  }

  static asyncHandler(fn) {
    return ErrorHandlerMiddleware.asyncHandler(fn);
  }

  static createError(code, message, statusCode = 400) {
    return ErrorHandlerMiddleware.createError(code, message, statusCode);
  }
}

/**
 * Setup padrão para um serviço
 * Registra middlewares na ordem correta
 */
function setupServiceMiddleware(app, organizationsService, stsService, serviceName = 'unknown') {
  // 1. RequestId (primeiro, para tracking)
  app.use(ErrorHandlerMiddleware.requestIdMiddleware());

  // 2. Authorization (extrair principal)
  app.use(MiddlewareFactory.createAuthorizationMiddleware(organizationsService, stsService));

  // 3. Policy Enforcement (validar SCP + IAM)
  app.use(MiddlewareFactory.createPolicyEnforcementMiddleware(organizationsService, serviceName));

  // 4. CloudTrail Logging (logar eventos permitidos e negados)
  const cloudtrailService = organizationsService?.organizationsSimulator?.server?.app?.locals?.cloudtrailService;
  if (cloudtrailService) {
    const cloudtrailLogger = new CloudTrailLoggerMiddleware(cloudtrailService);
    app.use(cloudtrailLogger.middleware(serviceName));
  }

  // 5. Error handler (último)
  app.use(ErrorHandlerMiddleware.errorHandler());
}

module.exports = {
  AuthorizationMiddleware,
  PolicyEnforcementMiddleware,
  ErrorHandlerMiddleware,
  CloudTrailLoggerMiddleware,
  MiddlewareFactory,
  setupServiceMiddleware
};
