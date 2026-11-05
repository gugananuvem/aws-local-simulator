"use strict";

/**
 * Handlers CloudFormation para EC2 / VPC.
 * sims.vpc  -> VPCSimulator (VPC, Subnet, IGW, RouteTable, NAT, EIP, NACL, Endpoint, Peering)
 * sims.ec2  -> EC2Simulator (Instance, SecurityGroup, Volume, KeyPair, LaunchTemplate, ENI)
 */

const { arn, generateName, toBool, toNumber } = require("./helpers");

const tags = (props) => props.Tags || [];
const az = (env) => `${env.region}a`;

/** Converte regra CFN (ingress/egress) em argumentos de SecurityGroup.add*Rule. */
function applyRules(sg, props) {
  const add = (rule, egress) => {
    const protocol = String(rule.IpProtocol ?? "tcp");
    const from = toNumber(rule.FromPort, protocol === "-1" ? -1 : 0);
    const to = toNumber(rule.ToPort, protocol === "-1" ? -1 : 65535);
    const cidr = rule.CidrIp || rule.CidrIpv6 || null;
    const sourceGroup = rule.SourceSecurityGroupId || rule.DestinationSecurityGroupId || null;
    const fn = egress ? "addEgressRule" : "addIngressRule";
    sg[fn](cidr, sourceGroup, from, to, protocol, rule.Description || "");
  };
  (props.SecurityGroupIngress || []).forEach((r) => add(r, false));
  if (props.SecurityGroupEgress) {
    // Egress explícito substitui a regra "allow all" padrão (como no CFN)
    sg.IpPermissionsEgress = [];
    props.SecurityGroupEgress.forEach((r) => add(r, true));
  }
}

const persistEc2 = (sims) => sims.ec2.persistData?.();

const ROUTE_TARGETS = [
  ["GatewayId", "igw"],
  ["NatGatewayId", "nat"],
  ["VpcEndpointId", "vpce"],
  ["InstanceId", "instance"],
  ["NetworkInterfaceId", "eni"],
];

module.exports = {
  "AWS::EC2::VPC": {
    requires: ["vpc"],
    inPlace: ["Tags", "EnableDnsSupport", "EnableDnsHostnames"],
    async create({ props, sims }) {
      const vpc = sims.vpc.createVPC(props.CidrBlock, tags(props), {
        EnableDnsHostnames: toBool(props.EnableDnsHostnames, false),
        EnableDnsSupport: toBool(props.EnableDnsSupport, true),
        InstanceTenancy: props.InstanceTenancy || "default",
      });
      const acl = sims.vpc.getDefaultNetworkAcl?.(vpc.VpcId);
      return {
        physicalId: vpc.VpcId,
        attrs: {
          VpcId: vpc.VpcId,
          CidrBlock: vpc.CidrBlock,
          CidrBlockAssociations: [],
          DefaultNetworkAcl: acl?.NetworkAclId || "",
          DefaultSecurityGroup: "sg-default",
          Ipv6CidrBlocks: [],
        },
      };
    },
    async update({ physicalId, props, sims, previous }) {
      sims.vpc.modifyVPCAttribute(physicalId, "enableDnsSupport", toBool(props.EnableDnsSupport, true));
      sims.vpc.modifyVPCAttribute(physicalId, "enableDnsHostnames", toBool(props.EnableDnsHostnames, false));
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteVPC(physicalId);
    },
  },

  "AWS::EC2::Subnet": {
    requires: ["vpc"],
    inPlace: ["Tags", "MapPublicIpOnLaunch"],
    async create({ props, sims, env }) {
      const zone = props.AvailabilityZone || az(env);
      const subnet = sims.vpc.createSubnet(props.VpcId, props.CidrBlock, zone, tags(props), {
        MapPublicIpOnLaunch: toBool(props.MapPublicIpOnLaunch, false),
      });
      return {
        physicalId: subnet.SubnetId,
        attrs: { SubnetId: subnet.SubnetId, AvailabilityZone: zone, VpcId: props.VpcId, CidrBlock: props.CidrBlock, Ipv6CidrBlocks: [], NetworkAclAssociationId: "" },
      };
    },
    async update({ physicalId, props, sims, previous }) {
      const subnet = sims.vpc.getSubnet(physicalId);
      subnet.MapPublicIpOnLaunch = toBool(props.MapPublicIpOnLaunch, false);
      subnet.Tags = tags(props);
      sims.vpc.persistData();
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteSubnet(physicalId);
    },
  },

  "AWS::EC2::InternetGateway": {
    requires: ["vpc"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const igw = sims.vpc.createInternetGateway(tags(props));
      return { physicalId: igw.InternetGatewayId, attrs: { InternetGatewayId: igw.InternetGatewayId } };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteInternetGateway(physicalId);
    },
  },

  "AWS::EC2::VPCGatewayAttachment": {
    requires: ["vpc"],
    inPlace: [],
    async create({ props, sims, logicalId, stackName }) {
      if (props.InternetGatewayId) sims.vpc.attachInternetGateway(props.InternetGatewayId, props.VpcId);
      else if (props.VpnGatewayId) sims.vpc.attachVpnGateway(props.VpnGatewayId, props.VpcId);
      else throw new Error("VPCGatewayAttachment requires InternetGatewayId or VpnGatewayId");
      return { physicalId: `${stackName}-${logicalId}-attachment`, attrs: {} };
    },
    async delete({ props, sims }) {
      if (props.InternetGatewayId) sims.vpc.detachInternetGateway(props.InternetGatewayId, props.VpcId);
      else if (props.VpnGatewayId) sims.vpc.detachVpnGateway(props.VpnGatewayId, props.VpcId);
    },
  },

  "AWS::EC2::RouteTable": {
    requires: ["vpc"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const rt = sims.vpc.createRouteTable(props.VpcId, tags(props), false);
      return { physicalId: rt.RouteTableId, attrs: { RouteTableId: rt.RouteTableId } };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteRouteTable(physicalId);
    },
  },

  "AWS::EC2::Route": {
    requires: ["vpc"],
    inPlace: [],
    async create({ props, sims }) {
      const target = ROUTE_TARGETS.find(([key]) => props[key]);
      if (!target) throw new Error("Route requires a target (GatewayId, NatGatewayId, ...)");
      const cidr = props.DestinationCidrBlock || props.DestinationIpv6CidrBlock;
      sims.vpc.addRoute(props.RouteTableId, cidr, props[target[0]], target[1]);
      return { physicalId: `${props.RouteTableId}_${cidr}`, attrs: { CidrBlock: cidr } };
    },
    async delete({ props, sims }) {
      try {
        sims.vpc.removeRoute(props.RouteTableId, props.DestinationCidrBlock || props.DestinationIpv6CidrBlock);
      } catch (_) {
        // A route table pode já ter sido removida junto com a tabela
      }
    },
  },

  "AWS::EC2::SubnetRouteTableAssociation": {
    requires: ["vpc"],
    inPlace: [],
    async create({ props, sims }) {
      const assoc = sims.vpc.associateRouteTable(props.RouteTableId, props.SubnetId);
      const id = assoc?.RouteTableAssociationId || `${props.RouteTableId}-${props.SubnetId}`;
      return { physicalId: id, attrs: { Id: id } };
    },
    async delete({ props, sims }) {
      try {
        sims.vpc.disassociateRouteTable(props.RouteTableId, props.SubnetId);
      } catch (_) {}
    },
  },

  "AWS::EC2::NatGateway": {
    requires: ["vpc"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const nat = sims.vpc.createNATGateway(props.SubnetId, props.AllocationId, {
        ConnectivityType: props.ConnectivityType,
        Tags: tags(props),
      });
      return { physicalId: nat.NatGatewayId, attrs: { NatGatewayId: nat.NatGatewayId } };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteNATGateway(physicalId);
    },
  },

  "AWS::EC2::EIP": {
    requires: ["vpc"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const eip = sims.vpc.allocateAddress({ Domain: props.Domain || "vpc", Tags: tags(props) });
      if (props.InstanceId) sims.vpc.associateAddress({ allocationId: eip.AllocationId, instanceId: props.InstanceId });
      return { physicalId: eip.AllocationId, ref: eip.PublicIp, attrs: { AllocationId: eip.AllocationId, PublicIp: eip.PublicIp } };
    },
    async delete({ physicalId, sims }) {
      try {
        sims.vpc.disassociateAddress({ allocationId: physicalId });
      } catch (_) {}
      sims.vpc.releaseAddress(physicalId);
    },
  },

  "AWS::EC2::EIPAssociation": {
    requires: ["vpc"],
    inPlace: [],
    async create({ props, sims }) {
      const eip = sims.vpc.associateAddress({
        allocationId: props.AllocationId,
        instanceId: props.InstanceId,
        networkInterfaceId: props.NetworkInterfaceId,
        privateIpAddress: props.PrivateIpAddress,
      });
      return { physicalId: eip.AssociationId || `${props.AllocationId}-assoc`, attrs: {} };
    },
    async delete({ props, sims }) {
      try {
        sims.vpc.disassociateAddress({ allocationId: props.AllocationId });
      } catch (_) {}
    },
  },

  "AWS::EC2::NetworkAcl": {
    requires: ["vpc"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const acl = sims.vpc.createNetworkAcl(props.VpcId, tags(props), false);
      return { physicalId: acl.NetworkAclId, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteNetworkAcl(physicalId);
    },
  },

  "AWS::EC2::NetworkAclEntry": {
    requires: ["vpc"],
    inPlace: [],
    async create({ props, sims, logicalId, stackName }) {
      const portRange = props.PortRange ? { From: Number(props.PortRange.From), To: Number(props.PortRange.To) } : undefined;
      sims.vpc.createNetworkAclEntry(props.NetworkAclId, {
        RuleNumber: props.RuleNumber,
        Protocol: String(props.Protocol),
        RuleAction: props.RuleAction,
        Egress: toBool(props.Egress, false),
        CidrBlock: props.CidrBlock || props.Ipv6CidrBlock || "0.0.0.0/0",
        IcmpTypeCode: props.Icmp,
        PortRange: portRange,
      });
      return { physicalId: `${stackName}-${logicalId}`, attrs: {} };
    },
    async delete({ props, sims }) {
      try {
        sims.vpc.deleteNetworkAclEntry(props.NetworkAclId, Number(props.RuleNumber), toBool(props.Egress, false));
      } catch (_) {}
    },
  },

  "AWS::EC2::SubnetNetworkAclAssociation": {
    requires: ["vpc"],
    inPlace: [],
    async create({ props, sims }) {
      const assoc = sims.vpc.associateNetworkAcl(props.NetworkAclId, props.SubnetId);
      const id = assoc?.NetworkAclAssociationId || `${props.NetworkAclId}-${props.SubnetId}`;
      return { physicalId: id, attrs: { AssociationId: id } };
    },
    async delete() {
      // A associação é removida junto com a subnet/NACL
    },
  },

  "AWS::EC2::VPCEndpoint": {
    requires: ["vpc"],
    inPlace: ["PolicyDocument", "PrivateDnsEnabled", "RouteTableIds", "SubnetIds", "SecurityGroupIds"],
    async create({ props, sims }) {
      const endpoint = sims.vpc.createVPCEndpoint(props.VpcId, props.ServiceName, {
        VpcEndpointType: props.VpcEndpointType || "Gateway",
        RouteTableIds: props.RouteTableIds || [],
        SubnetIds: props.SubnetIds || [],
        SecurityGroupIds: props.SecurityGroupIds || [],
        PrivateDnsEnabled: toBool(props.PrivateDnsEnabled, false),
        ...(props.PolicyDocument ? { PolicyDocument: props.PolicyDocument } : {}),
      });
      return {
        physicalId: endpoint.VpcEndpointId,
        attrs: { CreationTimestamp: endpoint.CreationTimestamp, DnsEntries: [], NetworkInterfaceIds: endpoint.NetworkInterfaceIds || [] },
      };
    },
    async update({ physicalId, props, sims, previous }) {
      sims.vpc.modifyVPCEndpoint(physicalId, {
        PolicyDocument: props.PolicyDocument,
        PrivateDnsEnabled: toBool(props.PrivateDnsEnabled, false),
      });
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteVPCEndpoint(physicalId);
    },
  },

  "AWS::EC2::VPCPeeringConnection": {
    requires: ["vpc"],
    inPlace: ["Tags"],
    async create({ props, sims }) {
      const conn = sims.vpc.createVPCPeeringConnection(props.VpcId, props.PeerVpcId, {});
      return { physicalId: conn.VpcPeeringConnectionId, attrs: {} };
    },
    async delete({ physicalId, sims }) {
      sims.vpc.deleteVPCPeeringConnection(physicalId);
    },
  },

  "AWS::EC2::SecurityGroup": {
    requires: ["ec2"],
    inPlace: ["Tags", "SecurityGroupIngress", "SecurityGroupEgress"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.GroupName || generateName(stackName, logicalId, { max: 255 });
      const sg = sims.ec2.createSecurityGroup(name, props.GroupDescription || "", props.VpcId || null, { Tags: tags(props) });
      applyRules(sg, props);
      persistEc2(sims);
      return { physicalId: sg.GroupId, attrs: { GroupId: sg.GroupId, VpcId: sg.VpcId } };
    },
    async update({ physicalId, props, sims, previous }) {
      const sg = sims.ec2.getSecurityGroup(physicalId);
      sg.Tags = tags(props);
      sg.IpPermissions = [];
      applyRules(sg, props);
      persistEc2(sims);
      return { physicalId, attrs: previous.attrs };
    },
    async delete({ physicalId, sims }) {
      sims.ec2.deleteSecurityGroup(physicalId);
      persistEc2(sims);
    },
  },

  "AWS::EC2::SecurityGroupIngress": {
    requires: ["ec2"],
    inPlace: [],
    async create({ props, sims, logicalId, stackName }) {
      const sg = sims.ec2.getSecurityGroup(props.GroupId);
      applyRules(sg, { SecurityGroupIngress: [props] });
      persistEc2(sims);
      return { physicalId: `${stackName}-${logicalId}`, attrs: {} };
    },
    async delete({ props, sims }) {
      try {
        const sg = sims.ec2.getSecurityGroup(props.GroupId);
        const cidr = props.CidrIp;
        sg.IpPermissions = sg.IpPermissions.filter((r) => !(r.IpProtocol === String(props.IpProtocol) && r.FromPort === toNumber(props.FromPort) && (r.IpRanges || []).some((x) => x.CidrIp === cidr)));
        persistEc2(sims);
      } catch (_) {}
    },
  },

  "AWS::EC2::SecurityGroupEgress": {
    requires: ["ec2"],
    inPlace: [],
    async create({ props, sims, logicalId, stackName }) {
      const sg = sims.ec2.getSecurityGroup(props.GroupId);
      const protocol = String(props.IpProtocol ?? "tcp");
      sg.addEgressRule(props.CidrIp || null, props.DestinationSecurityGroupId || null, toNumber(props.FromPort, -1), toNumber(props.ToPort, -1), protocol, props.Description || "");
      persistEc2(sims);
      return { physicalId: `${stackName}-${logicalId}`, attrs: {} };
    },
    async delete() {},
  },

  "AWS::EC2::Instance": {
    requires: ["ec2"],
    inPlace: ["Tags", "Monitoring", "DisableApiTermination", "InstanceInitiatedShutdownBehavior", "SecurityGroupIds", "SecurityGroups", "IamInstanceProfile", "UserData"],
    async create({ props, sims, env }) {
      let subnetId = props.SubnetId;
      let securityGroupIds = props.SecurityGroupIds || props.SecurityGroups || [];
      const ni = (props.NetworkInterfaces || [])[0];
      if (ni) {
        subnetId = subnetId || ni.SubnetId;
        securityGroupIds = securityGroupIds.length ? securityGroupIds : ni.GroupSet || [];
      }
      let vpcId = null;
      let zone = props.AvailabilityZone || az(env);
      if (subnetId && sims.vpc) {
        try {
          const subnet = sims.vpc.getSubnet(subnetId);
          vpcId = subnet.VpcId;
          zone = subnet.AvailabilityZone || zone;
        } catch (_) {}
      }
      const [instance] = sims.ec2.runInstances(props.ImageId, 1, props.InstanceType || "t2.micro", {
        SubnetId: subnetId,
        VpcId: vpcId,
        SecurityGroupIds: securityGroupIds.length ? securityGroupIds : undefined,
        KeyName: props.KeyName,
        Tags: tags(props),
        AvailabilityZone: zone,
      });
      return {
        physicalId: instance.InstanceId,
        attrs: {
          AvailabilityZone: zone,
          PrivateDnsName: `ip-${String(instance.PrivateIpAddress).replace(/\./g, "-")}.ec2.internal`,
          PrivateIp: instance.PrivateIpAddress,
          PublicDnsName: `ec2-${String(instance.PublicIpAddress).replace(/\./g, "-")}.compute-1.amazonaws.com`,
          PublicIp: instance.PublicIpAddress,
        },
      };
    },
    async delete({ physicalId, sims }) {
      sims.ec2.terminateInstances([physicalId]);
    },
  },

  "AWS::EC2::Volume": {
    requires: ["ec2"],
    inPlace: ["Tags"],
    async create({ props, sims, env }) {
      const volume = sims.ec2.createVolume({
        Size: props.Size !== undefined ? Number(props.Size) : undefined,
        VolumeType: props.VolumeType || "gp2",
        AvailabilityZone: props.AvailabilityZone || az(env),
        Encrypted: toBool(props.Encrypted, false),
        Iops: props.Iops !== undefined ? Number(props.Iops) : undefined,
        SnapshotId: props.SnapshotId,
        Tags: tags(props),
      });
      return { physicalId: volume.VolumeId, attrs: { VolumeId: volume.VolumeId } };
    },
    async delete({ physicalId, sims }) {
      sims.ec2.deleteVolume(physicalId);
    },
  },

  "AWS::EC2::VolumeAttachment": {
    requires: ["ec2"],
    inPlace: [],
    async create({ props, sims, logicalId, stackName }) {
      sims.ec2.attachVolume(props.VolumeId, props.InstanceId, props.Device || "/dev/sdf", false);
      return { physicalId: `${stackName}-${logicalId}-${props.VolumeId}`, attrs: {} };
    },
    async delete({ props, sims }) {
      try {
        sims.ec2.detachVolume(props.VolumeId, props.InstanceId);
      } catch (_) {}
    },
  },

  "AWS::EC2::KeyPair": {
    requires: ["ec2"],
    inPlace: ["Tags"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.KeyName || generateName(stackName, logicalId, { max: 255 });
      const kp = sims.ec2.createKeyPair(name, props.PublicKeyMaterial || null, { Tags: tags(props) });
      return { physicalId: name, attrs: { KeyPairId: kp.KeyPairId, KeyFingerprint: kp.KeyFingerprint, KeyName: name } };
    },
    async delete({ physicalId, sims }) {
      sims.ec2.deleteKeyPair(physicalId);
    },
  },

  "AWS::EC2::LaunchTemplate": {
    requires: ["ec2"],
    inPlace: ["TagSpecifications"],
    async create({ logicalId, stackName, props, sims }) {
      const name = props.LaunchTemplateName || generateName(stackName, logicalId, { max: 128 });
      const lt = sims.ec2.createLaunchTemplate({
        LaunchTemplateName: name,
        LaunchTemplateData: props.LaunchTemplateData || {},
        VersionDescription: props.VersionDescription,
        Tags: [],
      });
      return {
        physicalId: lt.LaunchTemplateId,
        attrs: { LaunchTemplateId: lt.LaunchTemplateId, DefaultVersionNumber: "1", LatestVersionNumber: "1" },
      };
    },
    async update({ physicalId, props, sims, previous }) {
      const version = sims.ec2.createLaunchTemplateVersion(physicalId, {
        LaunchTemplateData: props.LaunchTemplateData || {},
        VersionDescription: props.VersionDescription,
      });
      const number = String(version?.VersionNumber ?? 2);
      return { physicalId, attrs: { ...previous.attrs, LatestVersionNumber: number } };
    },
    async delete({ physicalId, sims }) {
      sims.ec2.deleteLaunchTemplate(physicalId);
    },
  },

  "AWS::EC2::NetworkInterface": {
    requires: ["ec2"],
    inPlace: ["Tags", "Description"],
    async create({ props, sims, env }) {
      let vpcId = null;
      if (props.SubnetId && sims.vpc) {
        try {
          vpcId = sims.vpc.getSubnet(props.SubnetId).VpcId;
        } catch (_) {}
      }
      const eni = sims.ec2.createNetworkInterface(props.SubnetId, vpcId, {
        Description: props.Description || "",
        Groups: (props.GroupSet || []).map((id) => ({ GroupId: id })),
        Tags: tags(props),
      });
      return {
        physicalId: eni.NetworkInterfaceId,
        attrs: { PrimaryPrivateIpAddress: eni.PrivateIpAddresses?.[0]?.PrivateIpAddress, SecondaryPrivateIpAddresses: [] },
      };
    },
    async delete({ physicalId, sims }) {
      sims.ec2.deleteNetworkInterface(physicalId);
    },
  },
};
