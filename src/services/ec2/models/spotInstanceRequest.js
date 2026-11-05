/**
 * Spot Instance Request Model
 */

const { v4: uuidv4 } = require('uuid');

class SpotInstanceRequest {
  constructor(config = {}) {
    this.SpotInstanceRequestId = `sir-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.SpotPrice = config.SpotPrice || '0.030000';
    this.Type = config.Type || 'one-time'; // one-time, persistent

    const launchSpec = config.LaunchSpecification || {};
    this.LaunchSpecification = launchSpec;
    this.InstanceType = config.InstanceType || launchSpec.InstanceType || 't2.micro';
    this.ImageId = launchSpec.ImageId || config.ImageId || '';
    this.AvailabilityZone =
      config.AvailabilityZone || launchSpec.Placement?.AvailabilityZone || 'us-east-1a';
    this.ProductDescription = config.ProductDescription || 'Linux/UNIX';

    // Um request "one-time" é imediatamente atendido pelo simulador.
    this.State = 'active'; // open, active, cancelled
    this.Status = {
      Code: 'fulfilled',
      Message: 'Your Spot request is fulfilled.',
      UpdateTime: new Date().toISOString()
    };
    this.InstanceId = config.InstanceId || `i-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.CreateTime = new Date().toISOString();
    this.Tags = config.Tags || [];
  }

  cancel() {
    this.State = 'cancelled';
    this.Status = {
      Code: 'request-canceled-and-instance-running',
      Message: 'Your Spot request is canceled.',
      UpdateTime: new Date().toISOString()
    };
  }

  toJSON() {
    return {
      SpotInstanceRequestId: this.SpotInstanceRequestId,
      SpotPrice: this.SpotPrice,
      Type: this.Type,
      InstanceType: this.InstanceType,
      ImageId: this.ImageId,
      AvailabilityZone: this.AvailabilityZone,
      ProductDescription: this.ProductDescription,
      State: this.State,
      Status: this.Status,
      InstanceId: this.InstanceId,
      CreateTime: this.CreateTime,
      LaunchSpecification: this.LaunchSpecification,
      Tags: this.Tags
    };
  }
}

module.exports = SpotInstanceRequest;
