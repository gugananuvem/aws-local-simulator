/**
 * EBS Snapshot Model
 * Representa um snapshot de volume do Elastic Block Store.
 */

const { v4: uuidv4 } = require('uuid');

class Snapshot {
  constructor(config = {}) {
    this.SnapshotId = `snap-${uuidv4().substring(0, 8)}`;
    this.VolumeId = config.VolumeId || '';
    this.VolumeSize = config.VolumeSize !== undefined ? Number(config.VolumeSize) : 8;
    this.State = 'completed'; // pending, completed, error
    this.Progress = '100%';
    this.Description = config.Description || '';
    this.Encrypted = config.Encrypted || false;
    this.OwnerId = '123456789012';
    this.StartTime = new Date().toISOString();
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      SnapshotId: this.SnapshotId,
      VolumeId: this.VolumeId,
      VolumeSize: this.VolumeSize,
      State: this.State,
      Progress: this.Progress,
      Description: this.Description,
      Encrypted: this.Encrypted,
      OwnerId: this.OwnerId,
      StartTime: this.StartTime,
      Tags: this.Tags
    };
  }
}

module.exports = { Snapshot };
