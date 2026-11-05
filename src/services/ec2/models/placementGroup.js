/**
 * Placement Group Model
 */

const { v4: uuidv4 } = require('uuid');

class PlacementGroup {
  constructor(name, strategy = 'spread', config = {}) {
    this.GroupName = name;
    this.GroupId = `pgrp-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.Strategy = strategy; // cluster, spread, partition
    this.State = 'available';
    this.PartitionCount = strategy === 'partition' ? Number(config.PartitionCount) || 2 : undefined;
    this.Tags = config.Tags || [];
    this.CreatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      GroupName: this.GroupName,
      GroupId: this.GroupId,
      Strategy: this.Strategy,
      State: this.State,
      PartitionCount: this.PartitionCount,
      Tags: this.Tags,
      CreatedAt: this.CreatedAt
    };
  }
}

module.exports = PlacementGroup;
