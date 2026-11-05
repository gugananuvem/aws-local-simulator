/**
 * Route53 Hosted Zone Model
 */

class HostedZone {
  constructor(name, config = {}) {
    this.Id = this.generateHostedZoneId();
    this.Name = name;
    this.Config = config || {};
    this.ResourceRecordSetCount = 0;
    this.CallerReference = config.CallerReference || new Date().getTime().toString();
    this.HostedZoneConfig = {
      Comment: config.Comment || '',
      PrivateZone: config.PrivateZone || false,
    };
    this.CreatedDate = new Date().toISOString();
  }

  generateHostedZoneId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `/hostedzone/${random}${timestamp}`.substring(0, 30);
  }

  toJSON() {
    return {
      Id: this.Id,
      Name: this.Name,
      CallerReference: this.CallerReference,
      Config: this.HostedZoneConfig,
      ResourceRecordSetCount: this.ResourceRecordSetCount,
      CreatedDate: this.CreatedDate,
    };
  }
}

module.exports = HostedZone;
