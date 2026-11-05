/**
 * AWS Organizations Models
 */

const Organization = require('./organization');
const ServiceControlPolicy = require('./scp');
const OrganizationRole = require('./role');

module.exports = {
  Organization,
  ServiceControlPolicy,
  OrganizationRole
};
