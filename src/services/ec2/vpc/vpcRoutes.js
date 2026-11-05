/**
 * VPC Routes
 *
 * O VPC passou a fazer parte do serviço EC2 (fusão).
 * Este módulo expõe:
 *  - setupVpcAdminRoutes(app, simulator): rotas REST administrativas namespaced em /__admin/ec2/vpc
 *  - createVpcQueryHandlers(simulator): handlers do EC2 Query Protocol (AWS CLI) para ações de VPC
 */

const logger = require('../../../utils/logger');
const EC2ResponseFormatter = require('../xmlResponseFormatter');

const ADMIN_BASE = '/__admin/ec2/vpc';

/**
 * Extrai uma lista do body no formato do Query Protocol.
 * Aceita tanto `{ VpcId: ['vpc-1'] }` (qs extended) quanto `{ 'VpcId.1': 'vpc-1' }`.
 */
function extractList(body, key) {
  if (!body) return undefined;

  const direct = body[key];
  if (Array.isArray(direct)) return direct;
  if (typeof direct === 'string') return [direct];

  const collected = [];
  const prefix = `${key}.`;
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith(prefix)) {
      if (Array.isArray(v)) collected.push(...v);
      else collected.push(v);
    }
  }
  return collected.length > 0 ? collected : undefined;
}

/**
 * Extrai TagSpecifications do Query Protocol para um resourceType.
 */
function extractTags(body, resourceType = 'vpc') {
  const tags = [];
  const specs = body?.TagSpecification;
  const list = Array.isArray(specs) ? specs : specs ? [specs] : [];

  for (const spec of list) {
    if (spec.ResourceType && spec.ResourceType !== resourceType) continue;
    const specTags = spec.Tag;
    const arr = Array.isArray(specTags) ? specTags : specTags ? [specTags] : [];
    for (const tag of arr) {
      if (tag.Key) tags.push({ Key: tag.Key, Value: tag.Value || '' });
    }
  }

  return tags;
}

/**
 * Normaliza os filtros do AWS CLI (Filter.1.Name / Filter.1.Value.1) num objeto simples.
 */
function extractFilters(body) {
  const raw = body?.Filter;
  const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
  const result = {};

  for (const filter of list) {
    if (!filter || !filter.Name) continue;
    let values = filter.Value;
    if (values === undefined) values = [];
    else if (!Array.isArray(values)) {
      values = typeof values === 'object' ? Object.values(values) : [values];
    }
    result[filter.Name] = values;
  }

  return result;
}

/**
 * Extrai uma lista de objetos indexados do Query Protocol (ex.: Entry.1.Cidr).
 * Aceita tanto `{ Entry: [{ Cidr }] }` quanto `{ 'Entry.1.Cidr': '...' }`.
 */
function extractIndexedObjects(body, key) {
  if (!body) return [];

  const direct = body[key];
  if (Array.isArray(direct)) {
    return direct.filter(Boolean);
  }

  const grouped = {};
  const prefix = `${key}.`;
  for (const [k, v] of Object.entries(body)) {
    if (!k.startsWith(prefix)) continue;
    const rest = k.slice(prefix.length);
    const [index, field] = rest.split('.');
    if (!field) continue;
    grouped[index] = grouped[index] || {};
    grouped[index][field] = v;
  }

  return Object.keys(grouped)
    .sort((a, b) => Number(a) - Number(b))
    .map(index => grouped[index]);
}

function sendXml(res, xmlResponse, status = 200) {
  res.status(status).set('Content-Type', 'text/xml').send(xmlResponse);
}

function sendError(res, code, message, status = 400) {
  logger.error(`VPC Query Error [${code}]: ${message}`);
  sendXml(res, EC2ResponseFormatter.formatErrorResponse(code, message), status);
}

/**
 * Registra as rotas REST administrativas do VPC sob /__admin/ec2/vpc
 */
function setupVpcAdminRoutes(app, simulator) {
  // ========== VPC Routes ==========

  app.post(`${ADMIN_BASE}/vpcs/create`, (req, res) => {
    try {
      const { CidrBlock, Tags, EnableDnsHostnames, EnableDnsSupport } = req.body;
      if (!CidrBlock) {
        return res.status(400).json({ error: 'CidrBlock is required' });
      }
      const vpc = simulator.createVPC(CidrBlock, Tags || [], {
        EnableDnsHostnames,
        EnableDnsSupport
      });
      res.json({ Vpc: vpc.toJSON() });
    } catch (error) {
      logger.error(`Error creating VPC: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/vpcs`, (req, res) => {
    try {
      const filters = {};
      if (req.query.vpcIds) {
        filters.vpcIds = Array.isArray(req.query.vpcIds)
          ? req.query.vpcIds
          : [req.query.vpcIds];
      }
      const vpcs = simulator.describeVPCs(filters);
      res.json({ Vpcs: vpcs.map(v => v.toJSON()) });
    } catch (error) {
      logger.error(`Error listing VPCs: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/vpcs/:vpcId`, (req, res) => {
    try {
      const vpc = simulator.getVPC(req.params.vpcId);
      res.json({ Vpc: vpc.toJSON() });
    } catch (error) {
      logger.error(`Error getting VPC: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/vpcs/:vpcId`, (req, res) => {
    try {
      simulator.deleteVPC(req.params.vpcId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting VPC: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/vpcs/:vpcId/attributes`, (req, res) => {
    try {
      const { attribute, value } = req.body;
      if (!attribute) {
        return res.status(400).json({ error: 'Attribute is required' });
      }
      const vpc = simulator.modifyVPCAttribute(req.params.vpcId, attribute, value);
      res.json({ Vpc: vpc.toJSON() });
    } catch (error) {
      logger.error(`Error modifying VPC attribute: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Subnet Routes ==========

  app.post(`${ADMIN_BASE}/subnets/create`, (req, res) => {
    try {
      const { VpcId, CidrBlock, AvailabilityZone, Tags, MapPublicIpOnLaunch } = req.body;
      if (!VpcId || !CidrBlock || !AvailabilityZone) {
        return res
          .status(400)
          .json({ error: 'VpcId, CidrBlock and AvailabilityZone are required' });
      }
      const subnet = simulator.createSubnet(VpcId, CidrBlock, AvailabilityZone, Tags || [], {
        MapPublicIpOnLaunch
      });
      res.json({ Subnet: subnet.toJSON() });
    } catch (error) {
      logger.error(`Error creating Subnet: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/subnets`, (req, res) => {
    try {
      const filters = {};
      if (req.query.vpcIds) {
        filters.vpcIds = Array.isArray(req.query.vpcIds)
          ? req.query.vpcIds
          : [req.query.vpcIds];
      }
      const subnets = simulator.describeSubnets(filters);
      res.json({ Subnets: subnets.map(s => s.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Subnets: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/subnets/:subnetId`, (req, res) => {
    try {
      const subnet = simulator.getSubnet(req.params.subnetId);
      res.json({ Subnet: subnet.toJSON() });
    } catch (error) {
      logger.error(`Error getting Subnet: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/subnets/:subnetId`, (req, res) => {
    try {
      simulator.deleteSubnet(req.params.subnetId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Subnet: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Route Table Routes ==========

  app.post(`${ADMIN_BASE}/route-tables/create`, (req, res) => {
    try {
      const { VpcId, Tags } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      const routeTable = simulator.createRouteTable(VpcId, Tags || []);
      res.json({ RouteTable: routeTable.toJSON() });
    } catch (error) {
      logger.error(`Error creating Route Table: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/route-tables`, (req, res) => {
    try {
      const filters = {};
      if (req.query.vpcIds) {
        filters.vpcIds = Array.isArray(req.query.vpcIds)
          ? req.query.vpcIds
          : [req.query.vpcIds];
      }
      const routeTables = simulator.describeRouteTables(filters);
      res.json({ RouteTables: routeTables.map(rt => rt.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Route Tables: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/route-tables/:rtId`, (req, res) => {
    try {
      const routeTable = simulator.getRouteTable(req.params.rtId);
      res.json({ RouteTable: routeTable.toJSON() });
    } catch (error) {
      logger.error(`Error getting Route Table: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/route-tables/:rtId`, (req, res) => {
    try {
      simulator.deleteRouteTable(req.params.rtId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Route Table: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/route-tables/:rtId/routes`, (req, res) => {
    try {
      const { DestinationCidrBlock, Target, TargetType } = req.body;
      if (!DestinationCidrBlock || !Target) {
        return res
          .status(400)
          .json({ error: 'DestinationCidrBlock and Target are required' });
      }
      const route = simulator.addRoute(
        req.params.rtId,
        DestinationCidrBlock,
        Target,
        TargetType || 'igw'
      );
      res.json({ Route: route.toJSON() });
    } catch (error) {
      logger.error(`Error adding route: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/route-tables/:rtId/routes/:cidr`, (req, res) => {
    try {
      const cidr = decodeURIComponent(req.params.cidr);
      simulator.removeRoute(req.params.rtId, cidr);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error removing route: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/route-tables/:rtId/associations`, (req, res) => {
    try {
      const { SubnetId } = req.body;
      if (!SubnetId) {
        return res.status(400).json({ error: 'SubnetId is required' });
      }
      const association = simulator.associateRouteTable(req.params.rtId, SubnetId);
      res.json({ Association: association.toJSON() });
    } catch (error) {
      logger.error(`Error associating route table: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/route-tables/:rtId/associations/:subnetId`, (req, res) => {
    try {
      simulator.disassociateRouteTable(req.params.rtId, req.params.subnetId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error disassociating route table: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Internet Gateway Routes ==========

  app.post(`${ADMIN_BASE}/internet-gateways/create`, (req, res) => {
    try {
      const { Tags } = req.body;
      const igw = simulator.createInternetGateway(Tags || []);
      res.json({ InternetGateway: igw.toJSON() });
    } catch (error) {
      logger.error(`Error creating IGW: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/internet-gateways`, (req, res) => {
    try {
      const igws = simulator.describeInternetGateways();
      res.json({ InternetGateways: igws.map(igw => igw.toJSON()) });
    } catch (error) {
      logger.error(`Error listing IGWs: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/internet-gateways/:igwId`, (req, res) => {
    try {
      const igw = simulator.getInternetGateway(req.params.igwId);
      res.json({ InternetGateway: igw.toJSON() });
    } catch (error) {
      logger.error(`Error getting IGW: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/internet-gateways/:igwId/attach`, (req, res) => {
    try {
      const { VpcId } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      const attachment = simulator.attachInternetGateway(req.params.igwId, VpcId);
      res.json({ Attachment: attachment.toJSON() });
    } catch (error) {
      logger.error(`Error attaching IGW: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/internet-gateways/:igwId/detach`, (req, res) => {
    try {
      const { VpcId } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      simulator.detachInternetGateway(req.params.igwId, VpcId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error detaching IGW: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/internet-gateways/:igwId`, (req, res) => {
    try {
      simulator.deleteInternetGateway(req.params.igwId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting IGW: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== VPC Endpoint Routes ==========

  app.post(`${ADMIN_BASE}/vpc-endpoints/create`, (req, res) => {
    try {
      const {
        VpcId,
        ServiceName,
        VpcEndpointType,
        RouteTableIds,
        SubnetIds,
        SecurityGroupIds,
        PrivateDnsEnabled,
        PolicyDocument,
        Tags
      } = req.body;
      if (!VpcId || !ServiceName) {
        return res.status(400).json({ error: 'VpcId and ServiceName are required' });
      }
      const endpoint = simulator.createVPCEndpoint(VpcId, ServiceName, {
        VpcEndpointType,
        RouteTableIds,
        SubnetIds,
        SecurityGroupIds,
        PrivateDnsEnabled,
        PolicyDocument,
        Tags: Tags || []
      });
      res.json({ VpcEndpoint: endpoint.toJSON() });
    } catch (error) {
      logger.error(`Error creating VPC Endpoint: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/vpc-endpoints`, (req, res) => {
    try {
      const filters = {};
      if (req.query.vpcIds) {
        filters.vpcIds = Array.isArray(req.query.vpcIds)
          ? req.query.vpcIds
          : [req.query.vpcIds];
      }
      const endpoints = simulator.describeVPCEndpoints(filters);
      res.json({ VpcEndpoints: endpoints.map(e => e.toJSON()) });
    } catch (error) {
      logger.error(`Error listing VPC Endpoints: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/vpc-endpoints/:epId`, (req, res) => {
    try {
      const endpoint = simulator.getVPCEndpoint(req.params.epId);
      res.json({ VpcEndpoint: endpoint.toJSON() });
    } catch (error) {
      logger.error(`Error getting VPC Endpoint: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/vpc-endpoints/:epId/modify`, (req, res) => {
    try {
      const endpoint = simulator.modifyVPCEndpoint(req.params.epId, req.body);
      res.json({ VpcEndpoint: endpoint.toJSON() });
    } catch (error) {
      logger.error(`Error modifying VPC Endpoint: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/vpc-endpoints/:epId`, (req, res) => {
    try {
      simulator.deleteVPCEndpoint(req.params.epId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting VPC Endpoint: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== VPC Peering Connection Routes ==========

  app.post(`${ADMIN_BASE}/peering-connections/create`, (req, res) => {
    try {
      const { VpcId, PeerVpcId, Tags } = req.body;
      if (!VpcId || !PeerVpcId) {
        return res.status(400).json({ error: 'VpcId and PeerVpcId are required' });
      }
      const connection = simulator.createVPCPeeringConnection(VpcId, PeerVpcId, { Tags: Tags || [] });
      res.json({ VpcPeeringConnection: connection.toJSON() });
    } catch (error) {
      logger.error(`Error creating VPC Peering Connection: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/peering-connections`, (req, res) => {
    try {
      const connections = simulator.describeVPCPeeringConnections();
      res.json({ VpcPeeringConnections: connections.map(c => c.toJSON()) });
    } catch (error) {
      logger.error(`Error listing VPC Peering Connections: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/peering-connections/:pcxId/accept`, (req, res) => {
    try {
      const connection = simulator.acceptVPCPeeringConnection(req.params.pcxId);
      res.json({ VpcPeeringConnection: connection.toJSON() });
    } catch (error) {
      logger.error(`Error accepting VPC Peering Connection: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/peering-connections/:pcxId/reject`, (req, res) => {
    try {
      simulator.rejectVPCPeeringConnection(req.params.pcxId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error rejecting VPC Peering Connection: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/peering-connections/:pcxId`, (req, res) => {
    try {
      simulator.deleteVPCPeeringConnection(req.params.pcxId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting VPC Peering Connection: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== VPC Endpoint Service Routes ==========

  app.post(`${ADMIN_BASE}/endpoint-services/create`, (req, res) => {
    try {
      const { NetworkLoadBalancerArns, AcceptanceRequired, Tags } = req.body;
      const service = simulator.createVPCEndpointServiceConfiguration(
        NetworkLoadBalancerArns || [],
        { AcceptanceRequired, Tags: Tags || [] }
      );
      res.json({ ServiceConfiguration: service.toJSON() });
    } catch (error) {
      logger.error(`Error creating VPC Endpoint Service: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/endpoint-services`, (req, res) => {
    try {
      const services = simulator.describeVPCEndpointServiceConfigurations();
      res.json({ ServiceConfigurations: services.map(s => s.toJSON()) });
    } catch (error) {
      logger.error(`Error listing VPC Endpoint Services: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/endpoint-services/:serviceId`, (req, res) => {
    try {
      simulator.deleteVPCEndpointServiceConfigurations(req.params.serviceId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting VPC Endpoint Service: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Network ACL Routes ==========

  app.post(`${ADMIN_BASE}/network-acls/create`, (req, res) => {
    try {
      const { VpcId, Tags } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      const acl = simulator.createNetworkAcl(VpcId, Tags || [], false);
      res.json({ NetworkAcl: acl.toJSON() });
    } catch (error) {
      logger.error(`Error creating Network ACL: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/network-acls`, (req, res) => {
    try {
      const filters = {};
      if (req.query.vpcIds) {
        filters.vpcIds = Array.isArray(req.query.vpcIds)
          ? req.query.vpcIds
          : [req.query.vpcIds];
      }
      const acls = simulator.describeNetworkAcls(filters);
      res.json({ NetworkAcls: acls.map(acl => acl.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Network ACLs: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/network-acls/:aclId`, (req, res) => {
    try {
      const acl = simulator.getNetworkAcl(req.params.aclId);
      res.json({ NetworkAcl: acl.toJSON() });
    } catch (error) {
      logger.error(`Error getting Network ACL: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/network-acls/:aclId`, (req, res) => {
    try {
      simulator.deleteNetworkAcl(req.params.aclId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Network ACL: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/network-acls/:aclId/entries`, (req, res) => {
    try {
      const entry = simulator.createNetworkAclEntry(req.params.aclId, req.body);
      res.json({ Entry: entry.toJSON() });
    } catch (error) {
      logger.error(`Error creating Network ACL entry: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/network-acls/:aclId/entries/:ruleNumber`, (req, res) => {
    try {
      const egress = req.query.egress === 'true';
      simulator.deleteNetworkAclEntry(req.params.aclId, Number(req.params.ruleNumber), egress);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Network ACL entry: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/network-acls/:aclId/associations`, (req, res) => {
    try {
      const { SubnetId } = req.body;
      if (!SubnetId) {
        return res.status(400).json({ error: 'SubnetId is required' });
      }
      const association = simulator.associateNetworkAcl(req.params.aclId, SubnetId);
      res.json({ Association: association.toJSON() });
    } catch (error) {
      logger.error(`Error associating Network ACL: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Elastic IP Routes ==========

  app.post(`${ADMIN_BASE}/elastic-ips/allocate`, (req, res) => {
    try {
      const { Domain, Tags, PublicIpv4Pool } = req.body;
      const address = simulator.allocateAddress({ Domain, Tags: Tags || [], PublicIpv4Pool });
      res.json({ Address: address.toJSON() });
    } catch (error) {
      logger.error(`Error allocating Elastic IP: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/elastic-ips`, (req, res) => {
    try {
      const addresses = simulator.describeAddresses();
      res.json({ Addresses: addresses.map(a => a.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Elastic IPs: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/elastic-ips/:allocationId`, (req, res) => {
    try {
      const address = simulator.getAddress(req.params.allocationId);
      res.json({ Address: address.toJSON() });
    } catch (error) {
      logger.error(`Error getting Elastic IP: ${error.message}`);
      res.status(404).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/elastic-ips/:allocationId/associate`, (req, res) => {
    try {
      const { InstanceId, NetworkInterfaceId, PrivateIpAddress } = req.body;
      const address = simulator.associateAddress({
        allocationId: req.params.allocationId,
        instanceId: InstanceId,
        networkInterfaceId: NetworkInterfaceId,
        privateIpAddress: PrivateIpAddress
      });
      res.json({ Address: address.toJSON() });
    } catch (error) {
      logger.error(`Error associating Elastic IP: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/elastic-ips/:allocationId/disassociate`, (req, res) => {
    try {
      const address = simulator.disassociateAddress({ allocationId: req.params.allocationId });
      res.json({ Address: address.toJSON() });
    } catch (error) {
      logger.error(`Error disassociating Elastic IP: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/elastic-ips/:allocationId`, (req, res) => {
    try {
      simulator.releaseAddress(req.params.allocationId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error releasing Elastic IP: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Egress-only Internet Gateway Routes ==========

  app.post(`${ADMIN_BASE}/egress-only-internet-gateways/create`, (req, res) => {
    try {
      const { VpcId, Tags } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      const eigw = simulator.createEgressOnlyInternetGateway(VpcId, Tags || []);
      res.json({ EgressOnlyInternetGateway: eigw.toJSON() });
    } catch (error) {
      logger.error(`Error creating Egress-only IGW: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/egress-only-internet-gateways`, (req, res) => {
    try {
      const eigws = simulator.describeEgressOnlyInternetGateways();
      res.json({ EgressOnlyInternetGateways: eigws.map(e => e.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Egress-only IGWs: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/egress-only-internet-gateways/:eigwId`, (req, res) => {
    try {
      simulator.deleteEgressOnlyInternetGateway(req.params.eigwId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Egress-only IGW: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== DHCP Options Routes ==========

  app.post(`${ADMIN_BASE}/dhcp-options/create`, (req, res) => {
    try {
      const { DhcpConfigurations, Tags } = req.body;
      if (!Array.isArray(DhcpConfigurations) || DhcpConfigurations.length === 0) {
        return res.status(400).json({ error: 'DhcpConfigurations is required' });
      }
      const options = simulator.createDhcpOptions(DhcpConfigurations, Tags || []);
      res.json({ DhcpOptions: options.toJSON() });
    } catch (error) {
      logger.error(`Error creating DHCP options: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/dhcp-options`, (req, res) => {
    try {
      const options = simulator.describeDhcpOptions();
      res.json({ DhcpOptions: options.map(o => o.toJSON()) });
    } catch (error) {
      logger.error(`Error listing DHCP options: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/dhcp-options/:dhcpOptionsId/associate`, (req, res) => {
    try {
      const { VpcId } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      simulator.associateDhcpOptions(VpcId, req.params.dhcpOptionsId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error associating DHCP options: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/dhcp-options/:dhcpOptionsId`, (req, res) => {
    try {
      simulator.deleteDhcpOptions(req.params.dhcpOptionsId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting DHCP options: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== NAT Gateway Routes ==========

  app.post(`${ADMIN_BASE}/nat-gateways/create`, (req, res) => {
    try {
      const { SubnetId, AllocationId, ConnectivityType, Tags } = req.body;
      if (!SubnetId) {
        return res.status(400).json({ error: 'SubnetId is required' });
      }
      const natGw = simulator.createNATGateway(SubnetId, AllocationId || null, {
        ConnectivityType,
        Tags: Tags || []
      });
      res.json({ NatGateway: natGw.toJSON() });
    } catch (error) {
      logger.error(`Error creating NAT Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/nat-gateways`, (req, res) => {
    try {
      const gateways = simulator.describeNATGateways();
      res.json({ NatGateways: gateways.map(ng => ng.toJSON()) });
    } catch (error) {
      logger.error(`Error listing NAT Gateways: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/nat-gateways/:natGatewayId`, (req, res) => {
    try {
      simulator.deleteNATGateway(req.params.natGatewayId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting NAT Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Customer Gateway Routes ==========

  app.post(`${ADMIN_BASE}/customer-gateways/create`, (req, res) => {
    try {
      const { Type, BgpAsn, IpAddress, PublicIp, CertificateArn, Tags } = req.body;
      if (!Type) {
        return res.status(400).json({ error: 'Type is required' });
      }
      if (!BgpAsn) {
        return res.status(400).json({ error: 'BgpAsn is required' });
      }
      const cgw = simulator.createCustomerGateway(Type, BgpAsn, {
        IpAddress: IpAddress || PublicIp,
        CertificateArn,
        Tags: Tags || []
      });
      res.json({ CustomerGateway: cgw.toJSON() });
    } catch (error) {
      logger.error(`Error creating Customer Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/customer-gateways`, (req, res) => {
    try {
      const gateways = simulator.describeCustomerGateways();
      res.json({ CustomerGateways: gateways.map(g => g.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Customer Gateways: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/customer-gateways/:customerGatewayId`, (req, res) => {
    try {
      simulator.deleteCustomerGateway(req.params.customerGatewayId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Customer Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Virtual Private Gateway Routes ==========

  app.post(`${ADMIN_BASE}/vpn-gateways/create`, (req, res) => {
    try {
      const { Type, AvailabilityZone, AmazonSideAsn, Tags } = req.body;
      const vgw = simulator.createVpnGateway(Type || 'ipsec.1', {
        AvailabilityZone,
        AmazonSideAsn,
        Tags: Tags || []
      });
      res.json({ VpnGateway: vgw.toJSON() });
    } catch (error) {
      logger.error(`Error creating VPN Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/vpn-gateways`, (req, res) => {
    try {
      const gateways = simulator.describeVpnGateways();
      res.json({ VpnGateways: gateways.map(g => g.toJSON()) });
    } catch (error) {
      logger.error(`Error listing VPN Gateways: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/vpn-gateways/:vpnGatewayId/attach`, (req, res) => {
    try {
      const { VpcId } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      const vgw = simulator.attachVpnGateway(req.params.vpnGatewayId, VpcId);
      res.json({ VpnGateway: vgw.toJSON() });
    } catch (error) {
      logger.error(`Error attaching VPN Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/vpn-gateways/:vpnGatewayId/detach`, (req, res) => {
    try {
      const { VpcId } = req.body;
      if (!VpcId) {
        return res.status(400).json({ error: 'VpcId is required' });
      }
      const vgw = simulator.detachVpnGateway(req.params.vpnGatewayId, VpcId);
      res.json({ VpnGateway: vgw.toJSON() });
    } catch (error) {
      logger.error(`Error detaching VPN Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/vpn-gateways/:vpnGatewayId`, (req, res) => {
    try {
      simulator.deleteVpnGateway(req.params.vpnGatewayId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting VPN Gateway: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Site-to-site VPN Connection Routes ==========

  app.post(`${ADMIN_BASE}/vpn-connections/create`, (req, res) => {
    try {
      const { Type, CustomerGatewayId, VpnGatewayId, Options, Tags } = req.body;
      if (!CustomerGatewayId) {
        return res.status(400).json({ error: 'CustomerGatewayId is required' });
      }
      if (!VpnGatewayId) {
        return res.status(400).json({ error: 'VpnGatewayId is required' });
      }
      const connection = simulator.createVpnConnection(
        Type || 'ipsec.1',
        CustomerGatewayId,
        VpnGatewayId,
        { Options, Tags: Tags || [] }
      );
      res.json({ VpnConnection: connection.toJSON() });
    } catch (error) {
      logger.error(`Error creating VPN Connection: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/vpn-connections`, (req, res) => {
    try {
      const connections = simulator.describeVpnConnections();
      res.json({ VpnConnections: connections.map(c => c.toJSON()) });
    } catch (error) {
      logger.error(`Error listing VPN Connections: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/vpn-connections/:vpnConnectionId`, (req, res) => {
    try {
      simulator.deleteVpnConnection(req.params.vpnConnectionId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting VPN Connection: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Client VPN Endpoint Routes ==========

  app.post(`${ADMIN_BASE}/client-vpn-endpoints/create`, (req, res) => {
    try {
      const { VpcId, ClientCidrBlock, ServerCertificateArn, SubnetIds, Tags } = req.body;
      if (!ClientCidrBlock) {
        return res.status(400).json({ error: 'ClientCidrBlock is required' });
      }
      if (!ServerCertificateArn) {
        return res.status(400).json({ error: 'ServerCertificateArn is required' });
      }
      const endpoint = simulator.createClientVpnEndpoint({
        ...req.body,
        VpcId,
        ClientCidrBlock,
        ServerCertificateArn,
        SubnetIds: SubnetIds || [],
        Tags: Tags || []
      });
      res.json({ ClientVpnEndpoint: endpoint.toJSON() });
    } catch (error) {
      logger.error(`Error creating Client VPN Endpoint: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/client-vpn-endpoints`, (req, res) => {
    try {
      const endpoints = simulator.describeClientVpnEndpoints();
      res.json({ ClientVpnEndpoints: endpoints.map(e => e.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Client VPN Endpoints: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.post(`${ADMIN_BASE}/client-vpn-endpoints/:clientVpnEndpointId/associate`, (req, res) => {
    try {
      const { SubnetId } = req.body;
      if (!SubnetId) {
        return res.status(400).json({ error: 'SubnetId is required' });
      }
      const endpoint = simulator.associateClientVpnTargetNetwork(
        req.params.clientVpnEndpointId,
        SubnetId
      );
      res.json({ ClientVpnEndpoint: endpoint.toJSON() });
    } catch (error) {
      logger.error(`Error associating Client VPN target network: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/client-vpn-endpoints/:clientVpnEndpointId`, (req, res) => {
    try {
      simulator.deleteClientVpnEndpoint(req.params.clientVpnEndpointId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Client VPN Endpoint: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Managed Prefix List Routes ==========

  app.post(`${ADMIN_BASE}/managed-prefix-lists/create`, (req, res) => {
    try {
      const { PrefixListName, AddressFamily, MaxEntries, Entries, Tags } = req.body;
      if (!PrefixListName) {
        return res.status(400).json({ error: 'PrefixListName is required' });
      }
      const list = simulator.createManagedPrefixList({
        PrefixListName,
        AddressFamily,
        MaxEntries,
        Entries: Entries || [],
        Tags: Tags || []
      });
      res.json({ ManagedPrefixList: list.toJSON() });
    } catch (error) {
      logger.error(`Error creating Managed Prefix List: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/managed-prefix-lists`, (req, res) => {
    try {
      const lists = simulator.describeManagedPrefixLists();
      res.json({ ManagedPrefixLists: lists.map(l => l.toJSON()) });
    } catch (error) {
      logger.error(`Error listing Managed Prefix Lists: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.get(`${ADMIN_BASE}/managed-prefix-lists/:prefixListId/entries`, (req, res) => {
    try {
      const result = simulator.getManagedPrefixListEntries(req.params.prefixListId);
      res.json(result);
    } catch (error) {
      logger.error(`Error listing Managed Prefix List entries: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  app.delete(`${ADMIN_BASE}/managed-prefix-lists/:prefixListId`, (req, res) => {
    try {
      simulator.deleteManagedPrefixList(req.params.prefixListId);
      res.json({ success: true });
    } catch (error) {
      logger.error(`Error deleting Managed Prefix List: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });

  // ========== Utility ==========

  app.get(`${ADMIN_BASE}/resources`, (req, res) => {
    try {
      const resources = simulator.getAllResources();
      res.json({
        vpcs: resources.vpcs.map(v => v.toJSON()),
        subnets: resources.subnets.map(s => s.toJSON()),
        routeTables: resources.routeTables.map(rt => rt.toJSON()),
        internetGateways: resources.internetGateways.map(igw => igw.toJSON()),
        networkAcls: resources.networkAcls.map(acl => acl.toJSON()),
        vpcEndpoints: resources.vpcEndpoints.map(e => e.toJSON()),
        vpcEndpointServices: resources.vpcEndpointServices.map(s => s.toJSON()),
        vpcPeeringConnections: resources.vpcPeeringConnections.map(c => c.toJSON()),
        elasticIps: resources.elasticIps.map(e => e.toJSON()),
        egressOnlyInternetGateways: resources.egressOnlyInternetGateways.map(e => e.toJSON()),
        dhcpOptions: resources.dhcpOptions.map(o => o.toJSON()),
        managedPrefixLists: resources.managedPrefixLists.map(l => l.toJSON()),
        natGateways: resources.natGateways.map(ng => ng.toJSON()),
        customerGateways: resources.customerGateways.map(g => g.toJSON()),
        vpnGateways: resources.vpnGateways.map(g => g.toJSON()),
        vpnConnections: resources.vpnConnections.map(c => c.toJSON()),
        clientVpnEndpoints: resources.clientVpnEndpoints.map(e => e.toJSON())
      });
    } catch (error) {
      logger.error(`Error fetching VPC resources: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  });
}

/**
 * Cria os handlers do EC2 Query Protocol (AWS CLI) para ações de VPC.
 * Retorna um mapa { ActionName: (req, res) => void }.
 */
function createVpcQueryHandlers(simulator) {
  return {
    DescribeVpcs(req, res) {
      try {
        const vpcIds = extractList(req.body, 'VpcId');
        const vpcs = simulator.describeVPCs(vpcIds ? { vpcIds } : {});
        sendXml(res, EC2ResponseFormatter.formatDescribeVpcsResponse(vpcs.map(v => v.toJSON())));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateVpc(req, res) {
      try {
        const cidrBlock = req.body.CidrBlock;
        if (!cidrBlock) throw new Error('CidrBlock is required');
        const tags = extractTags(req.body, 'vpc');
        const vpc = simulator.createVPC(cidrBlock, tags);
        sendXml(res, EC2ResponseFormatter.formatCreateVpcResponse(vpc.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteVpc(req, res) {
      try {
        const vpcId = req.body.VpcId;
        if (!vpcId) throw new Error('VpcId is required');
        simulator.deleteVPC(vpcId);
        sendXml(res, EC2ResponseFormatter.formatDeleteVpcResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeSubnets(req, res) {
      try {
        const vpcIds = extractList(req.body, 'VpcId');
        const subnetIds = extractList(req.body, 'SubnetId');
        const filters = {};
        if (vpcIds) filters.vpcIds = vpcIds;
        if (subnetIds) filters.subnetIds = subnetIds;
        const subnets = simulator.describeSubnets(filters);
        sendXml(res, EC2ResponseFormatter.formatDescribeSubnetsResponse(subnets.map(s => s.toJSON())));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateSubnet(req, res) {
      try {
        const { VpcId, CidrBlock } = req.body;
        const availabilityZone = req.body.AvailabilityZone || 'us-east-1a';
        if (!VpcId || !CidrBlock) {
          throw new Error('VpcId and CidrBlock are required');
        }
        const tags = extractTags(req.body, 'subnet');
        const subnet = simulator.createSubnet(VpcId, CidrBlock, availabilityZone, tags);
        sendXml(res, EC2ResponseFormatter.formatCreateSubnetResponse(subnet.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteSubnet(req, res) {
      try {
        const subnetId = req.body.SubnetId;
        if (!subnetId) throw new Error('SubnetId is required');
        simulator.deleteSubnet(subnetId);
        sendXml(res, EC2ResponseFormatter.formatDeleteSubnetResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeInternetGateways(req, res) {
      try {
        const ids = extractList(req.body, 'InternetGatewayId');
        const igws = simulator.describeInternetGateways(ids ? { internetGatewayIds: ids } : {});
        sendXml(res, EC2ResponseFormatter.formatDescribeIgwResponse(igws.map(i => i.toJSON())));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateInternetGateway(req, res) {
      try {
        const tags = extractTags(req.body, 'internet-gateway');
        const igw = simulator.createInternetGateway(tags);
        sendXml(res, EC2ResponseFormatter.formatCreateIgwResponse(igw.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AttachInternetGateway(req, res) {
      try {
        const { InternetGatewayId, VpcId } = req.body;
        if (!InternetGatewayId || !VpcId) {
          throw new Error('InternetGatewayId and VpcId are required');
        }
        simulator.attachInternetGateway(InternetGatewayId, VpcId);
        sendXml(res, EC2ResponseFormatter.formatAttachIgwResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DetachInternetGateway(req, res) {
      try {
        const { InternetGatewayId, VpcId } = req.body;
        if (!InternetGatewayId || !VpcId) {
          throw new Error('InternetGatewayId and VpcId are required');
        }
        simulator.detachInternetGateway(InternetGatewayId, VpcId);
        sendXml(res, EC2ResponseFormatter.formatDetachIgwResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteInternetGateway(req, res) {
      try {
        const internetGatewayId = req.body.InternetGatewayId;
        if (!internetGatewayId) throw new Error('InternetGatewayId is required');
        simulator.deleteInternetGateway(internetGatewayId);
        sendXml(res, EC2ResponseFormatter.formatDeleteIgwResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeRouteTables(req, res) {
      try {
        const vpcIds = extractList(req.body, 'VpcId');
        const routeTableIds = extractList(req.body, 'RouteTableId');
        const filters = {};
        if (vpcIds) filters.vpcIds = vpcIds;
        if (routeTableIds) filters.routeTableIds = routeTableIds;
        const routeTables = simulator.describeRouteTables(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeRouteTablesResponse(routeTables.map(rt => rt.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateRouteTable(req, res) {
      try {
        const vpcId = req.body.VpcId;
        if (!vpcId) throw new Error('VpcId is required');
        const tags = extractTags(req.body, 'route-table');
        const routeTable = simulator.createRouteTable(vpcId, tags);
        sendXml(res, EC2ResponseFormatter.formatCreateRouteTableResponse(routeTable.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateRoute(req, res) {
      try {
        const { RouteTableId, DestinationCidrBlock, GatewayId } = req.body;
        if (!RouteTableId || !DestinationCidrBlock || !GatewayId) {
          throw new Error('RouteTableId, DestinationCidrBlock and GatewayId are required');
        }
        simulator.addRoute(RouteTableId, DestinationCidrBlock, GatewayId);
        sendXml(res, EC2ResponseFormatter.formatCreateRouteResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteRouteTable(req, res) {
      try {
        const routeTableId = req.body.RouteTableId;
        if (!routeTableId) throw new Error('RouteTableId is required');
        simulator.deleteRouteTable(routeTableId);
        sendXml(res, EC2ResponseFormatter.formatDeleteRouteTableResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeNetworkAcls(req, res) {
      try {
        const aclIds = extractList(req.body, 'NetworkAclId');
        const filters = {};
        if (aclIds) filters.networkAclIds = aclIds;

        const nf = extractFilters(req.body);
        if (nf['vpc-id']) filters.vpcIds = nf['vpc-id'];
        if (nf['association.subnet-id']) filters.associationSubnetIds = nf['association.subnet-id'];

        const acls = simulator.describeNetworkAcls(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeNetworkAclsResponse(acls.map(acl => acl.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateNetworkAcl(req, res) {
      try {
        const vpcId = req.body.VpcId;
        if (!vpcId) throw new Error('VpcId is required');
        const tags = extractTags(req.body, 'network-acl');
        const acl = simulator.createNetworkAcl(vpcId, tags, false);
        sendXml(res, EC2ResponseFormatter.formatCreateNetworkAclResponse(acl.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteNetworkAcl(req, res) {
      try {
        const networkAclId = req.body.NetworkAclId;
        if (!networkAclId) throw new Error('NetworkAclId is required');
        simulator.deleteNetworkAcl(networkAclId);
        sendXml(res, EC2ResponseFormatter.formatDeleteNetworkAclResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateNetworkAclEntry(req, res) {
      try {
        const { NetworkAclId, RuleNumber, Protocol, RuleAction, Egress, CidrBlock } = req.body;
        if (!NetworkAclId || RuleNumber === undefined) {
          throw new Error('NetworkAclId and RuleNumber are required');
        }

        const portRange = req.body.PortRange
          ? { From: Number(req.body.PortRange.From), To: Number(req.body.PortRange.To) }
          : undefined;
        const icmpTypeCode = req.body.IcmpTypeCode
          ? { Type: Number(req.body.IcmpTypeCode.Type), Code: Number(req.body.IcmpTypeCode.Code) }
          : undefined;

        simulator.createNetworkAclEntry(NetworkAclId, {
          RuleNumber: Number(RuleNumber),
          Protocol: Protocol !== undefined ? String(Protocol) : '-1',
          RuleAction: RuleAction || 'allow',
          Egress: Egress === true || Egress === 'true',
          CidrBlock: CidrBlock || '0.0.0.0/0',
          IcmpTypeCode: icmpTypeCode,
          PortRange: portRange
        });
        sendXml(res, EC2ResponseFormatter.formatCreateNetworkAclEntryResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteNetworkAclEntry(req, res) {
      try {
        const { NetworkAclId, RuleNumber, Egress } = req.body;
        if (!NetworkAclId || RuleNumber === undefined) {
          throw new Error('NetworkAclId and RuleNumber are required');
        }
        simulator.deleteNetworkAclEntry(
          NetworkAclId,
          Number(RuleNumber),
          Egress === true || Egress === 'true'
        );
        sendXml(res, EC2ResponseFormatter.formatDeleteNetworkAclEntryResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    ReplaceNetworkAclAssociation(req, res) {
      try {
        const { AssociationId, NetworkAclId } = req.body;
        if (!AssociationId || !NetworkAclId) {
          throw new Error('AssociationId and NetworkAclId are required');
        }
        const association = simulator.replaceNetworkAclAssociation(AssociationId, NetworkAclId);
        sendXml(
          res,
          EC2ResponseFormatter.formatReplaceNetworkAclAssociationResponse(association.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeAddresses(req, res) {
      try {
        const allocationIds = extractList(req.body, 'AllocationId');
        const publicIps = extractList(req.body, 'PublicIp');
        const filters = {};
        if (allocationIds) filters.allocationIds = allocationIds;
        if (publicIps) filters.publicIps = publicIps;

        const nf = extractFilters(req.body);
        if (nf['allocation-id']) filters.allocationIds = nf['allocation-id'];
        if (nf['public-ip']) filters.publicIps = nf['public-ip'];
        if (nf['instance-id']) {
          let addresses = simulator.describeAddresses(filters);
          addresses = addresses.filter(a => nf['instance-id'].includes(a.InstanceId));
          return sendXml(
            res,
            EC2ResponseFormatter.formatDescribeAddressesResponse(addresses.map(a => a.toJSON()))
          );
        }

        const addresses = simulator.describeAddresses(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeAddressesResponse(addresses.map(a => a.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AllocateAddress(req, res) {
      try {
        const { Domain, PublicIpv4Pool } = req.body;
        const tags = extractTags(req.body, 'elastic-ip');
        const address = simulator.allocateAddress({ Domain, PublicIpv4Pool, Tags: tags });
        sendXml(res, EC2ResponseFormatter.formatAllocateAddressResponse(address.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    ReleaseAddress(req, res) {
      try {
        const allocationId = req.body.AllocationId;
        if (!allocationId) throw new Error('AllocationId is required');
        simulator.releaseAddress(allocationId);
        sendXml(res, EC2ResponseFormatter.formatReleaseAddressResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AssociateAddress(req, res) {
      try {
        const { AllocationId, InstanceId, NetworkInterfaceId, PrivateIpAddress } = req.body;
        const address = simulator.associateAddress({
          allocationId: AllocationId,
          instanceId: InstanceId,
          networkInterfaceId: NetworkInterfaceId,
          privateIpAddress: PrivateIpAddress
        });
        sendXml(res, EC2ResponseFormatter.formatAssociateAddressResponse(address.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DisassociateAddress(req, res) {
      try {
        const { AssociationId, PublicIp } = req.body;
        let allocationId;
        if (PublicIp) {
          const found = simulator.describeAddresses({ publicIps: [PublicIp] })[0];
          allocationId = found ? found.AllocationId : undefined;
        }
        if (!allocationId && !AssociationId) {
          throw new Error('AssociationId or PublicIp is required');
        }
        simulator.disassociateAddress({ associationId: AssociationId, allocationId });
        sendXml(res, EC2ResponseFormatter.formatDisassociateAddressResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeEgressOnlyInternetGateways(req, res) {
      try {
        const ids = extractList(req.body, 'EgressOnlyInternetGatewayId');
        const gateways = simulator.describeEgressOnlyInternetGateways(
          ids ? { egressOnlyInternetGatewayIds: ids } : {}
        );
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeEgressOnlyInternetGatewaysResponse(
            gateways.map(e => e.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateEgressOnlyInternetGateway(req, res) {
      try {
        const vpcId = req.body.VpcId;
        if (!vpcId) throw new Error('VpcId is required');
        const tags = extractTags(req.body, 'egress-only-internet-gateway');
        const eigw = simulator.createEgressOnlyInternetGateway(vpcId, tags);
        sendXml(
          res,
          EC2ResponseFormatter.formatCreateEgressOnlyInternetGatewayResponse(eigw.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteEgressOnlyInternetGateway(req, res) {
      try {
        const id = req.body.EgressOnlyInternetGatewayId;
        if (!id) throw new Error('EgressOnlyInternetGatewayId is required');
        simulator.deleteEgressOnlyInternetGateway(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteEgressOnlyInternetGatewayResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeDhcpOptions(req, res) {
      try {
        const ids = extractList(req.body, 'DhcpOptionsId');
        const vpcIds = extractList(req.body, 'VpcId');
        const filters = {};
        if (ids) filters.dhcpOptionsIds = ids;
        if (vpcIds) filters.vpcIds = vpcIds;
        const options = simulator.describeDhcpOptions(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeDhcpOptionsResponse(options.map(o => o.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateDhcpOptions(req, res) {
      try {
        const raw = req.body.DhcpConfiguration;
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const configurations = list.map(cfg => {
          let values = cfg.Value;
          if (values === undefined) values = [];
          else if (!Array.isArray(values)) {
            values = typeof values === 'object' ? Object.values(values) : [values];
          }
          return { Key: cfg.Key, Values: values.map(v => ({ Value: v })) };
        });
        if (configurations.length === 0) throw new Error('DhcpConfiguration is required');
        const tags = extractTags(req.body, 'dhcp-options');
        const options = simulator.createDhcpOptions(configurations, tags);
        sendXml(res, EC2ResponseFormatter.formatCreateDhcpOptionsResponse(options.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteDhcpOptions(req, res) {
      try {
        const id = req.body.DhcpOptionsId;
        if (!id) throw new Error('DhcpOptionsId is required');
        simulator.deleteDhcpOptions(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteDhcpOptionsResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AssociateDhcpOptions(req, res) {
      try {
        const { DhcpOptionsId, VpcId } = req.body;
        if (!DhcpOptionsId || !VpcId) {
          throw new Error('DhcpOptionsId and VpcId are required');
        }
        simulator.associateDhcpOptions(VpcId, DhcpOptionsId);
        sendXml(res, EC2ResponseFormatter.formatAssociateDhcpOptionsResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeNatGateways(req, res) {
      try {
        const ids = extractList(req.body, 'NatGatewayId');
        const filters = {};
        if (ids) filters.natGatewayIds = ids;

        const nf = extractFilters(req.body);
        if (nf['subnet-id']) filters.subnetIds = nf['subnet-id'];
        if (nf['vpc-id']) filters.vpcIds = nf['vpc-id'];
        if (nf.state) {
          const gateways = simulator
            .describeNATGateways(filters)
            .filter(ng => nf.state.includes(ng.State));
          return sendXml(
            res,
            EC2ResponseFormatter.formatDescribeNatGatewaysResponse(gateways.map(ng => ng.toJSON()))
          );
        }

        const gateways = simulator.describeNATGateways(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeNatGatewaysResponse(gateways.map(ng => ng.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateNatGateway(req, res) {
      try {
        const { SubnetId, AllocationId, ConnectivityType } = req.body;
        if (!SubnetId) throw new Error('SubnetId is required');
        const tags = extractTags(req.body, 'natgateway');
        const natGw = simulator.createNATGateway(SubnetId, AllocationId || null, {
          ConnectivityType,
          Tags: tags
        });
        sendXml(res, EC2ResponseFormatter.formatCreateNatGatewayResponse(natGw.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteNatGateway(req, res) {
      try {
        const natGatewayId = req.body.NatGatewayId;
        if (!natGatewayId) throw new Error('NatGatewayId is required');
        simulator.deleteNATGateway(natGatewayId);
        sendXml(res, EC2ResponseFormatter.formatDeleteNatGatewayResponse(natGatewayId));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPC Endpoints ==========

    CreateVpcEndpoint(req, res) {
      try {
        const { VpcId, ServiceName, VpcEndpointType, PrivateDnsEnabled, PolicyDocument } = req.body;
        if (!VpcId || !ServiceName) throw new Error('VpcId and ServiceName are required');
        const routeTableIds = extractList(req.body, 'RouteTableId');
        const subnetIds = extractList(req.body, 'SubnetId');
        const securityGroupIds = extractList(req.body, 'SecurityGroupId');
        const tags = extractTags(req.body, 'vpc-endpoint');
        const endpoint = simulator.createVPCEndpoint(VpcId, ServiceName, {
          VpcEndpointType,
          RouteTableIds: routeTableIds,
          SubnetIds: subnetIds,
          SecurityGroupIds: securityGroupIds,
          PrivateDnsEnabled: PrivateDnsEnabled === true || PrivateDnsEnabled === 'true',
          PolicyDocument,
          Tags: tags
        });
        sendXml(res, EC2ResponseFormatter.formatCreateVpcEndpointResponse(endpoint.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeVpcEndpoints(req, res) {
      try {
        const ids = extractList(req.body, 'VpcEndpointId');
        const filters = {};
        if (ids) filters.vpcEndpointIds = ids;
        const nf = extractFilters(req.body);
        if (nf['vpc-id']) filters.vpcIds = nf['vpc-id'];
        if (nf['service-name']) filters.serviceName = nf['service-name'][0];
        const endpoints = simulator.describeVPCEndpoints(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeVpcEndpointsResponse(
            endpoints.map(e => e.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    ModifyVpcEndpoint(req, res) {
      try {
        const { VpcEndpointId, PolicyDocument } = req.body;
        if (!VpcEndpointId) throw new Error('VpcEndpointId is required');
        const routeTableIds = extractList(req.body, 'AddRouteTableId');
        const subnetIds = extractList(req.body, 'AddSubnetId');
        simulator.modifyVPCEndpoint(VpcEndpointId, {
          RouteTableIds: routeTableIds,
          SubnetIds: subnetIds,
          PolicyDocument
        });
        sendXml(res, EC2ResponseFormatter.formatModifyVpcEndpointResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteVpcEndpoints(req, res) {
      try {
        const ids = extractList(req.body, 'VpcEndpointId');
        if (!ids || ids.length === 0) throw new Error('VpcEndpointId is required');
        ids.forEach(id => simulator.deleteVPCEndpoint(id));
        sendXml(res, EC2ResponseFormatter.formatDeleteVpcEndpointsResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPC Peering Connections ==========

    CreateVpcPeeringConnection(req, res) {
      try {
        const { VpcId, PeerVpcId } = req.body;
        if (!VpcId || !PeerVpcId) throw new Error('VpcId and PeerVpcId are required');
        const tags = extractTags(req.body, 'vpc-peering-connection');
        const connection = simulator.createVPCPeeringConnection(VpcId, PeerVpcId, { Tags: tags });
        sendXml(
          res,
          EC2ResponseFormatter.formatCreateVpcPeeringConnectionResponse(connection.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeVpcPeeringConnections(req, res) {
      try {
        const ids = extractList(req.body, 'VpcPeeringConnectionId');
        const filters = {};
        if (ids) filters.vpcPeeringConnectionIds = ids;
        const nf = extractFilters(req.body);
        const vpcIds = [
          ...(nf['requester-vpc-info.vpc-id'] || []),
          ...(nf['accepter-vpc-info.vpc-id'] || [])
        ];
        if (vpcIds.length > 0) filters.vpcIds = vpcIds;
        if (nf['status-code']) filters.status = nf['status-code'];
        const connections = simulator.describeVPCPeeringConnections(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeVpcPeeringConnectionsResponse(
            connections.map(c => c.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AcceptVpcPeeringConnection(req, res) {
      try {
        const id = req.body.VpcPeeringConnectionId;
        if (!id) throw new Error('VpcPeeringConnectionId is required');
        const connection = simulator.acceptVPCPeeringConnection(id);
        sendXml(
          res,
          EC2ResponseFormatter.formatAcceptVpcPeeringConnectionResponse(connection.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    RejectVpcPeeringConnection(req, res) {
      try {
        const id = req.body.VpcPeeringConnectionId;
        if (!id) throw new Error('VpcPeeringConnectionId is required');
        simulator.rejectVPCPeeringConnection(id);
        sendXml(res, EC2ResponseFormatter.formatRejectVpcPeeringConnectionResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteVpcPeeringConnection(req, res) {
      try {
        const id = req.body.VpcPeeringConnectionId;
        if (!id) throw new Error('VpcPeeringConnectionId is required');
        simulator.deleteVPCPeeringConnection(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteVpcPeeringConnectionResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPC Endpoint Services ==========

    CreateVpcEndpointServiceConfiguration(req, res) {
      try {
        const nlbArns = extractList(req.body, 'NetworkLoadBalancerArn') || [];
        const acceptanceRequired =
          req.body.AcceptanceRequired === true || req.body.AcceptanceRequired === 'true';
        const tags = extractTags(req.body, 'vpc-endpoint-service');
        const service = simulator.createVPCEndpointServiceConfiguration(nlbArns, {
          AcceptanceRequired: acceptanceRequired,
          Tags: tags
        });
        sendXml(
          res,
          EC2ResponseFormatter.formatCreateVpcEndpointServiceConfigurationResponse(
            service.toJSON()
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeVpcEndpointServiceConfigurations(req, res) {
      try {
        const ids = extractList(req.body, 'ServiceId');
        const filters = {};
        if (ids) filters.serviceIds = ids;
        const services = simulator.describeVPCEndpointServiceConfigurations(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeVpcEndpointServiceConfigurationsResponse(
            services.map(s => s.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    ModifyVpcEndpointServiceConfiguration(req, res) {
      try {
        const { ServiceId, AcceptanceRequired } = req.body;
        if (!ServiceId) throw new Error('ServiceId is required');
        simulator.modifyVPCEndpointServiceConfiguration(ServiceId, {
          AcceptanceRequired:
            AcceptanceRequired === true || AcceptanceRequired === 'true'
        });
        sendXml(res, EC2ResponseFormatter.formatModifyVpcEndpointServiceConfigurationResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteVpcEndpointServiceConfigurations(req, res) {
      try {
        const ids = extractList(req.body, 'ServiceId');
        if (!ids || ids.length === 0) throw new Error('ServiceId is required');
        simulator.deleteVPCEndpointServiceConfigurations(ids);
        sendXml(res, EC2ResponseFormatter.formatDeleteVpcEndpointServiceConfigurationsResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeVpcEndpointServices(req, res) {
      try {
        const names = extractList(req.body, 'ServiceName');
        const services = simulator.describeVPCEndpointServices(
          names ? { serviceNames: names } : {}
        );
        sendXml(res, EC2ResponseFormatter.formatDescribeVpcEndpointServicesResponse(services));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPN: Customer Gateways ==========

    CreateCustomerGateway(req, res) {
      try {
        const { Type, BgpAsn, IpAddress, CertificateArn } = req.body;
        if (!Type) throw new Error('Type is required');
        if (!BgpAsn) throw new Error('BgpAsn is required');
        const tags = extractTags(req.body, 'customer-gateway');
        const cgw = simulator.createCustomerGateway(Type, BgpAsn, {
          IpAddress,
          CertificateArn,
          Tags: tags
        });
        sendXml(res, EC2ResponseFormatter.formatCreateCustomerGatewayResponse(cgw.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeCustomerGateways(req, res) {
      try {
        const ids = extractList(req.body, 'CustomerGatewayId');
        const gateways = simulator.describeCustomerGateways(
          ids ? { customerGatewayIds: ids } : {}
        );
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeCustomerGatewaysResponse(gateways.map(g => g.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteCustomerGateway(req, res) {
      try {
        const id = req.body.CustomerGatewayId;
        if (!id) throw new Error('CustomerGatewayId is required');
        simulator.deleteCustomerGateway(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteCustomerGatewayResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPN: Virtual Private Gateways ==========

    CreateVpnGateway(req, res) {
      try {
        const { Type, AvailabilityZone, AmazonSideAsn } = req.body;
        const tags = extractTags(req.body, 'vpn-gateway');
        const vgw = simulator.createVpnGateway(Type || 'ipsec.1', {
          AvailabilityZone,
          AmazonSideAsn: AmazonSideAsn ? Number(AmazonSideAsn) : undefined,
          Tags: tags
        });
        sendXml(res, EC2ResponseFormatter.formatCreateVpnGatewayResponse(vgw.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeVpnGateways(req, res) {
      try {
        const ids = extractList(req.body, 'VpnGatewayId');
        const gateways = simulator.describeVpnGateways(ids ? { vpnGatewayIds: ids } : {});
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeVpnGatewaysResponse(gateways.map(g => g.toJSON()))
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AttachVpnGateway(req, res) {
      try {
        const { VpnGatewayId, VpcId } = req.body;
        if (!VpnGatewayId) throw new Error('VpnGatewayId is required');
        if (!VpcId) throw new Error('VpcId is required');
        simulator.attachVpnGateway(VpnGatewayId, VpcId);
        sendXml(res, EC2ResponseFormatter.formatAttachVpnGatewayResponse(VpcId));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DetachVpnGateway(req, res) {
      try {
        const { VpnGatewayId, VpcId } = req.body;
        if (!VpnGatewayId) throw new Error('VpnGatewayId is required');
        if (!VpcId) throw new Error('VpcId is required');
        simulator.detachVpnGateway(VpnGatewayId, VpcId);
        sendXml(res, EC2ResponseFormatter.formatDetachVpnGatewayResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteVpnGateway(req, res) {
      try {
        const id = req.body.VpnGatewayId;
        if (!id) throw new Error('VpnGatewayId is required');
        simulator.deleteVpnGateway(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteVpnGatewayResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPN: Site-to-site Connections ==========

    CreateVpnConnection(req, res) {
      try {
        const { Type, CustomerGatewayId, VpnGatewayId } = req.body;
        if (!CustomerGatewayId) throw new Error('CustomerGatewayId is required');
        if (!VpnGatewayId) throw new Error('VpnGatewayId is required');
        const staticRoutesOnly =
          req.body['Options.StaticRoutesOnly'] === true ||
          req.body['Options.StaticRoutesOnly'] === 'true';
        const tags = extractTags(req.body, 'vpn-connection');
        const connection = simulator.createVpnConnection(
          Type || 'ipsec.1',
          CustomerGatewayId,
          VpnGatewayId,
          { Options: { StaticRoutesOnly: staticRoutesOnly }, Tags: tags }
        );
        sendXml(
          res,
          EC2ResponseFormatter.formatCreateVpnConnectionResponse(connection.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeVpnConnections(req, res) {
      try {
        const ids = extractList(req.body, 'VpnConnectionId');
        const connections = simulator.describeVpnConnections(
          ids ? { vpnConnectionIds: ids } : {}
        );
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeVpnConnectionsResponse(
            connections.map(c => c.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteVpnConnection(req, res) {
      try {
        const id = req.body.VpnConnectionId;
        if (!id) throw new Error('VpnConnectionId is required');
        simulator.deleteVpnConnection(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteVpnConnectionResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== VPN: Client VPN Endpoints ==========

    CreateClientVpnEndpoint(req, res) {
      try {
        const cidr = req.body.ClientCidrBlock;
        const certArn = req.body.ServerCertificateArn;
        if (!cidr) throw new Error('ClientCidrBlock is required');
        if (!certArn) throw new Error('ServerCertificateArn is required');
        const subnetIds = extractList(req.body, 'VpcId.SubnetId') || extractList(req.body, 'SubnetId') || [];
        const tags = extractTags(req.body, 'client-vpn-endpoint');
        const endpoint = simulator.createClientVpnEndpoint({
          ClientCidrBlock: cidr,
          ServerCertificateArn: certArn,
          VpcId: req.body.VpcId,
          TransportProtocol: req.body.TransportProtocol,
          VpnPort: req.body.VpnPort ? Number(req.body.VpnPort) : undefined,
          SplitTunnel:
            req.body.SplitTunnel === true || req.body.SplitTunnel === 'true',
          SubnetIds: subnetIds,
          Tags: tags
        });
        sendXml(
          res,
          EC2ResponseFormatter.formatCreateClientVpnEndpointResponse(endpoint.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DescribeClientVpnEndpoints(req, res) {
      try {
        const ids = extractList(req.body, 'ClientVpnEndpointId');
        const endpoints = simulator.describeClientVpnEndpoints(
          ids ? { clientVpnEndpointIds: ids } : {}
        );
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeClientVpnEndpointsResponse(
            endpoints.map(e => e.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    AssociateClientVpnTargetNetwork(req, res) {
      try {
        const { ClientVpnEndpointId, SubnetId } = req.body;
        if (!ClientVpnEndpointId) throw new Error('ClientVpnEndpointId is required');
        if (!SubnetId) throw new Error('SubnetId is required');
        const endpoint = simulator.associateClientVpnTargetNetwork(
          ClientVpnEndpointId,
          SubnetId
        );
        sendXml(
          res,
          EC2ResponseFormatter.formatAssociateClientVpnTargetNetworkResponse(
            endpoint.toJSON(),
            SubnetId
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteClientVpnEndpoint(req, res) {
      try {
        const id = req.body.ClientVpnEndpointId;
        if (!id) throw new Error('ClientVpnEndpointId is required');
        simulator.deleteClientVpnEndpoint(id);
        sendXml(res, EC2ResponseFormatter.formatDeleteClientVpnEndpointResponse());
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    // ========== Managed Prefix Lists ==========

    DescribeManagedPrefixLists(req, res) {
      try {
        const ids = extractList(req.body, 'PrefixListId');
        const filters = {};
        if (ids) filters.prefixListIds = ids;

        const nf = extractFilters(req.body);
        if (nf['prefix-list-name']) filters.prefixListNames = nf['prefix-list-name'];

        const lists = simulator.describeManagedPrefixLists(filters);
        sendXml(
          res,
          EC2ResponseFormatter.formatDescribeManagedPrefixListsResponse(
            lists.map(l => l.toJSON())
          )
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    CreateManagedPrefixList(req, res) {
      try {
        const prefixListName = req.body.PrefixListName;
        if (!prefixListName) throw new Error('PrefixListName is required');
        const tags = extractTags(req.body, 'prefix-list');
        const rawEntries = extractIndexedObjects(req.body, 'Entry');
        const entries = rawEntries
          .filter(entry => entry.Cidr)
          .map(entry => ({ Cidr: entry.Cidr, Description: entry.Description }));
        const list = simulator.createManagedPrefixList({
          PrefixListName: prefixListName,
          AddressFamily: req.body.AddressFamily,
          MaxEntries: req.body.MaxEntries ? Number(req.body.MaxEntries) : undefined,
          Entries: entries,
          Tags: tags
        });
        sendXml(res, EC2ResponseFormatter.formatCreateManagedPrefixListResponse(list.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    DeleteManagedPrefixList(req, res) {
      try {
        const id = req.body.PrefixListId;
        if (!id) throw new Error('PrefixListId is required');
        const list = simulator.getManagedPrefixList(id);
        simulator.deleteManagedPrefixList(id);
        sendXml(
          res,
          EC2ResponseFormatter.formatDeleteManagedPrefixListResponse(list.toJSON())
        );
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    ModifyManagedPrefixList(req, res) {
      try {
        const id = req.body.PrefixListId;
        if (!id) throw new Error('PrefixListId is required');
        const addEntries = extractIndexedObjects(req.body, 'AddEntry')
          .filter(entry => entry.Cidr)
          .map(entry => ({ Cidr: entry.Cidr, Description: entry.Description }));
        const removeEntries = extractIndexedObjects(req.body, 'RemoveEntry')
          .filter(entry => entry.Cidr)
          .map(entry => ({ Cidr: entry.Cidr }));
        const list = simulator.modifyManagedPrefixList(id, {
          AddEntries: addEntries,
          RemoveEntries: removeEntries
        });
        sendXml(res, EC2ResponseFormatter.formatModifyManagedPrefixListResponse(list.toJSON()));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    },

    GetManagedPrefixListEntries(req, res) {
      try {
        const id = req.body.PrefixListId;
        if (!id) throw new Error('PrefixListId is required');
        const result = simulator.getManagedPrefixListEntries(id);
        sendXml(res, EC2ResponseFormatter.formatGetManagedPrefixListEntriesResponse(result));
      } catch (error) {
        sendError(res, 'InternalError', error.message);
      }
    }
  };
}

module.exports = { setupVpcAdminRoutes, createVpcQueryHandlers };
