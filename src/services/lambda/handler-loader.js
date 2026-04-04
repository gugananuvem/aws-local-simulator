/**
 * Handler Loader - Carrega handlers de Lambda em diferentes formatos
 * Suporta: CommonJS, ES Modules, TypeScript (compilado)
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const logger = require('../../utils/logger');

class HandlerLoader {
  /**
   * Carrega um handler de Lambda
   * @param {string} handlerPath - Caminho para o arquivo do handler
   * @param {string} type - Tipo do módulo: 'commonjs', 'module', 'auto'
   * @returns {Promise<Function>} - Função handler
   */
  static async load(handlerPath, type = 'auto') {
    // Resolve path: try cwd first, then data dir
    let fullPath = path.resolve(process.cwd(), handlerPath);

    if (!fs.existsSync(fullPath)) {
      const dataDir = process.env.AWS_LOCAL_SIMULATOR_DATA_DIR;
      if (dataDir) {
        const dataPath = path.resolve(dataDir, 'lambda', handlerPath.replace(/^\.\//, ''));
        if (fs.existsSync(dataPath)) {
          fullPath = dataPath;
        }
      }
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Handler não encontrado: ${fullPath}`);
    }
    
    logger.verboso(`Carregando handler: ${fullPath} (type: ${type})`);
    
    try {
      let handler;
      let resolvedType = type;
      
      // Detecta o tipo se for auto
      if (type === 'auto') {
        resolvedType = this.detectType(fullPath);
      }
      
      // Carrega baseado no tipo
      if (resolvedType === 'module' || fullPath.endsWith('.mjs')) {
        // ES Module
        const fileUrl = pathToFileURL(fullPath).href;
        const module = await import(fileUrl);
        handler = this.extractHandler(module);
      } else {
        // CommonJS
        // Limpa o cache para permitir hot reload em desenvolvimento
        if (process.env.NODE_ENV === 'development') {
          delete require.cache[require.resolve(fullPath)];
        }
        const module = require(fullPath);
        handler = this.extractHandler(module);
      }
      
      if (typeof handler !== 'function') {
        throw new Error(`Handler não é uma função em ${fullPath}. Exporte uma função ou um objeto com handler.`);
      }
      
      logger.debug(`✅ Handler carregado: ${fullPath}`);
      
      return handler;
      
    } catch (error) {
      logger.error(`❌ Erro ao carregar handler ${fullPath}:`, error);
      throw error;
    }
  }
  
  /**
   * Extrai a função handler de um módulo
   * Suporta: module.exports = handler, exports.handler, export default
   */
  static extractHandler(module) {
    // Verifica se é export default
    if (module.default && typeof module.default === 'function') {
      return module.default;
    }
    
    // Verifica se é exports.handler
    if (module.handler && typeof module.handler === 'function') {
      return module.handler;
    }
    
    // Verifica se o módulo inteiro é uma função
    if (typeof module === 'function') {
      return module;
    }
    
    // Tenta encontrar a primeira função exportada
    const exportedFunctions = Object.values(module).filter(v => typeof v === 'function');
    if (exportedFunctions.length === 1) {
      logger.warn(`⚠️ Usando a primeira função exportada como handler: ${exportedFunctions[0].name}`);
      return exportedFunctions[0];
    }
    
    // Se tem múltiplas funções, tenta encontrar uma chamada 'handler'
    if (module.handler) {
      return module.handler;
    }
    
    throw new Error('Não foi possível encontrar uma função handler no módulo');
  }
  
  /**
   * Detecta o tipo de módulo (CommonJS ou ES Module)
   */
  static detectType(filePath) {
    // Verifica extensão
    if (filePath.endsWith('.mjs')) {
      return 'module';
    }
    if (filePath.endsWith('.cjs')) {
      return 'commonjs';
    }
    
    // Verifica package.json na mesma pasta ou superior
    try {
      let currentDir = path.dirname(filePath);
      while (currentDir !== path.parse(currentDir).root) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          if (packageJson.type === 'module') {
            return 'module';
          }
          break;
        }
        currentDir = path.dirname(currentDir);
      }
    } catch (error) {
      // Ignora erro
    }
    
    return 'commonjs';
  }
  
  /**
   * Recarrega um handler (útil para hot reload)
   */
  static async reload(handlerPath, type = 'auto') {
    // Limpa cache
    const fullPath = path.resolve(process.cwd(), handlerPath);
    delete require.cache[require.resolve(fullPath)];
    
    // Recarrega
    return this.load(handlerPath, type);
  }
  
  /**
   * Valida se um caminho de handler é válido
   */
  static isValid(handlerPath) {
    const fullPath = path.resolve(process.cwd(), handlerPath);
    return fs.existsSync(fullPath);
  }
  
  /**
   * Retorna informações sobre o handler
   */
  static async getInfo(handlerPath) {
    const fullPath = path.resolve(process.cwd(), handlerPath);
    const type = this.detectType(fullPath);
    const stats = fs.statSync(fullPath);
    
    return {
      path: fullPath,
      type,
      exists: fs.existsSync(fullPath),
      size: stats.size,
      modified: stats.mtime,
      isValid: this.isValid(handlerPath)
    };
  }
}

module.exports = HandlerLoader;