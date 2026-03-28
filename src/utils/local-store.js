/**
 * Local Store - Persistência em arquivos JSON
 */

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

class LocalStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      mkdirp.sync(this.dataDir);
    }
  }

  getFilePath(entity) {
    return path.join(this.dataDir, `${entity}.json`);
  }

  read(entity) {
    const filePath = this.getFilePath(entity);
    if (!fs.existsSync(filePath)) return [];
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Erro ao ler ${entity}:`, error);
      return [];
    }
  }

  write(entity, data) {
    const filePath = this.getFilePath(entity);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Erro ao escrever ${entity}:`, error);
      throw error;
    }
  }

  delete(entity) {
    const filePath = this.getFilePath(entity);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  exists(entity) {
    const filePath = this.getFilePath(entity);
    return fs.existsSync(filePath);
  }

  list() {
    if (!fs.existsSync(this.dataDir)) return [];
    return fs.readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}

module.exports = LocalStore;