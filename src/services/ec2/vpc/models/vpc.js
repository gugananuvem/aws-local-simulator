/**
 * VPC Model
 */

const { v4: uuidv4 } = require('uuid');

class VPC {
  constructor(cidrBlock, tags = [], config = {}) {
    this.VpcId = `vpc-${uuidv4().substring(0, 8)}`;
    this.CidrBlock = cidrBlock;
    this.State = 'available';
    this.IsDefault = false;
    this.DhcpOptionsId = config.DhcpOptionsId || null;
    this.Tags = tags;
    this.CreatedAt = new Date().toISOString();
    this.Ipv6CidrBlockAssociationSet = [];
    this.EnableDnsHostnames = config.EnableDnsHostnames !== false;
    this.EnableDnsSupport = config.EnableDnsSupport !== false;
    this.InstanceTenancy = config.InstanceTenancy || 'default';
  }

  toJSON() {
    return {
      VpcId: this.VpcId,
      CidrBlock: this.CidrBlock,
      State: this.State,
      IsDefault: this.IsDefault,
      DhcpOptionsId: this.DhcpOptionsId,
      Tags: this.Tags,
      CreatedAt: this.CreatedAt,
      Ipv6CidrBlockAssociationSet: this.Ipv6CidrBlockAssociationSet,
      EnableDnsHostnames: this.EnableDnsHostnames,
      EnableDnsSupport: this.EnableDnsSupport,
      InstanceTenancy: this.InstanceTenancy
    };
  }
}

module.exports = VPC;
