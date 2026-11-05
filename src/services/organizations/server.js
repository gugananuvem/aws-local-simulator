/**
 * AWS Organizations & Control Tower Server - REST API
 *
 * Protocolo: AWS JSON 1.1 (mesmo das demais APIs JSON do simulador).
 *   POST /  com header `X-Amz-Target: AWSOrganizationsV20161128.<Action>`
 *   Content-Type: application/x-amz-json-1.1
 *
 * As respostas usam PascalCase (nomes do modelo do AWS), para que o AWS CLI e o
 * AWS SDK interpretem corretamente — o mesmo cuidado aplicado na correção do IAM.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const logger = require('../../utils/logger');

/** Converte timestamp ISO/epoch em epoch seconds (formato do AWS JSON). */
function toEpoch(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : Math.floor(date.getTime() / 1000);
}

/** Remove chaves undefined para manter a resposta limpa. */
function compact(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const serializers = {
  organization(org) {
    return compact({
      Id: org.Id,
      Arn: org.Arn,
      FeatureSet: org.FeatureSet,
      MasterAccountArn: org.MasterAccountArn,
      MasterAccountId: org.MasterAccountId,
      MasterAccountEmail: org.MasterAccountEmail,
      AvailablePolicyTypes: [{ Type: 'SERVICE_CONTROL_POLICY', Status: 'ENABLED' }]
    });
  },

  root(root) {
    return compact({ Id: root.Id, Arn: root.Arn, Name: root.Name, PolicyTypes: root.PolicyTypes });
  },

  account(account) {
    return compact({
      Id: account.id,
      Arn: account.arn,
      Email: account.email,
      Name: account.name,
      Status: account.status,
      State: account.status === 'ACTIVE' ? 'ACTIVE' : account.status,
      JoinedMethod: account.joinedMethod,
      JoinedTimestamp: toEpoch(account.createdAt)
    });
  },

  organizationalUnit(ou) {
    return compact({ Id: ou.id, Arn: ou.arn, Name: ou.name });
  },

  createAccountStatus(status) {
    return compact({
      Id: status.Id,
      AccountName: status.AccountName,
      State: status.State,
      RequestedTimestamp: toEpoch(status.RequestedTimestamp),
      CompletedTimestamp: toEpoch(status.CompletedTimestamp),
      AccountId: status.AccountId,
      FailureReason: status.FailureReason
    });
  },

  policySummary(policy) {
    return compact({
      Id: policy.id,
      Arn: policy.arn,
      Name: policy.name,
      Type: policy.type,
      AwsManaged: false,
      Description: policy.description || ''
    });
  },

  serviceAccess(entry) {
    return compact({
      ServicePrincipal: entry.ServicePrincipal,
      DateEnabled: toEpoch(entry.DateEnabled)
    });
  }
};

class OrganizationsServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.organizationsSimulator = null;
    this.controlTowerSimulator = null;
    this.server = null;
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    this.app.use(cors());
    // O AWS CLI/SDK envia application/x-amz-json-1.1; sem esta lista o body não
    // seria parseado e as ações com parâmetros falhariam.
    this.app.use(express.json({
      limit: '10mb',
      type: ['application/json', 'application/x-amz-json-1.1']
    }));

    this.app.use((req, res, next) => {
      const target = req.headers['x-amz-target'];
      if (target) {
        const [, action] = target.split('.');
        req.action = action;
      }

      logger.debug(`Organizations: ${req.method} ${req.path} - Action: ${req.action || 'none'}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando Organizations Server na porta ${this.port}`);
    this.setupRoutes();
  }

  setupRoutes() {
    // ========== API AWS (AWS JSON 1.1) ==========
    this.app.post('/', (req, res) => {
      const action = req.action || req.body?.Action;

      if (!action) {
        return this._jsonError(res, 'MissingAction', 'The request must contain an Action', 400);
      }

      try {
        const result = this._handleAction(action, req.body || {});
        this._jsonResponse(res, result);
      } catch (error) {
        this._handleError(res, error, action);
      }
    });

    // ========== API deAdmin (dashboard) ==========
    this.setupAdminRoutes();

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'organizations',
        port: this.port,
        stats: {
          organizations: this.organizationsSimulator?.getStats(),
          controlTower: this.controlTowerSimulator?.getStats()
        }
      });
    });
  }

  setupAdminRoutes() {
    this.app.get('/__admin/health', (req, res) => {
      res.json({ status: 'ok', service: 'organizations' });
    });

    // Organização (detalhes + estatísticas) — tela de Settings
    this.app.get('/__admin/organization', (req, res) => {
      try {
        const { Organization: org } = this.organizationsSimulator.describeOrganization();
        const accounts = this.organizationsSimulator.listAccounts().Accounts;
        res.json({
          organization: serializers.organization(org),
          stats: this.organizationsSimulator.getStats(),
          managementAccount: {
            Id: accounts.find(a => a.type === 'MASTER')?.id || org.MasterAccountId,
            Name: accounts.find(a => a.type === 'MASTER')?.name || org.MasterAccountName,
            Email: accounts.find(a => a.type === 'MASTER')?.email || org.MasterAccountEmail,
            Arn: org.MasterAccountArn
          }
        });
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.get('/__admin/accounts', (req, res) => {
      try {
        const accounts = this.organizationsSimulator.listAccounts().Accounts;
        res.json(accounts.map((account) => ({ ...serializers.account(account), ParentId: account.parentId })));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/accounts/create', (req, res) => {
      const { AccountName, Email, RoleName, ParentId, Tags } = req.body || {};
      if (!Email) return res.status(400).json({ message: 'Email is required' });
      if (!AccountName) return res.status(400).json({ message: 'AccountName is required' });

      try {
        const result = this.organizationsSimulator.createAccount(Email, AccountName, {
          parentOUId: ParentId,
          roleName: RoleName,
          tags: Tags
        });
        const status = serializers.createAccountStatus(result.CreateAccountStatus);
        const account = this.organizationsSimulator
          .describeAccount(status.AccountId).Account;
        res.status(201).json({
          ...status,
          Account: { ...serializers.account(account), ParentId: account.parentId }
        });
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.delete('/__admin/accounts/:id', (req, res) => {
      try {
        this.organizationsSimulator.removeAccountFromOrganization(req.params.id);
        res.json({ success: true });
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/accounts/move', (req, res) => {
      const { AccountId, SourceParentId, DestinationParentId } = req.body || {};
      if (!AccountId) return res.status(400).json({ message: 'AccountId is required' });
      if (!DestinationParentId) return res.status(400).json({ message: 'DestinationParentId is required' });

      try {
        this.organizationsSimulator.moveAccount(AccountId, SourceParentId, DestinationParentId);
        res.json({ success: true });
      } catch (err) {
        this._adminError(res, err);
      }
    });

    // OUs — supporting da árvore de contas
    this.app.get('/__admin/organizational-units', (req, res) => {
      try {
        const ous = Array.from(this.organizationsSimulator.organization.ous.values());
        res.json(ous.map(serializerWithChildren));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/organizational-units/create', (req, res) => {
      const { ParentId, Name } = req.body || {};
      if (!Name) return res.status(400).json({ message: 'Name is required' });
      if (!ParentId) return res.status(400).json({ message: 'ParentId is required' });

      try {
        const { OrganizationalUnit } = this.organizationsSimulator.createOrganizationalUnit(ParentId, Name);
        res.status(201).json(serializerWithChildren(OrganizationalUnit));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.delete('/__admin/organizational-units/:id', (req, res) => {
      try {
        this.organizationsSimulator.deleteOrganizationalUnit(req.params.id);
        res.json({ success: true });
      } catch (err) {
        this._adminError(res, err);
      }
    });

    // Convites — tela de Invitations
    this.app.get('/__admin/invitations', (req, res) => {
      try {
        res.json(this.organizationsSimulator.listInvitations().Handshakes);
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/invitations', (req, res) => {
      const { Email, AccountId, Message } = req.body || {};
      if (!Email) return res.status(400).json({ message: 'Email is required' });

      try {
        const { Handshake } = this.organizationsSimulator.inviteAccount(Email, {
          accountId: AccountId,
          message: Message
        });
        res.status(201).json(Handshake);
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.delete('/__admin/invitations/:id', (req, res) => {
      try {
        const { Handshake } = this.organizationsSimulator.cancelInvitation(req.params.id);
        res.json(Handshake);
      } catch (err) {
        this._adminError(res, err);
      }
    });

    // Policies — leitura para a tela de Policies
    this.app.get('/__admin/policies', (req, res) => {
      try {
        const { Policies } = this.organizationsSimulator.listPolicies();
        res.json(Policies.map(p => serializers.policySummary(p.PolicySummary)));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    // Policy types — status (Enabled/Disabled) exibido na tela de Policies
    this.app.get('/__admin/policy-types', (req, res) => {
      try {
        res.json(this.organizationsSimulator.listPolicyTypes().PolicyTypes);
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/policy-types/enable', (req, res) => {
      const { PolicyType } = req.body || {};
      if (!PolicyType) return res.status(400).json({ message: 'PolicyType is required' });

      try {
        res.json(this.organizationsSimulator.enablePolicyType(PolicyType));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/policy-types/disable', (req, res) => {
      const { PolicyType } = req.body || {};
      if (!PolicyType) return res.status(400).json({ message: 'PolicyType is required' });

      try {
        res.json(this.organizationsSimulator.disablePolicyType(PolicyType));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    // Serviços integrados (trusted access) — tela de Services
    this.app.get('/__admin/service-access', (req, res) => {
      try {
        // ISO para o dashboard formatar no fuso local.
        res.json(this.organizationsSimulator.organization.listServiceAccess());
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/service-access/enable', (req, res) => {
      const { ServicePrincipal } = req.body || {};
      if (!ServicePrincipal) return res.status(400).json({ message: 'ServicePrincipal is required' });

      try {
        res.json(this.organizationsSimulator.enableServiceAccess(ServicePrincipal));
      } catch (err) {
        this._adminError(res, err);
      }
    });

    this.app.post('/__admin/service-access/disable', (req, res) => {
      const { ServicePrincipal } = req.body || {};
      if (!ServicePrincipal) return res.status(400).json({ message: 'ServicePrincipal is required' });

      try {
        res.json(this.organizationsSimulator.disableServiceAccess(ServicePrincipal));
      } catch (err) {
        this._adminError(res, err);
      }
    });
  }

  // ========== Ações AWS ==========

  /** Valida a existência de uma conta, com o exception type do AWS. */
  _requireAccount(accountId) {
    const account = this.organizationsSimulator.organization.getAccount(accountId);
    if (!account) {
      throw this._awsError('AccountNotFoundException', `Account '${accountId}' not found`, 400);
    }
    return account;
  }

  /** Valida a existência de uma OU, com o exception type do AWS. */
  _requireOu(ouId) {
    const ou = this.organizationsSimulator.organization.getOrganizationalUnit(ouId);
    if (!ou) {
      throw this._awsError('OrganizationalUnitNotFoundException', `Organizational unit '${ouId}' not found`, 400);
    }
    return ou;
  }

  /** Valida a existência de uma policy. */
  _requirePolicy(policyId) {
    const policy = this.organizationsSimulator.organization.getPolicy(policyId);
    if (!policy) {
      throw this._awsError('PolicyNotFoundException', `Policy '${policyId}' not found`, 400);
    }
    return { Policy: { PolicySummary: policy, Content: JSON.stringify(policy.document) } };
  }

  /** Valida a existência de um convite. */
  _requireInvitation(handshakeId) {
    const invitation = this.organizationsSimulator.invitations.get(handshakeId);
    if (!invitation) {
      throw this._awsError('HandshakeNotFoundException', `Handshake '${handshakeId}' not found`, 400);
    }
    return invitation;
  }

  _handleAction(action, body) {
    const sim = this.organizationsSimulator;

    switch (action) {
      // Organização / Roots
      case 'DescribeOrganization':
        return {
          Organization: serializers.organization(sim.describeOrganization().Organization)
        };

      case 'ListRoots':
        return { Roots: sim.listRoots().Roots.map(serializers.root) };

      // Organizational Units
      case 'CreateOrganizationalUnit':
        if (!body.Name) {
          throw this._awsError('InvalidInputException', 'You must specify a name for the organizational unit', 400);
        }
        this._requireOu(body.ParentId);
        return {
          OrganizationalUnit: serializers.organizationalUnit(
            sim.createOrganizationalUnit(body.ParentId, body.Name).OrganizationalUnit
          )
        };

      case 'DescribeOrganizationalUnit':
        return {
          OrganizationalUnit: serializers.organizationalUnit(this._requireOu(body.OrganizationalUnitId))
        };

      case 'ListOrganizationalUnitsForParent':
        this._requireOu(body.ParentId);
        return {
          OrganizationalUnits: sim
            .listOrganizationalUnitsForParent(body.ParentId)
            .OrganizationalUnits.map(serializers.organizationalUnit)
        };

      case 'DeleteOrganizationalUnit':
        this._requireOu(body.OrganizationalUnitId);
        try {
          return sim.deleteOrganizationalUnit(body.OrganizationalUnitId);
        } catch (err) {
          throw this._awsError('OrganizationalUnitNotEmptyException', err.message, 400);
        }

      // Contas
      case 'CreateAccount':
        if (!body.Email) {
          throw this._awsError('InvalidInputException', 'You must specify an email for the account', 400);
        }
        if (!body.AccountName) {
          throw this._awsError('InvalidInputException', 'You must specify an account name', 400);
        }
        try {
          return {
            CreateAccountStatus: serializers.createAccountStatus(
              sim.createAccount(body.Email, body.AccountName, { roleName: body.RoleName }).CreateAccountStatus
            )
          };
        } catch (err) {
          throw this._awsError('AccountAlreadyExistsException', err.message, 400);
        }

      case 'ListAccounts':
        return { Accounts: sim.listAccounts().Accounts.map(serializers.account) };

      case 'ListAccountsForParent':
        this._requireOu(body.ParentId);
        return {
          Accounts: sim.listAccountsForParent(body.ParentId).Accounts.map(serializers.account)
        };

      case 'DescribeAccount':
        return { Account: serializers.account(this._requireAccount(body.AccountId)) };

      case 'MoveAccount':
        this._requireAccount(body.AccountId);
        this._requireOu(body.SourceParentId);
        this._requireOu(body.DestinationParentId);
        return sim.moveAccount(body.AccountId, body.SourceParentId, body.DestinationParentId);

      case 'RemoveAccountFromOrganization':
        this._requireAccount(body.AccountId);
        return sim.removeAccountFromOrganization(body.AccountId);

      // Policies
      case 'CreatePolicy': {
        const document = typeof body.Content === 'string' ? JSON.parse(body.Content) : body.Content;
        const { Policy } = sim.createPolicy(body.Name, document, body.Type);
        return {
          Policy: {
            PolicySummary: serializers.policySummary(Policy.PolicySummary),
            Content: Policy.Content
          }
        };
      }

      case 'DescribePolicy': {
        const { Policy } = this._requirePolicy(body.PolicyId);
        return {
          Policy: {
            PolicySummary: serializers.policySummary(Policy.PolicySummary),
            Content: Policy.Content
          }
        };
      }

      case 'ListPolicies':
        return {
          Policies: sim.listPolicies(body.Filter).Policies.map(p => ({
            PolicySummary: serializers.policySummary(p.PolicySummary)
          }))
        };

      case 'DeletePolicy':
        this._requirePolicy(body.PolicyId);
        return sim.deletePolicy(body.PolicyId);

      case 'AttachPolicy':
        this._requirePolicy(body.PolicyId);
        return sim.attachPolicy(body.PolicyId, body.TargetId);

      case 'DetachPolicy':
        this._requirePolicy(body.PolicyId);
        return sim.detachPolicy(body.PolicyId, body.TargetId);

      case 'ListPoliciesForTarget':
        return {
          Policies: sim
            .listPoliciesForTarget(body.TargetId, body.Filter)
            .Policies.map(p => ({ PolicySummary: serializers.policySummary(p.PolicySummary) }))
        };

      case 'EnablePolicyType': {
        if (!body.PolicyType) {
          throw this._awsError('InvalidInputException', 'You must specify a policy type', 400);
        }
        sim.enablePolicyType(body.PolicyType);
        return { Root: serializers.root(sim.getRoot()) };
      }

      case 'DisablePolicyType': {
        if (!body.PolicyType) {
          throw this._awsError('InvalidInputException', 'You must specify a policy type', 400);
        }
        sim.disablePolicyType(body.PolicyType);
        return { Root: serializers.root(sim.getRoot()) };
      }

      // Serviços integrados (trusted access)
      case 'EnableAWSServiceAccess': {
        if (!body.ServicePrincipal) {
          throw this._awsError('InvalidInputException', 'You must specify a service principal', 400);
        }
        sim.enableServiceAccess(body.ServicePrincipal);
        return {};
      }

      case 'DisableAWSServiceAccess': {
        if (!body.ServicePrincipal) {
          throw this._awsError('InvalidInputException', 'You must specify a service principal', 400);
        }
        sim.disableServiceAccess(body.ServicePrincipal);
        return {};
      }

      case 'ListAWSServiceAccessForOrganization':
        return {
          EnabledServicePrincipals: sim
            .listServiceAccess()
            .EnabledServicePrincipals.map(serializers.serviceAccess)
        };

      // Convites
      case 'InviteAccountToOrganization': {
        const target = body.Target?.Id || body.Email;
        if (!target) {
          throw this._awsError('InvalidInputException', 'You must specify a target to invite', 400);
        }
        return {
          Handshake: sim.inviteAccount(target, {
            accountId: body.Target?.Type === 'ACCOUNT' ? body.Target?.Id : undefined,
            message: body.Note
          }).Handshake
        };
      }

      case 'ListHandshakesForOrganization':
        return { Handshakes: sim.listInvitations().Handshakes };

      case 'DescribeHandshake':
        return { Handshake: this._requireInvitation(body.HandshakeId).toHandshake() };

      case 'CancelHandshake': {
        const invitation = this._requireInvitation(body.HandshakeId);
        if (invitation.state !== 'REQUESTED') {
          throw this._awsError(
            'HandshakeConstraintViolationException',
            `Handshake '${invitation.id}' is not in REQUESTED state`,
            400
          );
        }
        return { Handshake: sim.cancelInvitation(invitation.id).Handshake };
      }

      // Avaliação de SCP (uso interno/simulação)
      case 'EvaluateSCPs':
        return sim.evaluateSCPs(body.AccountId, body.Action, body.Resource);

      // Control Tower
      case 'SetupLandingZone':
        return this.controlTowerSimulator.setupLandingZone(body.OrganizationRootId);
      case 'GetLandingZoneStatus':
        return this.controlTowerSimulator.getLandingZoneStatus(body.LandingZoneId);
      case 'ListGuardrails':
        return this.controlTowerSimulator.listGuardrails();
      case 'EnableGuardrail':
        return this.controlTowerSimulator.enableGuardrail(body.GuardrailId, body.TargetOUId);
      case 'DisableGuardrail':
        return this.controlTowerSimulator.disableGuardrail(body.GuardrailId, body.TargetOUId);
      case 'CheckCompliance':
        return this.controlTowerSimulator.checkCompliance(body.AccountId);
      case 'GenerateComplianceReport':
        return this.controlTowerSimulator.generateComplianceReport();

      default:
        throw this._awsError('UnknownActionException', `Unknown action: ${action}`, 400);
    }
  }

  _awsError(code, message, statusCode = 400) {
    const err = new Error(message);
    err.code = code;
    err.statusCode = statusCode;
    return err;
  }

  _handleError(res, err, action) {
    const code = err.code || 'InternalFailureException';
    const statusCode = err.statusCode || 500;
    logger.error(`Organizations Error [${code}] em ${action}: ${err.message}`);
    this._jsonError(res, code, err.message, statusCode);
  }

  _adminError(res, err) {
    const statusCode = err.statusCode || 400;
    logger.error(`Organizations Admin Error: ${err.message}`);
    res.status(statusCode).json({ message: err.message });
  }

  _jsonResponse(res, result) {
    res.set('Content-Type', 'application/x-amz-json-1.1');
    res.send(JSON.stringify(result || {}));
  }

  _jsonError(res, code, message, statusCode = 400) {
    logger.debug(`Organizations erro ${code}: ${message}`);
    res.status(statusCode)
      .set('Content-Type', 'application/x-amz-json-1.1')
      .send(JSON.stringify({
        __type: code,
        message
      }));
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`✅ Organizations Server iniciado na porta ${this.port}`);
          resolve();
        });
      } catch (error) {
        logger.error(`❌ Erro ao iniciar Organizations Server: ${error.message}`);
        reject(error);
      }
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            logger.error(`Erro ao parar Organizations Server: ${err.message}`);
            reject(err);
          } else {
            logger.info('Organizations Server parado');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

/** Serializer de OU para a API de admin (inclui hierarquia). */
function serializerWithChildren(ou) {
  return {
    Id: ou.id,
    Arn: ou.arn,
    Name: ou.name,
    ParentId: ou.parentId,
    Children: ou.children || []
  };
}

module.exports = OrganizationsServer;
