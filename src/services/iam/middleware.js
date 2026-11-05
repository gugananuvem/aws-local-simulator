'use strict';

/**
 * Extracts AWS AccessKeyId from the request.
 * Checks Authorization header (AWS Signature V4) and fallback to query params.
 *
 * @param {object} req - Express request object
 * @returns {string|null} The extracted AccessKeyId or null if not found
 */
function extractCredentials(req) {
  // Check Authorization header: AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ...
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('AWS4-HMAC-SHA256')) {
    const credMatch = authHeader.match(/Credential=([A-Z0-9]+)\//);
    if (credMatch) return credMatch[1];
  }

  // Fallback: X-Amz-Credential query parameter (presigned URLs)
  const xAmzCredential = req.query && req.query['X-Amz-Credential'];
  if (xAmzCredential) {
    const parts = xAmzCredential.split('/');
    if (parts.length > 0) return parts[0];
  }

  // Fallback: AWSAccessKeyId query parameter (older signature versions)
  if (req.query && req.query['AWSAccessKeyId']) {
    return req.query['AWSAccessKeyId'];
  }

  return null;
}

/**
 * Creates an IAM enforcement middleware for a specific AWS service.
 *
 * @param {object} options
 * @param {object} options.iamSimulator - Reference to IAM simulator instance
 * @param {string} options.servicePrefix - IAM action prefix (e.g., 'sqs', 'sns', 'lambda', 's3')
 * @param {function} options.extractAction - (req) => string - extracts AWS action name from request
 * @param {function} options.extractResource - (req) => string - builds resource ARN from request
 * @param {function} [options.extractConditionContext] - (req) => object - additional condition context keys
 * @param {function} options.formatError - (res, code, message) => void - formats service-specific error response
 * @returns {function} Express middleware function
 */
function createIAMEnforcementMiddleware(options) {
  const {
    iamSimulator,
    servicePrefix,
    extractAction,
    extractResource,
    extractConditionContext,
    formatError
  } = options;

  return (req, res, next) => {
    // 1. Extract credentials from Authorization header or query parameters
    const accessKeyId = extractCredentials(req);

    // 2. If no credentials present → 403 AccessDenied
    if (!accessKeyId) {
      return formatError(res, 'AccessDenied', 'Missing authentication token');
    }

    // 3. Resolve identity via IAM service
    const identity = iamSimulator.resolveIdentity(accessKeyId);
    if (!identity) {
      return formatError(res, 'AccessDenied', 'The security token included in the request is invalid');
    }

    // 4. Build evaluation context
    const action = `${servicePrefix}:${extractAction(req)}`;
    const resource = extractResource(req);
    const context = {
      'aws:SourceIp': req.ip || req.connection?.remoteAddress || '127.0.0.1',
      'aws:CurrentTime': new Date().toISOString(),
      'aws:EpochTime': Math.floor(Date.now() / 1000).toString(),
      ...(extractConditionContext ? extractConditionContext(req) : {})
    };

    // 5. Evaluate access using the policy engine
    const decision = iamSimulator.evaluateAccess({
      accessKeyId,
      action,
      resource,
      context
    });

    // 6. Deny → 403, Allow → set identity and call next()
    if (decision === 'Deny') {
      return formatError(res, 'AccessDenied',
        `User is not authorized to perform: ${action} on resource: ${resource}`);
    }

    req.iamIdentity = identity;
    next();
  };
}

module.exports = { createIAMEnforcementMiddleware, extractCredentials };
