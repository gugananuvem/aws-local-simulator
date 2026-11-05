/**
 * Instance Server - Mini HTTP Server para cada EC2 Instance
 * Serve um site HTML/Angular, página padrão, ou atua como proxy para URL externa
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');
const logger = require('../../utils/logger');

class InstanceServer {
  constructor(instance, websiteDir = null) {
    this.instance = instance;
    this.websiteDir = websiteDir;
    this.app = express();
    this.server = null;
    this.setupApp();
  }

  setupApp() {
    this.app.use(express.json());

    // Middleware de log
    this.app.use((req, res, next) => {
      logger.debug(`[EC2:${this.instance.InstanceId}] ${req.method} ${req.path}`);
      next();
    });

    // Health check
    this.app.get('/__health', (req, res) => {
      res.json({
        status: 'ok',
        instanceId: this.instance.InstanceId,
        state: this.instance.State,
        isProxy: !!this.instance.ProxyUrl
      });
    });

    // Metadata (similar ao AWS metadata service)
    this.app.get('/__metadata', (req, res) => {
      res.json({
        instanceId: this.instance.InstanceId,
        instanceType: this.instance.InstanceType,
        privateIp: this.instance.PrivateIpAddress,
        publicIp: this.instance.PublicIpAddress,
        vpcId: this.instance.VpcId,
        subnetId: this.instance.SubnetId,
        launchTime: this.instance.LaunchTime,
        imageId: this.instance.ImageId,
        proxyUrl: this.instance.ProxyUrl || null
      });
    });

    // Se ProxyUrl configurada, usar http-proxy-middleware
    if (this.instance.ProxyUrl) {
      logger.info(`[EC2:${this.instance.InstanceId}] 🔗 Proxy configurado para: ${this.instance.ProxyUrl}`);
      
      this.app.use('/', createProxyMiddleware({
        target: this.instance.ProxyUrl,
        changeOrigin: true,
        pathRewrite: {},
        ws: true, // WebSocket suport
        logLevel: 'warn',
        onError: (err, req, res) => {
          logger.error(`[EC2:${this.instance.InstanceId}] Proxy error: ${err.message}`);
          res.status(503).json({
            error: 'Proxy service unavailable',
            target: this.instance.ProxyUrl,
            message: err.message
          });
        }
      }));
    } else if (this.websiteDir && fs.existsSync(this.websiteDir)) {
      // Se website dir configurado, servir arquivos estáticos
      logger.info(`[EC2:${this.instance.InstanceId}] Servindo website de: ${this.websiteDir}`);
      this.app.use(express.static(this.websiteDir));

      // SPA fallback (para Angular, React, Vue)
      this.app.get(/^(?!__).+/, (req, res, next) => {
        const indexPath = path.join(this.websiteDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          next();
        }
      });
    }

    // Página padrão (se não houver website nem proxy)
    if (!this.instance.ProxyUrl) {
      this.app.get('/', (req, res) => {
        const html = this.getDefaultPage();
        res.set('Content-Type', 'text/html; charset=utf-8').send(html);
      });
    }

    // 404
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        instanceId: this.instance.InstanceId,
        path: req.path
      });
    });
  }

  getDefaultPage() {
    const proxyInfo = this.instance.ProxyUrl ? `
      <div class="info-item proxy-item">
        <div class="info-label">🔗 Proxy URL</div>
        <div class="info-value">${this.instance.ProxyUrl}</div>
      </div>
    ` : '';

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EC2 Instance - ${this.instance.InstanceId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 10px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 600px;
      width: 100%;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 3px solid #667eea;
      padding-bottom: 20px;
    }
    .header h1 {
      color: #333;
      font-size: 28px;
      margin-bottom: 10px;
    }
    .status {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: bold;
      font-size: 14px;
      ${this.instance.isRunning() ? 'background: #4caf50; color: white;' : 'background: #ff9800; color: white;'}
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .info-item {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }
    .info-item.proxy-item {
      grid-column: 1 / -1;
      border-left-color: #2196f3;
      background: #e3f2fd;
    }
    .info-label {
      color: #666;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .info-value {
      color: #333;
      font-size: 16px;
      font-weight: 500;
      word-break: break-all;
    }
    .metadata-link {
      text-align: center;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .metadata-link a {
      color: #667eea;
      text-decoration: none;
      font-size: 14px;
    }
    .metadata-link a:hover {
      text-decoration: underline;
    }
    .footer {
      text-align: center;
      margin-top: 20px;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🖥️ AWS EC2 Instance</h1>
      <div class="status">${this.instance.State.toUpperCase()}</div>
    </div>
    
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Instance ID</div>
        <div class="info-value">${this.instance.InstanceId}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">Instance Type</div>
        <div class="info-value">${this.instance.InstanceType}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">Public IP</div>
        <div class="info-value">${this.instance.PublicIpAddress}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">Private IP</div>
        <div class="info-value">${this.instance.PrivateIpAddress}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">VPC ID</div>
        <div class="info-value">${this.instance.VpcId || 'N/A'}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">Subnet ID</div>
        <div class="info-value">${this.instance.SubnetId || 'N/A'}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">Image ID</div>
        <div class="info-value">${this.instance.ImageId}</div>
      </div>
      
      <div class="info-item">
        <div class="info-label">Launch Time</div>
        <div class="info-value">${new Date(this.instance.LaunchTime).toLocaleString('pt-BR')}</div>
      </div>
      
      ${proxyInfo}
    </div>
    
    <div class="metadata-link">
      <p><a href="/__metadata">📊 Ver Metadados Completos</a></p>
    </div>
    
    <div class="footer">
      <p>Simulador AWS Local | EC2 Instance</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.instance.WebServerPort, 'localhost', () => {
          logger.info(
            `[EC2:${this.instance.InstanceId}] Servidor rodando em http://localhost:${this.instance.WebServerPort}`
          );
          resolve();
        });

        this.server.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info(`[EC2:${this.instance.InstanceId}] Servidor parado`);
          resolve();
        });
      });
    }
  }
}

module.exports = InstanceServer;
