/**
 * Network ACL Model
 *
 * Representa uma Network ACL do VPC com suas regras (entries) e associações
 * com subnets. A AWS cria automaticamente uma ACL default por VPC, que permite
 * todo o tráfego de entrada e saída.
 */

const { v4: uuidv4 } = require('uuid');

class NetworkAclEntry {
  constructor({ RuleNumber, Protocol = '-1', RuleAction = 'deny', Egress = false, CidrBlock = '0.0.0.0/0', IcmpTypeCode, PortRange } = {}) {
    this.RuleNumber = Number(RuleNumber);
    this.Protocol = Protocol;
    this.RuleAction = RuleAction;
    this.Egress = !!Egress;
    this.CidrBlock = CidrBlock;
    this.IcmpTypeCode = IcmpTypeCode;
    this.PortRange = PortRange;
  }

  toJSON() {
    return {
      RuleNumber: this.RuleNumber,
      Protocol: this.Protocol,
      RuleAction: this.RuleAction,
      Egress: this.Egress,
      CidrBlock: this.CidrBlock,
      IcmpTypeCode: this.IcmpTypeCode,
      PortRange: this.PortRange
    };
  }
}

class NetworkAclAssociation {
  constructor(networkAclId, subnetId) {
    this.NetworkAclAssociationId = `aclassoc-${uuidv4().substring(0, 8)}`;
    this.NetworkAclId = networkAclId;
    this.SubnetId = subnetId;
  }

  toJSON() {
    return {
      NetworkAclAssociationId: this.NetworkAclAssociationId,
      NetworkAclId: this.NetworkAclId,
      SubnetId: this.SubnetId
    };
  }
}

class NetworkAcl {
  constructor(vpcId, tags = [], isDefault = false) {
    this.NetworkAclId = `acl-${uuidv4().substring(0, 8)}`;
    this.VpcId = vpcId;
    this.IsDefault = isDefault;
    this.OwnerId = '123456789012';
    this.Entries = [];
    this.Associations = [];
    this.Tags = tags;
    this.CreatedAt = new Date().toISOString();

    if (isDefault) {
      // Regras padrão da ACL default da VPC (permitir todo o tráfego)
      this.addEntry({ RuleNumber: 100, Protocol: '-1', RuleAction: 'allow', Egress: false, CidrBlock: '0.0.0.0/0' });
      this.addEntry({ RuleNumber: 100, Protocol: '-1', RuleAction: 'allow', Egress: true, CidrBlock: '0.0.0.0/0' });
    }
  }

  addEntry(entryData) {
    const entry = entryData instanceof NetworkAclEntry ? entryData : new NetworkAclEntry(entryData);
    // A AWS substitui uma regra existente com o mesmo número e direção
    this.Entries = this.Entries.filter(
      e => !(e.RuleNumber === entry.RuleNumber && e.Egress === entry.Egress)
    );
    this.Entries.push(entry);
    return entry;
  }

  removeEntry(ruleNumber, egress) {
    const before = this.Entries.length;
    this.Entries = this.Entries.filter(
      e => !(e.RuleNumber === Number(ruleNumber) && e.Egress === !!egress)
    );
    if (this.Entries.length === before) {
      throw new Error(`Network ACL entry ${ruleNumber} (egress=${egress}) not found`);
    }
    return true;
  }

  addAssociation(subnetId) {
    const existing = this.Associations.find(a => a.SubnetId === subnetId);
    if (existing) return existing;

    const association = new NetworkAclAssociation(this.NetworkAclId, subnetId);
    this.Associations.push(association);
    return association;
  }

  removeAssociation(subnetId) {
    const before = this.Associations.length;
    this.Associations = this.Associations.filter(a => a.SubnetId !== subnetId);
    return this.Associations.length !== before;
  }

  toJSON() {
    return {
      NetworkAclId: this.NetworkAclId,
      VpcId: this.VpcId,
      IsDefault: this.IsDefault,
      OwnerId: this.OwnerId,
      Entries: this.Entries.map(e => e.toJSON()),
      Associations: this.Associations.map(a => a.toJSON()),
      Tags: this.Tags,
      CreatedAt: this.CreatedAt
    };
  }
}

module.exports = { NetworkAcl, NetworkAclEntry, NetworkAclAssociation };
