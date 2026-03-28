#!/usr/bin/env node

/**
 * AWS Local Simulator - Entry Point
 * Suporta tanto CommonJS quanto ES Modules
 */

const Server = require('./server');
const { loadConfig } = require('./config/config-loader');
const logger = require('./utils/logger');

/**
 * Classe principal do simulador
 */
class AWSLocalSimulator {
  constructor(options = {}) {
    this.options = options;
    this.server = null;
    this.isRunning = false;
  }

  /**
   * Inicia o simulador com as configurações
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Simulador já está rodando');
      return;
    }

    try {
      // Carrega configurações
      const config = await loadConfig(this.options.configPath);
      
      // Inicializa o servidor
      this.server = new Server(config);
      
      // Inicia todos os serviços
      await this.server.start();
      
      this.isRunning = true;
      logger.info('✅ AWS Local Simulator iniciado com sucesso');
      
      return this.server;
    } catch (error) {
      logger.error('❌ Erro ao iniciar simulador:', error);
      throw error;
    }
  }

  /**
   * Para o simulador
   */
  async stop() {
    if (!this.isRunning || !this.server) {
      logger.warn('Simulador não está rodando');
      return;
    }

    try {
      await this.server.stop();
      this.isRunning = false;
      logger.info('🛑 AWS Local Simulator parado');
    } catch (error) {
      logger.error('❌ Erro ao parar simulador:', error);
      throw error;
    }
  }

  /**
   * Reinicia o simulador
   */
  async restart() {
    await this.stop();
    await this.start();
  }

  /**
   * Reseta todos os dados
   */
  async reset() {
    if (!this.server) {
      throw new Error('Simulador não iniciado');
    }
    
    await this.server.reset();
    logger.info('🗑️ Todos os dados foram resetados');
  }

  /**
   * Retorna status dos serviços
   */
  getStatus() {
    if (!this.server) {
      return { running: false };
    }
    
    return {
      running: this.isRunning,
      services: this.server.getStatus()
    };
  }
}

// Exporta para CommonJS
module.exports = { AWSLocalSimulator, Server };