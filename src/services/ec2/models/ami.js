/**
 * AMI (Amazon Machine Image) Model
 */

class AMI {
  constructor(name, description = '', config = {}) {
    this.ImageId = `ami-${Math.random().toString(36).substring(7)}`;
    this.Name = name;
    this.Description = description;
    this.Architecture = config.Architecture || 'x86_64';
    this.RootDeviceType = config.RootDeviceType || 'ebs';
    this.VirtualizationType = config.VirtualizationType || 'hvm';
    this.State = 'available';
    this.CreatedAt = new Date().toISOString();
    this.Public = config.Public !== false;
    this.Owner = config.Owner || '123456789012';
    this.SriovNetSupport = config.SriovNetSupport || false;
    this.EnaSupport = config.EnaSupport || true;
  }

  toJSON() {
    return {
      ImageId: this.ImageId,
      Name: this.Name,
      Description: this.Description,
      Architecture: this.Architecture,
      RootDeviceType: this.RootDeviceType,
      VirtualizationType: this.VirtualizationType,
      State: this.State,
      CreatedAt: this.CreatedAt,
      Public: this.Public,
      Owner: this.Owner,
      SriovNetSupport: this.SriovNetSupport,
      EnaSupport: this.EnaSupport
    };
  }
}

module.exports = AMI;
