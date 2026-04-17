/**
 * Cognito Server - Servidor HTTP para Cognito API
 */

const express = require('express');
const logger = require('../../utils/logger');

class CognitoServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(express.raw({ type: '*/*', limit: '10mb' }));
    this.app.use((req, res, next) => {
      if (req.body && Buffer.isBuffer(req.body)) {
        try {
          req.body = JSON.parse(req.body.toString('utf8'));
        } catch (e) {
          req.body = {};
        }
      } else if (!req.body) {
        req.body = {};
      }
      next();
    });
    
    if (logger.currentLogLevel === 'verboso') {
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.verboso(`Cognito: ${req.method} ${req.path} - ${duration}ms`);
        });
        next();
      });
    }
  }

  async initialize() {
    this.setupRoutes();
    logger.debug('Cognito Server inicializado');
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'cognito-simulator',
        version: '1.0.0'
      });
    });

    // User Pool operations — aceita POST / e POST /:userPoolId (compatibilidade com SDK)
    const cognitoHandler = async (req, res) => {
      const target = req.headers['x-amz-target'];
      logger.info(`Cognito incoming: target=${target} body=${JSON.stringify(req.body)}`);
      if (!target) {
        return res.status(400).json({ error: 'Missing X-Amz-Target header' });
      }

      try {
        const result = await this.handleRequest(target, req.body || {});
        res.json(result);
      } catch (error) {
        logger.error('Cognito Error:', error);
        res.status(400).json({
          __type: error.code || 'InternalServerError',
          message: error.message
        });
      }
    };

    this.app.post('/', cognitoHandler);
    this.app.post('/:userPoolId', cognitoHandler);

    // Admin endpoints
    this.setupAdminRoutes();
  }

  async handleRequest(target, params) {
    const action = target.split('.')[2] || target.split('.')[1];
    
    logger.verboso(`Cognito Action: ${action}`);
    
    switch(action) {
      // User Pool Management
      case 'CreateUserPool':
        return this.simulator.createUserPool(params);
      case 'ListUserPools':
        return this.simulator.listUserPools(params);
      case 'DescribeUserPool':
        return this.simulator.describeUserPool(params);
      case 'DeleteUserPool':
        return this.simulator.deleteUserPool(params);
      
      case 'ListUsers':
        return this.simulator.listUsers(params);
      // User Pool Client Management
      case 'CreateUserPoolClient':
        return this.simulator.createUserPoolClient(params);
      case 'ListUserPoolClients':
        return this.simulator.listUserPoolClients(params);
      case 'DescribeUserPoolClient':
        return this.simulator.describeUserPoolClient(params);
      case 'DeleteUserPoolClient':
        return this.simulator.deleteUserPoolClient(params);
      
      // User Operations
      case 'SignUp':
        return this.simulator.signUp(params);
      case 'ConfirmSignUp':
        return this.simulator.confirmSignUp(params);
      case 'ForgotPassword':
        return this.simulator.forgotPassword(params);
      case 'ConfirmForgotPassword':
        return this.simulator.confirmForgotPassword(params);
      case 'ChangePassword':
        return this.simulator.changePassword(params);
      case 'InitiateAuth':
        return this.simulator.initiateAuth(params);
      case 'RespondToAuthChallenge':
        return this.simulator.respondToAuthChallenge(params);
      case 'GetToken':
        return this.simulator.getToken(params);
      case 'GlobalSignOut':
        return this.simulator.globalSignOut(params);
      case 'RevokeToken':
        return this.simulator.revokeToken(params);
      case 'GetUser':
        return this.simulator.getUser(params);
      case 'UpdateUserAttributes':
        return this.simulator.updateUserAttributes(params);
      case 'DeleteUser':
        return this.simulator.deleteUser(params);

      // Admin Operations
      case 'AdminGetUser':
        return this.simulator.adminGetUser(params);
      case 'AdminCreateUser':
        return this.simulator.adminCreateUser(params);
      case 'AdminSetUserPassword':
        return this.simulator.adminSetUserPassword(params);
      case 'AdminDeleteUser':
        return this.simulator.adminDeleteUser(params);
      case 'AdminDisableUser':
        return this.simulator.adminDisableUser(params);
      case 'AdminEnableUser':
        return this.simulator.adminEnableUser(params);
      case 'AdminResetUserPassword':
        return this.simulator.adminResetUserPassword(params);
      case 'AdminInitiateAuth':
        return this.simulator.initiateAuth(params);
      case 'AdminListGroupsForUser':
        return this.simulator.adminListGroupsForUser(params);
      case 'AdminUserGlobalSignOut':
        return this.simulator.adminUserGlobalSignOut(params);
      
      // Identity Pool Operations
      case 'CreateIdentityPool':
        return this.simulator.createIdentityPool(params);
      case 'GetId':
        return this.simulator.getId(params);
      case 'GetCredentialsForIdentity':
        return this.simulator.getCredentialsForIdentity(params);
      
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  setupAdminRoutes() {
    this.app.get('/__admin/userpools', (req, res) => {
      res.json({
        userPools: this.simulator.getUserPoolsCount(),
        users: this.simulator.getTotalUsersCount(),
        identityPools: this.simulator.getIdentityPoolsCount(),
        activeSessions: this.simulator.getActiveSessionsCount()
      });
    });

    this.app.get('/__admin/userpools/:poolId/users', (req, res) => {
      const pool = this.simulator.userPools.get(req.params.poolId);
      if (!pool) {
        return res.status(404).json({ error: 'User pool not found' });
      }
      
      const users = [];
      for (const userId of pool.Users) {
        const user = this.simulator.users.get(userId);
        if (user) {
          users.push({
            username: user.Username,
            userId: user.UserId,
            status: user.UserStatus,
            attributes: user.Attributes,
            created: user.CreatedDate
          });
        }
      }
      
      res.json(users);
    });

    this.app.get('/__admin/validate-token', (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
      }
      
      const token = authHeader.replace('Bearer ', '');
      const decoded = this.simulator.verifyAccessToken(token);
      
      if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      res.json({ valid: true, payload: decoded });
    });

    this.app.post('/__admin/generate-token', (req, res) => {
      const { username, userPoolId, clientId } = req.body;
      
      const userPool = this.simulator.userPools.get(userPoolId);
      if (!userPool) {
        return res.status(404).json({ error: 'User pool not found' });
      }
      
      const user = this.simulator.findUserByUsername(username, null, userPoolId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const accessToken = this.simulator.generateAccessToken(user, userPool, clientId);
      const idToken = this.simulator.generateIdToken(user, userPool, clientId);
      
      res.json({
        accessToken,
        idToken,
        expiresIn: 3600
      });
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🔐 Cognito rodando em http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      endpoint: `http://localhost:${this.port}`,
      userPoolsCount: this.simulator?.getUserPoolsCount() || 0,
      usersCount: this.simulator?.getTotalUsersCount() || 0,
      identityPoolsCount: this.simulator?.getIdentityPoolsCount() || 0,
      activeSessions: this.simulator?.getActiveSessionsCount() || 0
    };
  }
}

module.exports = CognitoServer;