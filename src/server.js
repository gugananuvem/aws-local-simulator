/**
 * Servidor Principal - Orquestra todos os serviços
 */

const path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
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

      this.running = true;
      this.printStatus();
    } catch (error) {
      logger.error("❌ Erro ao iniciar servidor:", error);
      throw error;
    }
  }

  async initializeServices() {
    const serviceOrder = [
      { name: "sts",            class: STSService,            depends: [] },
      { name: "lambda",         class: LambdaService,         depends: [] },
      { name: "dynamodb",       class: DynamoDBService,       depends: [] },
      { name: "s3",             class: S3Service,             depends: [] },
      { name: "sqs",            class: SQSService,            depends: ["lambda"] },
      { name: "sns",            class: SNSService,            depends: [] },
      { name: "eventbridge",    class: EventBridgeService,    depends: [] },
      { name: "cognito",        class: CognitoService,        depends: [] },
      { name: "ecs",            class: ECSService,            depends: [] },
      { name: "apigateway",     class: APIGatewayService,     depends: ["lambda"] },
      { name: "kms",            class: KMSService,            depends: [] },
      { name: "cloudwatch",     class: CloudWatchService,     depends: [] },
      { name: "cloudtrail",     class: CloudTrailService,     depends: [] },
      { name: "cloudformation", class: CloudFormationService, depends: [] },
      { name: "xray",           class: XRayService,           depends: [] },
      { name: "secret-manager", class: SecretManagerService,  depends: [] },
      { name: "parameter-store",class: ParameterStoreService, depends: [] },
      { name: "config",         class: ConfigService,         depends: [] },
      { name: "athena",         class: AthenaService,         depends: [] },
    ];

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
