#!/usr/bin/env node

/**
 * Integration Script - Adiciona policy enforcement middleware em todos os serviços
 * 
 * Uso: node scripts/integrate-policy-enforcement.js
 * 
 * Este script:
 * 1. Encontra todos os serviços
 * 2. Adiciona setupServiceMiddleware() em cada server.js
 * 3. Adiciona injectDependencies() em cada index.js
 * 4. Injeta org/sts services no main server.js
 */

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');

const SERVICES_DIR = path.join(__dirname, '../src/services');
const SERVICES_TO_ENFORCE = [
  's3', 'sqs', 'sns', 'dynamodb', 'cognito', 'kms', 'lambda',
  'ec2', 'apigateway', 'cloudformation', 'iam'
];

class PolicyEnforcementIntegrator {
  constructor() {
    this.modifiedFiles = [];
    this.stats = {
      processed: 0,
      skipped: 0,
      modified: 0,
      errors: 0
    };
  }

  /**
   * Executar integração
   */
  async run() {
    logger.info('🔧 Iniciando integração de Policy Enforcement...\n');

    try {
      // 1. Integrar em cada serviço
      for (const service of SERVICES_TO_ENFORCE) {
        await this.integrateService(service);
      }

      // 2. Atualizar server.js principal
      await this.updateMainServer();

      // 3. Gerar relatório
      this.printReport();
    } catch (error) {
      logger.error('❌ Erro durante integração:', error.message);
      process.exit(1);
    }
  }

  /**
   * Integrar middleware em um serviço específico
   */
  async integrateService(serviceName) {
    const serviceDir = path.join(SERVICES_DIR, serviceName);
    const serverPath = path.join(serviceDir, 'server.js');
    const indexPath = path.join(serviceDir, 'index.js');

    // Verificar se serviço existe
    if (!fs.existsSync(serverPath) || !fs.existsSync(indexPath)) {
      logger.warn(`⏭️  ${serviceName}: Serviço não encontrado`);
      this.stats.skipped++;
      return;
    }

    logger.info(`📦 Processando ${serviceName}...`);

    try {
      // Atualizar server.js
      await this.updateServiceServer(serviceName, serverPath);

      // Atualizar index.js
      await this.updateServiceIndex(serviceName, indexPath);

      logger.success(`✅ ${serviceName}: Integrado com sucesso`);
      this.stats.modified++;
    } catch (error) {
      logger.error(`❌ ${serviceName}: Erro - ${error.message}`);
      this.stats.errors++;
    }

    this.stats.processed++;
  }

  /**
   * Atualizar server.js de um serviço
   */
  async updateServiceServer(serviceName, serverPath) {
    let content = fs.readFileSync(serverPath, 'utf-8');

    // Verificar se já foi integrado
    if (content.includes('setupServiceMiddleware')) {
      logger.debug(`  → server.js já contém setupServiceMiddleware`);
      return;
    }

    // 1. Adicionar import
    if (!content.includes("require('../../middleware')")) {
      const importLine = "const { setupServiceMiddleware } = require('../../middleware');\n";
      content = this.addImportAfterRequires(content, importLine);
    }

    // 2. Adicionar variáveis de dependência no constructor
    if (!content.includes('this.organizationsService')) {
      const constructorPattern = /(constructor\([^)]*\)\s*\{)/;
      const dependencyLines = `
    this.organizationsService = null;
    this.stsService = null;`;

      content = content.replace(
        constructorPattern,
        match => match + dependencyLines
      );
    }

    // 3. Adicionar injectDependencies method
    if (!content.includes('injectDependencies(')) {
      const methodLines = `

  injectDependencies(server) {
    this.organizationsService = server.servicesMap?.get('organizations');
    this.stsService = server.servicesMap?.get('sts');
  }`;

      // Inserir antes do último }
      content = content.replace(/\n\}$/, methodLines + '\n}');
    }

    // 4. Adicionar setupServiceMiddleware na rota de inicialização
    if (!content.includes(`setupServiceMiddleware`)) {
      const setupPattern = /(setupRoutes\s*\(\)\s*\{)/;
      const setupLine = `

    // Setup policy enforcement middleware
    if (this.organizationsService) {
      setupServiceMiddleware(
        this.app,
        this.organizationsService,
        this.stsService,
        '${serviceName}'
      );
    }`;

      content = content.replace(setupPattern, match => {
        return match + setupLine;
      });
    }

    fs.writeFileSync(serverPath, content, 'utf-8');
    this.modifiedFiles.push(serverPath);
  }

  /**
   * Atualizar index.js de um serviço
   */
  async updateServiceIndex(serviceName, indexPath) {
    let content = fs.readFileSync(indexPath, 'utf-8');

    // Verificar se já foi integrado
    if (content.includes('injectDependencies(server)')) {
      logger.debug(`  → index.js já contém injectDependencies`);
      return;
    }

    // Adicionar método injectDependencies
    if (!content.includes('injectDependencies')) {
      const methodLines = `

  injectDependencies(server) {
    if (this.server && typeof this.server.injectDependencies === 'function') {
      this.server.injectDependencies(server);
    }
  }`;

      content = content.replace(/\n\}$/, methodLines + '\n}');
    }

    fs.writeFileSync(indexPath, content, 'utf-8');
    this.modifiedFiles.push(indexPath);
  }

  /**
   * Atualizar main server.js
   */
  async updateMainServer() {
    const serverPath = path.join(__dirname, '../src/server.js');
    let content = fs.readFileSync(serverPath, 'utf-8');

    logger.info('\n📝 Atualizando server.js principal...');

    // Adicionar chamada a injectDependencies para cada serviço
    const services = SERVICES_TO_ENFORCE;
    
    let injectCode = `\n    // Injetar dependências de Organizations/STS em todos os serviços\n`;
    injectCode += `    const organizationsService = this.servicesMap.get('organizations');\n`;
    injectCode += `    const stsService = this.servicesMap.get('sts');\n`;
    injectCode += `    for (const service of this.services) {\n`;
    injectCode += `      if (typeof service.injectDependencies === 'function') {\n`;
    injectCode += `        service.injectDependencies(this);\n`;
    injectCode += `      }\n`;
    injectCode += `    }\n`;

    // Encontrar local para inserir (após inicializar serviços)
    if (!content.includes('for (const service of this.services)')) {
      const pattern = /(await Promise\.all\(startPromises\);)/;
      content = content.replace(
        pattern,
        match => injectCode + '\n    ' + match
      );
    }

    fs.writeFileSync(serverPath, content, 'utf-8');
    this.modifiedFiles.push(serverPath);
  }

  /**
   * Adicionar import após outras requires
   */
  addImportAfterRequires(content, importLine) {
    // Encontrar última linha de require/import
    const lines = content.split('\n');
    let lastRequireLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^(?:const|let|var)\s+.+require\(|^import\s+/)) {
        lastRequireLine = i;
      }
      if (lines[i].match(/^(?!const|let|var|import|\/\/)/)) {
        break; // Para na primeira linha que não é require/import/comentário
      }
    }

    if (lastRequireLine >= 0) {
      lines.splice(lastRequireLine + 1, 0, importLine);
      return lines.join('\n');
    }

    // Se não encontrou, inserir no início
    return importLine + content;
  }

  /**
   * Gerar relatório
   */
  printReport() {
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 RELATÓRIO DE INTEGRAÇÃO');
    logger.info('='.repeat(60));
    logger.info(`✅ Processados: ${this.stats.processed}`);
    logger.info(`✅ Modificados: ${this.stats.modified}`);
    logger.info(`⏭️  Pulados: ${this.stats.skipped}`);
    logger.info(`❌ Erros: ${this.stats.errors}`);
    logger.info('='.repeat(60));

    if (this.modifiedFiles.length > 0) {
      logger.info('\n📝 Arquivos modificados:');
      this.modifiedFiles.forEach(file => {
        const relative = path.relative(process.cwd(), file);
        logger.info(`   ✓ ${relative}`);
      });
    }

    logger.info('\n🎯 Próximos passos:');
    logger.info('   1. Revisar as mudanças nos arquivos acima');
    logger.info('   2. Testar: npm test');
    logger.info('   3. Iniciar: npm start');
    logger.info('   4. Ativar enforcement: default-config.js → organizationsPolicyEnforcement.enabled = true');
    logger.info('\n✨ Integração concluída!\n');
  }
}

// Executar
const integrator = new PolicyEnforcementIntegrator();
integrator.run().catch(error => {
  logger.error('Erro fatal:', error);
  process.exit(1);
});
