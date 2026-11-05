/**
 * Dedicated Host Model
 */

const { v4: uuidv4 } = require('uuid');

class DedicatedHost {
  constructor(instanceType, availabilityZone, config = {}) {
    this.HostId = `h-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.InstanceType = instanceType;
    this.AvailabilityZone = availabilityZone;
    this.State = 'available'; // available, under-assessment, pending, released
    this.AllocationTime = new Date().toISOString();
    this.AutoPlacement = config.AutoPlacement || 'off';
    this.HostRecovery = config.HostRecovery || 'off';
    this.OwnerId = '123456789012';
    this.Instances = [];

    const total = Number(config.InstanceCapacity) || 1;
    this.AvailableCapacity = {
      AvailableInstanceCapacity: [
        {
          InstanceType: instanceType,
          AvailableCapacity: total,
          TotalCapacity: total
        }
      ],
      AvailableVCpus: Number(config.VCpus) || 8
    };
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      HostId: this.HostId,
      InstanceType: this.InstanceType,
      AvailabilityZone: this.AvailabilityZone,
      State: this.State,
      AllocationTime: this.AllocationTime,
      AutoPlacement: this.AutoPlacement,
      HostRecovery: this.HostRecovery,
      OwnerId: this.OwnerId,
      AvailableCapacity: this.AvailableCapacity,
      Instances: this.Instances,
      Tags: this.Tags
    };
  }
}

module.exports = DedicatedHost;
