/**
 * ELBv2ResponseFormatter
 * Converte respostas do ALB Simulator para XML compatível com o AWS CLI (elasticloadbalancingv2, 2015-12-01)
 */

const xml = require('xmlbuilder');

const NS = 'http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/';

class ELBv2ResponseFormatter {
  /**
   * Helper: monta o envelope <ActionResponse><ActionResult>...</ActionResult><ResponseMetadata/></ActionResponse>
   */
  static _wrap(action, resultBody, requestId, includeResult = true) {
    const xmlObj = {
      [`${action}Response`]: {
        '@xmlns': NS,
        ...(includeResult ? { [`${action}Result`]: resultBody || {} } : {}),
        ResponseMetadata: { RequestId: requestId }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: normaliza um "member" de lista (elbv2 usa <member> para listas).
   */
  static _members(list = []) {
    return { member: list };
  }

  static _loadBalancerMember(lb) {
    const availabilityZones = (lb.SubnetIds || []).map((subnetId, index) => ({
      ZoneName:
        (lb.AvailabilityZones && lb.AvailabilityZones[index]) ||
        `us-east-1${String.fromCharCode(97 + index)}`,
      SubnetId: subnetId
    }));

    return {
      LoadBalancerArn: lb.LoadBalancerArn,
      DNSName: lb.DNSName,
      CanonicalHostedZoneId: 'Z35SXDOTRQ7X7K',
      CreatedTime: lb.CreatedTime,
      LoadBalancerName: lb.LoadBalancerName,
      Scheme: lb.Scheme,
      VpcId: lb.VpcId || '',
      State: { Code: lb.State || 'active' },
      Type: lb.Type || 'application',
      IpAddressType: lb.IpAddressType || 'ipv4',
      AvailabilityZones: this._members(availabilityZones),
      SecurityGroups: this._members(lb.SecurityGroupIds || [])
    };
  }

  static _targetGroupMember(tg) {
    return {
      TargetGroupArn: tg.TargetGroupArn,
      TargetGroupName: tg.TargetGroupName,
      Protocol: tg.Protocol,
      Port: tg.Port,
      VpcId: tg.VpcId || '',
      HealthCheckProtocol: tg.HealthCheckProtocol || 'HTTP',
      HealthCheckPort: String(tg.HealthCheckPort || tg.Port),
      HealthCheckEnabled: tg.HealthCheckEnabled !== false,
      HealthCheckIntervalSeconds: tg.HealthCheckIntervalSeconds || 30,
      HealthCheckTimeoutSeconds: tg.HealthCheckTimeoutSeconds || 5,
      HealthyThresholdCount: tg.HealthyThresholdCount || 2,
      UnhealthyThresholdCount: tg.UnhealthyThresholdCount || 2,
      HealthCheckPath: tg.HealthCheckPath || '/',
      Matcher: { HttpCode: (tg.Matcher && tg.Matcher.HttpCode) || '200' },
      TargetType: tg.TargetType || 'instance',
      ProtocolVersion: 'HTTP1',
      IpAddressType: 'ipv4',
      LoadBalancerArns: this._members(tg.LoadBalancerArns || [])
    };
  }

  static _listenerMember(listener) {
    return {
      ListenerArn: listener.ListenerArn,
      LoadBalancerArn: listener.LoadBalancerArn,
      Port: listener.Port,
      Protocol: listener.Protocol,
      Certificates: this._members(listener.Certificates || []),
      DefaultActions: this._members(
        (listener.DefaultActions || []).map(action => ({
          Type: action.Type,
          TargetGroupArn: action.TargetGroupArn
        }))
      )
    };
  }

  static formatDescribeLoadBalancersResponse(loadBalancers, requestId = 'alb-request-1') {
    return this._wrap(
      'DescribeLoadBalancers',
      { LoadBalancers: this._members(loadBalancers.map(lb => this._loadBalancerMember(lb))) },
      requestId
    );
  }

  static formatCreateLoadBalancerResponse(loadBalancer, requestId = 'alb-request-1') {
    return this._wrap(
      'CreateLoadBalancer',
      { LoadBalancers: this._members([this._loadBalancerMember(loadBalancer)]) },
      requestId
    );
  }

  static formatDeleteLoadBalancerResponse(requestId = 'alb-request-1') {
    return this._wrap('DeleteLoadBalancer', {}, requestId);
  }

  static formatDescribeTargetGroupsResponse(targetGroups, requestId = 'alb-request-1') {
    return this._wrap(
      'DescribeTargetGroups',
      {
        TargetGroups: this._members(targetGroups.map(tg => this._targetGroupMember(tg)))
      },
      requestId
    );
  }

  static formatCreateTargetGroupResponse(targetGroup, requestId = 'alb-request-1') {
    return this._wrap(
      'CreateTargetGroup',
      { TargetGroups: this._members([this._targetGroupMember(targetGroup)]) },
      requestId
    );
  }

  static formatDeleteTargetGroupResponse(requestId = 'alb-request-1') {
    return this._wrap('DeleteTargetGroup', {}, requestId);
  }

  static formatRegisterTargetsResponse(requestId = 'alb-request-1') {
    return this._wrap('RegisterTargets', {}, requestId);
  }

  static formatDeregisterTargetsResponse(requestId = 'alb-request-1') {
    return this._wrap('DeregisterTargets', {}, requestId);
  }

  static formatDescribeTargetHealthResponse(health, requestId = 'alb-request-1') {
    return this._wrap(
      'DescribeTargetHealth',
      {
        TargetHealthDescriptions: this._members(
          (health.HealthDescriptions || []).map(description => ({
            Target: {
              Id: description.TargetId,
              Port: description.Port
            },
            HealthCheckPort: String(description.Port || ''),
            TargetHealth: {
              State: description.HealthState,
              Reason: description.HealthReason || ''
            }
          }))
        )
      },
      requestId
    );
  }

  static formatDescribeListenersResponse(listeners, requestId = 'alb-request-1') {
    return this._wrap(
      'DescribeListeners',
      { Listeners: this._members(listeners.map(listener => this._listenerMember(listener))) },
      requestId
    );
  }

  static formatCreateListenerResponse(listener, requestId = 'alb-request-1') {
    return this._wrap(
      'CreateListener',
      { Listeners: this._members([this._listenerMember(listener)]) },
      requestId
    );
  }

  static formatDeleteListenerResponse(requestId = 'alb-request-1') {
    return this._wrap('DeleteListener', {}, requestId);
  }

  /**
   * Erro no formato do ELBv2 (Query Protocol)
   */
  static formatErrorResponse(code, message, requestId = 'alb-request-1') {
    const xmlObj = {
      ErrorResponse: {
        '@xmlns': NS,
        Error: {
          Type: 'Sender',
          Code: code,
          Message: message
        },
        RequestId: requestId
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: constrói XML a partir de objeto
   */
  static _buildXml(obj) {
    const root = xml.create(obj);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + root.toString();
  }
}

module.exports = ELBv2ResponseFormatter;
