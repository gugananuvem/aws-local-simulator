/**
 * Target Group Model
 */

const { v4: uuidv4 } = require('uuid');

class Target {
  constructor(targetId, port = 80) {
    this.TargetId = targetId; // instance-id ou IP
    this.Port = port;
    this.HealthState = 'healthy';
    this.HealthReason = 'N/A';
    this.Description = 'Target registered';
    this.RegisteredAt = new Date().toISOString();
  }

  setHealthy() {
    this.HealthState = 'healthy';
    this.HealthReason = 'N/A';
  }

  setUnhealthy(reason = 'Health checks failed') {
    this.HealthState = 'unhealthy';
    this.HealthReason = reason;
  }

  toJSON() {
    return {
      TargetId: this.TargetId,
      Port: this.Port,
      HealthState: this.HealthState,
      HealthReason: this.HealthReason,
      Description: this.Description,
      RegisteredAt: this.RegisteredAt
    };
  }
}

class TargetGroup {
  constructor(name, protocol = 'HTTP', port = 80, vpcId = null, config = {}) {
    this.TargetGroupArn = `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/${name}/${uuidv4().substring(0, 8)}`;
    this.TargetGroupName = name;
    this.Protocol = protocol;
    this.Port = port;
    this.VpcId = vpcId;
    this.TargetType = config.TargetType || 'instance'; // instance ou ip
    this.Targets = [];
    this.HealthCheckEnabled = config.HealthCheckEnabled !== false;
    this.HealthCheckProtocol = config.HealthCheckProtocol || 'HTTP';
    this.HealthCheckPath = config.HealthCheckPath || '/';
    this.HealthCheckPort = config.HealthCheckPort || String(port);
    this.HealthCheckIntervalSeconds = config.HealthCheckIntervalSeconds || 30;
    this.HealthCheckTimeoutSeconds = config.HealthCheckTimeoutSeconds || 5;
    this.HealthyThresholdCount = config.HealthyThresholdCount || 2;
    this.UnhealthyThresholdCount = config.UnhealthyThresholdCount || 2;
    this.Matcher = config.Matcher || { HttpCode: '200' };
    this.Tags = config.Tags || [];
    this.CreatedTime = new Date().toISOString();
    this.LoadBalancingAlgorithmType = 'round_robin';
    this.TargetCount = 0;
    this.HealthyCount = 0;
    this.UnhealthyCount = 0;
  }

  registerTarget(targetId, port = null) {
    const targetPort = port || this.Port;

    // Verificar se já existe
    if (this.Targets.some(t => t.TargetId === targetId && t.Port === targetPort)) {
      throw new Error(`Target ${targetId}:${targetPort} already registered`);
    }

    const target = new Target(targetId, targetPort);
    this.Targets.push(target);
    this.updateCounts();
    return target;
  }

  deregisterTarget(targetId, port = null) {
    const targetPort = port || this.Port;
    const index = this.Targets.findIndex(t => t.TargetId === targetId && t.Port === targetPort);

    if (index === -1) {
      throw new Error(`Target ${targetId}:${targetPort} not found`);
    }

    const target = this.Targets.splice(index, 1)[0];
    this.updateCounts();
    return target;
  }

  getNextTarget() {
    const healthyTargets = this.Targets.filter(t => t.HealthState === 'healthy');
    if (healthyTargets.length === 0) {
      return null;
    }
    // Round robin simples
    return healthyTargets[Math.floor(Math.random() * healthyTargets.length)];
  }

  updateCounts() {
    this.TargetCount = this.Targets.length;
    this.HealthyCount = this.Targets.filter(t => t.HealthState === 'healthy').length;
    this.UnhealthyCount = this.Targets.filter(t => t.HealthState === 'unhealthy').length;
  }

  toJSON() {
    return {
      TargetGroupArn: this.TargetGroupArn,
      TargetGroupName: this.TargetGroupName,
      Protocol: this.Protocol,
      Port: this.Port,
      VpcId: this.VpcId,
      TargetType: this.TargetType,
      TargetCount: this.TargetCount,
      HealthyCount: this.HealthyCount,
      UnhealthyCount: this.UnhealthyCount,
      HealthCheckEnabled: this.HealthCheckEnabled,
      HealthCheckProtocol: this.HealthCheckProtocol,
      HealthCheckPath: this.HealthCheckPath,
      CreatedTime: this.CreatedTime,
      LoadBalancingAlgorithmType: this.LoadBalancingAlgorithmType,
      Targets: this.Targets.map(t => t.toJSON())
    };
  }
}

module.exports = { TargetGroup, Target };
