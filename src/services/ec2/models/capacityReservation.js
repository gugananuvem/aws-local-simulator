/**
 * Capacity Reservation Model
 */

const { v4: uuidv4 } = require('uuid');

class CapacityReservation {
  constructor(instanceType, availabilityZone, instanceCount, config = {}) {
    this.CapacityReservationId = `cr-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.InstanceType = instanceType;
    this.AvailabilityZone = availabilityZone;
    this.TotalInstanceCount = Number(instanceCount) || 1;
    this.AvailableInstanceCount = this.TotalInstanceCount;
    this.InstancePlatform = config.InstancePlatform || 'Linux/UNIX';
    this.Tenancy = config.Tenancy || 'default';
    this.State = 'active'; // active, pending, cancelled, expired, failed
    this.StartDate = new Date().toISOString();
    this.CreateDate = this.StartDate;
    this.EndDateType = config.EndDateType || 'unlimited';
    this.EbsOptimized = !!config.EbsOptimized;
    this.OwnerId = '123456789012';
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      CapacityReservationId: this.CapacityReservationId,
      InstanceType: this.InstanceType,
      AvailabilityZone: this.AvailabilityZone,
      TotalInstanceCount: this.TotalInstanceCount,
      AvailableInstanceCount: this.AvailableInstanceCount,
      InstancePlatform: this.InstancePlatform,
      Tenancy: this.Tenancy,
      State: this.State,
      StartDate: this.StartDate,
      CreateDate: this.CreateDate,
      EndDateType: this.EndDateType,
      EbsOptimized: this.EbsOptimized,
      OwnerId: this.OwnerId,
      Tags: this.Tags
    };
  }
}

module.exports = CapacityReservation;
