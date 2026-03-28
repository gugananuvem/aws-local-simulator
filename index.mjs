#!/usr/bin/env node

/**
 * AWS Local Simulator - ES Module Entry Point
 */

import Server from './server.js';
import { loadConfig } from './config/config-loader.js';
import logger from './utils/logger.js';

export class AWSLocalSimulator {
  constructor(options = {}) {
    this.options = options;
    this.server = null;
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) {
      logger.warn('Simulador já está rodando');
      return;
    }

    try {
      const config = await loadConfig(this.options.configPath);
      this.server = new Server(config);
      await this.server.start();
      this.isRunning = true;
      logger.info('✅ AWS Local Simulator iniciado com sucesso');
      return this.server;
    } catch (error) {
      logger.error('❌ Erro ao iniciar simulador:', error);
      throw error;
    }
  }

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

  async restart() {
    await this.stop();
    await this.start();
  }

  async reset() {
    if (!this.server) {
      throw new Error('Simulador não iniciado');
    }
    await this.server.reset();
    logger.info('🗑️ Todos os dados foram resetados');
  }

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

export default AWSLocalSimulator;