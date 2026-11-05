/**
 * Launch Template Model - Template de configuração para ASG
 */

const { v4: uuid } = require('uuid');

class LaunchTemplate {
  constructor(name, imageId, instanceType, config = {}) {
    this.LaunchTemplateId = uuid();
    this.LaunchTemplateName = name;
    this.ImageId = imageId;
    this.InstanceType = instanceType;
    this.KeyName = config.keyName || null;
    this.SecurityGroupIds = config.securityGroupIds || [];
    this.UserData = config.userData || null;
    this.IamInstanceProfile = config.iamInstanceProfile || null;
    this.Monitoring = config.monitoring || { Enabled: false };
    this.TagSpecifications = config.tagSpecifications || [];
    this.CreationTime = new Date();
    this.VersionNumber = 1;
  }

  toJSON() {
    return {
      LaunchTemplateId: this.LaunchTemplateId,
      LaunchTemplateName: this.LaunchTemplateName,
      ImageId: this.ImageId,
      InstanceType: this.InstanceType,
      KeyName: this.KeyName,
      SecurityGroupIds: this.SecurityGroupIds,
      UserData: this.UserData,
      IamInstanceProfile: this.IamInstanceProfile,
      Monitoring: this.Monitoring,
      TagSpecifications: this.TagSpecifications,
      CreationTime: this.CreationTime,
      VersionNumber: this.VersionNumber
    };
  }
}

module.exports = LaunchTemplate;
