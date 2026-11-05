/**
 * Security Group Model
 */

const { v4: uuidv4 } = require('uuid');

class SecurityGroup {
  constructor(name, description = '', vpcId = null, config = {}) {
    this.GroupId = `sg-${uuidv4().substring(0, 8)}`;
    this.GroupName = name;
    this.Description = description;
    this.VpcId = vpcId;
    this.OwnerId = '123456789012';
    this.IpPermissions = [];
    this.IpPermissionsEgress = [];
    this.Tags = config.Tags || [];
    this.CreatedAt = new Date().toISOString();
    
    // Adicionar regra padrão de saída (allow all)
    this.addEgressRule('0.0.0.0/0', null, -1, -1);
  }

  addIngressRule(cidr, securityGroupId, fromPort, toPort, protocol = 'tcp', description = '') {
    const rule = {
      IpProtocol: protocol,
      FromPort: fromPort,
      ToPort: toPort,
      IpRanges: cidr ? [{ CidrIp: cidr, Description: description }] : [],
      UserIdGroupPairs: securityGroupId ? [{ GroupId: securityGroupId }] : [],
      CreatedAt: new Date().toISOString()
    };
    this.IpPermissions.push(rule);
    return rule;
  }

  addEgressRule(cidr, securityGroupId, fromPort, toPort, protocol = 'tcp', description = '') {
    const rule = {
      IpProtocol: protocol,
      FromPort: fromPort,
      ToPort: toPort,
      IpRanges: cidr ? [{ CidrIp: cidr, Description: description }] : [],
      UserIdGroupPairs: securityGroupId ? [{ GroupId: securityGroupId }] : [],
      CreatedAt: new Date().toISOString()
    };
    this.IpPermissionsEgress.push(rule);
    return rule;
  }

  removeIngressRule(index) {
    if (index >= 0 && index < this.IpPermissions.length) {
      return this.IpPermissions.splice(index, 1)[0];
    }
    throw new Error(`Invalid rule index: ${index}`);
  }

  toJSON() {
    return {
      GroupId: this.GroupId,
      GroupName: this.GroupName,
      Description: this.Description,
      VpcId: this.VpcId,
      OwnerId: this.OwnerId,
      IpPermissions: this.IpPermissions,
      IpPermissionsEgress: this.IpPermissionsEgress,
      Tags: this.Tags,
      CreatedAt: this.CreatedAt
    };
  }
}

module.exports = SecurityGroup;
