/**
 * EBS Volume Model
 * Representa um volume do Elastic Block Store e seus anexos a instâncias.
 */

const { v4: uuidv4 } = require('uuid');

class VolumeAttachment {
  constructor(volumeId, instanceId, device, deleteOnTermination = false) {
    this.VolumeId = volumeId;
    this.InstanceId = instanceId;
    this.Device = device || '/dev/sdf';
    this.State = 'attached';
    this.AttachTime = new Date().toISOString();
    this.DeleteOnTermination = deleteOnTermination;
  }

  toJSON() {
    return {
      VolumeId: this.VolumeId,
      InstanceId: this.InstanceId,
      Device: this.Device,
      State: this.State,
      AttachTime: this.AttachTime,
      DeleteOnTermination: this.DeleteOnTermination
    };
  }
}

class Volume {
  constructor(config = {}) {
    this.VolumeId = `vol-${uuidv4().substring(0, 8)}`;
    this.Size = config.Size !== undefined ? Number(config.Size) : 8;
    this.VolumeType = config.VolumeType || 'gp3';
    this.Iops = this._defaultIops(this.VolumeType, config.Iops);
    this.Throughput = this._defaultThroughput(this.VolumeType, config.Throughput);
    this.AvailabilityZone = config.AvailabilityZone || 'us-east-1a';
    this.State = 'available'; // creating, available, in-use, deleting, deleted
    this.SnapshotId = config.SnapshotId || '';
    this.Encrypted = config.Encrypted || false;
    this.MultiAttachEnabled = config.MultiAttachEnabled || false;
    this.CreateTime = new Date().toISOString();
    this.Attachments = [];
    this.OwnerId = '123456789012';
    this.Tags = config.Tags || [];
  }

  _defaultIops(volumeType, iops) {
    if (iops !== undefined && iops !== null && iops !== '') return Number(iops);
    if (['io1', 'io2'].includes(volumeType)) return 100;
    if (volumeType === 'gp3') return 3000;
    return undefined;
  }

  _defaultThroughput(volumeType, throughput) {
    if (throughput !== undefined && throughput !== null && throughput !== '') {
      return Number(throughput);
    }
    if (volumeType === 'gp3') return 125;
    return undefined;
  }

  /**
   * Anexa o volume a uma instância.
   */
  attach(instanceId, device = '/dev/sdf', deleteOnTermination = false) {
    const alreadyAttached = this.Attachments.some(a => a.InstanceId === instanceId);
    if (alreadyAttached) {
      throw new Error(`Volume ${this.VolumeId} already attached to instance ${instanceId}`);
    }

    const attachment = new VolumeAttachment(this.VolumeId, instanceId, device, deleteOnTermination);
    this.Attachments.push(attachment);
    this.State = 'in-use';
    return attachment;
  }

  /**
   * Desanexa o volume (de uma instância específica ou de todas).
   */
  detach(instanceId = null) {
    const before = this.Attachments.length;

    if (instanceId) {
      this.Attachments = this.Attachments.filter(a => a.InstanceId !== instanceId);
    } else {
      this.Attachments = [];
    }

    if (this.Attachments.length === 0) {
      this.State = 'available';
    }

    return before - this.Attachments.length;
  }

  /**
   * Aplica uma modificação de volume (size/type/iops/throughput).
   */
  modify({ Size, VolumeType, Iops, Throughput } = {}) {
    const original = {
      Size: this.Size,
      VolumeType: this.VolumeType,
      Iops: this.Iops,
      Throughput: this.Throughput
    };

    if (Size !== undefined && Size !== null && Size !== '') this.Size = Number(Size);
    if (VolumeType) this.VolumeType = VolumeType;
    if (Iops !== undefined && Iops !== null && Iops !== '') this.Iops = Number(Iops);
    if (Throughput !== undefined && Throughput !== null && Throughput !== '') {
      this.Throughput = Number(Throughput);
    }

    return original;
  }

  toJSON() {
    return {
      VolumeId: this.VolumeId,
      Size: this.Size,
      VolumeType: this.VolumeType,
      Iops: this.Iops,
      Throughput: this.Throughput,
      AvailabilityZone: this.AvailabilityZone,
      State: this.State,
      SnapshotId: this.SnapshotId,
      Encrypted: this.Encrypted,
      MultiAttachEnabled: this.MultiAttachEnabled,
      CreateTime: this.CreateTime,
      Attachments: this.Attachments.map(a =>
        a && typeof a.toJSON === 'function' ? a.toJSON() : a
      ),
      OwnerId: this.OwnerId,
      Tags: this.Tags
    };
  }
}

module.exports = { Volume, VolumeAttachment };
