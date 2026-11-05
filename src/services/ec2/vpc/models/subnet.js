/**
 * Subnet Model
 */

const { v4: uuidv4 } = require('uuid');

class Subnet {
  constructor(vpcId, cidrBlock, availabilityZone, tags = [], config = {}) {
    this.SubnetId = `subnet-${uuidv4().substring(0, 8)}`;
    this.VpcId = vpcId;
    this.CidrBlock = cidrBlock;
    this.AvailabilityZone = availabilityZone;
    this.State = 'available';
    this.AvailableIpAddressCount = this.calculateAvailableIps(cidrBlock);
    this.MapPublicIpOnLaunch = config.MapPublicIpOnLaunch || false;
    this.Tags = tags;
    this.CreatedAt = new Date().toISOString();
    this.AssignIpv6AddressOnCreation = config.AssignIpv6AddressOnCreation || false;
  }

  calculateAvailableIps(cidrBlock) {
    // Simples cálculo: /24 = 256 - 5 (reservados AWS) = 251
    const parts = cidrBlock.split('/');
    if (parts.length === 2) {
      const prefixLength = parseInt(parts[1]);
      const totalIps = Math.pow(2, 32 - prefixLength);
      return Math.max(1, totalIps - 5); // AWS reserva 5 IPs
    }
    return 250;
  }

  toJSON() {
    return {
      SubnetId: this.SubnetId,
      VpcId: this.VpcId,
      CidrBlock: this.CidrBlock,
      AvailabilityZone: this.AvailabilityZone,
      State: this.State,
      AvailableIpAddressCount: this.AvailableIpAddressCount,
      MapPublicIpOnLaunch: this.MapPublicIpOnLaunch,
      Tags: this.Tags,
      CreatedAt: this.CreatedAt,
      AssignIpv6AddressOnCreation: this.AssignIpv6AddressOnCreation
    };
  }
}

module.exports = Subnet;
