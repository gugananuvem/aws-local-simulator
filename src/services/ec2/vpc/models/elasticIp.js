/**
 * Elastic IP Model
 *
 * Um Elastic IP é um endereço IPv4 público estático. Na AWS ele pode ser
 * alocado, associado a uma instância/ENI e liberado.
 */

const { generateResourceId } = require('./identifier');

// Faixa de documentação TEST-NET-3 (203.0.113.0/24) usada para simular IPs públicos.
function randomPublicIp() {
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
}

class ElasticIp {
  constructor(config = {}) {
    this.AllocationId = generateResourceId('eipalloc');
    this.PublicIp = config.PublicIp || randomPublicIp();
    this.Domain = config.Domain || 'vpc';
    this.PublicIpv4Pool = config.PublicIpv4Pool || 'amazon';
    this.NetworkBorderGroup = config.NetworkBorderGroup || 'us-east-1';
    this.Tags = config.Tags || [];
    this.CreatedAt = new Date().toISOString();

    // Estado de associação
    this.AssociationId = null;
    this.InstanceId = null;
    this.NetworkInterfaceId = null;
    this.PrivateIpAddress = null;
  }

  isAssociated() {
    return !!this.AssociationId;
  }

  associate({ instanceId, networkInterfaceId, privateIpAddress }) {
    if (this.isAssociated()) {
      throw new Error(`Elastic IP ${this.AllocationId} is already associated`);
    }

    this.AssociationId = generateResourceId('eipassoc');
    this.InstanceId = instanceId || null;
    this.NetworkInterfaceId = networkInterfaceId || null;
    this.PrivateIpAddress = privateIpAddress || '10.0.0.10';
    return this;
  }

  disassociate() {
    if (!this.isAssociated()) {
      throw new Error(`Elastic IP ${this.AllocationId} is not associated`);
    }

    this.AssociationId = null;
    this.InstanceId = null;
    this.NetworkInterfaceId = null;
    this.PrivateIpAddress = null;
    return this;
  }

  toJSON() {
    return {
      AllocationId: this.AllocationId,
      PublicIp: this.PublicIp,
      Domain: this.Domain,
      PublicIpv4Pool: this.PublicIpv4Pool,
      NetworkBorderGroup: this.NetworkBorderGroup,
      Tags: this.Tags,
      CreatedAt: this.CreatedAt,
      AssociationId: this.AssociationId,
      InstanceId: this.InstanceId,
      NetworkInterfaceId: this.NetworkInterfaceId,
      PrivateIpAddress: this.PrivateIpAddress
    };
  }

  static fromJSON(data = {}) {
    const eip = new ElasticIp({
      PublicIp: data.PublicIp,
      Domain: data.Domain,
      PublicIpv4Pool: data.PublicIpv4Pool,
      NetworkBorderGroup: data.NetworkBorderGroup,
      Tags: data.Tags || []
    });
    eip.AllocationId = data.AllocationId || eip.AllocationId;
    eip.CreatedAt = data.CreatedAt || eip.CreatedAt;
    eip.AssociationId = data.AssociationId || null;
    eip.InstanceId = data.InstanceId || null;
    eip.NetworkInterfaceId = data.NetworkInterfaceId || null;
    eip.PrivateIpAddress = data.PrivateIpAddress || null;
    return eip;
  }
}

module.exports = ElasticIp;
