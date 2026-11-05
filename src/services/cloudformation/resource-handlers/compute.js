"use strict";

/**
 * Handlers CloudFormation: ELBv2 (ALB), Auto Scaling, ECS.
 */

const { assertOk, generateName, toBool, toNumber } = require("./helpers");

/** PascalCase -> camelCase em chaves (ECS espera camelCase nas definições de container). */
function camelize(value) {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), camelize(v)]));
  }
  return value;
}

const splitCsv = (v) => (Array.isArray(v) ? v : v ? String(v).split(",") : []);

module.exports = {
  // ─── ELBv2 ──────────────────────────────────────────────────────────────
  "AWS::ElasticLoadBalancingV2::LoadBalancer": {
    requires: ["alb"],
    inPlace: ["Tags", "LoadBalancerAttributes", "SecurityGroups"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 32 });
      let vpcId = null;
      const subnets = props.Subnets || (props.SubnetMappings || []).map((m) => m.SubnetId);
      if (subnets[0] && sims.vpc) {
        try {
          vpcId = sims.vpc.getSubnet(subnets[0]).VpcId;
        } catch (_) {}
      }
      const lb = sims.alb.createLoadBalancer(name, props.Scheme || "internet-facing", {
        VpcId: vpcId,
        SubnetIds: subnets,
        SecurityGroupIds: props.SecurityGroups || [],
        IpAddressType: props.IpAddressType || "ipv4",
        Tags: props.Tags || [],
      });
      return {
        physicalId: lb.LoadBalancerArn,
        attrs: {
          DNSName: lb.DNSName,
          LoadBalancerFullName: lb.LoadBalancerArn.split("loadbalancer/")[1],
          LoadBalancerName: name,
          CanonicalHostedZoneID: "Z35SXDOTRQ7X7K",
          SecurityGroups: lb.SecurityGroupIds,
        },
      };
    },
    async delete({ physicalId, sims }) {
      sims.alb.deleteLoadBalancer(physicalId);
    },
  },

  "AWS::ElasticLoadBalancingV2::TargetGroup": {
    requires: ["alb"],
    inPlace: ["Tags", "TargetGroupAttributes", "Targets", "HealthCheckPath", "HealthCheckIntervalSeconds"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.Name || generateName(stackName, logicalId, { max: 32 });
      const tg = sims.alb.createTargetGroup(name, props.Protocol || "HTTP", toNumber(props.Port, 80), props.VpcId || null, {
        HealthCheckPath: props.HealthCheckPath,
        HealthCheckIntervalSeconds: props.HealthCheckIntervalSeconds !== undefined ? Number(props.HealthCheckIntervalSeconds) : undefined,
        TargetType: props.TargetType,
        Tags: props.Tags || [],
      });
      for (const t of props.Targets || []) sims.alb.registerTarget?.(tg.TargetGroupArn, t.Id, toNumber(t.Port, 80));
      return {
        physicalId: tg.TargetGroupArn,
        attrs: {
          TargetGroupArn: tg.TargetGroupArn,
          TargetGroupName: name,
          TargetGroupFullName: tg.TargetGroupArn.split(":").pop(),
          LoadBalancerArns: [],
        },
      };
    },
    async delete({ physicalId, sims }) {
      sims.alb.deleteTargetGroup(physicalId);
    },
  },

  "AWS::ElasticLoadBalancingV2::Listener": {
    requires: ["alb"],
    inPlace: [],
    async create({ props, sims }) {
      const forward = (props.DefaultActions || []).find((a) => a.TargetGroupArn || a.ForwardConfig);
      const tgArn = forward?.TargetGroupArn || forward?.ForwardConfig?.TargetGroups?.[0]?.TargetGroupArn || null;
      const listener = sims.alb.addListener(props.LoadBalancerArn, props.Protocol || "HTTP", toNumber(props.Port, 80), tgArn);
      return { physicalId: listener.ListenerArn, attrs: { ListenerArn: listener.ListenerArn } };
    },
    async delete({ physicalId, sims }) {
      sims.alb.deleteListener(physicalId);
    },
  },

  // ─── Auto Scaling ───────────────────────────────────────────────────────
  "AWS::AutoScaling::LaunchConfiguration": {
    requires: ["asg"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.LaunchConfigurationName || generateName(stackName, logicalId, { max: 255 });
      const lt = sims.asg.createLaunchTemplate(name, props.ImageId, props.InstanceType || "t2.micro", {
        keyName: props.KeyName,
        securityGroupIds: props.SecurityGroups || [],
        userData: props.UserData,
        iamInstanceProfile: props.IamInstanceProfile,
      });
      return { physicalId: name, attrs: { LaunchTemplateId: lt.LaunchTemplateId } };
    },
    async delete({ attrs, sims }) {
      sims.asg.launchTemplates?.delete(attrs?.LaunchTemplateId);
      sims.asg.persistData?.();
    },
  },

  "AWS::AutoScaling::AutoScalingGroup": {
    requires: ["asg"],
    inPlace: ["MinSize", "MaxSize", "DesiredCapacity", "Tags", "HealthCheckGracePeriod"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.AutoScalingGroupName || generateName(stackName, logicalId, { max: 255 });

      // O ASG usa os próprios launch templates: resolve a origem (EC2 LaunchTemplate / LaunchConfiguration)
      let ltId = props.LaunchTemplate?.LaunchTemplateId || props.LaunchTemplate?.LaunchTemplateName || props.LaunchConfigurationName;
      if (ltId && !sims.asg.launchTemplates.has(ltId)) {
        const byName = [...sims.asg.launchTemplates.values()].find((t) => t.LaunchTemplateName === ltId);
        if (byName) ltId = byName.LaunchTemplateId;
        else if (sims.ec2) {
          const data = sims.ec2.resolveLaunchTemplateData(props.LaunchTemplate?.LaunchTemplateId || props.LaunchTemplate?.LaunchTemplateName, props.LaunchTemplate?.Version);
          const created = sims.asg.createLaunchTemplate(`${name}-lt`, data?.ImageId, data?.InstanceType || "t2.micro", {
            keyName: data?.KeyName,
            securityGroupIds: data?.SecurityGroupIds || [],
          });
          ltId = created.LaunchTemplateId;
        }
      }
      if (!ltId) throw new Error("AutoScalingGroup requires LaunchTemplate or LaunchConfigurationName");

      const subnets = splitCsv(props.VPCZoneIdentifier);
      sims.asg.createAutoScalingGroup(name, ltId, {
        minSize: toNumber(props.MinSize, 1),
        maxSize: toNumber(props.MaxSize, 5),
        desiredCapacity: props.DesiredCapacity !== undefined ? Number(props.DesiredCapacity) : undefined,
        vpcZoneIdentifier: subnets,
        availabilityZones: props.AvailabilityZones,
        targetGroupARNs: props.TargetGroupARNs,
        loadBalancerNames: props.LoadBalancerNames,
        healthCheckType: props.HealthCheckType,
        healthCheckGracePeriod: props.HealthCheckGracePeriod !== undefined ? Number(props.HealthCheckGracePeriod) : undefined,
        tags: (props.Tags || []).map((t) => ({ Key: t.Key, Value: t.Value })),
      });
      return { physicalId: name, attrs: {} };
    },
    async update({ physicalId, props, sims, previous }) {
      const group = sims.asg.getAutoScalingGroup(physicalId);
      if (props.MinSize !== undefined) group.MinSize = Number(props.MinSize);
      if (props.MaxSize !== undefined) group.MaxSize = Number(props.MaxSize);
      if (props.DesiredCapacity !== undefined) {
        group.DesiredCapacity = Number(props.DesiredCapacity);
        sims.asg._scaleToDesiredCapacity?.(group);
      }
      sims.asg.persistData?.();
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.asg.deleteAutoScalingGroup(physicalId, true);
    },
  },

  "AWS::AutoScaling::ScalingPolicy": {
    requires: ["asg"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const name = generateName(stackName, logicalId, { max: 255 });
      sims.asg.attachScalingPolicy(props.AutoScalingGroupName, name, props.PolicyType || "SimpleScaling", {
        scalingAdjustment: props.ScalingAdjustment !== undefined ? Number(props.ScalingAdjustment) : undefined,
        adjustmentType: props.AdjustmentType,
        cooldown: props.Cooldown !== undefined ? Number(props.Cooldown) : undefined,
        targetTrackingConfiguration: props.TargetTrackingConfiguration,
      });
      return { physicalId: name, attrs: {} };
    },
    async delete({ physicalId, props, sims }) {
      sims.asg.scalingPolicies?.delete(`${props?.AutoScalingGroupName}:${physicalId}`);
      sims.asg.persistData?.();
    },
  },

  // ─── ECS ────────────────────────────────────────────────────────────────
  "AWS::ECS::Cluster": {
    requires: ["ecs"],
    inPlace: ["Tags", "ClusterSettings", "CapacityProviders"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ClusterName || generateName(stackName, logicalId, { max: 255 });
      const { cluster } = assertOk(sims.ecs.createCluster(name));
      return { physicalId: name, attrs: { Arn: cluster.arn } };
    },
    async delete({ physicalId, sims }) {
      assertOk(sims.ecs.deleteCluster(physicalId));
    },
  },

  "AWS::ECS::TaskDefinition": {
    requires: ["ecs"],
    inPlace: [],
    async create({ logicalId, stackName, props, sims }) {
      const family = props.Family || generateName(stackName, logicalId, { max: 255 });
      const { taskDefinition } = assertOk(
        sims.ecs.registerTaskDefinition({
          family,
          containerDefinitions: camelize(props.ContainerDefinitions || []),
          networkMode: props.NetworkMode,
          cpu: props.Cpu !== undefined ? String(props.Cpu) : undefined,
          memory: props.Memory !== undefined ? String(props.Memory) : undefined,
          executionRoleArn: props.ExecutionRoleArn,
          taskRoleArn: props.TaskRoleArn,
        }),
      );
      return { physicalId: taskDefinition.taskDefinitionArn, attrs: { TaskDefinitionArn: taskDefinition.taskDefinitionArn } };
    },
    async delete({ physicalId, sims }) {
      // O simulador não possui DeregisterTaskDefinition: remove o arquivo da revisão registrada
      const m = String(physicalId).match(/task-definition\/(.+):(\d+)$/);
      if (m) {
        try {
          sims.ecs.store.delete(`taskdef_${m[1]}_${m[2]}`);
          sims.ecs.persistTaskDefinitions?.();
        } catch (_) {}
      }
    },
  },

  "AWS::ECS::Service": {
    requires: ["ecs"],
    inPlace: ["DesiredCount", "TaskDefinition"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.ServiceName || generateName(stackName, logicalId, { max: 255 });
      const cluster = String(props.Cluster || "default").split("/").pop();
      const { service } = assertOk(
        sims.ecs.createService({
          cluster,
          serviceName: name,
          taskDefinition: props.TaskDefinition,
          desiredCount: toNumber(props.DesiredCount, 1),
          loadBalancers: camelize(props.LoadBalancers || []),
          networkConfiguration: props.NetworkConfiguration ? camelize(props.NetworkConfiguration) : undefined,
          schedulingStrategy: props.SchedulingStrategy,
        }),
      );
      return { physicalId: service.arn, attrs: { Name: name, ServiceArn: service.arn } };
    },
    async update({ physicalId, props, sims, previous }) {
      const name = String(physicalId).split("/").pop();
      assertOk(sims.ecs.updateService({ cluster: String(props.Cluster || "default").split("/").pop(), service: name, desiredCount: props.DesiredCount !== undefined ? Number(props.DesiredCount) : undefined, taskDefinition: props.TaskDefinition }));
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, props, sims }) {
      const name = String(physicalId).split("/").pop();
      const cluster = String(props?.Cluster || "default").split("/").pop();
      sims.ecs.scaleService?.(name, 0);
      sims.ecs.services.delete(name);
      const clusterObj = sims.ecs.clusters.get(cluster);
      if (clusterObj) clusterObj.services = clusterObj.services.filter((s) => s !== name);
      sims.ecs.persistServices?.();
      sims.ecs.persistClusters?.();
    },
  },
};
