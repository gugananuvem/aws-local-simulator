/**
 * Application Load Balancer Model
 */

const { v4: uuidv4 } = require('uuid');

class LoadBalancer {
  constructor(name, scheme = 'internet-facing', config = {}) {
    this.LoadBalancerArn = `arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/${name}/${uuidv4().substring(0, 8)}`;
    this.LoadBalancerName = name;
    this.DNSName = `${name}-${Math.random().toString(36).substring(7)}.elb.us-east-1.amazonaws.com`;
    this.Scheme = scheme; // internet-facing ou internal
    this.Type = 'application';
    this.State = 'active';
    this.VpcId = config.VpcId || null;
    this.SubnetIds = config.SubnetIds || [];
    this.SecurityGroupIds = config.SecurityGroupIds || [];
    this.IpAddressType = config.IpAddressType || 'ipv4';
    this.Listeners = [];
    this.TargetGroups = [];
    this.Tags = config.Tags || [];
    this.CreatedTime = new Date().toISOString();
    this.Port = config.Port || 80;
  }

  addListener(protocol = 'HTTP', port = 80, targetGroupArn = null) {
    const listener = {
      ListenerArn: `arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/${uuidv4().substring(0, 8)}`,
      LoadBalancerArn: this.LoadBalancerArn,
      Port: port,
      Protocol: protocol,
      Certificates: [],
      DefaultActions: [
        {
          Type: 'forward',
          TargetGroupArn: targetGroupArn
        }
      ],
      AlpnPolicy: []
    };
    this.Listeners.push(listener);
    return listener;
  }

  addTargetGroup(targetGroup) {
    this.TargetGroups.push(targetGroup);
  }

  removeTargetGroup(targetGroupArn) {
    const index = this.TargetGroups.findIndex(tg => tg.TargetGroupArn === targetGroupArn);
    if (index > -1) {
      this.TargetGroups.splice(index, 1);
    }
  }

  getHealthyTargets() {
    const healthyTargets = [];
    this.TargetGroups.forEach(tg => {
      tg.Targets.forEach(target => {
        if (target.HealthState === 'healthy') {
          healthyTargets.push(target);
        }
      });
    });
    return healthyTargets;
  }

  toJSON() {
    return {
      LoadBalancerArn: this.LoadBalancerArn,
      LoadBalancerName: this.LoadBalancerName,
      DNSName: this.DNSName,
      Scheme: this.Scheme,
      Type: this.Type,
      State: this.State,
      VpcId: this.VpcId,
      SubnetIds: this.SubnetIds,
      SecurityGroupIds: this.SecurityGroupIds,
      IpAddressType: this.IpAddressType,
      CreatedTime: this.CreatedTime,
      Port: this.Port,
      ListenersCount: this.Listeners.length,
      TargetGroupsCount: this.TargetGroups.length
    };
  }
}

module.exports = LoadBalancer;
