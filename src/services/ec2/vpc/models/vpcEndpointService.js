/**
 * VPC Endpoint Service Configuration Model
 *
 * Representa a configuração de um serviço de endpoint (PrivateLink) criado
 * pelo usuário. Na AWS é identificado por `svc-<17 hex>`; o nome do serviço
 * tem o formato `com.amazonaws.vpce.<region>.<id>`.
 */

const { generateResourceId, hexSuffix } = require('./identifier');

const OWNER_ID = '123456789012';
const REGION = 'us-east-1';
const DEFAULT_AZS = ['us-east-1a', 'us-east-1b'];

class VPCEndpointService {
  constructor(networkLoadBalancerArns = [], config = {}) {
    // O ServiceId da AWS usa o formato `svc-<17 hex>`.
    this.ServiceId = generateResourceId('svc');
    this.ServiceName =
      config.ServiceName || `com.amazonaws.vpce.${REGION}.${hexSuffix(17)}`;
    this.ServiceState = config.ServiceState || 'Available';
    this.ServiceType = config.ServiceType || [{ ServiceType: 'Interface' }];
    this.NetworkLoadBalancerArns = networkLoadBalancerArns;
    this.AvailabilityZones = config.AvailabilityZones || DEFAULT_AZS.map(zone => ({ ZoneName: zone }));
    this.BaseEndpointDnsNames = config.BaseEndpointDnsNames || [];
    this.OwnerId = config.OwnerId || OWNER_ID;
    this.PrivateDnsName = config.PrivateDnsName;
    this.AcceptanceRequired = config.AcceptanceRequired !== false;
    this.Tags = config.Tags || [];
    this.CreationTimestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      ServiceId: this.ServiceId,
      ServiceName: this.ServiceName,
      ServiceState: this.ServiceState,
      ServiceType: this.ServiceType,
      NetworkLoadBalancerArns: this.NetworkLoadBalancerArns,
      AvailabilityZones: this.AvailabilityZones,
      BaseEndpointDnsNames: this.BaseEndpointDnsNames,
      OwnerId: this.OwnerId,
      PrivateDnsName: this.PrivateDnsName,
      AcceptanceRequired: this.AcceptanceRequired,
      Tags: this.Tags,
      CreationTimestamp: this.CreationTimestamp
    };
  }

  static fromJSON(data = {}) {
    const service = Object.create(VPCEndpointService.prototype);
    service.ServiceId = data.ServiceId;
    service.ServiceName = data.ServiceName;
    service.ServiceState = data.ServiceState || 'Available';
    service.ServiceType = data.ServiceType || [{ ServiceType: 'Interface' }];
    service.NetworkLoadBalancerArns = data.NetworkLoadBalancerArns || [];
    service.AvailabilityZones = data.AvailabilityZones || [];
    service.BaseEndpointDnsNames = data.BaseEndpointDnsNames || [];
    service.OwnerId = data.OwnerId || OWNER_ID;
    service.PrivateDnsName = data.PrivateDnsName;
    service.AcceptanceRequired = data.AcceptanceRequired !== false;
    service.Tags = data.Tags || [];
    service.CreationTimestamp = data.CreationTimestamp || new Date().toISOString();
    return service;
  }
}

module.exports = VPCEndpointService;
