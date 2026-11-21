/**
 * DAX Simulator Core
 */
const LocalStore = require("../../utils/local-store");
const logger = require("../../utils/logger");
const path = require("path");

const DEFAULT_PARAMETER_GROUP_NAME = 'default.dax1.0';
const DEFAULT_PARAMETER_VALUES = {
  'record-ttl-millis': '300000',
  'query-ttl-millis': '300000'
};
const DAX_TTL_PARAMETERS = {
  'record-ttl-millis': 'Maximum time, in milliseconds, that a record remains in the cache',
  'query-ttl-millis': 'Maximum time, in milliseconds, that a query remains in the cache'
};

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
      this.events = [];
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
    // A API real usa ReplicationFactor para o número de nós; TotalNodes é aceito por compatibilidade.
    const totalNodes = params.ReplicationFactor || params.TotalNodes || 1;
    const cluster = {
      ClusterName,
      Status: 'available',
      NodeType: params.NodeType || 'dax.r4.large',
      ClusterDescription: params.ClusterDescription || '',
      ClusterArn: `arn:aws:dax:us-east-1:123456789012:cache/${ClusterName}`,
      TotalNodes: totalNodes,
      ActiveNodes: totalNodes,
      Endpoint: { Address: `${ClusterName}.dax-cluster.local`, Port: 8111 },
      IamRoleArn: params.IamRoleArn || 'arn:aws:iam::123456789012:role/DAXRole',
      SubnetGroupName: params.SubnetGroupName || 'default',
      SecurityGroupIds: params.SecurityGroupIds || [],
      ParameterGroup: { ParameterGroupName: params.ParameterGroupName || 'default.dax1.0' },
      NetworkType: params.NetworkType || 'ipv4',
      SSESpecification: params.SSESpecification || { Enabled: false },
      ClusterEndpointEncryptionType: params.ClusterEndpointEncryptionType || 'NONE',
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
    if (!ParameterGroupName || ParameterGroupName.length > 255 || !/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/.test(ParameterGroupName)) {
      throw new Error('ParameterGroupName must start with a letter and contain only letters, digits, and single hyphens');
    }
    if (ParameterGroupName === DEFAULT_PARAMETER_GROUP_NAME || this.parameterGroups.has(ParameterGroupName)) {
      throw new Error(`Parameter group ${ParameterGroupName} already exists`);
    }
    const pg = {
      ParameterGroupName,
      ParameterGroupFamily: ParameterGroupFamily || 'dax1.0',
      Description: params.Description || '',
      ParameterValues: { ...DEFAULT_PARAMETER_VALUES }
    };
    this.parameterGroups.set(ParameterGroupName, pg);
    this.persistParameterGroups();
    return { ParameterGroup: this.toParameterGroupSummary(pg) };
  }

  describeParameterGroups(params = {}) {
    let groups = [
      {
        ParameterGroupName: DEFAULT_PARAMETER_GROUP_NAME,
        ParameterGroupFamily: 'dax1.0',
        Description: 'Default parameter group'
      },
      ...Array.from(this.parameterGroups.values()).map((group) => this.toParameterGroupSummary(group))
    ];
    if (params.ParameterGroupNames && params.ParameterGroupNames.length > 0) {
      groups = groups.filter(g => params.ParameterGroupNames.includes(g.ParameterGroupName));
    }
    return { ParameterGroups: groups };
  }

  toParameterGroupSummary(group) {
    return {
      ParameterGroupName: group.ParameterGroupName,
      ParameterGroupFamily: group.ParameterGroupFamily,
      Description: group.Description || ''
    };
  }

  describeParameters(params = {}) {
    const parameterGroupName = params.ParameterGroupName || DEFAULT_PARAMETER_GROUP_NAME;
    const group = parameterGroupName === DEFAULT_PARAMETER_GROUP_NAME
      ? null
      : this.parameterGroups.get(parameterGroupName);
    if (parameterGroupName !== DEFAULT_PARAMETER_GROUP_NAME && !group) {
      throw new Error(`Parameter group ${parameterGroupName} not found`);
    }

    const values = { ...DEFAULT_PARAMETER_VALUES, ...(group?.ParameterValues || {}) };
    return {
      Parameters: Object.entries(DAX_TTL_PARAMETERS).map(([ParameterName, Description]) => ({
        ParameterName,
        ParameterType: 'DURATION',
        ParameterValue: values[ParameterName],
        Description,
        IsModifiable: true,
        AllowedValues: '0-2147483647'
      }))
    };
  }

  updateParameterGroup(params) {
    const { ParameterGroupName, ParameterNameValues = [] } = params;
    if (!ParameterGroupName || ParameterGroupName === DEFAULT_PARAMETER_GROUP_NAME) {
      throw new Error('The default parameter group cannot be modified');
    }

    const group = this.parameterGroups.get(ParameterGroupName);
    if (!group) {
      throw new Error(`Parameter group ${ParameterGroupName} not found`);
    }
    if (!Array.isArray(ParameterNameValues) || ParameterNameValues.length === 0) {
      throw new Error('ParameterNameValues must contain at least one parameter');
    }

    const values = { ...DEFAULT_PARAMETER_VALUES, ...(group.ParameterValues || {}) };
    for (const parameter of ParameterNameValues) {
      const { ParameterName, ParameterValue } = parameter;
      if (!Object.prototype.hasOwnProperty.call(DAX_TTL_PARAMETERS, ParameterName)) {
        throw new Error(`Unsupported DAX parameter: ${ParameterName}`);
      }
      const value = String(ParameterValue);
      const numericValue = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(numericValue) || numericValue > 2147483647) {
        throw new Error(`${ParameterName} must be an integer between 0 and 2147483647`);
      }
      values[ParameterName] = value;
    }

    group.ParameterValues = values;
    this.parameterGroups.set(ParameterGroupName, group);
    this.persistParameterGroups();
    return {
      ParameterGroupName,
      Parameters: ParameterNameValues.map(({ ParameterName }) => ({
        ParameterName,
        ParameterValue: values[ParameterName]
      }))
    };
  }

  modifyParameterGroup(params) {
    return this.updateParameterGroup(params);
  }

  deleteParameterGroup(params) {
    if (params.ParameterGroupName === 'default.dax1.0') {
      throw new Error('The default parameter group cannot be deleted');
    }
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
      case 'DescribeParameters':
        return this.describeParameters(params);
      case 'UpdateParameterGroup':
        return this.updateParameterGroup(params);
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
