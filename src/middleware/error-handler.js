/**
 * Error Handler Middleware
 * 
 * Formata erros no padrão AWS
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

class ErrorHandlerMiddleware {
  /**
   * Middleware Express para tratamento de erros
   */
  static errorHandler() {
    return (err, req, res, next) => {
      const requestId = req.requestId || ErrorHandlerMiddleware.generateRequestId();

      logger.error('Request error:', {
        requestId,
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
      });

      // Se já foi enviada resposta, não fazer nada
      if (res.headersSent) {
        return next(err);
      }

      // Erro de autorização
      if (err.code === 'AccessDenied' || err.statusCode === 403) {
        return res.status(403).json({
          code: 'AccessDenied',
          message: err.message || 'Access Denied',
          requestId
        });
      }

      // Erro de validação
      if (err.code === 'ValidationException' || err.statusCode === 400) {
        return res.status(400).json({
          code: 'ValidationException',
          message: err.message || 'Invalid request',
          requestId
        });
      }

      // Erro de recurso não encontrado
      if (err.code === 'NotFound' || err.statusCode === 404) {
        return res.status(404).json({
          code: 'NotFound',
          message: err.message || 'Resource not found',
          requestId
        });
      }

      // Erro de conflito
      if (err.code === 'ConflictException' || err.statusCode === 409) {
        return res.status(409).json({
          code: 'ConflictException',
          message: err.message || 'Resource already exists',
          requestId
        });
      }

      // Erro interno
      if (err.statusCode === 500 || !err.statusCode) {
        return res.status(500).json({
          code: 'InternalError',
          message: 'Internal server error',
          requestId
        });
      }

      // Erro genérico
      res.status(err.statusCode || 500).json({
        code: err.code || 'UnknownError',
        message: err.message || 'An error occurred',
        requestId
      });
    };
  }

  /**
   * Middleware para capturar rotas não encontradas
   */
  static notFound() {
    return (req, res) => {
      const requestId = ErrorHandlerMiddleware.generateRequestId();

      res.status(404).json({
        code: 'NotFound',
        message: `${req.method} ${req.path} not found`,
        requestId
      });
    };
  }

  /**
   * Gera request ID único
   */
  static generateRequestId() {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  /**
   * Middleware para adicionar requestId em cada requisição
   */
  static requestIdMiddleware() {
    return (req, res, next) => {
      req.requestId = ErrorHandlerMiddleware.generateRequestId();
      res.set('X-Amz-Request-Id', req.requestId);
      next();
    };
  }

  /**
   * Wrapper para async route handlers (catch errors automaticamente)
   */
  static asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }

  /**
   * Criar erro no formato AWS
   */
  static createError(code, message, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
  }
}

module.exports = ErrorHandlerMiddleware;
