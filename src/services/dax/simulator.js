/**
 * DAX Simulator Core
 */
const LocalStore = require("../../utils/local-store");
const logger = require("../../utils/logger");
const path = require("path");

class DAXSimulator {
  constructor(config) {
    this.config = config;
    const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || config.dataDir || "./.aws-local-simulator-data";
    if (!dataDir) {
      throw new Error("AWS_LOCAL_SIMULATOR_DATA_DIR not set");
    }
    this.dataDir = path.join(dataDir, "dax");
    this.store = new LocalStore(this.dataDir);
    this.clusters = new Map();
    this.subnetGroups = new Map();
    this.parameterGroups = new Map();
    this.events = [];
  }

  async initialize() {
    logger.debug("Inicializando DAX Simulator...");
    this.loadState();
    logger.debug(`DAX Simulator inicializado com ${this.clusters.size} clusters`);
  }

  loadState() {
    const savedClusters = this.store.read("clusters");
    if (savedClusters) {
      for (const [name, cluster] of Object.entries(savedClusters)) {
        this.clusters.set(name, cluster);
      }
    }
    const savedSubnetGroups = this.store.read("subnetGroups");
    if (savedSubnetGroups) {
      for (const [name, sg] of Object.entries(savedSubnetGroups)) {
        this.subnetGroups.set(name, sg);
      }
    }
    const savedParameterGroups = this.store.read("parameterGroups");
    if (savedParameterGroups) {
      for (const [name, pg] of Object.entries(savedParameterGroups)) {
        this.parameterGroups.set(name, pg);
      }
    }
    const savedEvents = this.store.read("events");
    if (savedEvents) {
      this.events = savedEvents;
    } else {
      this.events = [
        { SourceName: 'cluster-1', SourceType: 'CLUSTER', Message: 'Cluster created', Date: new Date().toISOString() }
      ];
      this.persistEvents();
    }
  }

  persistClusters() {
    const obj = {};
    for (const [name, cluster] of this.clusters.entries()) {
      obj[name] = cluster;
    }
    this.store.write("clusters", obj);
  }

  persistSubnetGroups() {
    const obj = {};
    for (const [name, sg] of this.subnetGroups.entries()) {
      obj[name] = sg;
    }
    this.store.write("subnetGroups", obj);
  }

  persistParameterGroups() {
    const obj = {};
    for (const [name, pg] of this.parameterGroups.entries()) {
      obj[name] = pg;
    }
    this.store.write("parameterGroups", obj);
  }

  persistEvents() {
    this.store.write("events", this.events);
  }

  createCluster(params) {
    const { ClusterName } = params;
    if (this.clusters.has(ClusterName)) {
      throw new Error(`Cluster ${ClusterName} already exists`);
    }
    const cluster = {
      ClusterName,
      Status: 'available',
      NodeType: params.NodeType || 'dax.r4.large',
      ClusterArn: `arn:aws:dax:us-east-1:123456789012:cache/${ClusterName}`,
      TotalNodes: params.TotalNodes || 1,
      ActiveNodes: params.TotalNodes || 1,
      Endpoint: { Address: `${ClusterName}.dax-cluster.local`, Port: 8111 },
      IamRoleArn: params.IamRoleArn || 'arn:aws:iam::123456789012:role/DAXRole',
      SubnetGroupName: params.SubnetGroupName || 'default',
      SecurityGroupIds: params.SecurityGroupIds || [],
      ParameterGroup: { ParameterGroupName: params.ParameterGroupName || 'default.dax1.0' },
      CreatedTime: new Date().toISOString()
    };
    this.clusters.set(ClusterName, cluster);
    this.persistClusters();
    this.events.unshift({ SourceName: ClusterName, SourceType: 'CLUSTER', Message: 'Cluster created', Date: new Date().toISOString() });
    this.persistEvents();
    return { Cluster: cluster };
  }

  describeClusters(params = {}) {
    let clusters = Array.from(this.clusters.values());
    if (params.ClusterNames && params.ClusterNames.length > 0) {
      clusters = clusters.filter(c => params.ClusterNames.includes(c.ClusterName));
    }
    return { Clusters: clusters };
  }

  deleteCluster(params) {
    const { ClusterName } = params;
    if (!this.clusters.has(ClusterName)) {
      throw new Error(`Cluster ${ClusterName} not found`);
    }
    this.clusters.delete(ClusterName);
    this.persistClusters();
    this.events.unshift({ SourceName: ClusterName, SourceType: 'CLUSTER', Message: 'Cluster deleted', Date: new Date().toISOString() });
    this.persistEvents();
    return { Cluster: { ClusterName, Status: 'deleting' } };
  }

  createSubnetGroup(params) {
    const { SubnetGroupName } = params;
    const sg = {
      SubnetGroupName,
      Description: params.Description || '',
      SubnetIds: params.SubnetIds || [],
      Subnets: (params.SubnetIds || []).map(id => ({ SubnetIdentifier: id, SubnetAvailabilityZone: { Name: 'us-east-1a' } }))
    };
    this.subnetGroups.set(SubnetGroupName, sg);
    this.persistSubnetGroups();
    return { SubnetGroup: sg };
  }

  describeSubnetGroups(params = {}) {
    let groups = Array.from(this.subnetGroups.values());
    if (params.SubnetGroupNames && params.SubnetGroupNames.length > 0) {
      groups = groups.filter(g => params.SubnetGroupNames.includes(g.SubnetGroupName));
    }
    if (groups.length === 0) {
      groups = [{ SubnetGroupName: 'default', Description: 'Default subnet group', SubnetIds: [], Subnets: [] }];
    }
    return { SubnetGroups: groups };
  }

  deleteSubnetGroup(params) {
    const { SubnetGroupName } = params;
    this.subnetGroups.delete(SubnetGroupName);
    this.persistSubnetGroups();
    return {};
  }

  createParameterGroup(params) {
    const { ParameterGroupName, ParameterGroupFamily } = params;
    const pg = {
      ParameterGroupName,
      ParameterGroupFamily: ParameterGroupFamily || 'dax1.0',
      Description: params.Description || ''
    };
    this.parameterGroups.set(ParameterGroupName, pg);
    this.persistParameterGroups();
    return { ParameterGroup: pg };
  }

  describeParameterGroups(params = {}) {
    let groups = Array.from(this.parameterGroups.values());
    if (params.ParameterGroupNames && params.ParameterGroupNames.length > 0) {
      groups = groups.filter(g => params.ParameterGroupNames.includes(g.ParameterGroupName));
    }
    if (groups.length === 0) {
      groups = [{ ParameterGroupName: 'default.dax1.0', ParameterGroupFamily: 'dax1.0', Description: 'Default parameter group' }];
    }
    return { ParameterGroups: groups };
  }

  modifyParameterGroup(params) {
    return { ParameterGroupName: params.ParameterGroupName };
  }

  deleteParameterGroup(params) {
    this.parameterGroups.delete(params.ParameterGroupName);
    this.persistParameterGroups();
    return {};
  }

  describeEvents(params = {}) {
    let events = [...this.events];
    if (params.SourceName) {
      events = events.filter(e => e.SourceName === params.SourceName);
    }
    return { Events: events };
  }

  getClustersCount() {
    return this.clusters.size;
  }

  async reset() {
    this.clusters.clear();
    this.subnetGroups.clear();
    this.parameterGroups.clear();
    this.events = [];
    this.persistClusters();
    this.persistSubnetGroups();
    this.persistParameterGroups();
    this.persistEvents();
    logger.debug("DAX: Todos os dados resetados");
  }

  handleRequest(action, params) {
    switch (action) {
      case 'CreateCluster':
        return this.createCluster(params);
      case 'DescribeClusters':
        return this.describeClusters(params);
      case 'DeleteCluster':
        return this.deleteCluster(params);
      case 'CreateSubnetGroup':
        return this.createSubnetGroup(params);
      case 'DescribeSubnetGroups':
        return this.describeSubnetGroups(params);
      case 'DeleteSubnetGroup':
        return this.deleteSubnetGroup(params);
      case 'CreateParameterGroup':
        return this.createParameterGroup(params);
      case 'DescribeParameterGroups':
        return this.describeParameterGroups(params);
      case 'ModifyParameterGroup':
        return this.modifyParameterGroup(params);
      case 'DeleteParameterGroup':
        return this.deleteParameterGroup(params);
      case 'DescribeEvents':
        return this.describeEvents(params);
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }
}

module.exports = DAXSimulator;
