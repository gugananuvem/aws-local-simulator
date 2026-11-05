/**
 * Scaling Policy Model - Política de escalamento automático
 */

const { v4: uuid } = require('uuid');

class ScalingPolicy {
  constructor(name, asgName, policyType, config = {}) {
    this.PolicyName = name;
    this.AutoScalingGroupName = asgName;
    this.PolicyARN = `arn:aws:autoscaling:us-east-1:123456789012:scalingPolicy:${uuid()}:autoScalingGroupName/${asgName}:policyName/${name}`;
    this.PolicyType = policyType; // 'TargetTrackingScaling', 'StepScaling', 'SimpleScaling'
    
    // Target Tracking
    this.TargetValue = config.targetValue || null;
    this.PredefinedMetricSpecification = config.predefinedMetricSpecification || {
      PredefinedMetricType: 'ASGAverageCPUUtilization'
    };
    this.ScaleOutCooldown = config.scaleOutCooldown || 300;
    this.ScaleInCooldown = config.scaleInCooldown || 300;

    // Step Scaling
    this.AdjustmentType = config.adjustmentType || 'ChangeInCapacity';
    this.MetricAggregationType = config.metricAggregationType || 'Average';
    this.StepAdjustments = config.stepAdjustments || [];

    // Common
    this.Enabled = config.enabled !== false;
    this.CreationTime = new Date();
  }

  toJSON() {
    return {
      PolicyName: this.PolicyName,
      AutoScalingGroupName: this.AutoScalingGroupName,
      PolicyARN: this.PolicyARN,
      PolicyType: this.PolicyType,
      TargetValue: this.TargetValue,
      PredefinedMetricSpecification: this.PredefinedMetricSpecification,
      ScaleOutCooldown: this.ScaleOutCooldown,
      ScaleInCooldown: this.ScaleInCooldown,
      AdjustmentType: this.AdjustmentType,
      MetricAggregationType: this.MetricAggregationType,
      StepAdjustments: this.StepAdjustments,
      Enabled: this.Enabled,
      CreationTime: this.CreationTime
    };
  }
}

module.exports = ScalingPolicy;
