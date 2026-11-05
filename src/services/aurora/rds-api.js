'use strict';

/**
 * RDS Management API Handler - Simula operações de gerenciamento RDS
 * (CreateDBCluster, DeleteDBCluster, DescribeDBClusters, CreateDBInstance,
 *  DeleteDBInstance, DescribeDBInstances, ModifyDBCluster, StopDBCluster, StartDBCluster)
 */

const logger = require('../../utils/logger');

class RdsApiHandler {
  constructor(clusterManager, dbEngine, log) {
    this.clusterManager = clusterManager;
    this.dbEngine = dbEngine;
    this.logger = log || logger;

    // Optional service dependencies (injected later)
    this.kmsService = null;
    this.cloudTrailService = null;
  }

  /**
   * Routes an incoming RDS API action to the appropriate handler method.
   * @param {string} action - The RDS API action name
   * @param {Object} body - The request body/parameters
   * @returns {Object} The response object
   */
  async handleRequest(action, body) {
    switch (action) {
      case 'CreateDBCluster': return this.createDBCluster(body);
      case 'DeleteDBCluster': return this.deleteDBCluster(body);
      case 'DescribeDBClusters': return this.describeDBClusters(body);
      case 'CreateDBInstance': return this.createDBInstance(body);
      case 'DeleteDBInstance': return this.deleteDBInstance(body);
      case 'DescribeDBInstances': return this.describeDBInstances(body);
      case 'ModifyDBCluster': return this.modifyDBCluster(body);
      case 'StopDBCluster': return this.stopDBCluster(body);
      case 'StartDBCluster': return this.startDBCluster(body);
      default: {
        const error = new Error(`Unknown action: ${action}`);
        error.code = 'InvalidAction';
        error.statusCode = 400;
        throw error;
      }
    }
  }

  /**
   * Creates a new Aurora DB cluster.
   * Validates KMS key if StorageEncrypted, creates logical database if DatabaseName provided.
   * Records CloudTrail event.
   */
  async createDBCluster(params) {
    // Validate KMS key if StorageEncrypted and KmsKeyId provided
    if (params.StorageEncrypted && params.KmsKeyId && this.kmsService) {
      try {
        await this.kmsService.describeKey({ KeyId: params.KmsKeyId });
      } catch (err) {
        const error = new Error(`KMS key not found or invalid: ${params.KmsKeyId}`);
        error.code = 'InvalidParameterValue';
        error.statusCode = 400;
        throw error;
      }
    }

    // Create via ClusterManager (handles all validation)
    const cluster = this.clusterManager.createCluster(params);

    // If DatabaseName is provided, ensure the database exists in DbEngine
    if (params.DatabaseName && this.dbEngine) {
      this.dbEngine.getOrCreateDatabase(params.DatabaseName);
    }

    // Record CloudTrail event
    this._recordEvent('CreateDBCluster', params.DBClusterIdentifier);

    return { DBCluster: cluster };
  }

  /**
   * Deletes an existing Aurora DB cluster.
   * Throws DBClusterNotFoundFault if cluster does not exist.
   */
  async deleteDBCluster(params) {
    const { DBClusterIdentifier } = params;
    this.clusterManager.deleteCluster(DBClusterIdentifier);
    this._recordEvent('DeleteDBCluster', DBClusterIdentifier);
    return {};
  }

  /**
   * Describes one or all Aurora DB clusters.
   * Returns all clusters when no filter, or a specific one by DBClusterIdentifier.
   */
  async describeDBClusters(params) {
    const { DBClusterIdentifier } = params || {};
    const filters = DBClusterIdentifier ? { DBClusterIdentifier } : undefined;
    const clusters = this.clusterManager.listClusters(filters);
    return { DBClusters: clusters };
  }

  /**
   * Creates a new Aurora DB instance within an existing cluster.
   * Records CloudTrail event.
   */
  async createDBInstance(params) {
    const instance = this.clusterManager.createInstance(params);
    this._recordEvent('CreateDBInstance', params.DBInstanceIdentifier);
    return { DBInstance: instance };
  }

  /**
   * Deletes an existing Aurora DB instance.
   * Throws DBInstanceNotFoundFault if instance does not exist.
   */
  async deleteDBInstance(params) {
    const { DBInstanceIdentifier } = params;
    this.clusterManager.deleteInstance(DBInstanceIdentifier);
    this._recordEvent('DeleteDBInstance', DBInstanceIdentifier);
    return {};
  }

  /**
   * Describes one or all Aurora DB instances.
   * Returns all instances when no filter, or a specific one by DBInstanceIdentifier.
   */
  async describeDBInstances(params) {
    const { DBInstanceIdentifier } = params || {};
    const filters = DBInstanceIdentifier ? { DBInstanceIdentifier } : undefined;
    const instances = this.clusterManager.listInstances(filters);
    return { DBInstances: instances };
  }

  /**
   * Modifies an existing Aurora DB cluster's fields.
   * Records CloudTrail event.
   */
  async modifyDBCluster(params) {
    const { DBClusterIdentifier, ...fields } = params;
    const cluster = this.clusterManager.updateCluster(DBClusterIdentifier, fields);
    this._recordEvent('ModifyDBCluster', DBClusterIdentifier);
    return { DBCluster: cluster };
  }

  /**
   * Stops an Aurora DB cluster (changes status to 'stopped').
   * Records CloudTrail event.
   */
  async stopDBCluster(params) {
    const { DBClusterIdentifier } = params;
    const cluster = this.clusterManager.updateCluster(DBClusterIdentifier, { Status: 'stopped' });
    this._recordEvent('StopDBCluster', DBClusterIdentifier);
    return { DBCluster: cluster };
  }

  /**
   * Starts a stopped Aurora DB cluster (changes status to 'available').
   * Records CloudTrail event.
   */
  async startDBCluster(params) {
    const { DBClusterIdentifier } = params;
    const cluster = this.clusterManager.updateCluster(DBClusterIdentifier, { Status: 'available' });
    this._recordEvent('StartDBCluster', DBClusterIdentifier);
    return { DBCluster: cluster };
  }

  /**
   * Records a CloudTrail event for an RDS Management API operation.
   * Silently fails if CloudTrail service is unavailable or throws.
   * @private
   */
  _recordEvent(eventName, resourceId) {
    if (this.cloudTrailService) {
      try {
        this.cloudTrailService.recordEvent({
          eventSource: 'rds.amazonaws.com',
          eventName,
          resources: [{ ResourceType: 'AWS::RDS::DBCluster', ResourceName: resourceId || 'unknown' }],
          requestParameters: { dBClusterIdentifier: resourceId || 'unknown' }
        });
      } catch (e) {
        // Don't fail the request if CloudTrail recording fails
        this.logger.debug(`[Aurora RdsApiHandler] CloudTrail recording failed: ${e.message}`);
      }
    }
  }
}

module.exports = { RdsApiHandler };
