/**
 * Egress-only Internet Gateway Model
 *
 * Semelhante ao Internet Gateway, mas usado para permitir apenas tráfego
 * de saída (IPv6) da VPC para a internet.
 */

const { generateResourceId } = require('./identifier');

class EgressOnlyInternetGateway {
  constructor(vpcId = null, tags = []) {
    this.EgressOnlyInternetGatewayId = generateResourceId('eigw');
    this.Attachments = vpcId ? [{ VpcId: vpcId, State: 'attached' }] : [];
    this.Tags = tags;
  }

  attach(vpcId) {
    if (this.Attachments.some(a => a.VpcId === vpcId)) {
      throw new Error(`Egress-only IGW already attached to VPC ${vpcId}`);
    }
    this.Attachments.push({ VpcId: vpcId, State: 'attached' });
  }

  detach(vpcId) {
    const index = this.Attachments.findIndex(a => a.VpcId === vpcId);
    if (index === -1) {
      throw new Error(`Egress-only IGW not attached to VPC ${vpcId}`);
    }
    this.Attachments.splice(index, 1);
  }

  toJSON() {
    return {
      EgressOnlyInternetGatewayId: this.EgressOnlyInternetGatewayId,
      Attachments: this.Attachments,
      Tags: this.Tags
    };
  }

  static fromJSON(data = {}) {
    const eigw = new EgressOnlyInternetGateway(null, data.Tags || []);
    eigw.EgressOnlyInternetGatewayId =
      data.EgressOnlyInternetGatewayId || eigw.EgressOnlyInternetGatewayId;
    eigw.Attachments = (data.Attachments || []).map(att => ({
      VpcId: att.VpcId,
      State: att.State || 'attached'
    }));
    return eigw;
  }
}

module.exports = EgressOnlyInternetGateway;
