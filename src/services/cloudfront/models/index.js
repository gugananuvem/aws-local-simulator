/**
 * CloudFront Models Index
 */

const Distribution = require('./distribution');
const Origin = require('./origin');
const Behavior = require('./behavior');
const Invalidation = require('./invalidation');

/**
 * Validate a distribution configuration
 * @param {object} config - Configuration to validate
 * @returns {object} Validation result
 */
function validate(config) {
  const errors = [];
  const warnings = [];

  // Check required fields
  if (!config.Origins || !Array.isArray(config.Origins) || config.Origins.length === 0) {
    errors.push('Configuration must have at least one origin');
  }

  if (!config.DefaultCacheBehavior) {
    errors.push('Configuration must have DefaultCacheBehavior');
  }

  if (!config.CallerReference) {
    errors.push('Configuration must have CallerReference');
  }

  // Check behavior configuration
  if (config.DefaultCacheBehavior) {
    const behavior = config.DefaultCacheBehavior;
    
    if (!behavior.TargetOriginId) {
      errors.push('DefaultCacheBehavior must have TargetOriginId');
    }

    if (!behavior.ViewerProtocolPolicy) {
      errors.push('DefaultCacheBehavior must have ViewerProtocolPolicy');
    }

    const validPolicies = ['allow-all', 'https-only', 'redirect-to-https'];
    if (behavior.ViewerProtocolPolicy && !validPolicies.includes(behavior.ViewerProtocolPolicy)) {
      errors.push(
        `Invalid ViewerProtocolPolicy: ${behavior.ViewerProtocolPolicy}`
      );
    }
  }

  // Check cache behaviors if present
  if (config.CacheBehaviors && Array.isArray(config.CacheBehaviors)) {
    for (let i = 0; i < config.CacheBehaviors.length; i++) {
      const behavior = config.CacheBehaviors[i];
      
      if (!behavior.PathPattern) {
        errors.push(`CacheBehavior ${i} must have PathPattern`);
      }

      if (!behavior.TargetOriginId) {
        errors.push(`CacheBehavior ${i} must have TargetOriginId`);
      }
    }
  }

  // Check geo-restrictions if present
  if (config.GeoRestriction) {
    const validTypes = ['none', 'whitelist', 'blacklist'];
    if (!validTypes.includes(config.GeoRestriction.RestrictionType)) {
      errors.push(
        `Invalid GeoRestriction type: ${config.GeoRestriction.RestrictionType}`
      );
    }
  }

  // Warnings for best practices
  if (!config.Comment) {
    warnings.push('It is recommended to provide a comment for the distribution');
  }

  if (config.Logging?.Enabled && !config.Logging?.Bucket) {
    errors.push('Logging is enabled but no bucket is specified');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

module.exports = {
  Distribution,
  Origin,
  Behavior,
  Invalidation,
  validate
};
