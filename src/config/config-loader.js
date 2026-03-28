/**
 * Carrega configurações do usuário
 */

const fs = require('fs');
const path = require('path');
const defaultConfig = require('./default-config');
const EnvLoader = require('./env-loader');
const logger = require('../utils/logger');

class ConfigLoader {
  static async load(configPath) {
    logger.info('📝 Carregando configurações...');
    
    // 1. Carrega configurações padrão
    let config = { ...defaultConfig };
    
    // 2. Sobrescreve com variáveis de ambiente
    const envConfig = EnvLoader.load();
    config = this.mergeDeep(config, envConfig);
    
    // 3. Sobrescreve com arquivo de configuração do usuário se existir
    if (configPath) {
      const userConfig = await this.loadUserConfig(configPath);
      config = this.mergeDeep(config, userConfig);
    } else {
      // Tenta encontrar arquivo de configuração padrão
      const possiblePaths = [
        path.join(process.cwd(), 'aws-local-simulator.json'),
        path.join(process.cwd(), 'aws-local-simulator.config.json'),
        path.join(process.cwd(), '.aws-local-simulator.json')
      ];
      
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          const userConfig = await this.loadUserConfig(possiblePath);
          config = this.mergeDeep(config, userConfig);
          logger.info(`✅ Configuração carregada de: ${possiblePath}`);
          break;
        }
      }
    }
    
    // 4. Valida configurações
    this.validate(config);
    
    logger.info(`✅ Configurações carregadas (logLevel: ${config.logLevel})`);
    
    return config;
  }
  
  static async loadUserConfig(filePath) {
    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      
      if (!fs.existsSync(fullPath)) {
        logger.warn(`Arquivo de configuração não encontrado: ${fullPath}`);
        return {};
      }
      
      const content = fs.readFileSync(fullPath, 'utf8');
      const config = JSON.parse(content);
      
      return config;
    } catch (error) {
      logger.error(`Erro ao carregar configuração de ${filePath}:`, error);
      throw error;
    }
  }
  
  static validate(config) {
    // Valida serviços
    const enabledServices = Object.entries(config.services)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name);
    
    if (enabledServices.length === 0) {
      logger.warn('⚠️ Nenhum serviço está habilitado!');
    } else {
      logger.info(`📦 Serviços habilitados: ${enabledServices.join(', ')}`);
    }
    
    // Valida diretório de dados
    if (!config.dataDir) {
      throw new Error('dataDir não configurado');
    }
    
    // Valida portas
    for (const [service, port] of Object.entries(config.ports)) {
      if (config.services[service] && (port < 1 || port > 65535)) {
        throw new Error(`Porta inválida para ${service}: ${port}`);
      }
    }
  }
  
  static mergeDeep(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          output[key] = this.mergeDeep(target[key] || {}, source[key]);
        } else {
          output[key] = source[key];
        }
      }
    }
    
    return output;
  }
}

module.exports = { loadConfig: ConfigLoader.load.bind(ConfigLoader) };