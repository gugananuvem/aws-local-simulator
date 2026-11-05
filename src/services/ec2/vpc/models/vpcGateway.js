/**
 * VPC Gateway Model (NAT Gateway, Customer Gateway, etc)
 */

const { generateResourceId } = require('./identifier');

class NATGateway {
  constructor(subnetId, allocationId, config = {}) {
    this.NatGatewayId = generateResourceId('nat');
    this.SubnetId = subnetId;
    this.AllocationId = allocationId || null;
    this.ConnectivityType = config.ConnectivityType || (allocationId ? 'public' : 'private');
    this.PublicIp = config.PublicIp || `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
    this.PrivateIp = config.PrivateIp || null;
    this.State = 'available';
    this.FailureCode = null;
    this.FailureMessage = null;
    this.CreateTime = new Date().toISOString();
    this.DeleteTime = null;
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      NatGatewayId: this.NatGatewayId,
      SubnetId: this.SubnetId,
      AllocationId: this.AllocationId,
      ConnectivityType: this.ConnectivityType,
      PublicIp: this.PublicIp,
      PrivateIp: this.PrivateIp,
      State: this.State,
      FailureCode: this.FailureCode,
      FailureMessage: this.FailureMessage,
      CreateTime: this.CreateTime,
      DeleteTime: this.DeleteTime,
      Tags: this.Tags
    };
  }

  static fromJSON(data = {}) {
    const nat = new NATGateway(data.SubnetId, data.AllocationId, {
      ConnectivityType: data.ConnectivityType,
      PublicIp: data.PublicIp,
      PrivateIp: data.PrivateIp,
      Tags: data.Tags || []
    });
    nat.NatGatewayId = data.NatGatewayId || nat.NatGatewayId;
    nat.State = data.State || 'available';
    nat.CreateTime = data.CreateTime || nat.CreateTime;
    nat.DeleteTime = data.DeleteTime || null;
    return nat;
  }
}

class CustomerGateway {
  constructor(type, bgpAsn, config = {}) {
    this.CustomerGatewayId = generateResourceId('cgw');
    this.Type = type || 'ipsec.1';
    this.BgpAsn = bgpAsn;
    this.IpAddress = config.IpAddress || config.PublicIp || null;
    this.CertificateArn = config.CertificateArn || null;
    this.AmazonSideAsn = config.AmazonSideAsn || null;
    this.State = 'available';
    this.CreateTime = new Date().toISOString();
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      CustomerGatewayId: this.CustomerGatewayId,
      Type: this.Type,
      BgpAsn: this.BgpAsn,
      IpAddress: this.IpAddress,
      CertificateArn: this.CertificateArn,
      AmazonSideAsn: this.AmazonSideAsn,
      State: this.State,
      CreateTime: this.CreateTime,
      Tags: this.Tags
    };
  }

  static fromJSON(data = {}) {
    const cgw = Object.create(CustomerGateway.prototype);
    cgw.CustomerGatewayId = data.CustomerGatewayId;
    cgw.Type = data.Type || 'ipsec.1';
    cgw.BgpAsn = data.BgpAsn;
    cgw.IpAddress = data.IpAddress || null;
    cgw.CertificateArn = data.CertificateArn || null;
    cgw.AmazonSideAsn = data.AmazonSideAsn || null;
    cgw.State = data.State || 'available';
    cgw.CreateTime = data.CreateTime || new Date().toISOString();
    cgw.Tags = data.Tags || [];
    return cgw;
  }
}

class VpnGateway {
  constructor(type, config = {}) {
    this.VpnGatewayId = generateResourceId('vgw');
    this.Type = type || 'ipsec.1';
    this.State = 'available';
    this.AvailabilityZone = config.AvailabilityZone || null;
    this.AmazonSideAsn = config.AmazonSideAsn || 64512;
    this.VpcAttachments = config.VpcAttachments || [];
    this.CreateTime = new Date().toISOString();
    this.Tags = config.Tags || [];
  }

  attachToVpc(vpcId) {
    const exists = this.VpcAttachments.some(a => a.VpcId === vpcId);
    if (exists) {
      throw new Error(`VPN Gateway already attached to VPC ${vpcId}`);
    }

    this.VpcAttachments.push({
      VpcId: vpcId,
      State: 'attached'
    });
  }

  detachFromVpc(vpcId) {
    const index = this.VpcAttachments.findIndex(a => a.VpcId === vpcId);
    if (index === -1) {
      throw new Error(`VPN Gateway not attached to VPC ${vpcId}`);
    }

    this.VpcAttachments.splice(index, 1);
  }

  toJSON() {
    return {
      VpnGatewayId: this.VpnGatewayId,
      Type: this.Type,
      State: this.State,
      AvailabilityZone: this.AvailabilityZone,
      AmazonSideAsn: this.AmazonSideAsn,
      VpcAttachments: this.VpcAttachments,
      CreateTime: this.CreateTime,
      Tags: this.Tags
    };
  }

  static fromJSON(data = {}) {
    const vgw = Object.create(VpnGateway.prototype);
    vgw.VpnGatewayId = data.VpnGatewayId;
    vgw.Type = data.Type || 'ipsec.1';
    vgw.State = data.State || 'available';
    vgw.AvailabilityZone = data.AvailabilityZone || null;
    vgw.AmazonSideAsn = data.AmazonSideAsn || 64512;
    vgw.VpcAttachments = data.VpcAttachments || [];
    vgw.CreateTime = data.CreateTime || new Date().toISOString();
    vgw.Tags = data.Tags || [];
    return vgw;
  }
}

class VpnConnection {
  constructor(type, customerGatewayId, vpnGatewayId, config = {}) {
    this.VpnConnectionId = generateResourceId('vpn');
    this.Type = type || 'ipsec.1';
    this.CustomerGatewayId = customerGatewayId;
    this.VpnGatewayId = vpnGatewayId;
    this.CustomerGatewayConfiguration = config.CustomerGatewayConfiguration || null;
    this.TransitGatewayId = config.TransitGatewayId || null;
    this.Category = config.Category || 'VPN';
    this.State = 'available';
    this.Options = config.Options || {
      StaticRoutesOnly: false,
      TunnelOptions: [
        { TunnelInsideCidr: '169.254.10.0/30', OutsideIpAddress: '203.0.113.12' },
        { TunnelInsideCidr: '169.254.11.0/30', OutsideIpAddress: '203.0.113.13' }
      ]
    };
    this.VgwTelemetry = [
      { OutsideIpAddress: '203.0.113.12', Status: 'UP', AcceptedRouteCount: 0 },
      { OutsideIpAddress: '203.0.113.13', Status: 'UP', AcceptedRouteCount: 0 }
    ];
    this.Routes = config.Routes || [];
    this.CreateTime = new Date().toISOString();
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      VpnConnectionId: this.VpnConnectionId,
      Type: this.Type,
      CustomerGatewayId: this.CustomerGatewayId,
      VpnGatewayId: this.VpnGatewayId,
      CustomerGatewayConfiguration: this.CustomerGatewayConfiguration,
      TransitGatewayId: this.TransitGatewayId,
      Category: this.Category,
      State: this.State,
      Options: this.Options,
      VgwTelemetry: this.VgwTelemetry,
      Routes: this.Routes,
      CreateTime: this.CreateTime,
      Tags: this.Tags
    };
  }

  static fromJSON(data = {}) {
    const vpn = Object.create(VpnConnection.prototype);
    Object.assign(vpn, data);
    vpn.State = data.State || 'available';
    vpn.Options = data.Options || { StaticRoutesOnly: false, TunnelOptions: [] };
    vpn.VgwTelemetry = data.VgwTelemetry || [];
    vpn.Routes = data.Routes || [];
    vpn.Tags = data.Tags || [];
    return vpn;
  }
}

module.exports = {
  NATGateway,
  CustomerGateway,
  VpnGateway,
  VpnConnection
};
