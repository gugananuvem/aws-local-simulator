/**
 * Route53 Resource Record Model
 * Supports weighted routing, health checks, and multiple record types
 */

class ResourceRecord {
  constructor(name, type, values, config = {}) {
    this.Name = name;
    this.Type = type;
    this.TTL = config.TTL || 300;
    this.SetIdentifier = config.SetIdentifier || null;
    this.Weight = config.Weight || null;
    this.Region = config.Region || null;
    this.GeoLocation = config.GeoLocation || null;
    this.MultiValueAnswer = config.MultiValueAnswer || false;
    this.HealthCheckId = config.HealthCheckId || null;
    this.Failover = config.Failover || null; // PRIMARY or SECONDARY
    this.ResourceRecords = Array.isArray(values) ? values.map(v => ({ Value: v })) : [{ Value: values }];
    this.CreatedDate = new Date().toISOString();
    this.LastModified = this.CreatedDate;
  }

  toJSON() {
    const record = {
      Name: this.Name,
      Type: this.Type,
      TTL: this.TTL,
      ResourceRecords: this.ResourceRecords,
    };

    if (this.SetIdentifier) record.SetIdentifier = this.SetIdentifier;
    if (this.Weight) record.Weight = this.Weight;
    if (this.Region) record.Region = this.Region;
    if (this.GeoLocation) record.GeoLocation = this.GeoLocation;
    if (this.MultiValueAnswer) record.MultiValueAnswer = this.MultiValueAnswer;
    if (this.HealthCheckId) record.HealthCheckId = this.HealthCheckId;
    if (this.Failover) record.Failover = this.Failover;

    return record;
  }

  /**
   * Resolve records based on weights (weighted routing)
   */
  static selectWeightedRecords(records) {
    // Filter only weighted records
    const weightedRecords = records.filter(r => r.Weight !== null && r.Weight !== undefined);
    
    if (weightedRecords.length === 0) {
      return records.filter(r => !r.SetIdentifier); // Return non-weighted records
    }

    const totalWeight = weightedRecords.reduce((sum, r) => sum + r.Weight, 0);
    const random = Math.random() * totalWeight;

    let accumulated = 0;
    for (const record of weightedRecords) {
      accumulated += record.Weight;
      if (random <= accumulated) {
        return [record];
      }
    }

    return [weightedRecords[0]]; // Fallback to first
  }

  /**
   * Resolve records based on geolocation
   */
  static selectGeoLocationRecords(records, country = 'US') {
    // Filter geo-located records
    const geoRecords = records.filter(r => r.GeoLocation);
    
    if (geoRecords.length === 0) {
      return records.filter(r => !r.SetIdentifier);
    }

    const matched = geoRecords.find(r => 
      r.GeoLocation.CountryCode === country || 
      r.GeoLocation.CountryCode === '*'
    );

    return matched ? [matched] : [geoRecords[0]];
  }

  /**
   * Resolve records based on failover policy
   */
  static selectFailoverRecords(records, healthyIds = []) {
    const primary = records.find(r => r.Failover === 'PRIMARY');
    const secondary = records.find(r => r.Failover === 'SECONDARY');

    if (!primary) return [records[0]];

    // Check if primary is healthy
    const primaryHealthy = !primary.HealthCheckId || healthyIds.includes(primary.HealthCheckId);

    if (primaryHealthy) {
      return [primary];
    }

    return secondary ? [secondary] : [primary];
  }
}

module.exports = ResourceRecord;
