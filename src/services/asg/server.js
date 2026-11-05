/**
 * ASG Server - API REST + AutoScaling Query Protocol (AWS CLI)
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');
const { parseAwsQuery } = require('../../utils/aws-query');
const AutoScalingResponseFormatter = require('./autoscalingResponseFormatter');

/**
 * Normaliza listas do Query Protocol (autoscaling usa <Key>.member.N).
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

class ASGServer {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.app.use(cors());
    this.simulator = null;
  }

  setupMiddlewares() {
    this.app.use(express.json());
    // O AWS CLI envia o AutoScaling Query Protocol como application/x-www-form-urlencoded
    this.app.use(express.urlencoded({ extended: true, allowDots: true }));
    this.app.use((req, res, next) => {
      if (req.body && req.is('application/x-www-form-urlencoded')) {
        req.body = parseAwsQuery(req.body);
      }
      next();
    });
    this.app.use((req, res, next) => {
      logger.debug(`ASG Request: ${req.method} ${req.path}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando ASG Server na porta ${this.port}`);
    this.setupMiddlewares();
    this.setupRoutes();
    this.setupQueryProtocol();
  }

  setupQueryProtocol() {
    const simulator = this.simulator;

    const sendXml = (res, xmlResponse, status = 200) =>
      res.status(status).set('Content-Type', 'text/xml').send(xmlResponse);

    const sendError = (res, code, message, status = 400) => {
      logger.error(`ASG Query Error [${code}]: ${message}`);
      sendXml(res, AutoScalingResponseFormatter.formatErrorResponse(code, message), status);
    };

    const findLaunchTemplateByName = (name) =>
      Array.from(simulator.launchTemplates.values()).find(
        lt => lt.LaunchTemplateName === name
      );

    const handlers = {
      // ========== Launch Templates ==========

      CreateLaunchTemplate: (req, res) => {
        try {
          const name = req.body.LaunchTemplateName;
          const data = req.body.LaunchTemplateData || {};
          if (!name) throw new Error('LaunchTemplateName is required');
          if (!data.ImageId) throw new Error('LaunchTemplateData.ImageId is required');

          const launchTemplate = simulator.createLaunchTemplate(
            name,
            data.ImageId,
            data.InstanceType || 't2.micro',
            {
              keyName: data.KeyName,
              securityGroupIds: membersOf(data, 'SecurityGroupIds'),
              userData: data.UserData,
              iamInstanceProfile: data.IamInstanceProfile && data.IamInstanceProfile.Name,
              monitoring: data.Monitoring
            }
          );

          sendXml(
            res,
            AutoScalingResponseFormatter.formatCreateLaunchTemplateResponse(launchTemplate)
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeLaunchTemplates: (req, res) => {
        try {
          const filters = {};
          const names = membersOf(req.body, 'LaunchTemplateNames');
          const ids = membersOf(req.body, 'LaunchTemplateIds');
          if (names.length) filters.names = names;
          if (ids.length) filters.ids = ids;

          const launchTemplates = simulator.describeLaunchTemplates(filters);
          sendXml(
            res,
            AutoScalingResponseFormatter.formatDescribeLaunchTemplatesResponse(launchTemplates)
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteLaunchTemplate: (req, res) => {
        try {
          let templateId = req.body.LaunchTemplateId;
          const templateName = req.body.LaunchTemplateName;
          if (!templateId && templateName) {
            const found = findLaunchTemplateByName(templateName);
            templateId = found && found.LaunchTemplateId;
          }
          if (!templateId) throw new Error('LaunchTemplateId or LaunchTemplateName is required');

          simulator.deleteLaunchTemplate(templateId);
          sendXml(res, AutoScalingResponseFormatter.formatDeleteLaunchTemplateResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ========== Auto Scaling Groups ==========

      CreateAutoScalingGroup: (req, res) => {
        try {
          const name = req.body.AutoScalingGroupName;
          if (!name) throw new Error('AutoScalingGroupName is required');

          const launchTemplate = req.body.LaunchTemplate || {};
          let launchTemplateId = launchTemplate.LaunchTemplateId;
          if (!launchTemplateId && launchTemplate.LaunchTemplateName) {
            const found = findLaunchTemplateByName(launchTemplate.LaunchTemplateName);
            launchTemplateId = found && found.LaunchTemplateId;
          }
          if (!launchTemplateId) {
            throw new Error('LaunchTemplate.LaunchTemplateId or LaunchTemplateName is required');
          }

          const vpcZoneIdentifier = req.body.VPCZoneIdentifier
            ? String(req.body.VPCZoneIdentifier)
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            : [];

          const asg = simulator.createAutoScalingGroup(name, launchTemplateId, {
            minSize: Number(req.body.MinSize) || 0,
            maxSize: Number(req.body.MaxSize) || 0,
            desiredCapacity:
              req.body.DesiredCapacity !== undefined
                ? Number(req.body.DesiredCapacity)
                : Number(req.body.MinSize) || 0,
            vpcZoneIdentifier,
            targetGroupARNs: membersOf(req.body, 'TargetGroupARNs'),
            healthCheckType: req.body.HealthCheckType,
            healthCheckGracePeriod: Number(req.body.HealthCheckGracePeriod) || 300
          });

          logger.debug(`ASG criado via Query Protocol: ${asg.AutoScalingGroupName}`);
          sendXml(res, AutoScalingResponseFormatter.formatCreateAutoScalingGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeAutoScalingGroups: (req, res) => {
        try {
          const filters = {};
          const names = membersOf(req.body, 'AutoScalingGroupNames');
          if (names.length) filters.names = names;

          const autoScalingGroups = simulator.describeAutoScalingGroups(filters);
          sendXml(
            res,
            AutoScalingResponseFormatter.formatDescribeAutoScalingGroupsResponse(autoScalingGroups)
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      UpdateAutoScalingGroup: (req, res) => {
        try {
          const name = req.body.AutoScalingGroupName;
          if (!name) throw new Error('AutoScalingGroupName is required');
          const asg = simulator.getAutoScalingGroup(name);

          if (req.body.MinSize !== undefined) asg.MinSize = Number(req.body.MinSize);
          if (req.body.MaxSize !== undefined) asg.MaxSize = Number(req.body.MaxSize);
          if (req.body.DesiredCapacity !== undefined) {
            simulator.setDesiredCapacity(name, Number(req.body.DesiredCapacity));
          } else {
            simulator.persistData();
          }

          sendXml(res, AutoScalingResponseFormatter.formatUpdateAutoScalingGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteAutoScalingGroup: (req, res) => {
        try {
          const name = req.body.AutoScalingGroupName;
          if (!name) throw new Error('AutoScalingGroupName is required');
          const forceDelete = String(req.body.ForceDelete) === 'true';

          simulator.deleteAutoScalingGroup(name, forceDelete);
          sendXml(res, AutoScalingResponseFormatter.formatDeleteAutoScalingGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      SetDesiredCapacity: (req, res) => {
        try {
          const name = req.body.AutoScalingGroupName;
          if (!name || req.body.DesiredCapacity === undefined) {
            throw new Error('AutoScalingGroupName and DesiredCapacity are required');
          }

          simulator.setDesiredCapacity(name, Number(req.body.DesiredCapacity));
          sendXml(res, AutoScalingResponseFormatter.formatSetDesiredCapacityResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ========== Scaling Policies ==========

      PutScalingPolicy: (req, res) => {
        try {
          const asgName = req.body.AutoScalingGroupName;
          const policyName = req.body.PolicyName;
          if (!asgName || !policyName) {
            throw new Error('AutoScalingGroupName and PolicyName are required');
          }

          const targetTracking = req.body.TargetTrackingConfiguration || {};
          const policy = simulator.attachScalingPolicy(
            asgName,
            policyName,
            req.body.PolicyType || 'TargetTrackingScaling',
            {
              targetValue: targetTracking.TargetValue ? Number(targetTracking.TargetValue) : null,
              predefinedMetricSpecification: targetTracking.PredefinedMetricSpecification
            }
          );

          sendXml(res, AutoScalingResponseFormatter.formatPutScalingPolicyResponse(policy));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribePolicies: (req, res) => {
        try {
          let policies;
          if (req.body.AutoScalingGroupName) {
            policies = simulator.describeScalingPolicies(req.body.AutoScalingGroupName);
          } else {
            policies = Array.from(simulator.scalingPolicies.values());
          }

          const policyNames = membersOf(req.body, 'PolicyNames');
          if (policyNames.length) {
            policies = policies.filter(p => policyNames.includes(p.PolicyName));
          }

          sendXml(res, AutoScalingResponseFormatter.formatDescribePoliciesResponse(policies));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeletePolicy: (req, res) => {
        try {
          const asgName = req.body.AutoScalingGroupName;
          const policyName = req.body.PolicyName;
          if (!asgName || !policyName) {
            throw new Error('AutoScalingGroupName and PolicyName are required');
          }

          simulator.detachScalingPolicy(asgName, policyName);
          sendXml(res, AutoScalingResponseFormatter.formatDeletePolicyResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeScalingActivities: (req, res) => {
        sendXml(res, AutoScalingResponseFormatter.formatDescribeScalingActivitiesResponse());
      }
    };

    // Catch-all POST / para o AutoScaling Query Protocol (AWS CLI: aws autoscaling ...)
    this.app.post('/', (req, res) => {
      const action = req.body?.Action || '';
      logger.debug(`ASG Query Protocol Action: ${action}`);

      const handler = handlers[action];
      if (!handler) {
        return sendXml(
          res,
          AutoScalingResponseFormatter.formatErrorResponse(
            'InvalidAction',
            `Unknown Action: ${action}`
          ),
          400
        );
      }

      try {
        return handler(req, res);
      } catch (error) {
        logger.error(`Error handling ASG Query action ${action}: ${error.message}`);
        return sendXml(
          res,
          AutoScalingResponseFormatter.formatErrorResponse('InternalError', error.message),
          500
        );
      }
    });
  }

  setupRoutes() {
    // ========== Launch Template ==========

    // Create Launch Template
    this.app.post('/__admin/asg/launch-templates/create', (req, res) => {
      try {
        const { Name, ImageId, InstanceType, ...config } = req.body;
        if (!Name || !ImageId || !InstanceType) {
          return res.status(400).json({ error: 'Name, ImageId, and InstanceType are required' });
        }

        const lt = this.simulator.createLaunchTemplate(Name, ImageId, InstanceType, config);
        res.json({ LaunchTemplate: lt.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Launch Templates
    this.app.get('/__admin/asg/launch-templates', (req, res) => {
      try {
        const lts = this.simulator.describeLaunchTemplates();
        res.json({ LaunchTemplates: lts.map(lt => lt.toJSON()) });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get Launch Template
    this.app.get('/__admin/asg/launch-templates/:templateId', (req, res) => {
      try {
        const lt = this.simulator.getLaunchTemplate(req.params.templateId);
        res.json({ LaunchTemplate: lt.toJSON() });
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Delete Launch Template
    this.app.delete('/__admin/asg/launch-templates/:templateId', (req, res) => {
      try {
        this.simulator.deleteLaunchTemplate(req.params.templateId);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Auto Scaling Group ==========

    // Create Auto Scaling Group
    this.app.post('/__admin/asg/auto-scaling-groups/create', (req, res) => {
      try {
        const { AutoScalingGroupName, LaunchTemplateId, ...config } = req.body;
        if (!AutoScalingGroupName || !LaunchTemplateId) {
          return res.status(400).json({
            error: 'AutoScalingGroupName and LaunchTemplateId are required'
          });
        }

        const asg = this.simulator.createAutoScalingGroup(AutoScalingGroupName, LaunchTemplateId, config);
        res.json({ AutoScalingGroup: asg.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Auto Scaling Groups
    this.app.get('/__admin/asg/auto-scaling-groups', (req, res) => {
      try {
        const asgs = this.simulator.describeAutoScalingGroups();
        res.json({ AutoScalingGroups: asgs.map(asg => asg.toJSON()) });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Get Auto Scaling Group
    this.app.get('/__admin/asg/auto-scaling-groups/:name', (req, res) => {
      try {
        const asg = this.simulator.getAutoScalingGroup(req.params.name);
        res.json({ AutoScalingGroup: asg.toJSON() });
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Delete Auto Scaling Group
    this.app.delete('/__admin/asg/auto-scaling-groups/:name', (req, res) => {
      try {
        const forceDelete = req.query.forceDelete === 'true';
        this.simulator.deleteAutoScalingGroup(req.params.name, forceDelete);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Scaling Operations ==========

    // Set Desired Capacity
    this.app.put('/__admin/asg/auto-scaling-groups/:name/desired-capacity', (req, res) => {
      try {
        const { DesiredCapacity } = req.body;
        if (DesiredCapacity === undefined) {
          return res.status(400).json({ error: 'DesiredCapacity is required' });
        }

        const asg = this.simulator.setDesiredCapacity(req.params.name, DesiredCapacity);
        res.json({ AutoScalingGroup: asg.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Scaling Policies ==========

    // Attach Scaling Policy
    this.app.post('/__admin/asg/auto-scaling-groups/:name/scaling-policies', (req, res) => {
      try {
        const { PolicyName, PolicyType, ...config } = req.body;
        if (!PolicyName || !PolicyType) {
          return res.status(400).json({ error: 'PolicyName and PolicyType are required' });
        }

        const policy = this.simulator.attachScalingPolicy(req.params.name, PolicyName, PolicyType, config);
        res.json({ ScalingPolicy: policy.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Scaling Policies
    this.app.get('/__admin/asg/auto-scaling-groups/:name/scaling-policies', (req, res) => {
      try {
        const policies = this.simulator.describeScalingPolicies(req.params.name);
        res.json({ ScalingPolicies: policies.map(p => p.toJSON()) });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Detach Scaling Policy
    this.app.delete('/__admin/asg/auto-scaling-groups/:name/scaling-policies/:policyName', (req, res) => {
      try {
        this.simulator.detachScalingPolicy(req.params.name, req.params.policyName);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Evaluate Scaling Policies (manual trigger)
    this.app.post('/__admin/asg/auto-scaling-groups/:name/evaluate-policies', (req, res) => {
      try {
        this.simulator.evaluateScalingPolicies(req.params.name);
        const asg = this.simulator.getAutoScalingGroup(req.params.name);
        res.json({ AutoScalingGroup: asg.toJSON() });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Health & Admin ==========

    // Health Check
    this.app.get('/__admin/asg/health', (req, res) => {
      res.json({ status: 'ok', service: 'asg' });
    });

    // Get All Resources
    this.app.get('/__admin/asg/resources', (req, res) => {
      try {
        const resources = this.simulator.getAllResources();
        res.json({
          autoScalingGroups: resources.autoScalingGroups.map(a => a.toJSON()),
          launchTemplates: resources.launchTemplates.map(lt => lt.toJSON()),
          scalingPolicies: resources.scalingPolicies.map(p => p.toJSON())
        });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`ASG Server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('ASG Server stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = ASGServer;
