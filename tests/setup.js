/**
 * Setup de testes
 * Configura variáveis de ambiente e diretórios temporários
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const mkdirp = require('mkdirp');

// Configura variáveis de ambiente para teste
process.env.IS_LOCAL = 'true';
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

// Configura diretório de dados temporário
const tempDir = path.join(os.tmpdir(), 'aws-local-simulator-test');
process.env.AWS_LOCAL_SIMULATOR_DATA_DIR = tempDir;

// Cria diretório de dados se não existir
if (!fs.existsSync(tempDir)) {
  mkdirp.sync(tempDir);
}

// Limpa diretório de dados antes de cada teste
beforeEach(() => {
  // Não limpar completamente, apenas garantir que existe
  if (!fs.existsSync(tempDir)) {
    mkdirp.sync(tempDir);
  }
});

// Limpa após todos os testes
afterAll(() => {
  try {
    // Opcional: remover diretório de teste
    // fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignora erros de limpeza
  }
});

console.log(`🧪 Test environment ready: ${tempDir}`);