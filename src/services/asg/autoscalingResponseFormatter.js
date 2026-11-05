/**
 * AutoScalingResponseFormatter
 * Converte respostas do ASG Simulator para XML compatível com o AWS CLI (autoscaling, 2011-01-01)
 */

const xml = require('xmlbuilder');

const NS = 'http://autoscaling.amazonaws.com/doc/2011-01-01/';

class AutoScalingResponseFormatter {
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

  static _members(list = []) {
    return { member: list };
  }

  static _launchTemplateMember(launchTemplate) {
    if (!launchTemplate) {
      return {};
    }

    // Pode ser o model LaunchTemplate ou apenas o id (após loadFromPersistence)
    if (typeof launchTemplate === 'string') {
      return {
        LaunchTemplateId: launchTemplate,
        LaunchTemplateName: launchTemplate,
        Version: String(1)
      };
    }

    return {
      LaunchTemplateId: launchTemplate.LaunchTemplateId,
      LaunchTemplateName: launchTemplate.LaunchTemplateName,
      Version: String(launchTemplate.VersionNumber || 1)
    };
  }

  static _autoScalingGroupMember(asg) {
    const vpcZoneIdentifier = Array.isArray(asg.VPCZoneIdentifier)
      ? asg.VPCZoneIdentifier.join(',')
      : asg.VPCZoneIdentifier || '';

    return {
      AutoScalingGroupName: asg.AutoScalingGroupName,
      AutoScalingGroupARN: asg.AutoScalingGroupARN,
      MinSize: asg.MinSize,
      MaxSize: asg.MaxSize,
      DesiredCapacity: asg.DesiredCapacity,
      DefaultCooldown: 300,
      AvailabilityZones: this._members(asg.AvailabilityZones || []),
      LoadBalancerNames: this._members(asg.LoadBalancerNames || []),
      TargetGroupARNs: this._members(asg.TargetGroupARNs || []),
      HealthCheckType: asg.HealthCheckType || 'EC2',
      HealthCheckGracePeriod: asg.HealthCheckGracePeriod || 0,
      Instances: this._members(
        (asg.Instances || []).map(instance => ({
          InstanceId: instance.InstanceId,
          AvailabilityZone: instance.AvailabilityZone || '',
          LifecycleState: instance.LifecycleState || 'InService',
          HealthStatus: instance.HealthStatus || 'Healthy',
          ProtectedFromScaleIn: false
        }))
      ),
      CreatedTime: asg.CreationTime || new Date().toISOString(),
      SuspendedProcesses: this._members([]),
      VPCZoneIdentifier: vpcZoneIdentifier,
      EnabledMetrics: this._members(asg.EnabledMetrics || []),
      LaunchTemplate: this._launchTemplateMember(asg.LaunchTemplate),
      Tags: this._members([])
    };
  }

  static _launchTemplateListMember(launchTemplate) {
    return {
      LaunchTemplateId: launchTemplate.LaunchTemplateId,
      LaunchTemplateName: launchTemplate.LaunchTemplateName,
      CreateTime: launchTemplate.CreationTime || new Date().toISOString(),
      CreatedBy: 'arn:aws:iam::123456789012:root',
      DefaultVersionNumber: launchTemplate.VersionNumber || 1,
      LatestVersionNumber: launchTemplate.VersionNumber || 1
    };
  }

  static _scalingPolicyMember(policy) {
    return {
      AutoScalingGroupName: policy.AutoScalingGroupName,
      PolicyName: policy.PolicyName,
      PolicyARN: policy.PolicyARN,
      PolicyType: policy.PolicyType,
      AdjustmentType: policy.AdjustmentType || '',
      Enabled: true,
      TargetTrackingConfiguration: policy.TargetValue
        ? {
            TargetValue: policy.TargetValue,
            PredefinedMetricSpecification: {
              PredefinedMetricType:
                (policy.PredefinedMetricSpecification &&
                  policy.PredefinedMetricSpecification.PredefinedMetricType) ||
                'ASGAverageCPUUtilization'
            },
            DisableScaleIn: false
          }
        : undefined
    };
  }

  static formatCreateLaunchTemplateResponse(launchTemplate, requestId = 'asg-request-1') {
    return this._wrap(
      'CreateLaunchTemplate',
      {
        LaunchTemplate: {
          LaunchTemplateId: launchTemplate.LaunchTemplateId,
          LaunchTemplateName: launchTemplate.LaunchTemplateName
        }
      },
      requestId
    );
  }

  static formatDescribeLaunchTemplatesResponse(launchTemplates, requestId = 'asg-request-1') {
    return this._wrap(
      'DescribeLaunchTemplates',
      {
        LaunchTemplates: this._members(
          launchTemplates.map(lt => this._launchTemplateListMember(lt))
        )
      },
      requestId
    );
  }

  static formatDeleteLaunchTemplateResponse(requestId = 'asg-request-1') {
    return this._wrap('DeleteLaunchTemplate', {}, requestId);
  }

  static formatCreateAutoScalingGroupResponse(requestId = 'asg-request-1') {
    return this._wrap('CreateAutoScalingGroup', {}, requestId);
  }

  static formatDescribeAutoScalingGroupsResponse(autoScalingGroups, requestId = 'asg-request-1') {
    return this._wrap(
      'DescribeAutoScalingGroups',
      {
        AutoScalingGroups: this._members(
          autoScalingGroups.map(asg => this._autoScalingGroupMember(asg))
        )
      },
      requestId
    );
  }

  static formatUpdateAutoScalingGroupResponse(requestId = 'asg-request-1') {
    return this._wrap('UpdateAutoScalingGroup', {}, requestId);
  }

  static formatDeleteAutoScalingGroupResponse(requestId = 'asg-request-1') {
    return this._wrap('DeleteAutoScalingGroup', {}, requestId);
  }

  static formatSetDesiredCapacityResponse(requestId = 'asg-request-1') {
    return this._wrap('SetDesiredCapacity', {}, requestId);
  }

  static formatPutScalingPolicyResponse(policy, requestId = 'asg-request-1') {
    return this._wrap(
      'PutScalingPolicy',
      {
        PolicyARN: policy.PolicyARN
      },
      requestId
    );
  }

  static formatDescribePoliciesResponse(policies, requestId = 'asg-request-1') {
    return this._wrap(
      'DescribePolicies',
      {
        ScalingPolicies: this._members(policies.map(policy => this._scalingPolicyMember(policy)))
      },
      requestId
    );
  }

  static formatDeletePolicyResponse(requestId = 'asg-request-1') {
    return this._wrap('DeletePolicy', {}, requestId);
  }

  static formatDescribeScalingActivitiesResponse(requestId = 'asg-request-1') {
    return this._wrap(
      'DescribeScalingActivities',
      {
        Activities: this._members([])
      },
      requestId
    );
  }

  static fieldName(value) {
    return value;
  }

  /**
   * Erro no formato do AutoScaling (Query Protocol)
   */
  static formatErrorResponse(code, message, requestId = 'asg-request-1') {
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

  static _buildXml(obj) {
    const root = xml.create(obj);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + root.toString();
  }
}

module.exports = AutoScalingResponseFormatter;
