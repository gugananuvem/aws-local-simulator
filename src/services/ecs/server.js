/**
 * ECS Server - Servidor HTTP para ECS API
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');

class ECSServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json());
    
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`ECS: ${req.method} ${req.path} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.setupRoutes();
    logger.debug('ECS Server inicializado');
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'ecs-simulator',
        version: '1.0.0'
      });
    });

    // Cluster operations
    this.app.post('/clusters', (req, res) => {
      const { clusterName } = req.body;
      const result = this.simulator.createCluster(clusterName);
      if (result.error) {
        res.status(result.status).json(result.error);
      } else {
        res.json(result.cluster);
      }
    });

    this.app.get('/clusters', (req, res) => {
      const clusters = this.simulator.listClusters();
      res.json({ clusterArns: clusters.map(c => `arn:aws:ecs:local:000000000000:cluster/${c}`) });
    });

    this.app.get('/clusters/:clusterName', (req, res) => {
      try {
        const result = this.simulator.describeCluster(req.params.clusterName);
        res.json(result);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    this.app.delete('/clusters/:clusterName', (req, res) => {
      const result = this.simulator.deleteCluster(req.params.clusterName);
      if (result.error) {
        res.status(result.status).json(result.error);
      } else {
        res.json({ message: 'Cluster deleted' });
      }
    });

    // Task Definition operations
    this.app.post('/task-definitions', (req, res) => {
      const result = this.simulator.registerTaskDefinition(req.body);
      if (result.error) {
        res.status(result.status).json(result.error);
      } else {
        res.json(result.taskDefinition);
      }
    });

    // Service operations
    this.app.post('/services', (req, res) => {
      const result = this.simulator.createService(req.body);
      if (result.error) {
        res.status(result.status).json(result.error);
      } else {
        res.json(result.service);
      }
    });

    this.app.put('/services/:serviceName', (req, res) => {
      const result = this.simulator.updateService({
        ...req.body,
        service: req.params.serviceName
      });
      if (result.error) {
        res.status(result.status).json(result.error);
      } else {
        res.json(result.service);
      }
    });

    // Task operations
    this.app.post('/tasks', (req, res) => {
      this.simulator.runTask(req.body).then(result => {
        if (result.error) {
          res.status(result.status).json(result.error);
        } else {
          res.json(result.task);
        }
      });
    });

    this.app.get('/tasks', (req, res) => {
      const result = this.simulator.listTasks(req.query);
      res.json(result);
    });

    this.app.post('/tasks/describe', (req, res) => {
      const result = this.simulator.describeTasks(req.body);
      res.json(result);
    });

    this.app.post('/tasks/:taskArn/stop', (req, res) => {
      this.simulator.stopTask(req.params.taskArn).then(result => {
        if (result.error) {
          res.status(result.status).json(result.error);
        } else {
          res.json(result.task);
        }
      });
    });

    // Admin endpoints
    this.setupAdminRoutes();
  }

  setupAdminRoutes() {
    this.app.get('/__admin/clusters', (req, res) => {
      res.json({
        clusters: this.simulator.getClustersCount(),
        services: this.simulator.getServicesCount(),
        tasks: this.simulator.getTasksCount(),
        runningContainers: this.simulator.getRunningContainers()
      });
    });

    this.app.get('/__admin/clusters/:clusterName/details', (req, res) => {
      const cluster = this.simulator.clusters.get(req.params.clusterName);
      if (cluster) {
        res.json(cluster);
      } else {
        res.status(404).json({ error: 'Cluster not found' });
      }
    });

    this.app.get('/__admin/containers', (req, res) => {
      const containers = [];
      for (const [id, process] of this.simulator.containerProcesses) {
        containers.push({
          containerId: id,
          taskArn: process.taskArn,
          container: process.container,
          running: process.running,
          startTime: process.startTime
        });
      }
      res.json(containers);
    });

    this.app.get('/__admin/ports', (req, res) => {
      res.json({
        availablePorts: Array.from(this.simulator.availablePorts),
        usedPorts: this.getUsedPorts()
      });
    });
  }

  getUsedPorts() {
    const usedPorts = [];
    for (const [_, process] of this.simulator.containerProcesses) {
      for (const mapping of process.container.portMappings) {
        if (mapping.hostPort) {
          usedPorts.push(mapping.hostPort);
        }
      }
    }
    return usedPorts;
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🐳 ECS/Fargate rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      clustersCount: this.simulator?.getClustersCount() || 0,
      servicesCount: this.simulator?.getServicesCount() || 0,
      tasksCount: this.simulator?.getTasksCount() || 0,
      runningContainers: this.simulator?.getRunningContainers() || 0
    };
  }
}

module.exports = ECSServer;