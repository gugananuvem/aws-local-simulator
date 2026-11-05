/**
 * Route Table Model
 */

const { v4: uuidv4 } = require('uuid');

class Route {
  constructor(destinationCidrBlock, target, targetType = 'local') {
    this.DestinationCidrBlock = destinationCidrBlock;
    this.State = 'active';
    this.Origin = 'CreateRouteTable';
    this.CreatedAt = new Date().toISOString();
    
    // Set target based on type
    switch (targetType) {
      case 'local':
        this.Target = 'local';
        break;
      case 'igw':
        this.GatewayId = target;
        this.Target = target;
        break;
      case 'nat':
        this.NatGatewayId = target;
        this.Target = target;
        break;
      case 'vpce':
        this.VpcEndpointId = target;
        this.Target = target;
        break;
      case 'instance':
        this.InstanceId = target;
        this.Target = target;
        break;
      case 'eni':
        this.NetworkInterfaceId = target;
        this.Target = target;
        break;
      default:
        this.GatewayId = target;
        this.Target = target;
    }
  }

  toJSON() {
    const result = {
      DestinationCidrBlock: this.DestinationCidrBlock,
      State: this.State,
      Origin: this.Origin
    };

    if (this.GatewayId) result.GatewayId = this.GatewayId;
    if (this.NatGatewayId) result.NatGatewayId = this.NatGatewayId;
    if (this.VpcEndpointId) result.VpcEndpointId = this.VpcEndpointId;
    if (this.InstanceId) result.InstanceId = this.InstanceId;
    if (this.NetworkInterfaceId) result.NetworkInterfaceId = this.NetworkInterfaceId;

    return result;
  }
}

class RouteTableAssociation {
  constructor(subnetId, routeTableId, isMain = false) {
    this.RouteTableAssociationId = `rtbassoc-${uuidv4().substring(0, 8)}`;
    this.SubnetId = subnetId;
    this.RouteTableId = routeTableId;
    this.Main = isMain;
    this.CreatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      RouteTableAssociationId: this.RouteTableAssociationId,
      SubnetId: this.SubnetId,
      RouteTableId: this.RouteTableId,
      Main: this.Main
    };
  }
}

class RouteTable {
  constructor(vpcId, tags = [], isMain = false) {
    this.RouteTableId = `rtb-${uuidv4().substring(0, 8)}`;
    this.VpcId = vpcId;
    this.Routes = [];
    this.Associations = [];
    this.Tags = tags;
    this.IsMain = isMain;
    this.State = 'active';
    this.CreatedAt = new Date().toISOString();

    // Local route é adicionada automaticamente
    this.addLocalRoute(vpcId);
  }

  addLocalRoute(vpcCidr) {
    const localRoute = new Route(vpcCidr, 'local', 'local');
    this.Routes.push(localRoute);
  }

  addRoute(destinationCidrBlock, target, targetType = 'igw') {
    // Verificar se rota já existe
    const exists = this.Routes.some(r => r.DestinationCidrBlock === destinationCidrBlock);
    if (exists) {
      throw new Error(`Route with destination ${destinationCidrBlock} already exists`);
    }

    const route = new Route(destinationCidrBlock, target, targetType);
    this.Routes.push(route);
    return route;
  }

  removeRoute(destinationCidrBlock) {
    const index = this.Routes.findIndex(r => r.DestinationCidrBlock === destinationCidrBlock);
    if (index === -1) {
      throw new Error(`Route with destination ${destinationCidrBlock} not found`);
    }

    const route = this.Routes[index];
    this.Routes.splice(index, 1);
    return route;
  }

  addAssociation(subnetId) {
    const exists = this.Associations.some(a => a.SubnetId === subnetId);
    if (exists) {
      throw new Error(`Subnet ${subnetId} is already associated with this route table`);
    }

    const association = new RouteTableAssociation(subnetId, this.RouteTableId);
    this.Associations.push(association);
    return association;
  }

  removeAssociation(subnetId) {
    const index = this.Associations.findIndex(a => a.SubnetId === subnetId);
    if (index === -1) {
      throw new Error(`Subnet ${subnetId} is not associated with this route table`);
    }

    const association = this.Associations[index];
    this.Associations.splice(index, 1);
    return association;
  }

  toJSON() {
    return {
      RouteTableId: this.RouteTableId,
      VpcId: this.VpcId,
      Routes: this.Routes.map(r => r.toJSON()),
      Associations: this.Associations.map(a => a.toJSON()),
      Tags: this.Tags,
      IsMain: this.IsMain,
      State: this.State,
      CreatedAt: this.CreatedAt
    };
  }
}

module.exports = { RouteTable, Route, RouteTableAssociation };
