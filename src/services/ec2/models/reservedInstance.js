/**
 * Reserved Instance Model + catálogo de ofertas padrão.
 *
 * O simulador não contabiliza cobrança real; mantém uma lista fixa de ofertas
 * ("offerings") e as reservas compradas a partir delas.
 */

const { v4: uuidv4 } = require('uuid');

const YEAR = 31536000;

class ReservedInstance {
  constructor(offering, config = {}) {
    this.ReservedInstancesId = `ri-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.InstanceType = offering.InstanceType;
    this.AvailabilityZone = offering.AvailabilityZone || 'us-east-1a';
    this.OfferingType = offering.OfferingType || 'All Upfront';
    this.ProductDescription = offering.ProductDescription || 'Linux/UNIX';
    this.InstanceTenancy = offering.InstanceTenancy || 'default';
    this.OfferingClass = offering.OfferingClass || 'standard';
    this.Scope = offering.Scope || 'Availability Zone';
    this.Duration = offering.Duration || YEAR;
    this.FixedPrice = offering.FixedPrice || 0;
    this.UsagePrice = offering.UsagePrice || 0;
    this.InstanceCount = Number(config.InstanceCount) || 1;
    this.CurrencyCode = 'USD';
    this.State = 'active'; // active, retired
    this.Start = new Date().toISOString();
    this.End = new Date(Date.now() + this.Duration * 1000).toISOString();
    this.Tags = config.Tags || [];
  }

  toJSON() {
    return {
      ReservedInstancesId: this.ReservedInstancesId,
      InstanceType: this.InstanceType,
      AvailabilityZone: this.AvailabilityZone,
      OfferingType: this.OfferingType,
      ProductDescription: this.ProductDescription,
      InstanceTenancy: this.InstanceTenancy,
      OfferingClass: this.OfferingClass,
      Scope: this.Scope,
      Duration: this.Duration,
      FixedPrice: this.FixedPrice,
      UsagePrice: this.UsagePrice,
      InstanceCount: this.InstanceCount,
      CurrencyCode: this.CurrencyCode,
      State: this.State,
      Start: this.Start,
      End: this.End,
      Tags: this.Tags
    };
  }
}

/**
 * Catálogo fixo de ofertas de reserva, no formato da AWS.
 */
function defaultReservedInstancesOfferings() {
  const offerings = [
    { InstanceType: 't2.micro', ProductDescription: 'Linux/UNIX', OfferingType: 'All Upfront', FixedPrice: 64, UsagePrice: 0 },
    { InstanceType: 't2.micro', ProductDescription: 'Linux/UNIX', OfferingType: 'No Upfront', FixedPrice: 0, UsagePrice: 0.008 },
    { InstanceType: 't3.small', ProductDescription: 'Linux/UNIX', OfferingType: 'Partial Upfront', FixedPrice: 120, UsagePrice: 0.005 },
    { InstanceType: 'm5.large', ProductDescription: 'Linux/UNIX', OfferingType: 'All Upfront', FixedPrice: 690, UsagePrice: 0 },
    { InstanceType: 'm5.large', ProductDescription: 'Windows', OfferingType: 'All Upfront', FixedPrice: 1290, UsagePrice: 0 }
  ];

  return offerings.map(offering => ({
    ReservedInstancesOfferingId: `rifr-${uuidv4().replace(/-/g, '').substring(0, 17)}`,
    AvailabilityZone: 'us-east-1a',
    Duration: YEAR,
    InstanceTenancy: 'default',
    OfferingClass: 'standard',
    Scope: 'Availability Zone',
    CurrencyCode: 'USD',
    FixedPrice: 0,
    UsagePrice: 0,
    Marketplace: false,
    PricingDetails: [],
    ...offering
  }));
}

module.exports = { ReservedInstance, defaultReservedInstancesOfferings };
