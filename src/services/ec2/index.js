/**
 * EC2 Service - Ponto de entrada
 *
 * Desde a fusão, o EC2 também é dono dos recursos de VPC (VPC não é um serviço AWS separado).
 * O simulador de rede vive em ./vpc/simulator.js e as rotas em ./vpc/vpcRoutes.js.
 */

const EC2Server = require('./server');
const EC2Simulator = require('./simulator');
const VPCSimulator = require('./vpc/simulator');

class EC2Service {
  constructor(config) {
    this.config = config;
    this.name = 'ec2';
    this.port = config.ports.ec2 || 4020;
    this.server = null;
    this.simulator = null; // recursos de instância
    this.vpcSimulator = null; // recursos de rede (VPC/subnet/IGW/route table/endpoints)
    this.isRunning = false;
  }

  async initialize() {
    const logger = require('../../utils/logger');
    logger.debug(`Inicializando EC2 Service na porta ${this.port}...`);

    this.simulator = new EC2Simulator(this.config.ec2 || {});
    await this.simulator.initialize();

    this.vpcSimulator = new VPCSimulator(this.config.vpc || {});
    await this.vpcSimulator.initialize();

    this.server = new EC2Server(this.port, this.config);
    this.server.simulator = this.simulator;
    this.server.vpcSimulator = this.vpcSimulator;

    await this.server.initialize();

    logger.debug('EC2 Service inicializado');
  }

  injectDependencies(server) {
    // Aqui você pode injetar dependências de outros serviços se necessário
    // Por exemplo, integração com VPC (agora interna ao EC2)
  }

  async start() {
    const logger = require('../../utils/logger');

    if (this.isRunning) {
      logger.warn('EC2 Service já está em execução');
      return;
    }

    try {
      await this.server.start();
      this.isRunning = true;
      logger.info('EC2 Service iniciado com sucesso');
    } catch (error) {
      logger.error(`Erro ao iniciar EC2 Service: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    const logger = require('../../utils/logger');

    if (!this.isRunning) {
      logger.warn('EC2 Service não está em execução');
      return;
    }

    try {
      // Parar todos os servidores web das instâncias
      for (const [, server] of this.simulator.instanceServers) {
        await server.stop();
      }

      await this.server.stop();
      this.isRunning = false;
      logger.info('EC2 Service parado com sucesso');
    } catch (error) {
      logger.error(`Erro ao parar EC2 Service: ${error.message}`);
      throw error;
    }
  }

  getSimulator() {
    return this.simulator;
  }

  getVpcSimulator() {
    return this.vpcSimulator;
  }

  getStatus() {
    const instances = this.simulator.getAllResources();
    const network = this.vpcSimulator ? this.vpcSimulator.getAllResources() : {};

    return {
      name: this.name,
      running: this.isRunning,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      resources: {
        instancesCount: instances.instances.length,
        runningCount: instances.instances.filter(i => i.isRunning()).length,
        amisCount: instances.amis.length,
        securityGroupsCount: instances.securityGroups.length,
        networkInterfacesCount: instances.networkInterfaces.length,
        launchTemplatesCount: instances.launchTemplates.length,
        keyPairsCount: instances.keyPairs ? instances.keyPairs.length : 0,
        placementGroupsCount: instances.placementGroups ? instances.placementGroups.length : 0,
        dedicatedHostsCount: instances.dedicatedHosts ? instances.dedicatedHosts.length : 0,
        capacityReservationsCount: instances.capacityReservations
          ? instances.capacityReservations.length
          : 0,
        spotInstanceRequestsCount: instances.spotInstanceRequests
          ? instances.spotInstanceRequests.length
          : 0,
        reservedInstancesCount: instances.reservedInstances
          ? instances.reservedInstances.length
          : 0,
        vpcsCount: network.vpcs ? network.vpcs.length : 0,
        subnetsCount: network.subnets ? network.subnets.length : 0,
        routeTablesCount: network.routeTables ? network.routeTables.length : 0,
        internetGatewaysCount: network.internetGateways
          ? network.internetGateways.length
          : 0,
        vpcEndpointsCount: network.vpcEndpoints ? network.vpcEndpoints.length : 0,
        vpcEndpointServicesCount: network.vpcEndpointServices
          ? network.vpcEndpointServices.length
          : 0,
        vpcPeeringConnectionsCount: network.vpcPeeringConnections
          ? network.vpcPeeringConnections.length
          : 0,
        elasticIpsCount: network.elasticIps ? network.elasticIps.length : 0,
        egressOnlyInternetGatewaysCount: network.egressOnlyInternetGateways
          ? network.egressOnlyInternetGateways.length
          : 0,
        dhcpOptionsCount: network.dhcpOptions ? network.dhcpOptions.length : 0,
        managedPrefixListsCount: network.managedPrefixLists
          ? network.managedPrefixLists.length
          : 0,
        natGatewaysCount: network.natGateways ? network.natGateways.length : 0,
        customerGatewaysCount: network.customerGateways ? network.customerGateways.length : 0,
        vpnGatewaysCount: network.vpnGateways ? network.vpnGateways.length : 0,
        vpnConnectionsCount: network.vpnConnections ? network.vpnConnections.length : 0,
        clientVpnEndpointsCount: network.clientVpnEndpoints
          ? network.clientVpnEndpoints.length
          : 0
      }
    };
  }
}

module.exports = EC2Service;
