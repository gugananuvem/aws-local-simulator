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
    // Suporta subpaths como 'parameter-store/parameters'
    const parts = entity.split('/');
    const dir = parts.length > 1 ? path.join(this.dataDir, ...parts.slice(0, -1)) : this.dataDir;
    if (!fs.existsSync(dir)) mkdirp.sync(dir);
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

  write(entity, data, _data2) {
    // Suporta chamada com 3 args: write(entity, null, data) usado por alguns simuladores
    const payload = (data === null || data === undefined) ? _data2 : data;
    const filePath = this.getFilePath(entity);
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
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

  // Aliases async para compatibilidade com simuladores que usam store.load/store.save
  async load(entity) {
    const data = this.read(entity);
    return Array.isArray(data) && data.length === 0 ? null : data;
  }

  async save(entity, data) {
    this.write(entity, data);
  }
}

module.exports = LocalStore;