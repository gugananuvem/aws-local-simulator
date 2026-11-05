/**
 * EBS Lifecycle Manager (DLM) Policy Model
 * Representa uma política de ciclo de vida de snapshots do EBS.
 */

const { v4: uuidv4 } = require('uuid');

class LifecyclePolicy {
  constructor(config = {}) {
    this.PolicyId = `policy-${uuidv4().substring(0, 8)}`;
    this.Description = config.Description || '';
    this.State = config.State || 'ENABLED'; // ENABLED, DISABLED, ERROR, DELETING
    this.ExecutionRoleArn =
      config.ExecutionRoleArn || 'arn:aws:iam::123456789012:role/service-role/AWSDataLifecycleManagerDefaultRole';
    this.ResourceType = config.ResourceType || 'VOLUME'; // VOLUME, INSTANCE
    this.PolicyType = config.PolicyType || 'EBS_SNAPSHOT_MANAGEMENT';
    this.ResourceLocations = config.ResourceLocations || ['TAG'];
    this.TargetTags = config.TargetTags || [];
    this.Schedules = config.Schedules || [LifecyclePolicy.defaultSchedule()];
    this.DateCreated = new Date().toISOString();
    this.DateModified = this.DateCreated;
    this.Tags = config.Tags || [];
  }

  static defaultSchedule() {
    return {
      Name: 'Daily Snapshots',
      CreateRule: {
        Interval: 24,
        IntervalUnit: 'HOURS',
        Times: ['03:00']
      },
      RetainRule: {
        Count: 7
      },
      CopyTags: true
    };
  }

  enable() {
    this.State = 'ENABLED';
    this.DateModified = new Date().toISOString();
  }

  disable() {
    this.State = 'DISABLED';
    this.DateModified = new Date().toISOString();
  }

  toJSON() {
    return {
      PolicyId: this.PolicyId,
      Description: this.Description,
      State: this.State,
      ExecutionRoleArn: this.ExecutionRoleArn,
      ResourceType: this.ResourceType,
      PolicyType: this.PolicyType,
      ResourceLocations: this.ResourceLocations,
      TargetTags: this.TargetTags,
      Schedules: this.Schedules,
      DateCreated: this.DateCreated,
      DateModified: this.DateModified,
      Tags: this.Tags
    };
  }
}

module.exports = { LifecyclePolicy };
