const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const logger = require('../../utils/logger');
const { setupServiceMiddleware } = require('../../middleware');


class IAMServer {
  constructor(simulator, logger, config) {
    this.organizationsService = null;
    this.stsService = null;
    this.simulator = simulator;
    this.logger = logger || require('../../utils/logger');
    this.config = config;
    this.app = express();
    this._setupMiddleware();
    this._setupRoutes();
  }

  _setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.json());
    this.app.use(express.static(__dirname));
  }

  _setupRoutes() {
    // Main IAM API endpoint (AWS Query protocol)
    this.app.post('/', (req, res) => {
      const action = req.body.Action || req.query.Action;

      if (!action) {
        return this._xmlError(res, 'MissingAction', 'The request must contain the parameter Action', 400);
      }

      this.logger.debug(`IAM action: ${action}`);

      try {
        const result = this._handleAction(action, req.body);

        if (result && typeof result.then === 'function') {
          result
            .then(data => this._xmlResponse(res, action, data))
            .catch(err => this._handleError(res, err));
        } else {
          this._xmlResponse(res, action, result);
        }
      } catch (err) {
        this._handleError(res, err);
      }
    });

    // Admin health endpoint
    this.app.get('/__admin/health', (req, res) => {
      res.json({ status: 'ok', service: 'iam' });
    });

    // Admin dashboard endpoints
    this.app.get('/__admin/users', (req, res) => {
      const users = Array.from(this.simulator.users.values());
      res.json(users);
    });

    this.app.get('/__admin/policies', (req, res) => {
      const policies = Array.from(this.simulator.policies.values()).map(p => {
        const { Document, ...metadata } = p;
        return metadata;
      });
      res.json(policies);
    });

    this.app.get('/__admin/roles', (req, res) => {
      const roles = Array.from(this.simulator.roles.values());
      res.json(roles);
    });

    this.app.get('/__admin/groups', (req, res) => {
      const groups = Array.from(this.simulator.groups.values()).map(g => ({
        ...g,
        MemberCount: this.simulator.groupMembers.get(g.GroupName)?.size || 0
      }));
      res.json(groups);
    });

    this.app.get('/__admin/access-keys', (req, res) => {
      const accessKeys = Array.from(this.simulator.accessKeys.values());
      res.json(accessKeys);
    });

    // Admin create/delete endpoints
    this.app.post('/__admin/users/create', async (req, res) => {
      try {
        const user = await this.simulator.createUser({ UserName: req.body?.UserName });
        res.json(user);
      } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    });

    this.app.delete('/__admin/users/:name', async (req, res) => {
      try {
        await this.simulator.deleteUser({ UserName: req.params.name });
        res.json({ success: true });
      } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    });

    this.app.post('/__admin/groups/create', async (req, res) => {
      try {
        const group = await this.simulator.createGroup({ GroupName: req.body?.GroupName });
        res.json(group);
      } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    });

    this.app.delete('/__admin/groups/:name', async (req, res) => {
      try {
        await this.simulator.deleteGroup({ GroupName: req.params.name });
        res.json({ success: true });
      } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    });

    this.app.post('/__admin/roles/create', async (req, res) => {
      try {
        const role = await this.simulator.createRole({ RoleName: req.body?.RoleName });
        res.json(role);
      } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    });

    this.app.delete('/__admin/roles/:name', async (req, res) => {
      try {
        await this.simulator.deleteRole({ RoleName: req.params.name });
        res.json({ success: true });
      } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    });

    // Dashboard HTML
    this.app.get('/dashboard', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard.html'));
    });
  }

  _handleAction(action, params) {
    switch (action) {
      // User Management
      case 'CreateUser':
        return this.simulator.createUser(params);
      case 'GetUser':
        return this.simulator.getUser(params);
      case 'ListUsers':
        return this.simulator.listUsers(params);
      case 'DeleteUser':
        return this.simulator.deleteUser(params);
      // Access Key Management
      case 'CreateAccessKey':
        return this.simulator.createAccessKey(params);
      case 'ListAccessKeys':
        return this.simulator.listAccessKeys(params);
      case 'DeleteAccessKey':
        return this.simulator.deleteAccessKey(params);
      case 'UpdateAccessKey':
        return this.simulator.updateAccessKey(params);
      // Group Management
      case 'CreateGroup':
        return this.simulator.createGroup(params);
      case 'GetGroup':
        return this.simulator.getGroup(params);
      case 'DeleteGroup':
        return this.simulator.deleteGroup(params);
      case 'AddUserToGroup':
        return this.simulator.addUserToGroup(params);
      case 'RemoveUserFromGroup':
        return this.simulator.removeUserFromGroup(params);
      case 'ListGroupsForUser':
        return this.simulator.listGroupsForUser(params);
      case 'ListGroups':
        return this.simulator.listGroups(params);
      // Role Management
      case 'CreateRole':
        return this.simulator.createRole(params);
      case 'GetRole':
        return this.simulator.getRole(params);
      case 'ListRoles':
        return this.simulator.listRoles(params);
      case 'DeleteRole':
        return this.simulator.deleteRole(params);
      // Policy Management
      case 'CreatePolicy':
        return this.simulator.createPolicy(params);
      case 'GetPolicy':
        return this.simulator.getPolicy(params);
      case 'GetPolicyVersion':
        return this.simulator.getPolicyVersion(params);
      case 'ListPolicies':
        return this.simulator.listPolicies(params);
      case 'DeletePolicy':
        return this.simulator.deletePolicy(params);
      // Policy Attach/Detach
      case 'AttachUserPolicy':
        return this.simulator.attachUserPolicy(params);
      case 'AttachGroupPolicy':
        return this.simulator.attachGroupPolicy(params);
      case 'AttachRolePolicy':
        return this.simulator.attachRolePolicy(params);
      case 'DetachUserPolicy':
        return this.simulator.detachUserPolicy(params);
      case 'DetachGroupPolicy':
        return this.simulator.detachGroupPolicy(params);
      case 'DetachRolePolicy':
        return this.simulator.detachRolePolicy(params);
      // Attached Policy Listing
      case 'ListAttachedUserPolicies':
        return this.simulator.listAttachedUserPolicies(params);
      case 'ListAttachedGroupPolicies':
        return this.simulator.listAttachedGroupPolicies(params);
      case 'ListAttachedRolePolicies':
        return this.simulator.listAttachedRolePolicies(params);
      // Account
      case 'GetAccountSummary':
        return this.simulator.getAccountSummary(params);
      default:
        const err = new Error(`Unsupported IAM action: ${action}`);
        err.code = 'InvalidAction';
        err.statusCode = 400;
        throw err;
    }
  }

  _handleError(res, err) {
    const code = err.code || 'InternalFailure';
    const message = err.message || 'An internal error occurred';
    const statusCode = err.statusCode || 500;
    this.logger.error(`IAM Error [${code}]: ${message}`);
    this._xmlError(res, code, message, statusCode);
  }

  _xmlResponse(res, action, result) {
    const requestId = crypto.randomUUID();
    let resultXml = '';

    if (result && typeof result === 'object') {
      resultXml = this._objectToXml(result);
    }

    const xml = `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/">` +
      `<${action}Result>${resultXml}</${action}Result>` +
      `<ResponseMetadata><RequestId>${requestId}</RequestId></ResponseMetadata>` +
      `</${action}Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(xml);
  }

  _xmlError(res, code, message, statusCode = 400) {
    const requestId = crypto.randomUUID();

    const xml = `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">` +
      `<Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error>` +
      `<RequestId>${requestId}</RequestId>` +
      `</ErrorResponse>`;

    res.status(statusCode).set('Content-Type', 'text/xml').send(xml);
  }

  _objectToXml(obj) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object') return String(obj);

    const SINGULAR_MAP = {
      'Groups': 'Group',
      'Users': 'User',
      'Roles': 'Role',
      'Policies': 'Policy',
      'AccessKeyMetadata': 'member',
      'AttachedPolicies': 'member'
    };

    const MAP_KEYS = new Set(['SummaryMap']);

    let xml = '';
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        const itemTag = SINGULAR_MAP[key] || 'member';
        xml += `<${key}>`;
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            xml += `<${itemTag}>${this._objectToXml(item)}</${itemTag}>`;
          } else {
            xml += `<${itemTag}>${this._escapeXml(String(item))}</${itemTag}>`;
          }
        }
        xml += `</${key}>`;
      } else if (MAP_KEYS.has(key) && typeof value === 'object' && value !== null) {
        xml += `<${key}>`;
        for (const [mapKey, mapValue] of Object.entries(value)) {
          xml += `<entry><key>${this._escapeXml(String(mapKey))}</key><value>${this._escapeXml(String(mapValue))}</value></entry>`;
        }
        xml += `</${key}>`;
      } else if (typeof value === 'object' && value !== null) {
        xml += `<${key}>${this._objectToXml(value)}</${key}>`;
      } else {
        xml += `<${key}>${this._escapeXml(String(value))}</${key}>`;
      }
    }
    return xml;
  }

  _escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  getApp() {
    return this.app;
  }
}

module.exports = IAMServer;
