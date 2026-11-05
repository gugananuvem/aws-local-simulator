/**
 * Auto Scaling Group Model
 */

const { v4: uuid } = require('uuid');

class AutoScalingGroup {
  constructor(name, launchTemplate, config = {}) {
    this.AutoScalingGroupName = name;
    this.AutoScalingGroupARN = `arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:${uuid()}:autoScalingGroupName/${name}`;
    
    // Launch Configuration
    this.LaunchTemplate = launchTemplate;
    
    // Capacity
    this.MinSize = config.minSize !== undefined ? config.minSize : 1;
    this.MaxSize = config.maxSize !== undefined ? config.maxSize : 5;
    this.DesiredCapacity =
      config.desiredCapacity !== undefined ? config.desiredCapacity : this.MinSize;
    this.Instances = []; // Array de instanceIds gerenciados por esse ASG
    
    // Subnets
    this.VPCZoneIdentifier = config.vpcZoneIdentifier || [];
    this.AvailabilityZones = config.availabilityZones || ['us-east-1a'];
    
    // Target Groups (para ALB)
    this.TargetGroupARNs = config.targetGroupARNs || [];
    this.LoadBalancerNames = config.loadBalancerNames || [];
    
    // Policies
    this.HealthCheckType = config.healthCheckType || 'ELB';
    this.HealthCheckGracePeriod = config.healthCheckGracePeriod || 300;
    
    // Tags
    this.Tags = config.tags || [];
    
    // Scaling & Lifecycle
    this.SuspendedProcesses = [];
    this.EnabledMetrics = config.enabledMetrics || ['GroupInServiceInstances', 'GroupTerminatingInstances'];
    this.CreationTime = new Date();
    this.Status = 'Active';
    
    // Internal tracking
    this.lastScalingTime = new Date();
    this.scalingPolicies = [];
  }

  toJSON() {
    return {
      AutoScalingGroupName: this.AutoScalingGroupName,
      AutoScalingGroupARN: this.AutoScalingGroupARN,
      LaunchTemplate: this.LaunchTemplate.toJSON(),
      MinSize: this.MinSize,
      MaxSize: this.MaxSize,
      DesiredCapacity: this.DesiredCapacity,
      Instances: this.Instances.map(inst => ({
        InstanceId: inst.InstanceId,
        InstanceType: inst.InstanceType,
        AvailabilityZone: inst.AvailabilityZone,
        LifecycleState: inst.LifecycleState,
        HealthStatus: inst.HealthStatus
      })),
      VPCZoneIdentifier: this.VPCZoneIdentifier,
      AvailabilityZones: this.AvailabilityZones,
      TargetGroupARNs: this.TargetGroupARNs,
      LoadBalancerNames: this.LoadBalancerNames,
      HealthCheckType: this.HealthCheckType,
      HealthCheckGracePeriod: this.HealthCheckGracePeriod,
      Tags: this.Tags,
      EnabledMetrics: this.EnabledMetrics,
      CreationTime: this.CreationTime,
      Status: this.Status
    };
  }

  addInstance(instance) {
    this.Instances.push({
      InstanceId: instance.InstanceId,
      InstanceType: instance.InstanceType,
      AvailabilityZone: this.AvailabilityZones[0],
      LifecycleState: 'InService',
      HealthStatus: 'Healthy'
    });
  }

  removeInstance(instanceId) {
    this.Instances = this.Instances.filter(inst => inst.InstanceId !== instanceId);
  }

  getInstanceCount() {
    return this.Instances.length;
  }

  canScaleUp() {
    return this.getInstanceCount() < this.MaxSize;
  }

  canScaleDown() {
    return this.getInstanceCount() > this.MinSize;
  }

  isBelowDesiredCapacity() {
    return this.getInstanceCount() < this.DesiredCapacity;
  }

  isAboveDesiredCapacity() {
    return this.getInstanceCount() > this.DesiredCapacity;
  }
}

module.exports = AutoScalingGroup;
