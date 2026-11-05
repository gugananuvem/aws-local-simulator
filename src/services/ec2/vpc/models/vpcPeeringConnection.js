/**
 * VPC Peering Connection Model
 *
 * Representa uma conexão de peering entre duas VPCs. Segue os estados
 * documentados pela AWS: initiating-request -> pending-acceptance -> active,
 * além de rejected/deleted/expired/failed.
 */

const { generateResourceId } = require('./identifier');

const OWNER_ID = '123456789012';
const REGION = 'us-east-1';

/** Monta o bloco `*VpcInfo` a partir de uma VPC. */
function vpcInfo(vpc, options = {}) {
  return {
    VpcId: vpc.VpcId,
    OwnerId: vpc.OwnerId || OWNER_ID,
    CidrBlock: vpc.CidrBlock,
    Region: vpc.Region || REGION,
    CidrBlockSet: [{ CidrBlock: vpc.CidrBlock }],
    PeeringOptions: {
      AllowDnsResolutionFromRemoteVpc: !!options.AllowDnsResolutionFromRemoteVpc,
      AllowEgressFromLocalClassicLinkToRemoteVpc: false,
      AllowEgressFromLocalVpcToRemoteClassicLink: false
    }
  };
}

class VPCPeeringConnection {
  constructor(requesterVpc, accepterVpc, options = {}) {
    this.VpcPeeringConnectionId = generateResourceId('pcx');
    this.RequesterVpcInfo = vpcInfo(requesterVpc, options);
    this.AccepterVpcInfo = vpcInfo(accepterVpc, options);
    // Requisições para outra conta/região começam como pending-acceptance;
    // no simulador local consideramos sempre o fluxo de aceitação manual.
    this.Status = { Code: 'pending-acceptance', Message: 'Pending Acceptance by Owner' };
    this.Tags = options.Tags || options.tagSpecifications || [];
    this.CreationTimestamp = new Date().toISOString();
  }

  accept() {
    if (this.Status.Code !== 'pending-acceptance') {
      throw new Error(`Cannot accept peering connection in state ${this.Status.Code}`);
    }
    this.Status = { Code: 'active', Message: 'Active' };
  }

  reject() {
    if (this.Status.Code !== 'pending-acceptance') {
      throw new Error(`Cannot reject peering connection in state ${this.Status.Code}`);
    }
    this.Status = { Code: 'rejected', Message: 'Rejected by Owner' };
  }

  toJSON() {
    return {
      VpcPeeringConnectionId: this.VpcPeeringConnectionId,
      RequesterVpcInfo: this.RequesterVpcInfo,
      AccepterVpcInfo: this.AccepterVpcInfo,
      Status: this.Status,
      Tags: this.Tags,
      CreationTimestamp: this.CreationTimestamp
    };
  }

  static fromJSON(data = {}) {
    const connection = Object.create(VPCPeeringConnection.prototype);
    connection.VpcPeeringConnectionId = data.VpcPeeringConnectionId;
    connection.RequesterVpcInfo = data.RequesterVpcInfo || {};
    connection.AccepterVpcInfo = data.AccepterVpcInfo || {};
    connection.Status = data.Status || { Code: 'pending-acceptance', Message: '' };
    connection.Tags = data.Tags || [];
    connection.CreationTimestamp = data.CreationTimestamp || new Date().toISOString();
    return connection;
  }
}

module.exports = VPCPeeringConnection;
