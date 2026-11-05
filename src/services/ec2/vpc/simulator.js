/**
 * VPC Simulator
 * Gerencia o estado de VPCs, subnets, rotas e gateways com persistência
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const VPC = require('./models/vpc');
const Subnet = require('./models/subnet');
const { RouteTable } = require('./models/routeTable');
const { InternetGateway, InternetGatewayAttachment } = require('./models/internetGateway');
const VPCEndpoint = require('./models/vpcEndpoint');
const ElasticIp = require('./models/elasticIp');
const EgressOnlyInternetGateway = require('./models/egressOnlyInternetGateway');
const DhcpOptions = require('./models/dhcpOptions');
const ManagedPrefixList = require('./models/managedPrefixList');
const VPCPeeringConnection = require('./models/vpcPeeringConnection');
const VPCEndpointService = require('./models/vpcEndpointService');
const ClientVpnEndpoint = require('./models/clientVpnEndpoint');
const { NetworkAcl, NetworkAclEntry, NetworkAclAssociation } = require('./models/networkAcl');
const {
  NATGateway,
  CustomerGateway,
  VpnGateway,
  VpnConnection
} = require('./models/vpcGateway');
const LocalStore = require('../../../utils/local-store');
const logger = require('../../../utils/logger');

class VPCSimulator {
  constructor(config = {}) {
    this.config = config;
    this.vpcs = new Map();
    this.subnets = new Map();
    this.routeTables = new Map();
    this.internetGateways = new Map();
    this.networkAcls = new Map();
    this.vpcEndpoints = new Map();
    this.vpcEndpointServices = new Map();
    this.vpcPeeringConnections = new Map();
    this.elasticIps = new Map();
    this.egressOnlyInternetGateways = new Map();
    this.dhcpOptions = new Map();
    this.managedPrefixLists = new Map();
    this.natGateways = new Map();
    this.customerGateways = new Map();
    this.vpnGateways = new Map();
    this.vpnConnections = new Map();
    this.clientVpnEndpoints = new Map();

    // Inicializar persistência
    // VPC passou a fazer parte do serviço EC2 (fusão) -> dados ficam sob ec2/vpc.
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || './.aws-local-simulator-data';
    this.dataDir = path.join(dataDir, 'ec2', 'vpc');
    this.legacyDataDir = path.join(dataDir, 'vpc');
    this.store = new LocalStore(this.dataDir);
    this.legacyStore = new LocalStore(this.legacyDataDir);
    this.isPersistent = true;
  }

  async initialize() {
    // 1. Carregar dados persistidos se existirem
    await this.loadFromPersistence();

    // 1b. Migração one-time: se não há dados no novo local, importar do legado (dataDir/vpc)
    if (this.isEmpty()) {
      this.migrateFromLegacy();
    }

    // 2. Se não houver dados persistidos, carregar da configuração
    if (this.vpcs.size === 0 && this.config.vpcs && Array.isArray(this.config.vpcs)) {
      logger.info('📚 Carregando VPCs da configuração inicial...');
      for (const vpcConfig of this.config.vpcs) {
        this.createVPC(vpcConfig.CidrBlock, vpcConfig.Tags || []);
      }
    }

    if (this.subnets.size === 0 && this.config.subnets && Array.isArray(this.config.subnets)) {
      for (const subnetConfig of this.config.subnets) {
        this.createSubnet(
          subnetConfig.VpcId,
          subnetConfig.CidrBlock,
          subnetConfig.AvailabilityZone,
          subnetConfig.Tags
        );
      }
    }

    // 3. Garantir que exista um conjunto padrão de DHCP options e que as VPCs
    //    que ainda não têm um estejam associadas a ele.
    this.ensureDefaultDhcpOptions();

    // 4. Garantir a lista de prefixos padrão (AWS-owned) por região.
    this.ensureDefaultManagedPrefixList();
  }

  /**
   * Garante a existência do conjunto padrão de DHCP options e associa as VPCs
   * sem DhcpOptionsId a ele (comportamento da AWS).
   */
  ensureDefaultDhcpOptions() {
    let defaultOptions = Array.from(this.dhcpOptions.values()).find(o => o.IsDefault);
    let created = false;

    if (!defaultOptions) {
      defaultOptions = DhcpOptions.defaultOptions();
      this.dhcpOptions.set(defaultOptions.DhcpOptionsId, defaultOptions);
      created = true;
      logger.info(`📚 Criado conjunto padrão de DHCP options (${defaultOptions.DhcpOptionsId})`);
    }

    let changed = false;
    for (const vpc of this.vpcs.values()) {
      if (!vpc.DhcpOptionsId) {
        vpc.DhcpOptionsId = defaultOptions.DhcpOptionsId;
        changed = true;
      }
    }

    if (created || changed) {
      this.persistData();
    }
  }

  /**
   * Garante a existência da lista de prefixos padrão (equivalente à que a AWS
   * disponibiliza por região, ex.: `com.amazonaws.us-east-1.s3`).
   */
  ensureDefaultManagedPrefixList() {
    const exists = Array.from(this.managedPrefixLists.values()).some(
      list => list.OwnerId === 'AWS'
    );
    if (exists) {
      return;
    }

    const defaultList = ManagedPrefixList.defaultPrefixList();
    this.managedPrefixLists.set(defaultList.PrefixListId, defaultList);
    logger.info(`📚 Criada managed prefix list padrão (${defaultList.PrefixListId})`);
    this.persistData();
  }

  /**
   * Carrega dados persistidos do storage
   */
  async loadFromPersistence() {
    try {
      // Carregar VPCs
      const vpcsData = this.store.read('vpcs');
      if (Array.isArray(vpcsData)) {
        logger.info(`📂 Carregando ${vpcsData.length} VPCs do storage...`);
        for (const vpcData of vpcsData) {
          const vpc = new VPC(vpcData.CidrBlock, vpcData.Tags, {
            EnableDnsHostnames: vpcData.EnableDnsHostnames,
            EnableDnsSupport: vpcData.EnableDnsSupport
          });
          vpc.VpcId = vpcData.VpcId;
          vpc.State = vpcData.State;
          vpc.DhcpOptionsId = vpcData.DhcpOptionsId || null;
          this.vpcs.set(vpc.VpcId, vpc);
        }
      }

      // Carregar Subnets
      const subnetsData = this.store.read('subnets');
      if (Array.isArray(subnetsData)) {
        logger.info(`📂 Carregando ${subnetsData.length} Subnets do storage...`);
        for (const subnetData of subnetsData) {
          const subnet = new Subnet(
            subnetData.VpcId,
            subnetData.CidrBlock,
            subnetData.AvailabilityZone,
            subnetData.Tags,
            { MapPublicIpOnLaunch: subnetData.MapPublicIpOnLaunch }
          );
          subnet.SubnetId = subnetData.SubnetId;
          subnet.State = subnetData.State;
          this.subnets.set(subnet.SubnetId, subnet);
        }
      }

      // Carregar Internet Gateways
      const igwsData = this.store.read('internet-gateways');
      if (Array.isArray(igwsData)) {
        logger.info(`📂 Carregando ${igwsData.length} Internet Gateways do storage...`);
        for (const igwData of igwsData) {
          const igw = new InternetGateway(igwData.Tags);
          igw.InternetGatewayId = igwData.InternetGatewayId;
          // Reconstrói as anexações como instâncias (o JSON carrega objetos simples)
          igw.Attachments = (igwData.Attachments || []).map(att => {
            const attachment = new InternetGatewayAttachment(att.VpcId);
            attachment.State = att.State || 'available';
            return attachment;
          });
          this.internetGateways.set(igw.InternetGatewayId, igw);
        }
      }

      // Carregar Route Tables
      const rtbsData = this.store.read('route-tables');
      if (Array.isArray(rtbsData)) {
        logger.info(`📂 Carregando ${rtbsData.length} Route Tables do storage...`);
        for (const rtbData of rtbsData) {
          const rtb = new RouteTable(rtbData.VpcId, rtbData.Tags);
          rtb.RouteTableId = rtbData.RouteTableId;
          rtb.State = rtbData.State || 'active';
          rtb.CreatedAt = rtbData.CreatedAt || new Date().toISOString();
          
          // Desserializar Routes corretamente
          const { Route } = require('./models/routeTable');
          rtb.Routes = (rtbData.Routes || []).map(routeData => {
            const route = new Route(
              routeData.DestinationCidrBlock,
              routeData.GatewayId || routeData.NatGatewayId || routeData.VpcEndpointId || routeData.InstanceId || routeData.NetworkInterfaceId || 'local',
              routeData.GatewayId ? 'igw' : routeData.NatGatewayId ? 'nat' : routeData.VpcEndpointId ? 'vpce' : routeData.InstanceId ? 'instance' : routeData.NetworkInterfaceId ? 'eni' : 'local'
            );
            // Restaurar propriedades originais
            route.State = routeData.State || 'active';
            route.Origin = routeData.Origin || 'CreateRouteTable';
            route.CreatedAt = routeData.CreatedAt || new Date().toISOString();
            return route;
          });
          
          // Desserializar Associations corretamente
          const { RouteTableAssociation } = require('./models/routeTable');
          rtb.Associations = (rtbData.Associations || []).map(assocData => {
            const association = new RouteTableAssociation(assocData.SubnetId, assocData.RouteTableId, assocData.Main);
            association.RouteTableAssociationId = assocData.RouteTableAssociationId || `rtbassoc-${uuidv4().substring(0, 8)}`;
            association.CreatedAt = assocData.CreatedAt || new Date().toISOString();
            return association;
          });
          
          rtb.IsMain = rtbData.IsMain || false;
          this.routeTables.set(rtb.RouteTableId, rtb);
        }
      }

      // Carregar Network ACLs
      const aclsData = this.store.read('network-acls');
      if (Array.isArray(aclsData)) {
        logger.info(`📂 Carregando ${aclsData.length} Network ACLs do storage...`);
        for (const aclData of aclsData) {
          const acl = new NetworkAcl(aclData.VpcId, aclData.Tags || [], false);
          acl.NetworkAclId = aclData.NetworkAclId;
          acl.IsDefault = aclData.IsDefault || false;
          acl.CreatedAt = aclData.CreatedAt || new Date().toISOString();

          acl.Entries = (aclData.Entries || []).map(e => new NetworkAclEntry(e));
          acl.Associations = (aclData.Associations || []).map(assocData => {
            const association = new NetworkAclAssociation(acl.NetworkAclId, assocData.SubnetId);
            association.NetworkAclAssociationId =
              assocData.NetworkAclAssociationId || association.NetworkAclAssociationId;
            return association;
          });

          this.networkAcls.set(acl.NetworkAclId, acl);
        }
      }

      // Carregar VPC Endpoints
      const endpointsData = this.store.read('vpc-endpoints');
      if (Array.isArray(endpointsData)) {
        logger.info(`📂 Carregando ${endpointsData.length} VPC Endpoints do storage...`);
        for (const epData of endpointsData) {
          const endpoint = VPCEndpoint.fromJSON(epData);
          this.vpcEndpoints.set(endpoint.VpcEndpointId, endpoint);
        }
      }

      // Carregar VPC Endpoint Services
      const endpointServicesData = this.store.read('vpc-endpoint-services');
      if (Array.isArray(endpointServicesData)) {
        logger.info(
          `📂 Carregando ${endpointServicesData.length} VPC Endpoint Services do storage...`
        );
        for (const svcData of endpointServicesData) {
          const service = VPCEndpointService.fromJSON(svcData);
          this.vpcEndpointServices.set(service.ServiceId, service);
        }
      }

      // Carregar VPC Peering Connections
      const peeringsData = this.store.read('vpc-peering-connections');
      if (Array.isArray(peeringsData)) {
        logger.info(
          `📂 Carregando ${peeringsData.length} VPC Peering Connections do storage...`
        );
        for (const peeringData of peeringsData) {
          const connection = VPCPeeringConnection.fromJSON(peeringData);
          this.vpcPeeringConnections.set(connection.VpcPeeringConnectionId, connection);
        }
      }

      // Carregar Elastic IPs
      const eipsData = this.store.read('elastic-ips');
      if (Array.isArray(eipsData)) {
        logger.info(`📂 Carregando ${eipsData.length} Elastic IPs do storage...`);
        for (const eipData of eipsData) {
          const eip = ElasticIp.fromJSON(eipData);
          this.elasticIps.set(eip.AllocationId, eip);
        }
      }

      // Carregar Egress-only Internet Gateways
      const eigwsData = this.store.read('egress-only-internet-gateways');
      if (Array.isArray(eigwsData)) {
        logger.info(`📂 Carregando ${eigwsData.length} Egress-only IGWs do storage...`);
        for (const eigwData of eigwsData) {
          const eigw = EgressOnlyInternetGateway.fromJSON(eigwData);
          this.egressOnlyInternetGateways.set(eigw.EgressOnlyInternetGatewayId, eigw);
        }
      }

      // Carregar DHCP Options
      const dhcpData = this.store.read('dhcp-options');
      if (Array.isArray(dhcpData)) {
        logger.info(`📂 Carregando ${dhcpData.length} DHCP option sets do storage...`);
        for (const optionsData of dhcpData) {
          const options = DhcpOptions.fromJSON(optionsData);
          this.dhcpOptions.set(options.DhcpOptionsId, options);
        }
      }

      // Carregar Managed Prefix Lists
      const prefixListsData = this.store.read('managed-prefix-lists');
      if (Array.isArray(prefixListsData)) {
        logger.info(`📂 Carregando ${prefixListsData.length} Managed Prefix Lists do storage...`);
        for (const item of prefixListsData) {
          const list = ManagedPrefixList.fromJSON(item);
          this.managedPrefixLists.set(list.PrefixListId, list);
        }
      }

      // Carregar NAT Gateways
      const natData = this.store.read('nat-gateways');
      if (Array.isArray(natData)) {
        logger.info(`📂 Carregando ${natData.length} NAT Gateways do storage...`);
        for (const natGwData of natData) {
          const natGw = NATGateway.fromJSON(natGwData);
          this.natGateways.set(natGw.NatGatewayId, natGw);
        }
      }

      // Carregar Customer Gateways
      const cgwData = this.store.read('customer-gateways');
      if (Array.isArray(cgwData)) {
        logger.info(`📂 Carregando ${cgwData.length} Customer Gateways do storage...`);
        for (const item of cgwData) {
          const cgw = CustomerGateway.fromJSON(item);
          this.customerGateways.set(cgw.CustomerGatewayId, cgw);
        }
      }

      // Carregar VPN Gateways
      const vgwData = this.store.read('vpn-gateways');
      if (Array.isArray(vgwData)) {
        logger.info(`📂 Carregando ${vgwData.length} VPN Gateways do storage...`);
        for (const item of vgwData) {
          const vgw = VpnGateway.fromJSON(item);
          this.vpnGateways.set(vgw.VpnGatewayId, vgw);
        }
      }

      // Carregar VPN Connections
      const vpnData = this.store.read('vpn-connections');
      if (Array.isArray(vpnData)) {
        logger.info(`📂 Carregando ${vpnData.length} VPN Connections do storage...`);
        for (const item of vpnData) {
          const vpn = VpnConnection.fromJSON(item);
          this.vpnConnections.set(vpn.VpnConnectionId, vpn);
        }
      }

      // Carregar Client VPN Endpoints
      const cvpnData = this.store.read('client-vpn-endpoints');
      if (Array.isArray(cvpnData)) {
        logger.info(`📂 Carregando ${cvpnData.length} Client VPN Endpoints do storage...`);
        for (const item of cvpnData) {
          const endpoint = ClientVpnEndpoint.fromJSON(item);
          this.clientVpnEndpoints.set(endpoint.ClientVpnEndpointId, endpoint);
        }
      }
    } catch (error) {
      logger.warn(`⚠️  Erro ao carregar dados persistidos: ${error.message}`);
    }
  }

  /**
   * Verifica se não há nenhum recurso de rede carregado
   */
  isEmpty() {
    return (
      this.vpcs.size === 0 &&
      this.subnets.size === 0 &&
      this.routeTables.size === 0 &&
      this.internetGateways.size === 0 &&
      this.networkAcls.size === 0 &&
      this.vpcEndpoints.size === 0 &&
      this.vpcEndpointServices.size === 0 &&
      this.vpcPeeringConnections.size === 0 &&
      this.elasticIps.size === 0 &&
      this.egressOnlyInternetGateways.size === 0 &&
      this.dhcpOptions.size === 0 &&
      this.managedPrefixLists.size === 0 &&
      this.natGateways.size === 0 &&
      this.customerGateways.size === 0 &&
      this.vpnGateways.size === 0 &&
      this.vpnConnections.size === 0 &&
      this.clientVpnEndpoints.size === 0
    );
  }

  /**
   * Migração one-time de dataDir/vpc (layout antigo) para dataDir/ec2/vpc (fusão com EC2)
   */
  migrateFromLegacy() {
    try {
      const hasLegacy = ['vpcs', 'subnets', 'internet-gateways', 'route-tables'].some(
        (entity) => {
          const data = this.legacyStore.read(entity);
          return Array.isArray(data) && data.length > 0;
        }
      );

      if (!hasLegacy) {
        return;
      }

      logger.info('📦 Migrando dados de VPC de dataDir/vpc para dataDir/ec2/vpc...');
      const currentStore = this.store;
      this.store = this.legacyStore;
      this.loadFromPersistence();
      this.store = currentStore;
      this.persistData();
      logger.info('✅ Migração de dados de VPC concluída');
    } catch (error) {
      logger.warn(`⚠️  Falha ao migrar dados de VPC: ${error.message}`);
    }
  }

  /**
   * Persiste estado atual em storage
   */
  persistData() {
    try {
      this.store.write('vpcs', Array.from(this.vpcs.values()).map(v => v.toJSON()));
      this.store.write('subnets', Array.from(this.subnets.values()).map(s => s.toJSON()));
      this.store.write('internet-gateways', Array.from(this.internetGateways.values()).map(igw => igw.toJSON()));
      this.store.write('route-tables', Array.from(this.routeTables.values()).map(rt => rt.toJSON()));
      this.store.write('network-acls', Array.from(this.networkAcls.values()).map(acl => acl.toJSON()));
      this.store.write('vpc-endpoints', Array.from(this.vpcEndpoints.values()).map(e => e.toJSON()));
      this.store.write(
        'vpc-endpoint-services',
        Array.from(this.vpcEndpointServices.values()).map(s => s.toJSON())
      );
      this.store.write(
        'vpc-peering-connections',
        Array.from(this.vpcPeeringConnections.values()).map(pc => pc.toJSON())
      );
      this.store.write('elastic-ips', Array.from(this.elasticIps.values()).map(eip => eip.toJSON()));
      this.store.write(
        'egress-only-internet-gateways',
        Array.from(this.egressOnlyInternetGateways.values()).map(eigw => eigw.toJSON())
      );
      this.store.write('dhcp-options', Array.from(this.dhcpOptions.values()).map(o => o.toJSON()));
      this.store.write(
        'managed-prefix-lists',
        Array.from(this.managedPrefixLists.values()).map(l => l.toJSON())
      );
      this.store.write('nat-gateways', Array.from(this.natGateways.values()).map(ng => ng.toJSON()));
      this.store.write(
        'customer-gateways',
        Array.from(this.customerGateways.values()).map(c => c.toJSON())
      );
      this.store.write('vpn-gateways', Array.from(this.vpnGateways.values()).map(v => v.toJSON()));
      this.store.write(
        'vpn-connections',
        Array.from(this.vpnConnections.values()).map(v => v.toJSON())
      );
      this.store.write(
        'client-vpn-endpoints',
        Array.from(this.clientVpnEndpoints.values()).map(v => v.toJSON())
      );
    } catch (error) {
      logger.error(`Erro ao persistir dados VPC: ${error.message}`);
    }
  }

  // ========== VPC Operations ==========

  createVPC(cidrBlock, tags = [], config = {}) {
    const vpc = new VPC(cidrBlock, tags, config);

    // Associar ao conjunto padrão de DHCP options (comportamento da AWS)
    const defaultOptions = Array.from(this.dhcpOptions.values()).find(o => o.IsDefault);
    if (!vpc.DhcpOptionsId && defaultOptions) {
      vpc.DhcpOptionsId = defaultOptions.DhcpOptionsId;
    }

    this.vpcs.set(vpc.VpcId, vpc);

    // Criar tabela de rotas padrão para VPC
    const mainRouteTable = this.createRouteTable(vpc.VpcId, [], true);

    // Criar Network ACL padrão da VPC (a AWS cria uma ACL default por VPC)
    this.createNetworkAcl(vpc.VpcId, [], true);

    // ✅ Persistir mudanças
    this.persistData();
    
    return vpc;
  }

  describeVPCs(filters = {}) {
    let vpcs = Array.from(this.vpcs.values());

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      vpcs = vpcs.filter(v => filters.vpcIds.includes(v.VpcId));
    }

    if (filters.cidrBlock) {
      vpcs = vpcs.filter(v => v.CidrBlock === filters.cidrBlock);
    }

    return vpcs;
  }

  getVPC(vpcId) {
    const vpc = this.vpcs.get(vpcId);
    if (!vpc) {
      throw new Error(`VPC ${vpcId} not found`);
    }
    return vpc;
  }

  deleteVPC(vpcId) {
    // Verificar dependências
    const subnets = Array.from(this.subnets.values()).filter(s => s.VpcId === vpcId);
    if (subnets.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: VPC has subnets`);
    }

    const igws = Array.from(this.internetGateways.values()).filter(igw =>
      igw.isAttachedTo(vpcId)
    );
    if (igws.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: IGW still attached`);
    }

    const eigws = Array.from(this.egressOnlyInternetGateways.values()).filter(eigw =>
      eigw.Attachments.some(a => a.VpcId === vpcId)
    );
    if (eigws.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: egress-only IGW still attached`);
    }

    const vpcSubnetIds = new Set(
      Array.from(this.subnets.values()).filter(s => s.VpcId === vpcId).map(s => s.SubnetId)
    );
    const nats = Array.from(this.natGateways.values()).filter(ng => vpcSubnetIds.has(ng.SubnetId));
    if (nats.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: NAT gateway still present`);
    }

    const endpoints = Array.from(this.vpcEndpoints.values()).filter(e => e.VpcId === vpcId);
    if (endpoints.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: VPC endpoint still present`);
    }

    const peerings = Array.from(this.vpcPeeringConnections.values()).filter(
      pc =>
        pc.RequesterVpcInfo.VpcId === vpcId || pc.AccepterVpcInfo.VpcId === vpcId
    );
    if (peerings.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: VPC peering connection still present`);
    }

    const vgwAttached = Array.from(this.vpnGateways.values()).filter(vgw =>
      vgw.VpcAttachments.some(a => a.VpcId === vpcId)
    );
    if (vgwAttached.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: virtual private gateway still attached`);
    }

    const clientVpns = Array.from(this.clientVpnEndpoints.values()).filter(
      e => e.VpcId === vpcId
    );
    if (clientVpns.length > 0) {
      throw new Error(`Cannot delete VPC ${vpcId}: Client VPN endpoint still present`);
    }

    // Deletar tabelas de rotas associadas
    const rtbs = Array.from(this.routeTables.values()).filter(rt => rt.VpcId === vpcId);
    for (const rtb of rtbs) {
      this.routeTables.delete(rtb.RouteTableId);
    }

    // Deletar Network ACLs da VPC
    const acls = Array.from(this.networkAcls.values()).filter(acl => acl.VpcId === vpcId);
    for (const acl of acls) {
      this.networkAcls.delete(acl.NetworkAclId);
    }

    this.vpcs.delete(vpcId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return true;
  }

  modifyVPCAttribute(vpcId, attribute, value) {
    const vpc = this.getVPC(vpcId);

    switch (attribute) {
      case 'enableDnsHostnames':
        vpc.EnableDnsHostnames = value;
        break;
      case 'enableDnsSupport':
        vpc.EnableDnsSupport = value;
        break;
      default:
        throw new Error(`Unknown VPC attribute: ${attribute}`);
    }

    // ✅ Persistir mudanças
    this.persistData();

    return vpc;
  }

  // ========== Subnet Operations ==========

  createSubnet(vpcId, cidrBlock, availabilityZone, tags = [], config = {}) {
    // Verificar se VPC existe
    this.getVPC(vpcId);

    // Verificar sobreposição de CIDR
    const existingSubnets = Array.from(this.subnets.values()).filter(
      s => s.VpcId === vpcId
    );
    if (this.hasCIDROverlap(cidrBlock, existingSubnets.map(s => s.CidrBlock))) {
      throw new Error(`CIDR block ${cidrBlock} overlaps with existing subnets`);
    }

    const subnet = new Subnet(vpcId, cidrBlock, availabilityZone, tags, config);
    this.subnets.set(subnet.SubnetId, subnet);

    // Associar a subnet à Network ACL padrão da VPC (comportamento da AWS)
    const defaultAcl = this.getDefaultNetworkAcl(vpcId);
    if (defaultAcl) {
      defaultAcl.addAssociation(subnet.SubnetId);
    }

    // ✅ Persistir mudanças
    this.persistData();
    
    return subnet;
  }

  describeSubnets(filters = {}) {
    let subnets = Array.from(this.subnets.values());

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      subnets = subnets.filter(s => filters.vpcIds.includes(s.VpcId));
    }

    if (filters.subnetIds && Array.isArray(filters.subnetIds)) {
      subnets = subnets.filter(s => filters.subnetIds.includes(s.SubnetId));
    }

    if (filters.cidrBlock) {
      subnets = subnets.filter(s => s.CidrBlock === filters.cidrBlock);
    }

    return subnets;
  }

  getSubnet(subnetId) {
    const subnet = this.subnets.get(subnetId);
    if (!subnet) {
      throw new Error(`Subnet ${subnetId} not found`);
    }
    return subnet;
  }

  deleteSubnet(subnetId) {
    // Verificar dependências
    const routeTableAssocs = Array.from(this.routeTables.values())
      .flatMap(rt => rt.Associations)
      .filter(a => a.SubnetId === subnetId);

    if (routeTableAssocs.length > 0) {
      throw new Error(`Subnet ${subnetId} has associated route tables`);
    }

    // Remover associações de Network ACL que apontem para esta subnet
    for (const acl of this.networkAcls.values()) {
      acl.removeAssociation(subnetId);
    }

    this.subnets.delete(subnetId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return true;
  }

  // ========== Route Table Operations ==========

  createRouteTable(vpcId, tags = [], isMain = false) {
    // Verificar se VPC existe
    this.getVPC(vpcId);

    const routeTable = new RouteTable(vpcId, tags, isMain);
    this.routeTables.set(routeTable.RouteTableId, routeTable);
    
    // ✅ Persistir mudanças (apenas se não for main table)
    if (!isMain) {
      this.persistData();
    }
    
    return routeTable;
  }

  describeRouteTables(filters = {}) {
    let routeTables = Array.from(this.routeTables.values());

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      routeTables = routeTables.filter(rt => filters.vpcIds.includes(rt.VpcId));
    }

    if (filters.routeTableIds && Array.isArray(filters.routeTableIds)) {
      routeTables = routeTables.filter(rt => filters.routeTableIds.includes(rt.RouteTableId));
    }

    return routeTables;
  }

  getRouteTable(routeTableId) {
    const rt = this.routeTables.get(routeTableId);
    if (!rt) {
      throw new Error(`Route Table ${routeTableId} not found`);
    }
    return rt;
  }

  deleteRouteTable(routeTableId) {
    const rt = this.getRouteTable(routeTableId);

    if (rt.IsMain) {
      throw new Error(`Cannot delete main route table ${routeTableId}`);
    }

    if (rt.Associations.length > 0) {
      throw new Error(`Cannot delete route table with associations`);
    }

    this.routeTables.delete(routeTableId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return true;
  }

  addRoute(routeTableId, destinationCidrBlock, target, targetType = 'igw') {
    const rt = this.getRouteTable(routeTableId);
    const route = rt.addRoute(destinationCidrBlock, target, targetType);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return route;
  }

  removeRoute(routeTableId, destinationCidrBlock) {
    const rt = this.getRouteTable(routeTableId);
    const route = rt.removeRoute(destinationCidrBlock);
    return route;
  }

  associateRouteTable(routeTableId, subnetId) {
    const rt = this.getRouteTable(routeTableId);
    this.getSubnet(subnetId);

    const association = rt.addAssociation(subnetId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return association;
  }

  disassociateRouteTable(routeTableId, subnetId) {
    const rt = this.getRouteTable(routeTableId);
    const association = rt.removeAssociation(subnetId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return association;
  }

  // ========== Internet Gateway Operations ==========

  createInternetGateway(tags = []) {
    const igw = new InternetGateway(tags);
    this.internetGateways.set(igw.InternetGatewayId, igw);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return igw;
  }

  describeInternetGateways(filters = {}) {
    let igws = Array.from(this.internetGateways.values());

    if (filters.internetGatewayIds && Array.isArray(filters.internetGatewayIds)) {
      igws = igws.filter(igw => filters.internetGatewayIds.includes(igw.InternetGatewayId));
    }

    return igws;
  }

  getInternetGateway(internetGatewayId) {
    const igw = this.internetGateways.get(internetGatewayId);
    if (!igw) {
      throw new Error(`Internet Gateway ${internetGatewayId} not found`);
    }
    return igw;
  }

  attachInternetGateway(internetGatewayId, vpcId) {
    const igw = this.getInternetGateway(internetGatewayId);
    this.getVPC(vpcId);

    const attachment = igw.attach(vpcId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return attachment;
  }

  detachInternetGateway(internetGatewayId, vpcId) {
    const igw = this.getInternetGateway(internetGatewayId);
    const attachment = igw.detach(vpcId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return attachment;
  }

  deleteInternetGateway(internetGatewayId) {
    const igw = this.getInternetGateway(internetGatewayId);

    if (igw.Attachments.length > 0) {
      throw new Error(`Cannot delete Internet Gateway with attachments`);
    }

    this.internetGateways.delete(internetGatewayId);
    
    // ✅ Persistir mudanças
    this.persistData();
    
    return true;
  }

  // ========== Network ACL Operations ==========

  createNetworkAcl(vpcId, tags = [], isDefault = false) {
    this.getVPC(vpcId);

    const acl = new NetworkAcl(vpcId, tags, isDefault);
    this.networkAcls.set(acl.NetworkAclId, acl);

    // A ACL default é criada junto com a VPC (que persiste depois)
    if (!isDefault) {
      this.persistData();
    }

    return acl;
  }

  describeNetworkAcls(filters = {}) {
    let acls = Array.from(this.networkAcls.values());

    if (filters.networkAclIds && Array.isArray(filters.networkAclIds)) {
      acls = acls.filter(acl => filters.networkAclIds.includes(acl.NetworkAclId));
    }

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      acls = acls.filter(acl => filters.vpcIds.includes(acl.VpcId));
    }

    if (filters.associationSubnetIds && Array.isArray(filters.associationSubnetIds)) {
      acls = acls.filter(acl =>
        acl.Associations.some(assoc => filters.associationSubnetIds.includes(assoc.SubnetId))
      );
    }

    return acls;
  }

  getNetworkAcl(networkAclId) {
    const acl = this.networkAcls.get(networkAclId);
    if (!acl) {
      throw new Error(`Network ACL ${networkAclId} not found`);
    }
    return acl;
  }

  getDefaultNetworkAcl(vpcId) {
    return Array.from(this.networkAcls.values()).find(
      acl => acl.VpcId === vpcId && acl.IsDefault
    );
  }

  deleteNetworkAcl(networkAclId) {
    const acl = this.getNetworkAcl(networkAclId);

    if (acl.IsDefault) {
      throw new Error(`Cannot delete the default network ACL ${networkAclId}`);
    }

    if (acl.Associations.length > 0) {
      throw new Error(`Cannot delete network ACL ${networkAclId}: associated with a subnet`);
    }

    this.networkAcls.delete(networkAclId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  createNetworkAclEntry(networkAclId, entryData) {
    const acl = this.getNetworkAcl(networkAclId);
    const entry = acl.addEntry(entryData);

    // ✅ Persistir mudanças
    this.persistData();

    return entry;
  }

  deleteNetworkAclEntry(networkAclId, ruleNumber, egress) {
    const acl = this.getNetworkAcl(networkAclId);
    acl.removeEntry(ruleNumber, egress);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  associateNetworkAcl(networkAclId, subnetId) {
    const acl = this.getNetworkAcl(networkAclId);
    this.getSubnet(subnetId);

    // Uma subnet só pode estar associada a uma ACL: remove das demais
    for (const other of this.networkAcls.values()) {
      if (other.NetworkAclId !== networkAclId) {
        other.removeAssociation(subnetId);
      }
    }

    const association = acl.addAssociation(subnetId);

    // ✅ Persistir mudanças
    this.persistData();

    return association;
  }

  replaceNetworkAclAssociation(associationId, networkAclId) {
    const newAcl = this.getNetworkAcl(networkAclId);

    let subnetId = null;
    for (const acl of this.networkAcls.values()) {
      const assoc = acl.Associations.find(
        a => a.NetworkAclAssociationId === associationId
      );
      if (assoc) {
        subnetId = assoc.SubnetId;
        acl.removeAssociation(assoc.SubnetId);
        break;
      }
    }

    if (!subnetId) {
      throw new Error(`Network ACL association ${associationId} not found`);
    }

    const association = newAcl.addAssociation(subnetId);

    // ✅ Persistir mudanças
    this.persistData();

    return association;
  }

  // ========== VPC Endpoint Operations ==========

  createVPCEndpoint(vpcId, serviceName, config = {}) {
    this.getVPC(vpcId);

    const endpoint = new VPCEndpoint(vpcId, serviceName, config);
    this.vpcEndpoints.set(endpoint.VpcEndpointId, endpoint);

    // ✅ Persistir mudanças
    this.persistData();

    return endpoint;
  }

  describeVPCEndpoints(filters = {}) {
    let endpoints = Array.from(this.vpcEndpoints.values());

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      endpoints = endpoints.filter(e => filters.vpcIds.includes(e.VpcId));
    }

    if (filters.vpcEndpointIds && Array.isArray(filters.vpcEndpointIds)) {
      endpoints = endpoints.filter(e => filters.vpcEndpointIds.includes(e.VpcEndpointId));
    }

    if (filters.serviceName) {
      endpoints = endpoints.filter(e => e.ServiceName === filters.serviceName);
    }

    return endpoints;
  }

  getVPCEndpoint(vpcEndpointId) {
    const endpoint = this.vpcEndpoints.get(vpcEndpointId);
    if (!endpoint) {
      throw new Error(`VPC Endpoint ${vpcEndpointId} not found`);
    }
    return endpoint;
  }

  deleteVPCEndpoint(vpcEndpointId) {
    this.vpcEndpoints.delete(vpcEndpointId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  modifyVPCEndpoint(vpcEndpointId, changes) {
    const endpoint = this.getVPCEndpoint(vpcEndpointId);

    if (changes.RouteTableIds) {
      endpoint.RouteTableIds = changes.RouteTableIds;
    }

    if (changes.SubnetIds) {
      endpoint.SubnetIds = changes.SubnetIds;
    }

    if (changes.PolicyDocument) {
      endpoint.PolicyDocument = changes.PolicyDocument;
    }

    // ✅ Persistir mudanças
    this.persistData();

    return endpoint;
  }

  // ========== VPC Peering Connection Operations ==========

  createVPCPeeringConnection(requesterVpcId, accepterVpcId, options = {}) {
    const requester = this.getVPC(requesterVpcId);
    const accepter = this.getVPC(accepterVpcId);

    if (requesterVpcId === accepterVpcId) {
      throw new Error('Cannot create a peering connection to the same VPC');
    }

    const connection = new VPCPeeringConnection(requester, accepter, options);
    this.vpcPeeringConnections.set(connection.VpcPeeringConnectionId, connection);
    this.persistData();
    return connection;
  }

  describeVPCPeeringConnections(filters = {}) {
    let connections = Array.from(this.vpcPeeringConnections.values());

    if (filters.vpcPeeringConnectionIds && Array.isArray(filters.vpcPeeringConnectionIds)) {
      connections = connections.filter(c =>
        filters.vpcPeeringConnectionIds.includes(c.VpcPeeringConnectionId)
      );
    }

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      connections = connections.filter(
        c =>
          filters.vpcIds.includes(c.RequesterVpcInfo.VpcId) ||
          filters.vpcIds.includes(c.AccepterVpcInfo.VpcId)
      );
    }

    if (filters.status) {
      connections = connections.filter(c => filters.status.includes(c.Status.Code));
    }

    return connections;
  }

  getVPCPeeringConnection(vpcPeeringConnectionId) {
    const connection = this.vpcPeeringConnections.get(vpcPeeringConnectionId);
    if (!connection) {
      throw new Error(`VPC Peering Connection ${vpcPeeringConnectionId} not found`);
    }
    return connection;
  }

  acceptVPCPeeringConnection(vpcPeeringConnectionId) {
    const connection = this.getVPCPeeringConnection(vpcPeeringConnectionId);
    connection.accept();
    this.persistData();
    return connection;
  }

  rejectVPCPeeringConnection(vpcPeeringConnectionId) {
    const connection = this.getVPCPeeringConnection(vpcPeeringConnectionId);
    connection.reject();
    this.persistData();
    return connection;
  }

  deleteVPCPeeringConnection(vpcPeeringConnectionId) {
    const connection = this.getVPCPeeringConnection(vpcPeeringConnectionId);
    // AWS permite excluir em qualquer estado (exceto deleted).
    this.vpcPeeringConnections.delete(vpcPeeringConnectionId);
    this.persistData();
    return connection;
  }

  // ========== VPC Endpoint Service Operations ==========

  createVPCEndpointServiceConfiguration(networkLoadBalancerArns, config = {}) {
    const service = new VPCEndpointService(networkLoadBalancerArns, config);
    service.BaseEndpointDnsNames = [
      `${service.ServiceId}.${service.AvailabilityZones[0]?.ZoneName || 'us-east-1a'}.vpce.amazonaws.com`
    ];
    this.vpcEndpointServices.set(service.ServiceId, service);
    this.persistData();
    return service;
  }

  describeVPCEndpointServiceConfigurations(filters = {}) {
    let services = Array.from(this.vpcEndpointServices.values());

    if (filters.serviceIds && Array.isArray(filters.serviceIds)) {
      services = services.filter(s => filters.serviceIds.includes(s.ServiceId));
    }

    return services;
  }

  getVPCEndpointService(serviceId) {
    const service = this.vpcEndpointServices.get(serviceId);
    if (!service) {
      throw new Error(`VPC Endpoint Service ${serviceId} not found`);
    }
    return service;
  }

  modifyVPCEndpointServiceConfiguration(serviceId, changes = {}) {
    const service = this.getVPCEndpointService(serviceId);
    if (changes.AcceptanceRequired !== undefined) {
      service.AcceptanceRequired = !!changes.AcceptanceRequired;
    }
    this.persistData();
    return service;
  }

  deleteVPCEndpointServiceConfigurations(serviceIds) {
    const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
    for (const id of ids) {
      this.vpcEndpointServices.delete(id);
    }
    this.persistData();
    return true;
  }

  /**
   * Lista os serviços de endpoint disponíveis: os gerenciados pela AWS
   * (uma amostra) e os criados pelo usuário.
   */
  describeVPCEndpointServices(filters = {}) {
    const awsManaged = [
      { ServiceName: 'com.amazonaws.us-east-1.s3', ServiceType: [{ ServiceType: 'Gateway' }] },
      { ServiceName: 'com.amazonaws.us-east-1.dynamodb', ServiceType: [{ ServiceType: 'Gateway' }] },
      { ServiceName: 'com.amazonaws.us-east-1.ec2', ServiceType: [{ ServiceType: 'Interface' }] },
      { ServiceName: 'com.amazonaws.us-east-1.ssm', ServiceType: [{ ServiceType: 'Interface' }] },
      { ServiceName: 'com.amazonaws.us-east-1.lambda', ServiceType: [{ ServiceType: 'Interface' }] },
      { ServiceName: 'com.amazonaws.us-east-1.sqs', ServiceType: [{ ServiceType: 'Interface' }] },
      { ServiceName: 'com.amazonaws.us-east-1.sns', ServiceType: [{ ServiceType: 'Interface' }] }
    ].map(service => ({
      ServiceName: service.ServiceName,
      ServiceType: service.ServiceType,
      ServiceId: `vpce-svc-${service.ServiceName.split('.').pop()}`,
      Owner: 'amazon',
      AvailabilityZones: [],
      BaseEndpointDnsNames: [],
      PrivateDnsName: '',
      VpcEndpointPolicySupported: false,
      AcceptanceRequired: false
    }));

    const userManaged = Array.from(this.vpcEndpointServices.values()).map(s => ({
      ServiceName: s.ServiceName,
      ServiceType: s.ServiceType,
      ServiceId: s.ServiceId,
      Owner: s.OwnerId,
      AvailabilityZones: s.AvailabilityZones,
      BaseEndpointDnsNames: s.BaseEndpointDnsNames,
      PrivateDnsName: s.PrivateDnsName || '',
      VpcEndpointPolicySupported: false,
      AcceptanceRequired: s.AcceptanceRequired
    }));

    let services = [...awsManaged, ...userManaged];

    if (filters.serviceNames && Array.isArray(filters.serviceNames)) {
      services = services.filter(s => filters.serviceNames.includes(s.ServiceName));
    }

    return services;
  }

  // ========== VPN: Customer Gateways ==========

  createCustomerGateway(type, bgpAsn, config = {}) {
    const cgw = new CustomerGateway(type, bgpAsn, config);
    this.customerGateways.set(cgw.CustomerGatewayId, cgw);
    this.persistData();
    return cgw;
  }

  describeCustomerGateways(filters = {}) {
    let gateways = Array.from(this.customerGateways.values());
    if (filters.customerGatewayIds && Array.isArray(filters.customerGatewayIds)) {
      gateways = gateways.filter(g => filters.customerGatewayIds.includes(g.CustomerGatewayId));
    }
    return gateways;
  }

  getCustomerGateway(customerGatewayId) {
    const cgw = this.customerGateways.get(customerGatewayId);
    if (!cgw) {
      throw new Error(`Customer Gateway ${customerGatewayId} not found`);
    }
    return cgw;
  }

  deleteCustomerGateway(customerGatewayId) {
    const cgw = this.getCustomerGateway(customerGatewayId);
    const inUse = Array.from(this.vpnConnections.values()).some(
      v => v.CustomerGatewayId === customerGatewayId
    );
    if (inUse) {
      throw new Error(`Cannot delete Customer Gateway ${customerGatewayId}: still in use`);
    }
    this.customerGateways.delete(customerGatewayId);
    this.persistData();
    return cgw;
  }

  // ========== VPN: Virtual Private Gateways ==========

  createVpnGateway(type, config = {}) {
    const vgw = new VpnGateway(type, config);
    this.vpnGateways.set(vgw.VpnGatewayId, vgw);
    this.persistData();
    return vgw;
  }

  describeVpnGateways(filters = {}) {
    let gateways = Array.from(this.vpnGateways.values());
    if (filters.vpnGatewayIds && Array.isArray(filters.vpnGatewayIds)) {
      gateways = gateways.filter(g => filters.vpnGatewayIds.includes(g.VpnGatewayId));
    }
    return gateways;
  }

  getVpnGateway(vpnGatewayId) {
    const vgw = this.vpnGateways.get(vpnGatewayId);
    if (!vgw) {
      throw new Error(`VPN Gateway ${vpnGatewayId} not found`);
    }
    return vgw;
  }

  attachVpnGateway(vpnGatewayId, vpcId) {
    const vgw = this.getVpnGateway(vpnGatewayId);
    this.getVPC(vpcId);
    vgw.attachToVpc(vpcId);
    this.persistData();
    return vgw;
  }

  detachVpnGateway(vpnGatewayId, vpcId) {
    const vgw = this.getVpnGateway(vpnGatewayId);
    vgw.detachFromVpc(vpcId);
    this.persistData();
    return vgw;
  }

  deleteVpnGateway(vpnGatewayId) {
    const vgw = this.getVpnGateway(vpnGatewayId);
    if (vgw.VpcAttachments.length > 0) {
      throw new Error(`Cannot delete VPN Gateway ${vpnGatewayId}: still attached to a VPC`);
    }
    const inUse = Array.from(this.vpnConnections.values()).some(
      v => v.VpnGatewayId === vpnGatewayId
    );
    if (inUse) {
      throw new Error(`Cannot delete VPN Gateway ${vpnGatewayId}: still in use`);
    }
    this.vpnGateways.delete(vpnGatewayId);
    this.persistData();
    return vgw;
  }

  // ========== VPN: Site-to-site connections ==========

  createVpnConnection(type, customerGatewayId, vpnGatewayId, config = {}) {
    this.getCustomerGateway(customerGatewayId);
    this.getVpnGateway(vpnGatewayId);
    const connection = new VpnConnection(type, customerGatewayId, vpnGatewayId, config);
    this.vpnConnections.set(connection.VpnConnectionId, connection);
    this.persistData();
    return connection;
  }

  describeVpnConnections(filters = {}) {
    let connections = Array.from(this.vpnConnections.values());
    if (filters.vpnConnectionIds && Array.isArray(filters.vpnConnectionIds)) {
      connections = connections.filter(c => filters.vpnConnectionIds.includes(c.VpnConnectionId));
    }
    return connections;
  }

  getVpnConnection(vpnConnectionId) {
    const connection = this.vpnConnections.get(vpnConnectionId);
    if (!connection) {
      throw new Error(`VPN Connection ${vpnConnectionId} not found`);
    }
    return connection;
  }

  deleteVpnConnection(vpnConnectionId) {
    const connection = this.getVpnConnection(vpnConnectionId);
    this.vpnConnections.delete(vpnConnectionId);
    this.persistData();
    return connection;
  }

  // ========== VPN: Client VPN endpoints ==========

  createClientVpnEndpoint(config = {}) {
    if (config.VpcId) {
      this.getVPC(config.VpcId);
    }
    const endpoint = new ClientVpnEndpoint(config);
    // Associar subnets informadas como redes-alvo
    for (const subnetId of config.SubnetIds || []) {
      endpoint.associateTargetNetwork(subnetId);
    }
    this.clientVpnEndpoints.set(endpoint.ClientVpnEndpointId, endpoint);
    this.persistData();
    return endpoint;
  }

  describeClientVpnEndpoints(filters = {}) {
    let endpoints = Array.from(this.clientVpnEndpoints.values());
    if (filters.clientVpnEndpointIds && Array.isArray(filters.clientVpnEndpointIds)) {
      endpoints = endpoints.filter(e => filters.clientVpnEndpointIds.includes(e.ClientVpnEndpointId));
    }
    return endpoints;
  }

  getClientVpnEndpoint(clientVpnEndpointId) {
    const endpoint = this.clientVpnEndpoints.get(clientVpnEndpointId);
    if (!endpoint) {
      throw new Error(`Client VPN Endpoint ${clientVpnEndpointId} not found`);
    }
    return endpoint;
  }

  associateClientVpnTargetNetwork(clientVpnEndpointId, subnetId) {
    const endpoint = this.getClientVpnEndpoint(clientVpnEndpointId);
    this.getSubnet(subnetId);
    endpoint.associateTargetNetwork(subnetId);
    this.persistData();
    return endpoint;
  }

  deleteClientVpnEndpoint(clientVpnEndpointId) {
    const endpoint = this.getClientVpnEndpoint(clientVpnEndpointId);
    this.clientVpnEndpoints.delete(clientVpnEndpointId);
    this.persistData();
    return endpoint;
  }

  // ========== VPC Gateway Operations (NAT, VPN, etc) ==========

  createNATGateway(subnetId, allocationId, config = {}) {
    this.getSubnet(subnetId);

    if (allocationId && !this.elasticIps.has(allocationId)) {
      throw new Error(`Elastic IP ${allocationId} not found`);
    }

    const natGw = new NATGateway(subnetId, allocationId, config);
    if (allocationId) {
      natGw.PublicIp = (this.elasticIps.get(allocationId) || {}).PublicIp || natGw.PublicIp;
    }
    this.natGateways.set(natGw.NatGatewayId, natGw);

    // ✅ Persistir mudanças
    this.persistData();

    return natGw;
  }

  describeNATGateways(filters = {}) {
    let gateways = Array.from(this.natGateways.values());

    if (filters.natGatewayIds && Array.isArray(filters.natGatewayIds)) {
      gateways = gateways.filter(ng => filters.natGatewayIds.includes(ng.NatGatewayId));
    }

    if (filters.subnetIds && Array.isArray(filters.subnetIds)) {
      gateways = gateways.filter(ng => filters.subnetIds.includes(ng.SubnetId));
    }

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      const subnetIds = new Set(
        Array.from(this.subnets.values())
          .filter(s => filters.vpcIds.includes(s.VpcId))
          .map(s => s.SubnetId)
      );
      gateways = gateways.filter(ng => subnetIds.has(ng.SubnetId));
    }

    return gateways;
  }

  getNATGateway(natGatewayId) {
    const natGw = this.natGateways.get(natGatewayId);
    if (!natGw) {
      throw new Error(`NAT Gateway ${natGatewayId} not found`);
    }
    return natGw;
  }

  deleteNATGateway(natGatewayId) {
    this.getNATGateway(natGatewayId);
    this.natGateways.delete(natGatewayId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  // ========== Elastic IP Operations ==========

  allocateAddress(config = {}) {
    const eip = new ElasticIp(config);
    this.elasticIps.set(eip.AllocationId, eip);

    // ✅ Persistir mudanças
    this.persistData();

    return eip;
  }

  describeAddresses(filters = {}) {
    let addresses = Array.from(this.elasticIps.values());

    if (filters.allocationIds && Array.isArray(filters.allocationIds)) {
      addresses = addresses.filter(eip => filters.allocationIds.includes(eip.AllocationId));
    }

    if (filters.publicIps && Array.isArray(filters.publicIps)) {
      addresses = addresses.filter(eip => filters.publicIps.includes(eip.PublicIp));
    }

    return addresses;
  }

  getAddress(allocationId) {
    const eip = this.elasticIps.get(allocationId);
    if (!eip) {
      throw new Error(`Elastic IP ${allocationId} not found`);
    }
    return eip;
  }

  releaseAddress(allocationId) {
    const eip = this.getAddress(allocationId);
    if (eip.isAssociated()) {
      throw new Error(`Cannot release Elastic IP ${allocationId}: it is associated`);
    }

    this.elasticIps.delete(allocationId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  associateAddress({ allocationId, instanceId, networkInterfaceId, privateIpAddress }) {
    if (!allocationId) {
      throw new Error('AllocationId is required');
    }
    const eip = this.getAddress(allocationId);
    eip.associate({ instanceId, networkInterfaceId, privateIpAddress });

    // ✅ Persistir mudanças
    this.persistData();

    return eip;
  }

  disassociateAddress({ associationId, allocationId }) {
    let eip = null;

    if (allocationId) {
      eip = this.getAddress(allocationId);
    } else if (associationId) {
      eip = Array.from(this.elasticIps.values()).find(a => a.AssociationId === associationId);
    }

    if (!eip) {
      throw new Error('Elastic IP association not found');
    }

    eip.disassociate();

    // ✅ Persistir mudanças
    this.persistData();

    return eip;
  }

  // ========== Egress-only Internet Gateway Operations ==========

  createEgressOnlyInternetGateway(vpcId, tags = []) {
    this.getVPC(vpcId);

    const eigw = new EgressOnlyInternetGateway(vpcId, tags);
    this.egressOnlyInternetGateways.set(eigw.EgressOnlyInternetGatewayId, eigw);

    // ✅ Persistir mudanças
    this.persistData();

    return eigw;
  }

  describeEgressOnlyInternetGateways(filters = {}) {
    let gateways = Array.from(this.egressOnlyInternetGateways.values());

    if (filters.egressOnlyInternetGatewayIds && Array.isArray(filters.egressOnlyInternetGatewayIds)) {
      gateways = gateways.filter(eigw =>
        filters.egressOnlyInternetGatewayIds.includes(eigw.EgressOnlyInternetGatewayId)
      );
    }

    return gateways;
  }

  getEgressOnlyInternetGateway(egressOnlyInternetGatewayId) {
    const eigw = this.egressOnlyInternetGateways.get(egressOnlyInternetGatewayId);
    if (!eigw) {
      throw new Error(`Egress-only Internet Gateway ${egressOnlyInternetGatewayId} not found`);
    }
    return eigw;
  }

  deleteEgressOnlyInternetGateway(egressOnlyInternetGatewayId) {
    this.getEgressOnlyInternetGateway(egressOnlyInternetGatewayId);
    this.egressOnlyInternetGateways.delete(egressOnlyInternetGatewayId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  // ========== DHCP Options Operations ==========

  createDhcpOptions(configurations, tags = []) {
    const options = new DhcpOptions(configurations, tags, false);
    this.dhcpOptions.set(options.DhcpOptionsId, options);

    // ✅ Persistir mudanças
    this.persistData();

    return options;
  }

  describeDhcpOptions(filters = {}) {
    let options = Array.from(this.dhcpOptions.values());

    if (filters.dhcpOptionsIds && Array.isArray(filters.dhcpOptionsIds)) {
      options = options.filter(o => filters.dhcpOptionsIds.includes(o.DhcpOptionsId));
    }

    if (filters.vpcIds && Array.isArray(filters.vpcIds)) {
      const ids = new Set(
        Array.from(this.vpcs.values())
          .filter(v => filters.vpcIds.includes(v.VpcId))
          .map(v => v.DhcpOptionsId)
          .filter(Boolean)
      );
      options = options.filter(o => ids.has(o.DhcpOptionsId));
    }

    return options;
  }

  getDhcpOptions(dhcpOptionsId) {
    const options = this.dhcpOptions.get(dhcpOptionsId);
    if (!options) {
      throw new Error(`DHCP options ${dhcpOptionsId} not found`);
    }
    return options;
  }

  getDefaultDhcpOptions() {
    return Array.from(this.dhcpOptions.values()).find(o => o.IsDefault) || null;
  }

  deleteDhcpOptions(dhcpOptionsId) {
    const options = this.getDhcpOptions(dhcpOptionsId);

    if (options.IsDefault) {
      throw new Error(`Cannot delete the default DHCP options ${dhcpOptionsId}`);
    }

    // Não permitir exclusão se estiver associado a alguma VPC
    const associated = Array.from(this.vpcs.values()).filter(v => v.DhcpOptionsId === dhcpOptionsId);
    if (associated.length > 0) {
      throw new Error(`DHCP options ${dhcpOptionsId} is associated with a VPC`);
    }

    this.dhcpOptions.delete(dhcpOptionsId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  associateDhcpOptions(vpcId, dhcpOptionsId) {
    const vpc = this.getVPC(vpcId);
    this.getDhcpOptions(dhcpOptionsId);

    vpc.DhcpOptionsId = dhcpOptionsId;

    // ✅ Persistir mudanças
    this.persistData();

    return vpc;
  }

  // ========== Managed Prefix List Operations ==========

  createManagedPrefixList({
    PrefixListName,
    AddressFamily,
    MaxEntries,
    Entries,
    Tags
  } = {}) {
    if (!PrefixListName) {
      throw new Error('PrefixListName is required');
    }

    const list = new ManagedPrefixList({
      PrefixListName,
      AddressFamily,
      MaxEntries,
      Entries: Entries || [],
      Tags: Tags || []
    });

    this.managedPrefixLists.set(list.PrefixListId, list);

    // ✅ Persistir mudanças
    this.persistData();

    return list;
  }

  describeManagedPrefixLists(filters = {}) {
    let lists = Array.from(this.managedPrefixLists.values());

    if (filters.prefixListIds && Array.isArray(filters.prefixListIds)) {
      lists = lists.filter(l => filters.prefixListIds.includes(l.PrefixListId));
    }

    if (filters.prefixListNames && Array.isArray(filters.prefixListNames)) {
      lists = lists.filter(l => filters.prefixListNames.includes(l.PrefixListName));
    }

    return lists;
  }

  getManagedPrefixList(prefixListId) {
    const list = this.managedPrefixLists.get(prefixListId);
    if (!list) {
      throw new Error(`Managed Prefix List ${prefixListId} not found`);
    }
    return list;
  }

  deleteManagedPrefixList(prefixListId) {
    const list = this.getManagedPrefixList(prefixListId);

    if (!list.isRemovable()) {
      throw new Error(`Cannot delete the AWS-managed prefix list ${prefixListId}`);
    }

    this.managedPrefixLists.delete(prefixListId);

    // ✅ Persistir mudanças
    this.persistData();

    return true;
  }

  modifyManagedPrefixList(prefixListId, { AddEntries, RemoveEntries } = {}) {
    const list = this.getManagedPrefixList(prefixListId);

    if (Array.isArray(RemoveEntries)) {
      list.Entries = list.Entries.filter(
        entry => !RemoveEntries.some(remove => remove.Cidr === entry.Cidr)
      );
    }

    if (Array.isArray(AddEntries)) {
      for (const add of AddEntries) {
        if (!list.Entries.some(entry => entry.Cidr === add.Cidr)) {
          list.Entries.push({ Cidr: add.Cidr, Description: add.Description });
        }
      }
    }

    list.Version += 1;
    list.State = 'modify-complete';

    // ✅ Persistir mudanças
    this.persistData();

    return list;
  }

  getManagedPrefixListEntries(prefixListId) {
    const list = this.getManagedPrefixList(prefixListId);
    return {
      prefixListId: list.PrefixListId,
      entries: list.Entries,
      nextToken: null
    };
  }

  // Utility methods

  hasCIDROverlap(newCidr, existingCidrs) {
    const parseNetworkCIDR = (cidr) => {
      const [ip, prefix] = cidr.split('/');
      const parts = ip.split('.').map(Number);
      const ipNum = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
      const prefixNum = parseInt(prefix) || 32;
      const mask = (0xffffffff << (32 - prefixNum)) >>> 0;
      return { ipNum, mask };
    };

    const { ipNum: newIp, mask: newMask } = parseNetworkCIDR(newCidr);

    for (const existingCidr of existingCidrs) {
      const { ipNum: existingIp, mask: existingMask } = parseNetworkCIDR(existingCidr);

      if ((newIp & newMask) === (existingIp & newMask)) {
        return true;
      }
    }

    return false;
  }

  getAllResources() {
    return {
      vpcs: Array.from(this.vpcs.values()),
      subnets: Array.from(this.subnets.values()),
      routeTables: Array.from(this.routeTables.values()),
      internetGateways: Array.from(this.internetGateways.values()),
      networkAcls: Array.from(this.networkAcls.values()),
      vpcEndpoints: Array.from(this.vpcEndpoints.values()),
      vpcEndpointServices: Array.from(this.vpcEndpointServices.values()),
      vpcPeeringConnections: Array.from(this.vpcPeeringConnections.values()),
      elasticIps: Array.from(this.elasticIps.values()),
      egressOnlyInternetGateways: Array.from(this.egressOnlyInternetGateways.values()),
      dhcpOptions: Array.from(this.dhcpOptions.values()),
      managedPrefixLists: Array.from(this.managedPrefixLists.values()),
      natGateways: Array.from(this.natGateways.values()),
      customerGateways: Array.from(this.customerGateways.values()),
      vpnGateways: Array.from(this.vpnGateways.values()),
      vpnConnections: Array.from(this.vpnConnections.values()),
      clientVpnEndpoints: Array.from(this.clientVpnEndpoints.values())
    };
  }
}

module.exports = VPCSimulator;
