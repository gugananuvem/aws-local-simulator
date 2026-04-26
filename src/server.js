/**
 * Servidor Principal - Orquestra todos os serviços
 */

const path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
const express = require("express");
const cors = require("cors");
const logger = require("./utils/logger");

// Importa serviços
const DynamoDBService = require("./services/dynamodb");
const S3Service = require("./services/s3");
const SQSService = require("./services/sqs");
const LambdaService = require("./services/lambda");
const { SNSService } = require("./services/sns");
const { EventBridgeService } = require("./services/eventbridge");
const CognitoService = require("./services/cognito");
const APIGatewayService = require("./services/apigateway");
const ECSService = require("./services/ecs");
const STSService = require("./services/sts");
const { CloudWatchService } = require("./services/cloudwatch");
const CloudTrailService = require("./services/cloudtrail");
const { KMSService } = require("./services/kms");
const CloudFormationService = require("./services/cloudformation");
const { XRayService } = require("./services/xray");
const { SecretManagerService } = require("./services/secret-manager");
const { ParameterStoreService } = require("./services/parameter-store");
const { ConfigService } = require("./services/config");
const { AthenaService } = require("./services/athena");

class Server {
  constructor(config) {
    this.config = config;
    this.services = [];
    this.servicesMap = new Map();
    this.running = false;
    this.managementApp = express();
    this.managementApp.use(cors());
    this.managementApp.use(express.json());
    this.managementServer = null;
    this.setupDataDir();
    this.setupLogLevel();
  }

  setupDataDir() {
    const dataDir = path.resolve(process.cwd(), this.config.dataDir);
    if (!fs.existsSync(dataDir)) {
      mkdirp.sync(dataDir);
      logger.debug(`📁 Diretório de dados criado: ${dataDir}`);
    }
    process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = dataDir;
  }

  setupLogLevel() {
    logger.setLevel(this.config.logLevel);
    logger.info(`📝 Nível de log: ${this.config.logLevel}`);
  }

  async start() {
    if (this.running) {
      logger.warn("Servidor já está rodando");
      return;
    }

    logger.info("\n🚀 Iniciando AWS Local Simulator...\n");

    try {
      await this.initializeServices();
      await this.startServices();
      this.setupManagementRoutes();
      await this.startManagementServer();

      this.running = true;
      this.printStatus();
    } catch (error) {
      logger.error("❌ Erro ao iniciar servidor:", error);
      throw error;
    }
  }

  setupManagementRoutes() {
    const app = this.managementApp;

    // GET /__admin/services — returns all services status
    app.get("/__admin/services", (req, res) => {
      const registry = this.buildServiceRegistry();
      const services = registry.map((def) => {
        const svc = this.servicesMap.get(def.name);
        if (svc) {
          const status = typeof svc.getStatus === "function"
            ? svc.getStatus()
            : { name: def.name, running: true, port: svc.port };
          // Compute canDisable: no running service should depend on this one
          const canDisable = !registry.some(
            (other) =>
              other.depends.includes(def.name) &&
              this.servicesMap.has(other.name)
          );
          return {
            name: def.name,
            running: true,
            enabled: true,
            port: status.port || this.config.ports?.[def.name],
            endpoint: status.endpoint || `http://localhost:${status.port || this.config.ports?.[def.name]}`,
            dependencies: def.depends,
            category: def.category,
            canDisable,
            ...status,
          };
        }
        return {
          name: def.name,
          running: false,
          enabled: false,
          port: this.config.ports?.[def.name],
          endpoint: `http://localhost:${this.config.ports?.[def.name]}`,
          dependencies: def.depends,
          canDisable: true,
        };
      });
      res.json({ services });
    });

    // GET /__admin/services/:name — returns single service status
    app.get("/__admin/services/:name", (req, res) => {
      const { name } = req.params;
      const registry = this.buildServiceRegistry();
      const def = registry.find((d) => d.name === name);
      if (!def) {
        return res.status(404).json({ error: `Unknown service: ${name}` });
      }
      const svc = this.servicesMap.get(name);
      const canDisable = !registry.some(
        (other) =>
          other.depends.includes(name) &&
          this.servicesMap.has(other.name)
      );
      if (svc) {
        const status = typeof svc.getStatus === "function"
          ? svc.getStatus()
          : { name, running: true, port: svc.port };
        return res.json({
          name,
          running: true,
          enabled: true,
          port: status.port || this.config.ports?.[name],
          endpoint: status.endpoint || `http://localhost:${status.port || this.config.ports?.[name]}`,
          dependencies: def.depends,
          canDisable,
          ...status,
        });
      }
      return res.json({
        name,
        running: false,
        enabled: false,
        port: this.config.ports?.[name],
        endpoint: `http://localhost:${this.config.ports?.[name]}`,
        dependencies: def.depends,
        canDisable: true,
      });
    });

    // POST /__admin/services/:name/enable — enables a service
    app.post("/__admin/services/:name/enable", async (req, res) => {
      const result = await this.enableService(req.params.name);
      res.status(result.success ? 200 : 400).json(result);
    });

    // POST /__admin/services/:name/disable — disables a service
    app.post("/__admin/services/:name/disable", async (req, res) => {
      const result = await this.disableService(req.params.name);
      res.status(result.success ? 200 : 400).json(result);
    });
  }

  startManagementServer() {
    return new Promise((resolve, reject) => {
      const port = this.config.adminPort || 9999;
      this.managementServer = this.managementApp.listen(port, () => {
        logger.info(`🔧 Management API rodando em http://localhost:${port}`);
        resolve();
      });
      this.managementServer.on("error", reject);
    });
  }

  buildServiceRegistry() {
    return [
      //Armazenamento & BD
      { name: "dynamodb", class: DynamoDBService, depends: [], category: 'Armazenamento & Banco de Dados' },
      { name: "s3", class: S3Service, depends: [], category: 'Armazenamento & Banco de Dados' },
      { name: "athena", class: AthenaService, depends: [], category: 'Armazenamento & Banco de Dados' },

      //Computação
      { name: "lambda", class: LambdaService, depends: [], category: 'Computação' },
      /*      { name: "ecs",            class: ECSService,            depends: [] , category:'Computação'},*/

      { name: "cognito", class: CognitoService, depends: ["lambda"], category: 'Segurança & Identidade' },
      { name: "sts", class: STSService, depends: [], category: 'Segurança & Identidade' },
      { name: "kms", class: KMSService, depends: [], category: 'Segurança & Identidade' },
      { name: "secret-manager", class: SecretManagerService, depends: [], category: 'Segurança & Identidade' },
      { name: "parameter-store", class: ParameterStoreService, depends: [], category: 'Segurança & Identidade' },

      //Mensageria
      { name: "sqs", class: SQSService, depends: ["lambda"], category: 'Mensageria & Integração' },
      { name: "sns", class: SNSService, depends: [], category: 'Mensageria & Integração' },
      { name: "eventbridge", class: EventBridgeService, depends: [], category: 'Mensageria & Integração' },

      //Networking
      { name: "apigateway", class: APIGatewayService, depends: ["lambda", "cognito"], category: 'Networking' },

      //Observabilidade & Conformidade
      { name: "cloudwatch", class: CloudWatchService, depends: [], category: 'Observabilidade & Conformidade' },
      { name: "cloudtrail", class: CloudTrailService, depends: [], category: 'Observabilidade & Conformidade' },
      { name: "xray", class: XRayService, depends: [], category: 'Observabilidade & Conformidade' },
      { name: "config", class: ConfigService, depends: [], category: 'Observabilidade & Conformidade' },
      { name: "cloudformation", class: CloudFormationService, depends: [], category: 'Observabilidade & Conformidade' },

    ];
  }

  async initializeServices() {
    const serviceOrder = this.buildServiceRegistry();

    for (const serviceDef of serviceOrder) {
      if (this.config.services[serviceDef.name]) {
        try {
          const dependencies = {};
          for (const dep of serviceDef.depends) {
            dependencies[dep] = this.servicesMap.get(dep);
          }

          const service = new serviceDef.class(this.config, dependencies);
          await service.initialize();

          this.services.push(service);
          this.servicesMap.set(serviceDef.name, service);

          logger.success(`✅ ${serviceDef.name.toUpperCase()} Service inicializado`);
        } catch (error) {
          logger.error(`❌ Erro ao inicializar ${serviceDef.name}:`, error);
          if (serviceDef.name === "lambda") throw error;
        }
      }
    }

    // Injeta dependências cross-service nos serviços que suportam
    for (const service of this.services) {
      if (typeof service.injectDependencies === "function") {
        service.injectDependencies(this);
      }
    }
  }

  async startServices() {
    const startPromises = this.services.map((service) => service.start());
    await Promise.all(startPromises);
    logger.success("\n🎉 Todos os serviços foram iniciados com sucesso!");
  }

  async stop() {
    if (!this.running) {
      logger.warn("Servidor não está rodando");
      return;
    }

    logger.info("\n🛑 Parando AWS Local Simulator...\n");

    try {
      const stopPromises = [...this.services].reverse().map((service) => service.stop());
      await Promise.all(stopPromises);

      if (this.managementServer) {
        await new Promise((resolve) => this.managementServer.close(resolve));
        this.managementServer = null;
      }

      this.running = false;
      logger.success("✅ Todos os serviços foram parados");
    } catch (error) {
      logger.error("❌ Erro ao parar servidor:", error);
      throw error;
    }
  }

  async reset() {
    logger.info("\n🗑️ Resetando todos os dados...\n");

    const resetPromises = this.services.map((service) => service.reset());
    await Promise.all(resetPromises);

    logger.success("✅ Todos os dados foram resetados");
  }

  getStatus() {
    const status = {
      running: this.running,
      services: {},
    };

    for (const service of this.services) {
      status.services[service.name] = service.getStatus();
    }

    return status;
  }

  getService(name) {
    return this.servicesMap.get(name);
  }

  async enableService(name) {
    // Check if already running
    if (this.servicesMap.has(name)) {
      return { success: false, error: "Service already running" };
    }

    // Look up in registry
    const registry = this.buildServiceRegistry();
    const serviceDef = registry.find((s) => s.name === name);
    if (!serviceDef) {
      return { success: false, error: "Unknown service" };
    }

    // Validate all dependencies are running
    for (const dep of serviceDef.depends) {
      if (!this.servicesMap.has(dep)) {
        return { success: false, error: `Dependency not running: ${dep}` };
      }
    }

    try {
      const service = new serviceDef.class(this.config);
      await service.initialize();
      await service.start();

      this.services.push(service);
      this.servicesMap.set(name, service);

      if (typeof service.injectDependencies === "function") {
        service.injectDependencies(this);
      }

      // Build ServiceStatus for the response
      const canDisable = !registry.some(
        (other) =>
          other.depends.includes(name) && this.servicesMap.has(other.name)
      );
      const rawStatus =
        typeof service.getStatus === "function"
          ? service.getStatus()
          : { name, running: true, port: service.port };

      const serviceStatus = {
        name,
        running: true,
        enabled: true,
        port: rawStatus.port || this.config.ports?.[name],
        endpoint:
          rawStatus.endpoint ||
          `http://localhost:${rawStatus.port || this.config.ports?.[name]}`,
        dependencies: serviceDef.depends,
        canDisable,
        ...rawStatus,
      };

      return { success: true, service: serviceStatus };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async disableService(name) {
    // Check if running
    const service = this.servicesMap.get(name);
    if (!service) {
      return { success: false, error: "Service not running" };
    }

    // Check reverse dependencies
    const registry = this.buildServiceRegistry();
    for (const other of registry) {
      if (other.depends.includes(name) && this.servicesMap.has(other.name)) {
        return {
          success: false,
          error: `Cannot disable: ${other.name} depends on it`,
        };
      }
    }

    try {
      await service.stop();
      this.services = this.services.filter((s) => s !== service);
      this.servicesMap.delete(name);

      return {
        success: true,
        service: {
          name,
          running: false,
          enabled: false,
          port: this.config.ports?.[name],
          endpoint: `http://localhost:${this.config.ports?.[name]}`,
          dependencies: registry.find((d) => d.name === name)?.depends || [],
          canDisable: true,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  printStatus() {
    logger.info("\n" + "=".repeat(60));
    logger.info("📊 Status dos Serviços:");
    logger.info("=".repeat(60));

    for (const service of this.services) {
      const status = service.getStatus();
      logger.info(`\n${service.name.toUpperCase()}:`);
      logger.info(`  Status: ${status.running ? "✅ Rodando" : "❌ Parado"}`);
      logger.info(`  Porta: ${status.port}`);
      logger.info(`  Endpoint: ${status.endpoint}`);

      if (status.tablesCount !== undefined) {
        logger.info(`  Tabelas: ${status.tablesCount}`);
      }
      if (status.bucketsCount !== undefined) {
        logger.info(`  Buckets: ${status.bucketsCount}`);
      }
      if (status.queuesCount !== undefined) {
        logger.info(`  Filas: ${status.queuesCount}`);
      }
      if (status.lambdasCount !== undefined) {
        logger.info(`  Lambdas: ${status.lambdasCount}`);
      }
      if (status.objectsCount !== undefined) {
        logger.info(`  Objetos: ${status.objectsCount}`);
      }
      if (status.messagesCount !== undefined) {
        logger.info(`  Mensagens: ${status.messagesCount}`);
      }
    }

    logger.info("\n" + "=".repeat(60));
    logger.info("\n📝 Comandos úteis:");
    logger.info("  AWS CLI:");
    logger.info("    aws dynamodb list-tables --endpoint-url http://localhost:8000");
    logger.info("    aws s3 ls --endpoint-url http://localhost:4566");
    logger.info("    aws sqs list-queues --endpoint-url http://localhost:9324");
    logger.info("\n  Testar APIs:");
    logger.info("    curl http://localhost:3001/health");
    logger.info("    curl http://localhost:8000/__admin/tables");
    logger.info("    curl http://localhost:4566/__admin/buckets");
    logger.info("    curl http://localhost:9324/__admin/queues");
    logger.info("=".repeat(60) + "\n");
  }
}

module.exports = Server;
