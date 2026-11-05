/**
 * EC2 Instance Model
 */

const { v4: uuidv4 } = require('uuid');

class Instance {
  constructor(imageId, instanceType = 't2.micro', config = {}) {
    this.InstanceId = `i-${uuidv4().substring(0, 8)}`;
    this.ImageId = imageId;
    this.InstanceType = instanceType;
    this.State = 'running'; // pending, running, stopping, stopped, shutting-down, terminated
    this.StateTransitionReason = 'User initiated';
    this.LaunchTime = new Date().toISOString();
    this.PrivateIpAddress = config.PrivateIpAddress || this.generatePrivateIp();
    this.PublicIpAddress = config.PublicIpAddress || this.generatePublicIp();
    this.SubnetId = config.SubnetId || null;
    this.VpcId = config.VpcId || null;
    this.SecurityGroupIds = config.SecurityGroupIds || ['sg-default'];
    this.KeyName = config.KeyName || null;
    this.Tags = config.Tags || [];
    this.Monitoring = config.Monitoring || { State: 'disabled' };
    this.IamInstanceProfile = config.IamInstanceProfile || null;
    this.EbsOptimized = config.EbsOptimized || false;
    this.RootDeviceType = 'ebs';
    this.Architecture = 'x86_64';
    this.VirtualizationType = 'hvm';
    this.Hypervisor = 'xen';
    this.WebServerPort = config.WebServerPort || this.assignWebServerPort();
    this.WebServerDir = config.WebServerDir || null;
    this.ProxyUrl = config.ProxyUrl || null; // URL externa para proxy (ex: http://localhost:3000)
    this.WebServer = null; // Será preenchido com a instância do servidor
    this.CpuUtilization = 0;
    this.MemoryUtilization = 0;
  }

  generatePrivateIp() {
    return `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  }

  generatePublicIp() {
    return `54.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  }

  assignWebServerPort() {
    // Porta entre 8001 e 8999
    return 8000 + Math.floor(Math.random() * 1000);
  }

  setState(state, reason = '') {
    this.State = state;
    this.StateTransitionReason = reason || this.StateTransitionReason;
  }

  isRunning() {
    return this.State === 'running';
  }

  isStopped() {
    return this.State === 'stopped';
  }

  isTerminated() {
    return this.State === 'terminated';
  }

  toJSON() {
    return {
      InstanceId: this.InstanceId,
      ImageId: this.ImageId,
      InstanceType: this.InstanceType,
      State: this.State,
      StateTransitionReason: this.StateTransitionReason,
      LaunchTime: this.LaunchTime,
      PrivateIpAddress: this.PrivateIpAddress,
      PublicIpAddress: this.PublicIpAddress,
      SubnetId: this.SubnetId,
      VpcId: this.VpcId,
      SecurityGroupIds: this.SecurityGroupIds,
      KeyName: this.KeyName,
      Tags: this.Tags,
      Monitoring: this.Monitoring,
      IamInstanceProfile: this.IamInstanceProfile,
      EbsOptimized: this.EbsOptimized,
      RootDeviceType: this.RootDeviceType,
      Architecture: this.Architecture,
      VirtualizationType: this.VirtualizationType,
      Hypervisor: this.Hypervisor,
      WebServerPort: this.WebServerPort,
      WebServerDir: this.WebServerDir,
      ProxyUrl: this.ProxyUrl,
      CpuUtilization: this.CpuUtilization,
      MemoryUtilization: this.MemoryUtilization
    };
  }
}

module.exports = Instance;
