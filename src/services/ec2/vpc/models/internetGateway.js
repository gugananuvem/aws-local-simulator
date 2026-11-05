/**
 * Internet Gateway Model
 */

const { v4: uuidv4 } = require('uuid');

class InternetGatewayAttachment {
  constructor(vpcId) {
    this.VpcId = vpcId;
    this.State = 'available';
    this.CreatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      VpcId: this.VpcId,
      State: this.State
    };
  }
}

class InternetGateway {
  constructor(tags = []) {
    this.InternetGatewayId = `igw-${uuidv4().substring(0, 8)}`;
    this.Attachments = [];
    this.Tags = tags;
    this.State = 'available';
    this.OwnerId = '123456789012';
    this.CreatedAt = new Date().toISOString();
  }

  attach(vpcId) {
    // Verificar se já está anexado a esta VPC
    const exists = this.Attachments.some(a => a.VpcId === vpcId);
    if (exists) {
      throw new Error(`IGW already attached to VPC ${vpcId}`);
    }

    const attachment = new InternetGatewayAttachment(vpcId);
    this.Attachments.push(attachment);
    return attachment;
  }

  detach(vpcId) {
    const index = this.Attachments.findIndex(a => a.VpcId === vpcId);
    if (index === -1) {
      throw new Error(`IGW not attached to VPC ${vpcId}`);
    }

    const attachment = this.Attachments[index];
    this.Attachments.splice(index, 1);
    return attachment;
  }

  isAttachedTo(vpcId) {
    return this.Attachments.some(a => a.VpcId === vpcId);
  }

  toJSON() {
    return {
      InternetGatewayId: this.InternetGatewayId,
      Attachments: this.Attachments.map(a =>
        a && typeof a.toJSON === 'function' ? a.toJSON() : a
      ),
      Tags: this.Tags,
      State: this.State,
      OwnerId: this.OwnerId,
      CreatedAt: this.CreatedAt
    };
  }
}

module.exports = { InternetGateway, InternetGatewayAttachment };
