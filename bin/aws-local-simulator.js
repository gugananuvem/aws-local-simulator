#!/usr/bin/env node

/**
 * CLI para AWS Local Simulator
 */

const { AWSLocalSimulator } = require('../src/index');
const logger = require('../src/utils/logger');
const path = require('path');

const command = process.argv[2];
const configPath = process.argv[3];

const simulator = new AWSLocalSimulator({
  configPath: configPath ? path.resolve(process.cwd(), configPath) : undefined
});

async function main() {
  switch (command) {
    case 'start':
      await simulator.start();
      break;
      
    case 'stop':
      await simulator.stop();
      break;
      
    case 'restart':
      await simulator.restart();
      break;
      
    case 'reset':
      await simulator.reset();
      break;
      
    case 'status':
      const status = simulator.getStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
      
    case 'help':
    default:
      console.log(`
AWS Local Simulator - CLI Commands:
  start [configPath]  - Inicia o simulador
  stop                - Para o simulador
  restart             - Reinicia o simulador
  reset               - Reseta todos os dados
  status              - Mostra status dos serviços
  help                - Mostra esta ajuda

Exemplos:
  npx aws-local-simulator start
  npx aws-local-simulator start ./my-config.json
  AWS_LOCAL_SIMULATOR_LOG=verboso npx aws-local-simulator start
      `);
      break;
  }
}

main().catch(error => {
  logger.error('Erro:', error);
  process.exit(1);
});