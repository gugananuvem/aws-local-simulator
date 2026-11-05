/**
 * ALB Server - API REST + ELBv2 Query Protocol (AWS CLI)
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');
const { parseAwsQuery } = require('../../utils/aws-query');
const ELBv2ResponseFormatter = require('./elbv2ResponseFormatter');

/**
 * Normaliza listas do Query Protocol (elbv2 usa <Key>.member.N).
 * Aceita tanto `{ Names: { member: ['a'] } }` (qs) quanto chaves planas.
 */
function membersOf(body, key) {
  const container = body ? body[key] : undefined;

  if (container !== undefined && container !== null) {
    const member = container.member !== undefined ? container.member : container;
    if (Array.isArray(member)) return member;
    if (member && typeof member === 'object') return Object.values(member);
    return [member];
  }

  const collected = [];
  const dotted = `${key}.member.`;
  const plain = `${key}.`;
  for (const [k, v] of Object.entries(body || {})) {
    if (k.startsWith(dotted) || k.startsWith(plain)) {
      collected.push(v);
    }
  }
  return collected;
}

class ALBServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.app.use(cors());
    this.simulator = null;
  }

  setupMiddlewares() {
    this.app.use(express.json());
    // O AWS CLI envia o ELBv2 Query Protocol como application/x-www-form-urlencoded
    this.app.use(express.urlencoded({ extended: true, allowDots: true }));
    this.app.use((req, res, next) => {
      if (req.body && req.is('application/x-www-form-urlencoded')) {
        req.body = parseAwsQuery(req.body);
      }
      next();
    });
    this.app.use((req, res, next) => {
      logger.debug(`ALB Request: ${req.method} ${req.path}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando ALB Server na porta ${this.port}`);
    this.setupMiddlewares();
    this.setupRoutes();
    this.setupQueryProtocol();
  }

  setupQueryProtocol() {
    const simulator = this.simulator;

    const sendXml = (res, xmlResponse, status = 200) =>
      res.status(status).set('Content-Type', 'text/xml').send(xmlResponse);

    const sendError = (res, code, message, status = 400) => {
      logger.error(`ALB Query Error [${code}]: ${message}`);
      sendXml(res, ELBv2ResponseFormatter.formatErrorResponse(code, message), status);
    };

    const handlers = {
      DescribeLoadBalancers: (req, res) => {
        try {
          const filters = {};
          const names = membersOf(req.body, 'Names');
          const arns = membersOf(req.body, 'LoadBalancerArns');
          if (names.length) filters.names = names;
          if (arns.length) filters.arns = arns;

          const loadBalancers = simulator.describeLoadBalancers(filters);
          sendXml(res, ELBv2ResponseFormatter.formatDescribeLoadBalancersResponse(loadBalancers));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CreateLoadBalancer: (req, res) => {
        try {
          const name = req.body.Name;
          if (!name) throw new Error('Name is required');

          const scheme = req.body.Scheme || 'internet-facing';
          const loadBalancer = simulator.createLoadBalancer(name, scheme, {
            SubnetIds: membersOf(req.body, 'Subnets'),
            SecurityGroupIds: membersOf(req.body, 'SecurityGroups'),
            Type: req.body.Type,
            IpAddressType: req.body.IpAddressType,
            Tags: []
          });

          sendXml(res, ELBv2ResponseFormatter.formatCreateLoadBalancerResponse(loadBalancer));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteLoadBalancer: (req, res) => {
        try {
          const arn = req.body.LoadBalancerArn;
          if (!arn) throw new Error('LoadBalancerArn is required');
          simulator.deleteLoadBalancer(arn);
          sendXml(res, ELBv2ResponseFormatter.formatDeleteLoadBalancerResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeTargetGroups: (req, res) => {
        try {
          const filters = {};
          const names = membersOf(req.body, 'Names');
          const arns = membersOf(req.body, 'TargetGroupArns');
          if (names.length) filters.names = names;
          if (arns.length) filters.arns = arns;

          let targetGroups = simulator.describeTargetGroups(filters);

          const loadBalancerArn = req.body.LoadBalancerArn;
          let scopedAlb = null;
          if (loadBalancerArn) {
            scopedAlb = simulator.getLoadBalancer(loadBalancerArn);
            const tgArns = (scopedAlb.TargetGroups || []).map(tg => tg.TargetGroupArn);
            targetGroups = targetGroups.filter(tg => tgArns.includes(tg.TargetGroupArn));
          }

          // Anexa os ARNs dos load balancers que usam cada target group
          for (const tg of targetGroups) {
            const owners = Array.from(simulator.loadBalancers.values())
              .filter(alb =>
                (alb.TargetGroups || []).some(t => t.TargetGroupArn === tg.TargetGroupArn)
              )
              .map(alb => alb.LoadBalancerArn);

            if (scopedAlb && !owners.includes(scopedAlb.LoadBalancerArn)) {
              owners.push(scopedAlb.LoadBalancerArn);
            }

            tg.LoadBalancerArns = owners;
          }

          sendXml(res, ELBv2ResponseFormatter.formatDescribeTargetGroupsResponse(targetGroups));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CreateTargetGroup: (req, res) => {
        try {
          const name = req.body.Name;
          if (!name) throw new Error('Name is required');

          const targetGroup = simulator.createTargetGroup(
            name,
            req.body.Protocol || 'HTTP',
            Number(req.body.Port) || 80,
            req.body.VpcId || null,
            {
              TargetType: req.body.TargetType,
              HealthCheckProtocol: req.body.HealthCheckProtocol,
              HealthCheckPath: req.body.HealthCheckPath,
              HealthCheckPort: req.body.HealthCheckPort,
              HealthCheckEnabled: req.body.HealthCheckEnabled
            }
          );

          sendXml(res, ELBv2ResponseFormatter.formatCreateTargetGroupResponse(targetGroup));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteTargetGroup: (req, res) => {
        try {
          const arn = req.body.TargetGroupArn;
          if (!arn) throw new Error('TargetGroupArn is required');
          simulator.deleteTargetGroup(arn);
          sendXml(res, ELBv2ResponseFormatter.formatDeleteTargetGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      RegisterTargets: (req, res) => {
        try {
          const arn = req.body.TargetGroupArn;
          if (!arn) throw new Error('TargetGroupArn is required');

          for (const target of membersOf(req.body, 'Targets')) {
            simulator.registerTarget(arn, target.Id, target.Port ? Number(target.Port) : null);
          }

          sendXml(res, ELBv2ResponseFormatter.formatRegisterTargetsResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeregisterTargets: (req, res) => {
        try {
          const arn = req.body.TargetGroupArn;
          if (!arn) throw new Error('TargetGroupArn is required');

          for (const target of membersOf(req.body, 'Targets')) {
            simulator.deregisterTarget(arn, target.Id, target.Port ? Number(target.Port) : null);
          }

          sendXml(res, ELBv2ResponseFormatter.formatDeregisterTargetsResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeTargetHealth: (req, res) => {
        try {
          const arn = req.body.TargetGroupArn;
          if (!arn) throw new Error('TargetGroupArn is required');
          const health = simulator.describeTargetHealth(arn);
          sendXml(res, ELBv2ResponseFormatter.formatDescribeTargetHealthResponse(health));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CreateListener: (req, res) => {
        try {
          const arn = req.body.LoadBalancerArn;
          if (!arn) throw new Error('LoadBalancerArn is required');

          const actions = membersOf(req.body, 'DefaultActions');
          const targetGroupArn = actions[0] ? actions[0].TargetGroupArn : null;

          const listener = simulator.addListener(
            arn,
            req.body.Protocol || 'HTTP',
            Number(req.body.Port) || 80,
            targetGroupArn
          );

          sendXml(res, ELBv2ResponseFormatter.formatCreateListenerResponse(listener));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeListeners: (req, res) => {
        try {
          const filters = {};
          if (req.body.LoadBalancerArn) filters.albArn = req.body.LoadBalancerArn;
          const listenerArns = membersOf(req.body, 'ListenerArns');
          if (listenerArns.length) filters.listenerArns = listenerArns;

          const listeners = simulator.describeListeners(filters);
          sendXml(res, ELBv2ResponseFormatter.formatDescribeListenersResponse(listeners));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteListener: (req, res) => {
        try {
          const arn = req.body.ListenerArn;
          if (!arn) throw new Error('ListenerArn is required');
          simulator.deleteListener(arn);
          sendXml(res, ELBv2ResponseFormatter.formatDeleteListenerResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      }
    };

    // Catch-all POST / para o ELBv2 Query Protocol (AWS CLI: aws elbv2 ...)
    this.app.post('/', (req, res) => {
      const action = req.body?.Action || '';
      logger.debug(`ALB Query Protocol Action: ${action}`);

      const handler = handlers[action];
      if (!handler) {
        return sendXml(
          res,
          ELBv2ResponseFormatter.formatErrorResponse('InvalidAction', `Unknown Action: ${action}`),
          400
        );
      }

      try {
        return handler(req, res);
      } catch (error) {
        logger.error(`Error handling ALB Query action ${action}: ${error.message}`);
        return sendXml(
          res,
          ELBv2ResponseFormatter.formatErrorResponse('InternalError', error.message),
          500
        );
      }
    });
  }

  setupRoutes() {
    // Create Load Balancer
    this.app.post('/__admin/alb/load-balancers/create', (req, res) => {
      try {
        const { Name, Scheme = 'internet-facing', ...config } = req.body;
        if (!Name) return res.status(400).json({ error: 'Name is required' });

        const alb = this.simulator.createLoadBalancer(Name, Scheme, config);
        res.json({ LoadBalancer: alb.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Load Balancers
    this.app.get('/__admin/alb/load-balancers', (req, res) => {
      try {
        const albs = this.simulator.describeLoadBalancers();
        res.json({ LoadBalancers: albs.map(a => a.toJSON()) });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get Load Balancer
    this.app.get('/__admin/alb/load-balancers/:albArn', (req, res) => {
      try {
        const alb = this.simulator.getLoadBalancer(req.params.albArn);
        res.json({ LoadBalancer: alb.toJSON() });
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Delete Load Balancer
    this.app.delete('/__admin/alb/load-balancers/:albArn', (req, res) => {
      try {
        this.simulator.deleteLoadBalancer(req.params.albArn);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Create Target Group
    this.app.post('/__admin/alb/target-groups/create', (req, res) => {
      try {
        const { Name, Protocol = 'HTTP', Port = 80, VpcId = null, ...config } = req.body;
        if (!Name) return res.status(400).json({ error: 'Name is required' });

        const tg = this.simulator.createTargetGroup(Name, Protocol, Port, VpcId, config);
        res.json({ TargetGroup: tg.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Target Groups
    this.app.get('/__admin/alb/target-groups', (req, res) => {
      try {
        const tgs = this.simulator.describeTargetGroups();
        res.json({ TargetGroups: tgs.map(t => t.toJSON()) });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Register Target
    this.app.post('/__admin/alb/target-groups/:tgArn/register-target', (req, res) => {
      try {
        const { TargetId, Port } = req.body;
        if (!TargetId) return res.status(400).json({ error: 'TargetId is required' });

        const target = this.simulator.registerTarget(req.params.tgArn, TargetId, Port);
        res.json({ Target: target.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Target Health
    this.app.get('/__admin/alb/target-groups/:tgArn/health', (req, res) => {
      try {
        const health = this.simulator.describeTargetHealth(req.params.tgArn);
        res.json(health);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Target Group
    this.app.delete('/__admin/alb/target-groups/:tgArn', (req, res) => {
      try {
        this.simulator.deleteTargetGroup(req.params.tgArn);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Create Listener (usado pelo wizard de criação de Load Balancer)
    this.app.post('/__admin/alb/load-balancers/:albArn/listeners', (req, res) => {
      try {
        const { Protocol = 'HTTP', Port = 80, TargetGroupArn = null } = req.body || {};

        const listener = this.simulator.addListener(
          req.params.albArn,
          Protocol,
          Number(Port) || 80,
          TargetGroupArn
        );

        // Associa o target group ao load balancer para refletir na contagem.
        if (TargetGroupArn) {
          const alb = this.simulator.getLoadBalancer(req.params.albArn);
          const tg = this.simulator.getTargetGroup(TargetGroupArn);
          if (!alb.TargetGroups.some(t => t.TargetGroupArn === tg.TargetGroupArn)) {
            alb.addTargetGroup(tg);
            this.simulator.persistData();
          }
        }

        res.json({ Listener: listener });
      } catch (error) {
        logger.error(`Erro ao criar listener: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Health Check
    this.app.get('/__admin/alb/health', (req, res) => {
      res.json({ status: 'ok', service: 'alb' });
    });

    // Get All Resources
    this.app.get('/__admin/alb/resources', (req, res) => {
      try {
        const resources = this.simulator.getAllResources();
        res.json({
          loadBalancers: resources.loadBalancers.map(a => a.toJSON()),
          targetGroups: resources.targetGroups.map(t => t.toJSON())
        });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`ALB Server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('ALB Server stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = ALBServer;
