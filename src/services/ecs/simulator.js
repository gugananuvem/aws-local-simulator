/**
 * ECS Simulator Core
 * Simula clusters, serviços, tarefas e containers
 */

const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');
const LocalStore = require('../../utils/local-store');

class ECSSimulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, 'ecs');
    this.store = new LocalStore(this.dataDir);
    this.clusters = new Map();
    this.services = new Map();
    this.tasks = new Map();
    this.containerProcesses = new Map();
    this.availablePorts = new Set();
    this.nextPort = 50000;
  }

  async initialize() {
    logger.debug('Inicializando ECS Simulator...');
    this.loadClusters();
    this.loadServices();
    this.loadTasks();
    
    // Inicializa range de portas para containers
    for (let i = 50000; i <= 51000; i++) {
      this.availablePorts.add(i);
    }
    this.nextPort = 50000;
    
    logger.debug(`✅ ECS Simulator inicializado com ${this.clusters.size} clusters, ${this.services.size} serviços, ${this.tasks.size} tarefas`);
  }

  loadClusters() {
    const savedClusters = this.store.read('__clusters__');
    if (savedClusters) {
      for (const [name, data] of Object.entries(savedClusters)) {
        this.clusters.set(name, {
          name: data.name,
          arn: data.arn,
          status: data.status,
          createdAt: new Date(data.createdAt),
          services: data.services || [],
          tasks: data.tasks || []
        });
      }
    }
    
    // Cria clusters da configuração
    if (this.config.ecs?.clusters) {
      for (const clusterName of this.config.ecs.clusters) {
        this.createCluster(clusterName);
      }
    }
  }

  loadServices() {
    const savedServices = this.store.read('__services__');
    if (savedServices) {
      for (const [name, data] of Object.entries(savedServices)) {
        this.services.set(name, {
          name: data.name,
          arn: data.arn,
          clusterArn: data.clusterArn,
          taskDefinition: data.taskDefinition,
          desiredCount: data.desiredCount,
          runningCount: data.runningCount,
          status: data.status,
          loadBalancers: data.loadBalancers,
          networkConfiguration: data.networkConfiguration,
          schedulingStrategy: data.schedulingStrategy,
          createdAt: new Date(data.createdAt)
        });
      }
    }
  }

  loadTasks() {
    const savedTasks = this.store.read('__tasks__');
    if (savedTasks) {
      for (const [id, data] of Object.entries(savedTasks)) {
        this.tasks.set(id, {
          taskArn: data.taskArn,
          taskDefinitionArn: data.taskDefinitionArn,
          clusterArn: data.clusterArn,
          serviceName: data.serviceName,
          containers: data.containers,
          lastStatus: data.lastStatus,
          desiredStatus: data.desiredStatus,
          startedAt: new Date(data.startedAt),
          stoppedAt: data.stoppedAt ? new Date(data.stoppedAt) : null,
          stopCode: data.stopCode,
          createdAt: new Date(data.createdAt)
        });
        
        // Reconstitui processos de container se estavam rodando
        if (data.lastStatus === 'RUNNING') {
          this.startContainerProcess(data.taskArn, data.containers);
        }
      }
    }
  }

  // ============ Cluster Operations ============

  createCluster(clusterName) {
    if (this.clusters.has(clusterName)) {
      return { error: { code: 'ClusterExists', message: 'Cluster already exists' }, status: 409 };
    }
    
    const cluster = {
      name: clusterName,
      arn: `arn:aws:ecs:local:000000000000:cluster/${clusterName}`,
      status: 'ACTIVE',
      createdAt: new Date(),
      services: [],
      tasks: []
    };
    
    this.clusters.set(clusterName, cluster);
    this.persistClusters();
    
    logger.debug(`✅ Cluster ECS criado: ${clusterName}`);
    
    return { cluster };
  }

  listClusters() {
    return Array.from(this.clusters.keys());
  }

  describeCluster(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) {
      throw new Error(`Cluster ${clusterName} not found`);
    }
    
    return {
      cluster: {
        clusterName: cluster.name,
        clusterArn: cluster.arn,
        status: cluster.status,
        registeredContainerInstancesCount: 0,
        runningTasksCount: this.getRunningTasksCount(clusterName),
        pendingTasksCount: this.getPendingTasksCount(clusterName),
        activeServicesCount: this.getActiveServicesCount(clusterName),
        statistics: []
      }
    };
  }

  deleteCluster(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) {
      return { error: { code: 'ClusterNotFound', message: 'Cluster not found' }, status: 404 };
    }
    
    const services = this.getServicesInCluster(clusterName);
    if (services.length > 0) {
      return { error: { code: 'ClusterNotEmpty', message: 'Cluster has active services' }, status: 409 };
    }
    
    const tasks = this.getTasksInCluster(clusterName);
    if (tasks.length > 0) {
      return { error: { code: 'ClusterNotEmpty', message: 'Cluster has active tasks' }, status: 409 };
    }
    
    this.clusters.delete(clusterName);
    this.persistClusters();
    
    return { success: true };
  }

  // ============ Task Definition Operations ============

  registerTaskDefinition(params) {
    const { family, containerDefinitions, networkMode, cpu, memory, executionRoleArn, taskRoleArn } = params;
    
    const taskDefinitionArn = `arn:aws:ecs:local:000000000000:task-definition/${family}:${this.getNextRevision(family)}`;
    
    const taskDefinition = {
      family,
      taskDefinitionArn,
      revision: this.getNextRevision(family),
      containerDefinitions: containerDefinitions.map(this.normalizeContainerDefinition.bind(this)),
      networkMode: networkMode || 'awsvpc',
      cpu: cpu || '256',
      memory: memory || '512',
      executionRoleArn,
      taskRoleArn,
      status: 'ACTIVE',
      registeredAt: new Date().toISOString()
    };
    
    this.store.write(`taskdef_${family}_${taskDefinition.revision}`, taskDefinition);
    this.persistTaskDefinitions();
    
    logger.debug(`✅ Task Definition registrada: ${taskDefinitionArn}`);
    
    return { taskDefinition };
  }

  getNextRevision(family) {
    const files = this.store.list();
    const revisions = files
      .filter(f => f.startsWith(`taskdef_${family}_`))
      .map(f => parseInt(f.split('_')[2]) || 0);
    
    return Math.max(0, ...revisions) + 1;
  }

  normalizeContainerDefinition(container) {
    return {
      name: container.name,
      image: container.image,
      cpu: container.cpu || 0,
      memory: container.memory || 0,
      memoryReservation: container.memoryReservation || 0,
      essential: container.essential !== false,
      portMappings: (container.portMappings || []).map(pm => ({
        containerPort: pm.containerPort,
        hostPort: pm.hostPort || 0,
        protocol: pm.protocol || 'tcp'
      })),
      environment: container.environment || [],
      environmentFiles: container.environmentFiles || [],
      secrets: container.secrets || [],
      mountPoints: container.mountPoints || [],
      volumesFrom: container.volumesFrom || [],
      linuxParameters: container.linuxParameters || {},
      logConfiguration: container.logConfiguration || {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': `/ecs/${container.name}`,
          'awslogs-region': 'local',
          'awslogs-stream-prefix': 'ecs'
        }
      }
    };
  }

  // ============ Service Operations ============

  createService(params) {
    const { cluster, serviceName, taskDefinition, desiredCount, loadBalancers, networkConfiguration, schedulingStrategy } = params;
    
    const clusterObj = this.clusters.get(cluster);
    if (!clusterObj) {
      return { error: { code: 'ClusterNotFound', message: 'Cluster not found' }, status: 404 };
    }
    
    if (this.services.has(serviceName)) {
      return { error: { code: 'ServiceExists', message: 'Service already exists' }, status: 409 };
    }
    
    const serviceArn = `arn:aws:ecs:local:000000000000:service/${cluster}/${serviceName}`;
    
    const service = {
      name: serviceName,
      arn: serviceArn,
      clusterArn: clusterObj.arn,
      taskDefinition,
      desiredCount: desiredCount || 1,
      runningCount: 0,
      pendingCount: 0,
      status: 'ACTIVE',
      loadBalancers: loadBalancers || [],
      networkConfiguration: networkConfiguration || {
        awsvpcConfiguration: {
          subnets: ['subnet-local'],
          securityGroups: ['sg-local'],
          assignPublicIp: 'ENABLED'
        }
      },
      schedulingStrategy: schedulingStrategy || 'REPLICA',
      createdAt: new Date(),
      tasks: []
    };
    
    this.services.set(serviceName, service);
    clusterObj.services.push(serviceName);
    this.persistServices();
    this.persistClusters();
    
    // Inicia as tarefas do serviço
    if (desiredCount > 0) {
      this.scaleService(serviceName, desiredCount);
    }
    
    logger.debug(`✅ Serviço ECS criado: ${serviceName} (${desiredCount} tarefas)`);
    
    return { service };
  }

  updateService(params) {
    const { cluster, service, desiredCount, taskDefinition } = params;
    
    const serviceObj = this.services.get(service);
    if (!serviceObj) {
      return { error: { code: 'ServiceNotFound', message: 'Service not found' }, status: 404 };
    }
    
    if (desiredCount !== undefined) {
      serviceObj.desiredCount = desiredCount;
      this.scaleService(service, desiredCount);
    }
    
    if (taskDefinition) {
      serviceObj.taskDefinition = taskDefinition;
      // Em produção, faria uma atualização gradual
      this.updateServiceTasks(service, taskDefinition);
    }
    
    this.persistServices();
    
    return { service: serviceObj };
  }

  scaleService(serviceName, desiredCount) {
    const service = this.services.get(serviceName);
    if (!service) return;
    
    const currentCount = this.getRunningTasksCountForService(serviceName);
    const diff = desiredCount - currentCount;
    
    if (diff > 0) {
      // Scale up
      for (let i = 0; i < diff; i++) {
        this.runTask({
          cluster: service.clusterArn.split('/').pop(),
          taskDefinition: service.taskDefinition,
          serviceName: service.name
        });
      }
    } else if (diff < 0) {
      // Scale down
      const tasks = this.getTasksForService(serviceName);
      const toStop = tasks.slice(0, -diff);
      for (const task of toStop) {
        this.stopTask(task.taskArn);
      }
    }
    
    service.runningCount = this.getRunningTasksCountForService(serviceName);
    service.pendingCount = this.getPendingTasksCountForService(serviceName);
  }

  // ============ Task Operations ============

  async runTask(params) {
    const { cluster, taskDefinition, serviceName, overrides } = params;
    
    const clusterObj = this.clusters.get(cluster);
    if (!clusterObj) {
      return { error: { code: 'ClusterNotFound', message: 'Cluster not found' }, status: 404 };
    }
    
    // Busca a task definition
    const taskDef = this.getTaskDefinition(taskDefinition);
    if (!taskDef) {
      return { error: { code: 'TaskDefinitionNotFound', message: 'Task definition not found' }, status: 404 };
    }
    
    const taskId = crypto.randomUUID();
    const taskArn = `arn:aws:ecs:local:000000000000:task/${cluster}/${taskId}`;
    
    // Prepara containers com portas mapeadas
    const containers = await this.prepareContainers(taskDef.containerDefinitions, overrides);
    
    const task = {
      taskArn,
      taskDefinitionArn: taskDef.taskDefinitionArn,
      clusterArn: clusterObj.arn,
      serviceName: serviceName || null,
      containers,
      lastStatus: 'PROVISIONING',
      desiredStatus: 'RUNNING',
      startedAt: null,
      stoppedAt: null,
      stopCode: null,
      createdAt: new Date(),
      overrides: overrides || {}
    };
    
    this.tasks.set(taskArn, task);
    clusterObj.tasks.push(taskArn);
    
    if (serviceName) {
      const service = this.services.get(serviceName);
      if (service) {
        service.tasks.push(taskArn);
        service.pendingCount++;
      }
    }
    
    this.persistTasks();
    this.persistClusters();
    this.persistServices();
    
    logger.debug(`📦 Tarefa ECS criada: ${taskArn}`);
    
    // Inicia os containers
    this.startTask(task);
    
    return { task };
  }

  async prepareContainers(containerDefs, overrides) {
    const containers = [];
    
    for (const containerDef of containerDefs) {
      // Aloca portas para o container
      const portMappings = [];
      for (const mapping of containerDef.portMappings || []) {
        const hostPort = this.allocatePort();
        portMappings.push({
          containerPort: mapping.containerPort,
          hostPort,
          protocol: mapping.protocol
        });
      }
      
      containers.push({
        name: containerDef.name,
        image: containerDef.image,
        containerArn: `arn:aws:ecs:local:container/${crypto.randomUUID()}`,
        lastStatus: 'PROVISIONING',
        desiredStatus: 'RUNNING',
        portMappings,
        environment: containerDef.environment,
        command: overrides?.containerOverrides?.find(c => c.name === containerDef.name)?.command || null,
        startedAt: null,
        stoppedAt: null
      });
    }
    
    return containers;
  }

  allocatePort() {
    if (this.availablePorts.size === 0) {
      // Expande range de portas
      for (let i = this.nextPort; i <= this.nextPort + 100; i++) {
        this.availablePorts.add(i);
      }
      this.nextPort += 100;
    }
    
    const port = Array.from(this.availablePorts)[0];
    this.availablePorts.delete(port);
    return port;
  }

  releasePort(port) {
    this.availablePorts.add(port);
  }

  async startTask(task) {
    task.lastStatus = 'PENDING';
    this.persistTasks();
    
    // Simula tempo de provisão
    setTimeout(async () => {
      task.lastStatus = 'RUNNING';
      task.startedAt = new Date();
      
      if (task.serviceName) {
        const service = this.services.get(task.serviceName);
        if (service) {
          service.runningCount++;
          service.pendingCount--;
          this.persistServices();
        }
      }
      
      this.persistTasks();
      
      // Inicia cada container
      for (const container of task.containers) {
        await this.startContainer(task.taskArn, container);
      }
      
      logger.success(`✅ Tarefa ECS iniciada: ${task.taskArn}`);
    }, 1000);
  }

  async startContainer(taskArn, container) {
    const containerId = crypto.randomUUID();
    container.lastStatus = 'RUNNING';
    container.startedAt = new Date();
    container.containerId = containerId;
    
    logger.info(`🐳 Container iniciado: ${container.name} (${container.image})`);
    logger.info(`   Portas: ${container.portMappings.map(p => `${p.containerPort}:${p.hostPort}`).join(', ')}`);
    
    // Simula execução do container
    // Em um cenário real, aqui você poderia realmente executar o container Docker
    this.containerProcesses.set(container.containerId, {
      taskArn,
      container,
      running: true,
      startTime: new Date()
    });
    
    this.persistTasks();
  }

  async stopTask(taskArn) {
    const task = this.tasks.get(taskArn);
    if (!task) {
      return { error: { code: 'TaskNotFound', message: 'Task not found' }, status: 404 };
    }
    
    // Para todos os containers
    for (const container of task.containers) {
      if (container.containerId) {
        const process = this.containerProcesses.get(container.containerId);
        if (process) {
          process.running = false;
          this.containerProcesses.delete(container.containerId);
        }
        container.lastStatus = 'STOPPED';
        container.stoppedAt = new Date();
        this.releasePorts(container.portMappings);
      }
    }
    
    task.lastStatus = 'STOPPED';
    task.desiredStatus = 'STOPPED';
    task.stoppedAt = new Date();
    task.stopCode = 'UserInitiated';
    
    if (task.serviceName) {
      const service = this.services.get(task.serviceName);
      if (service && service.runningCount > 0) {
        service.runningCount--;
        this.persistServices();
      }
    }
    
    this.persistTasks();
    
    logger.debug(`🛑 Tarefa ECS parada: ${taskArn}`);
    
    return { task };
  }

  releasePorts(portMappings) {
    for (const mapping of portMappings) {
      if (mapping.hostPort) {
        this.releasePort(mapping.hostPort);
      }
    }
  }

  listTasks(params) {
    const { cluster, serviceName } = params;
    let tasks = Array.from(this.tasks.values());
    
    if (cluster) {
      tasks = tasks.filter(t => t.clusterArn.includes(cluster));
    }
    
    if (serviceName) {
      tasks = tasks.filter(t => t.serviceName === serviceName);
    }
    
    return {
      taskArns: tasks.map(t => t.taskArn)
    };
  }

  describeTasks(params) {
    const { cluster, tasks } = params;
    const taskList = [];
    
    for (const taskArn of tasks) {
      const task = this.tasks.get(taskArn);
      if (task) {
        taskList.push({
          taskArn: task.taskArn,
          taskDefinitionArn: task.taskDefinitionArn,
          clusterArn: task.clusterArn,
          serviceName: task.serviceName,
          containers: task.containers.map(c => ({
            name: c.name,
            containerArn: c.containerArn,
            lastStatus: c.lastStatus,
            networkBindings: c.portMappings.map(pm => ({
              containerPort: pm.containerPort,
              hostPort: pm.hostPort,
              protocol: pm.protocol
            }))
          })),
          lastStatus: task.lastStatus,
          desiredStatus: task.desiredStatus,
          startedAt: task.startedAt,
          stoppedAt: task.stoppedAt,
          stopCode: task.stopCode,
          createdAt: task.createdAt
        });
      }
    }
    
    return { tasks: taskList, failures: [] };
  }

  // ============ Helper Methods ============

  getTaskDefinition(taskDefinition) {
    const [family, revision] = taskDefinition.split(':').pop().split('/').pop().split(':');
    return this.store.read(`taskdef_${family}_${revision || this.getLatestRevision(family)}`);
  }

  getLatestRevision(family) {
    const files = this.store.list();
    const revisions = files
      .filter(f => f.startsWith(`taskdef_${family}_`))
      .map(f => parseInt(f.split('_')[2]) || 0);
    
    return Math.max(0, ...revisions);
  }

  getRunningTasksCount(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) return 0;
    
    let count = 0;
    for (const taskArn of cluster.tasks) {
      const task = this.tasks.get(taskArn);
      if (task && task.lastStatus === 'RUNNING') {
        count++;
      }
    }
    return count;
  }

  getPendingTasksCount(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) return 0;
    
    let count = 0;
    for (const taskArn of cluster.tasks) {
      const task = this.tasks.get(taskArn);
      if (task && task.lastStatus === 'PENDING') {
        count++;
      }
    }
    return count;
  }

  getActiveServicesCount(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) return 0;
    return cluster.services.length;
  }

  getServicesInCluster(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) return [];
    return cluster.services;
  }

  getTasksInCluster(clusterName) {
    const cluster = this.clusters.get(clusterName);
    if (!cluster) return [];
    return cluster.tasks;
  }

  getRunningTasksCountForService(serviceName) {
    const service = this.services.get(serviceName);
    if (!service) return 0;
    
    let count = 0;
    for (const taskArn of service.tasks) {
      const task = this.tasks.get(taskArn);
      if (task && task.lastStatus === 'RUNNING') {
        count++;
      }
    }
    return count;
  }

  getPendingTasksCountForService(serviceName) {
    const service = this.services.get(serviceName);
    if (!service) return 0;
    
    let count = 0;
    for (const taskArn of service.tasks) {
      const task = this.tasks.get(taskArn);
      if (task && task.lastStatus === 'PENDING') {
        count++;
      }
    }
    return count;
  }

  getTasksForService(serviceName) {
    const service = this.services.get(serviceName);
    if (!service) return [];
    
    const tasks = [];
    for (const taskArn of service.tasks) {
      const task = this.tasks.get(taskArn);
      if (task) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  updateServiceTasks(serviceName, newTaskDefinition) {
    const service = this.services.get(serviceName);
    if (!service) return;
    
    const tasks = this.getTasksForService(serviceName);
    for (const task of tasks) {
      if (task.lastStatus === 'RUNNING') {
        // Para a tarefa antiga e inicia nova
        this.stopTask(task.taskArn);
        this.runTask({
          cluster: service.clusterArn.split('/').pop(),
          taskDefinition: newTaskDefinition,
          serviceName: service.name
        });
      }
    }
  }

  // ============ Persistence ============

  persistClusters() {
    const clustersObj = {};
    for (const [name, cluster] of this.clusters.entries()) {
      clustersObj[name] = {
        name: cluster.name,
        arn: cluster.arn,
        status: cluster.status,
        createdAt: cluster.createdAt.toISOString(),
        services: cluster.services,
        tasks: cluster.tasks
      };
    }
    this.store.write('__clusters__', clustersObj);
  }

  persistServices() {
    const servicesObj = {};
    for (const [name, service] of this.services.entries()) {
      servicesObj[name] = {
        name: service.name,
        arn: service.arn,
        clusterArn: service.clusterArn,
        taskDefinition: service.taskDefinition,
        desiredCount: service.desiredCount,
        runningCount: service.runningCount,
        status: service.status,
        loadBalancers: service.loadBalancers,
        networkConfiguration: service.networkConfiguration,
        schedulingStrategy: service.schedulingStrategy,
        createdAt: service.createdAt.toISOString(),
        tasks: service.tasks
      };
    }
    this.store.write('__services__', servicesObj);
  }

  persistTasks() {
    const tasksObj = {};
    for (const [arn, task] of this.tasks.entries()) {
      tasksObj[arn] = {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        clusterArn: task.clusterArn,
        serviceName: task.serviceName,
        containers: task.containers.map(c => ({
          name: c.name,
          image: c.image,
          containerArn: c.containerArn,
          lastStatus: c.lastStatus,
          desiredStatus: c.desiredStatus,
          portMappings: c.portMappings,
          environment: c.environment,
          startedAt: c.startedAt,
          stoppedAt: c.stoppedAt
        })),
        lastStatus: task.lastStatus,
        desiredStatus: task.desiredStatus,
        startedAt: task.startedAt,
        stoppedAt: task.stoppedAt,
        stopCode: task.stopCode,
        createdAt: task.createdAt.toISOString()
      };
    }
    this.store.write('__tasks__', tasksObj);
  }

  persistTaskDefinitions() {
    // Task definitions são persistidas individualmente
    // Já salvas no registerTaskDefinition
  }

  async reset() {
    // Para todas as tarefas em execução
    for (const [taskArn] of this.tasks) {
      await this.stopTask(taskArn);
    }
    
    this.clusters.clear();
    this.services.clear();
    this.tasks.clear();
    this.containerProcesses.clear();
    
    this.persistClusters();
    this.persistServices();
    this.persistTasks();
    
    logger.debug('ECS: Todos os dados resetados');
  }

  getClustersCount() {
    return this.clusters.size;
  }

  getServicesCount() {
    return this.services.size;
  }

  getTasksCount() {
    return this.tasks.size;
  }

  getRunningContainers() {
    return this.containerProcesses.size;
  }
}

module.exports = ECSSimulator;