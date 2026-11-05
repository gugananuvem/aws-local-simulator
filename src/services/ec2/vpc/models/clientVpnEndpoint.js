/**
 * Client VPN Endpoint Model
 *
 * Representa um endpoint de VPN de cliente (Client VPN). O certificado do
 * servidor é referenciado por ARN e deve vir do serviço ACM.
 */

const { generateResourceId } = require('./identifier');

class ClientVpnEndpoint {
  constructor(config = {}) {
    this.ClientVpnEndpointId = generateResourceId('cvpn-endpoint');
    this.Description = config.Description || '';
    this.Status = { Code: 'available' };
    this.ClientCidrBlock = config.ClientCidrBlock || '10.100.0.0/16';
    this.DnsServers = config.DnsServers || [];
    this.SplitTunnel = config.SplitTunnel !== false;
    this.VpnProtocol = config.VpnProtocol || 'openvpn';
    this.TransportProtocol = config.TransportProtocol || 'udp';
    this.VpnPort = config.VpnPort || 443;
    this.AssociatedTargetNetworks = [];
    this.AuthenticationOptions = config.AuthenticationOptions || [
      {
        Type: 'certificate-authentication',
        MutualAuthentication: { ClientRootCertificateChain: '' }
      }
    ];
    this.ConnectionLogOptions = config.ConnectionLogOptions || { Enabled: false };
    this.ServerCertificateArn = config.ServerCertificateArn || null;
    this.ClientLoginBannerOptions = config.ClientLoginBannerOptions || { Enabled: false };
    this.SecurityGroupIds = config.SecurityGroupIds || [];
    this.VpcId = config.VpcId || null;
    this.SelfServicePortal = config.SelfServicePortal || 'disabled';
    this.ClientConnectOptions = config.ClientConnectOptions || { Enabled: false };
    this.SessionTimeoutHours = config.SessionTimeoutHours || 24;
    this.Tags = config.Tags || [];
    this.CreationTime = new Date().toISOString();
  }

  associateTargetNetwork(targetNetworkId) {
    if (this.AssociatedTargetNetworks.some(n => n.TargetNetworkId === targetNetworkId)) {
      throw new Error(`Subnet ${targetNetworkId} already associated`);
    }
    this.AssociatedTargetNetworks.push({ TargetNetworkId: targetNetworkId, Status: { Code: 'associated' } });
  }

  toJSON() {
    return {
      ClientVpnEndpointId: this.ClientVpnEndpointId,
      Description: this.Description,
      Status: this.Status,
      ClientCidrBlock: this.ClientCidrBlock,
      DnsServers: this.DnsServers,
      SplitTunnel: this.SplitTunnel,
      VpnProtocol: this.VpnProtocol,
      TransportProtocol: this.TransportProtocol,
      VpnPort: this.VpnPort,
      AssociatedTargetNetworks: this.AssociatedTargetNetworks,
      AuthenticationOptions: this.AuthenticationOptions,
      ConnectionLogOptions: this.ConnectionLogOptions,
      ServerCertificateArn: this.ServerCertificateArn,
      ClientLoginBannerOptions: this.ClientLoginBannerOptions,
      SecurityGroupIds: this.SecurityGroupIds,
      VpcId: this.VpcId,
      SelfServicePortal: this.SelfServicePortal,
      ClientConnectOptions: this.ClientConnectOptions,
      SessionTimeoutHours: this.SessionTimeoutHours,
      Tags: this.Tags,
      CreationTime: this.CreationTime
    };
  }

  static fromJSON(data = {}) {
    const endpoint = Object.create(ClientVpnEndpoint.prototype);
    Object.assign(endpoint, data);
    endpoint.Status = data.Status || { Code: 'available' };
    endpoint.AssociatedTargetNetworks = data.AssociatedTargetNetworks || [];
    endpoint.AuthenticationOptions = data.AuthenticationOptions || [];
    endpoint.DnsServers = data.DnsServers || [];
    endpoint.SecurityGroupIds = data.SecurityGroupIds || [];
    endpoint.Tags = data.Tags || [];
    return endpoint;
  }
}

module.exports = ClientVpnEndpoint;
