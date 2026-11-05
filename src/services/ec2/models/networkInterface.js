/**
 * Network Interface Model
 */

const { v4: uuidv4 } = require('uuid');

class NetworkInterface {
  constructor(subnetId, vpcId, config = {}) {
    this.NetworkInterfaceId = `eni-${uuidv4().substring(0, 8)}`;
    this.SubnetId = subnetId;
    this.VpcId = vpcId;
    this.Description = config.Description || '';
    this.PrivateIpAddresses = config.PrivateIpAddresses || [
      {
        PrivateIpAddress: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        Primary: true
      }
    ];
    this.Groups = config.Groups || [];
    this.MacAddress = this.generateMacAddress();
    this.Status = 'available'; // available, associated, detaching, detached
    this.Attachment = config.Attachment || null;
    this.SourceDestCheck = true;
    this.Tags = config.Tags || [];
    this.CreatedAt = new Date().toISOString();
  }

  generateMacAddress() {
    return '02:' + Array(5)
      .fill(0)
      .map(() => Math.floor(Math.random() * 255).toString(16).padStart(2, '0'))
      .join(':');
  }

  attachToInstance(instanceId, deviceIndex = 0) {
    this.Attachment = {
      AttachmentId: `eni-attach-${uuidv4().substring(0, 8)}`,
      InstanceId: instanceId,
      DeviceIndex: deviceIndex,
      Status: 'attached',
      AttachTime: new Date().toISOString()
    };
    this.Status = 'associated';
  }

  detachFromInstance() {
    if (this.Attachment) {
      this.Attachment.Status = 'detaching';
      setTimeout(() => {
        this.Attachment = null;
        this.Status = 'available';
      }, 1000);
    }
  }

  toJSON() {
    return {
      NetworkInterfaceId: this.NetworkInterfaceId,
      SubnetId: this.SubnetId,
      VpcId: this.VpcId,
      Description: this.Description,
      PrivateIpAddresses: this.PrivateIpAddresses,
      Groups: this.Groups,
      MacAddress: this.MacAddress,
      Status: this.Status,
      Attachment: this.Attachment,
      SourceDestCheck: this.SourceDestCheck,
      Tags: this.Tags,
      CreatedAt: this.CreatedAt
    };
  }
}

module.exports = NetworkInterface;
