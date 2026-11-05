/**
 * VPC Endpoint Model
 */

const { v4: uuidv4 } = require('uuid');

class VPCEndpoint {
  constructor(vpcId, serviceName, config = {}) {
    this.VpcEndpointId = `vpce-${uuidv4().substring(0, 8)}`;
    this.VpcId = vpcId;
    this.ServiceName = serviceName;
    this.VpcEndpointType = config.VpcEndpointType || 'Gateway';
    this.State = 'available';
    this.CreationTimestamp = new Date().toISOString();
    
    // Para Gateway endpoints (S3, DynamoDB)
    this.RouteTableIds = config.RouteTableIds || [];
    
    // Para Interface endpoints
    this.SubnetIds = config.SubnetIds || [];
    this.SecurityGroupIds = config.SecurityGroupIds || [];
    this.PrivateDnsEnabled = config.PrivateDnsEnabled || false;
    this.NetworkInterfaceIds = config.NetworkInterfaceIds || [];
    
    this.PolicyDocument = config.PolicyDocument || {
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: '*',
          Resource: '*'
        }
      ]
    };
    
    this.Tags = config.Tags || [];
  }

  addRouteTable(routeTableId) {
    if (!this.RouteTableIds.includes(routeTableId)) {
      this.RouteTableIds.push(routeTableId);
    }
  }

  removeRouteTable(routeTableId) {
    const index = this.RouteTableIds.indexOf(routeTableId);
    if (index > -1) {
      this.RouteTableIds.splice(index, 1);
    }
  }

  addSubnet(subnetId) {
    if (!this.SubnetIds.includes(subnetId)) {
      this.SubnetIds.push(subnetId);
    }
  }

  removeSubnet(subnetId) {
    const index = this.SubnetIds.indexOf(subnetId);
    if (index > -1) {
      this.SubnetIds.splice(index, 1);
    }
  }

  getServiceType() {
    if (this.ServiceName.includes('.s3')) return 'S3';
    if (this.ServiceName.includes('.dynamodb')) return 'DynamoDB';
    if (this.ServiceName.includes('.lambda')) return 'Lambda';
    if (this.ServiceName.includes('.sqs')) return 'SQS';
    if (this.ServiceName.includes('.sns')) return 'SNS';
    if (this.ServiceName.includes('.ec2')) return 'EC2';
    return 'Custom';
  }

  toJSON() {
    const result = {
      VpcEndpointId: this.VpcEndpointId,
      VpcId: this.VpcId,
      ServiceName: this.ServiceName,
      VpcEndpointType: this.VpcEndpointType,
      State: this.State,
      CreationTimestamp: this.CreationTimestamp,
      PolicyDocument: this.PolicyDocument,
      Tags: this.Tags
    };

    if (this.VpcEndpointType === 'Gateway') {
      result.RouteTableIds = this.RouteTableIds;
    } else if (this.VpcEndpointType === 'Interface') {
      result.SubnetIds = this.SubnetIds;
      result.SecurityGroupIds = this.SecurityGroupIds;
      result.PrivateDnsEnabled = this.PrivateDnsEnabled;
      result.NetworkInterfaceIds = this.NetworkInterfaceIds;
    }

    return result;
  }

  static fromJSON(data = {}) {
    const endpoint = new VPCEndpoint(data.VpcId, data.ServiceName, {
      VpcEndpointType: data.VpcEndpointType,
      RouteTableIds: data.RouteTableIds || [],
      SubnetIds: data.SubnetIds || [],
      SecurityGroupIds: data.SecurityGroupIds || [],
      PrivateDnsEnabled: data.PrivateDnsEnabled || false,
      NetworkInterfaceIds: data.NetworkInterfaceIds || [],
      PolicyDocument: data.PolicyDocument,
      Tags: data.Tags || []
    });
    endpoint.VpcEndpointId = data.VpcEndpointId || endpoint.VpcEndpointId;
    endpoint.State = data.State || 'available';
    endpoint.CreationTimestamp = data.CreationTimestamp || endpoint.CreationTimestamp;
    return endpoint;
  }
}

module.exports = VPCEndpoint;
