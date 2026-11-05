const { setupServiceMiddleware } = require('../../middleware');
/**
 * EC2 Server - API REST + EC2 Query Protocol (AWS CLI)
 *
 * Desde a fusão, este serviço também responde pelas ações de VPC
 * (VPC não é um serviço AWS separado — suas ações vivem na API do EC2).
 */

const express = require('express');
const cors = require('cors');
const logger = require('../../utils/logger');
const { parseAwsQuery } = require('../../utils/aws-query');
const EC2ResponseFormatter = require('./xmlResponseFormatter');
const { setupVpcAdminRoutes, createVpcQueryHandlers } = require('./vpc/vpcRoutes');

/**
 * Extrai uma lista do body no formato do Query Protocol.
 */
function collectList(body, key) {
  if (!body) return undefined;

  const direct = body[key];
  if (Array.isArray(direct)) return direct;
  if (typeof direct === 'string') return [direct];

  const collected = [];
  const prefix = `${key}.`;
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith(prefix)) {
      if (Array.isArray(v)) collected.push(...v);
      else collected.push(v);
    }
  }
  return collected.length > 0 ? collected : undefined;
}

/**
 * Normaliza os filtros do AWS CLI (Filter.1.Name / Filter.1.Value.1) num objeto simples.
 */
function normalizeFilters(body) {
  const raw = body?.Filter;
  const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
  const result = {};

  for (const filter of list) {
    if (!filter || !filter.Name) continue;
    let values = filter.Value;
    if (values === undefined) values = [];
    else if (!Array.isArray(values)) {
      values = typeof values === 'object' ? Object.values(values) : [values];
    }
    result[filter.Name] = values;
  }

  return result;
}

/**
 * Extrai TagSpecifications do Query Protocol para um resourceType.
 */
function extractTags(body, resourceType) {
  const tags = [];
  const specs = body?.TagSpecification;
  const list = Array.isArray(specs) ? specs : specs ? [specs] : [];

  for (const spec of list) {
    if (resourceType && spec.ResourceType && spec.ResourceType !== resourceType) continue;
    const specTags = spec.Tag;
    const arr = Array.isArray(specTags) ? specTags : specTags ? [specTags] : [];
    for (const tag of arr) {
      if (tag.Key) tags.push({ Key: tag.Key, Value: tag.Value || '' });
    }
  }

  return tags;
}

/**
 * Converte um valor (único ou lista) em array.
 */
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Converte valores do Query Protocol em booleano/número.
 */
function toBool(value) {
  return value === true || value === 'true';
}

function toNumber(value) {
  return value !== undefined && value !== null && value !== '' ? Number(value) : undefined;
}

/**
 * Normaliza o LaunchTemplateData recebido do Query Protocol (AWS CLI) para o
 * formato camelCase interno usado pelo modelo.
 */
function normalizeLaunchTemplateData(raw = {}) {
  const data = {};
  if (!raw || typeof raw !== 'object') return data;

  if (raw.ImageId) data.ImageId = raw.ImageId;
  if (raw.InstanceType) data.InstanceType = raw.InstanceType;
  if (raw.KeyName) data.KeyName = raw.KeyName;
  if (raw.UserData) data.UserData = raw.UserData;

  const sgIds = collectList(raw, 'SecurityGroupId');
  if (sgIds) data.SecurityGroupIds = sgIds;

  if (raw.IamInstanceProfile && (raw.IamInstanceProfile.Arn || raw.IamInstanceProfile.Name)) {
    data.IamInstanceProfile = {
      Arn: raw.IamInstanceProfile.Arn,
      Name: raw.IamInstanceProfile.Name
    };
  }

  if (raw.Monitoring) {
    data.Monitoring = { Enabled: toBool(raw.Monitoring.Enabled) };
  }

  if (raw.Placement && raw.Placement.AvailabilityZone) {
    data.Placement = { AvailabilityZone: raw.Placement.AvailabilityZone };
  }

  if (raw.CreditSpecification && raw.CreditSpecification.CpuCredits) {
    data.CreditSpecification = { CpuCredits: raw.CreditSpecification.CpuCredits };
  }

  if (raw.InstanceInitiatedShutdownBehavior) {
    data.ShutdownBehavior = raw.InstanceInitiatedShutdownBehavior;
  }

  if (raw.MetadataOptions) data.MetadataOptions = raw.MetadataOptions;

  const blockDevices = toArray(raw.BlockDeviceMapping);
  if (blockDevices.length > 0) {
    data.BlockDeviceMappings = blockDevices.map(item => ({
      DeviceName: item.DeviceName,
      Ebs: item.Ebs
        ? {
            VolumeSize: toNumber(item.Ebs.VolumeSize),
            VolumeType: item.Ebs.VolumeType,
            DeleteOnTermination: toBool(item.Ebs.DeleteOnTermination),
            Encrypted: toBool(item.Ebs.Encrypted),
            Iops: toNumber(item.Ebs.Iops),
            Throughput: toNumber(item.Ebs.Throughput)
          }
        : undefined
    }));
  }

  const networkInterfaces = toArray(raw.NetworkInterface);
  if (networkInterfaces.length > 0) {
    data.NetworkInterfaces = networkInterfaces.map(ni => ({
      DeviceIndex: toNumber(ni.DeviceIndex),
      SubnetId: ni.SubnetId,
      Description: ni.Description,
      Groups: collectList(ni, 'SecurityGroupId') || [],
      AssociatePublicIpAddress: toBool(ni.AssociatePublicIpAddress)
    }));
  }

  const tagSpecs = toArray(raw.TagSpecification);
  if (tagSpecs.length > 0) {
    data.TagSpecifications = tagSpecs.map(spec => ({
      ResourceType: spec.ResourceType,
      Tags: toArray(spec.Tag).map(t => ({ Key: t.Key, Value: t.Value || '' }))
    }));
  }

  return data;
}

/**
 * Normaliza regras de ingress recebidas do Query Protocol.
 * Suporta tanto a forma "flat" (--protocol/--port/--cidr) quanto --ip-permissions.
 */
function collectIpPermissions(body) {
  const permissions = [];

  if (body && body.IpPermissions) {
    const list = Array.isArray(body.IpPermissions) ? body.IpPermissions : [body.IpPermissions];

    for (const perm of list) {
      const ipProtocol = perm.IpProtocol !== undefined ? String(perm.IpProtocol) : 'tcp';
      const fromPort = perm.FromPort !== undefined ? Number(perm.FromPort) : -1;
      const toPort = perm.ToPort !== undefined ? Number(perm.ToPort) : -1;

      const ipRanges = perm.IpRanges
        ? Array.isArray(perm.IpRanges)
          ? perm.IpRanges
          : [perm.IpRanges]
        : [];
      const groupPairs = perm.UserIdGroupPairs
        ? Array.isArray(perm.UserIdGroupPairs)
          ? perm.UserIdGroupPairs
          : [perm.UserIdGroupPairs]
        : [];

      if (ipRanges.length === 0 && groupPairs.length === 0) {
        permissions.push({ IpProtocol: ipProtocol, FromPort: fromPort, ToPort: toPort });
      }

      for (const range of ipRanges) {
        permissions.push({
          IpProtocol: ipProtocol,
          FromPort: fromPort,
          ToPort: toPort,
          CidrIp: range.CidrIp,
          Description: range.Description || ''
        });
      }

      for (const pair of groupPairs) {
        permissions.push({
          IpProtocol: ipProtocol,
          FromPort: fromPort,
          ToPort: toPort,
          SecurityGroupId: pair.GroupId,
          Description: pair.Description || ''
        });
      }
    }

    return permissions;
  }

  // Forma "flat": aws ec2 authorize-security-group-ingress --protocol tcp --port 22 --cidr 0.0.0.0/0
  permissions.push({
    IpProtocol: body.IpProtocol !== undefined ? String(body.IpProtocol) : 'tcp',
    FromPort: body.FromPort !== undefined ? Number(body.FromPort) : -1,
    ToPort: body.ToPort !== undefined ? Number(body.ToPort) : -1,
    CidrIp: body.CidrIp,
    SecurityGroupId: body.SourceSecurityGroupId || body.SourceSecurityGroupName,
    Description: ''
  });

  return permissions;
}

/**
 * Verifica se uma regra de ingress existente corresponde a uma especificação.
 */
function ingressRuleMatches(rule, spec) {
  const sameProtocol = String(rule.IpProtocol) === String(spec.IpProtocol);
  const sameFrom = Number(rule.FromPort) === Number(spec.FromPort);
  const sameTo = Number(rule.ToPort) === Number(spec.ToPort);
  const cidrOk = !spec.CidrIp || (rule.IpRanges || []).some(r => r.CidrIp === spec.CidrIp);
  const groupOk =
    !spec.SecurityGroupId ||
    (rule.UserIdGroupPairs || []).some(p => p.GroupId === spec.SecurityGroupId);

  return sameProtocol && sameFrom && sameTo && cidrOk && groupOk;
}

class EC2Server {
  constructor(port, config) {
    this.organizationsService = null;
    this.stsService = null;
    this.port = port;
    this.config = config;
    this.app = express();
    this.simulator = null;
    this.vpcSimulator = null;
  }

  setupMiddlewares() {
    this.app.use(cors());
    this.app.use(express.json());
    // O AWS CLI envia o EC2 Query Protocol como application/x-www-form-urlencoded
    this.app.use(express.urlencoded({ extended: true, allowDots: true }));
    this.app.use((req, res, next) => {
      if (req.body && req.is('application/x-www-form-urlencoded')) {
        req.body = parseAwsQuery(req.body);
      }
      next();
    });
    this.app.use((req, res, next) => {
      logger.debug(`EC2 Request: ${req.method} ${req.path}`);
      next();
    });
  }

  async initialize() {
    logger.debug(`Inicializando EC2 Server na porta ${this.port}`);
    this.setupMiddlewares();
    this.setupRoutes();
    setupVpcAdminRoutes(this.app, this.vpcSimulator);
    this.setupQueryProtocol();
  }

  setupQueryProtocol() {
    const vpcHandlers = this.vpcSimulator ? createVpcQueryHandlers(this.vpcSimulator) : {};
    const ec2Handlers = this.createEc2QueryHandlers();

    // Catch-all POST / para o EC2 Query Protocol (AWS CLI)
    this.app.post('/', (req, res) => {
      const action = req.body?.Action || '';
      logger.debug(`EC2 Query Protocol Action: ${action}`);

      const handler = ec2Handlers[action] || vpcHandlers[action];

      if (!handler) {
        const xmlError = EC2ResponseFormatter.formatErrorResponse(
          'InvalidAction',
          `Unknown Action: ${action}`
        );
        return res.status(400).set('Content-Type', 'text/xml').send(xmlError);
      }

      try {
        return handler(req, res);
      } catch (error) {
        logger.error(`Error handling EC2 Query action ${action}: ${error.message}`);
        const xmlError = EC2ResponseFormatter.formatErrorResponse('InternalError', error.message);
        return res.status(500).set('Content-Type', 'text/xml').send(xmlError);
      }
    });
  }

  createEc2QueryHandlers() {
    const sendXml = (res, xml, status = 200) =>
      res.status(status).set('Content-Type', 'text/xml').send(xml);
    const sendError = (res, code, message, status = 400) => {
      logger.error(`EC2 Query Error [${code}]: ${message}`);
      sendXml(res, EC2ResponseFormatter.formatErrorResponse(code, message), status);
    };

    const simulator = this.simulator;

    return {
      DescribeInstances: (req, res) => {
        try {
          const filters = {};
          const instanceIds = collectList(req.body, 'InstanceId');
          if (instanceIds) filters.instanceIds = instanceIds;

          const nf = normalizeFilters(req.body);
          if (nf['instance-id']) filters.instanceIds = nf['instance-id'];
          if (nf['instance-state-name']) filters.state = nf['instance-state-name'][0];
          if (nf['vpc-id']) filters.vpcIds = nf['vpc-id'];

          const instances = simulator.describeInstances(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeInstancesResponse(instances.map(i => i.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      RunInstances: (req, res) => {
        try {
          const {
            ImageId,
            MinCount = 1,
            MaxCount = 1,
            InstanceType,
            KeyName,
            SubnetId,
            VpcId
          } = req.body;

          // Resolve dados do launch template (se informado). Parâmetros
          // explícitos do RunInstances têm prioridade sobre o template.
          const ltRequest = req.body.LaunchTemplate;
          let templateData = {};
          if (ltRequest && (ltRequest.LaunchTemplateId || ltRequest.LaunchTemplateName)) {
            const resolved = simulator.resolveLaunchTemplateData(
              ltRequest.LaunchTemplateId || ltRequest.LaunchTemplateName,
              ltRequest.Version
            );
            templateData = resolved.data || {};
          }

          const resolvedImageId = ImageId || templateData.ImageId;
          if (!resolvedImageId) throw new Error('ImageId is required');

          const securityGroupIds =
            collectList(req.body, 'SecurityGroupId') || templateData.SecurityGroupIds;
          const tags = extractTags(req.body, undefined);

          const instances = simulator.runInstances(
            resolvedImageId,
            Number(MaxCount),
            InstanceType || templateData.InstanceType || 't2.micro',
            {
              KeyName: KeyName || templateData.KeyName,
              SubnetId: SubnetId || templateData.SubnetId,
              VpcId: VpcId || templateData.VpcId,
              SecurityGroupIds: securityGroupIds,
              Tags: tags
            }
          );

          // Iniciar servidores web das instâncias (assíncrono, como na rota admin)
          instances.forEach(instance => {
            simulator
              .startInstanceServer(instance.InstanceId)
              .catch(e =>
                logger.warn(`Não foi possível iniciar servidor web de ${instance.InstanceId}: ${e.message}`)
              );
          });

          sendXml(
            res,
            EC2ResponseFormatter.formatRunInstancesResponse(instances.map(i => i.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      StartInstances: (req, res) => this._instanceStateChange(req, res, 'StartInstances'),
      StopInstances: (req, res) => this._instanceStateChange(req, res, 'StopInstances'),
      TerminateInstances: (req, res) => this._instanceStateChange(req, res, 'TerminateInstances'),
      RebootInstances: (req, res) => this._instanceStateChange(req, res, 'RebootInstances'),

      DescribeImages: (req, res) => {
        try {
          const imageIds = collectList(req.body, 'ImageId');
          const images = simulator.describeImages(imageIds ? { imageIds } : {});
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeImagesResponse(images.map(i => i.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeSecurityGroups: (req, res) => {
        try {
          const filters = {};
          const groupIds = collectList(req.body, 'GroupId');
          const groupNames = collectList(req.body, 'GroupName');
          if (groupIds) filters.groupIds = groupIds;
          if (groupNames) filters.groupNames = groupNames;

          const nf = normalizeFilters(req.body);
          if (nf['group-id']) filters.groupIds = nf['group-id'];
          if (nf['group-name']) filters.groupNames = nf['group-name'];
          if (nf['vpc-id']) filters.vpcIds = nf['vpc-id'];

          const sgs = simulator.describeSecurityGroups(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeSecurityGroupsResponse(sgs.map(sg => sg.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CreateSecurityGroup: (req, res) => {
        try {
          const { GroupName, GroupDescription = '', VpcId } = req.body;
          if (!GroupName) throw new Error('GroupName is required');
          const sg = simulator.createSecurityGroup(GroupName, GroupDescription, VpcId || null);
          sendXml(res, EC2ResponseFormatter.formatCreateSecurityGroupResponse(sg.toJSON()));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteSecurityGroup: (req, res) => {
        try {
          const { GroupId } = req.body;
          if (!GroupId) throw new Error('GroupId is required');
          simulator.deleteSecurityGroup(GroupId);
          sendXml(res, EC2ResponseFormatter.formatDeleteSecurityGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      AuthorizeSecurityGroupIngress: (req, res) => {
        try {
          const { GroupId } = req.body;
          if (!GroupId) throw new Error('GroupId is required');
          const sg = simulator.getSecurityGroup(GroupId);
          const permissions = collectIpPermissions(req.body);

          for (const rule of permissions) {
            sg.addIngressRule(
              rule.CidrIp,
              rule.SecurityGroupId,
              rule.FromPort,
              rule.ToPort,
              rule.IpProtocol,
              rule.Description
            );
          }

          sendXml(res, EC2ResponseFormatter.formatAuthorizeSecurityGroupIngressResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      RevokeSecurityGroupIngress: (req, res) => {
        try {
          const { GroupId } = req.body;
          if (!GroupId) throw new Error('GroupId is required');
          const sg = simulator.getSecurityGroup(GroupId);
          const permissions = collectIpPermissions(req.body);

          for (const spec of permissions) {
            const index = sg.IpPermissions.findIndex(rule => ingressRuleMatches(rule, spec));
            if (index !== -1) {
              sg.removeIngressRule(index);
            }
          }

          sendXml(res, EC2ResponseFormatter.formatRevokeSecurityGroupIngressResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeNetworkInterfaces: (req, res) => {
        try {
          const filters = {};
          const eniIds = collectList(req.body, 'NetworkInterfaceId');
          if (eniIds) filters.networkInterfaceIds = eniIds;

          const nf = normalizeFilters(req.body);
          if (nf['network-interface-id']) filters.networkInterfaceIds = nf['network-interface-id'];
          if (nf['subnet-id']) filters.subnetIds = nf['subnet-id'];

          const enis = simulator.describeNetworkInterfaces(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeNetworkInterfacesResponse(enis.map(e => e.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ========== EBS Volumes ==========

      CreateVolume: (req, res) => {
        try {
          const {
            AvailabilityZone,
            Size,
            VolumeType,
            Iops,
            Throughput,
            SnapshotId,
            Encrypted,
            MultiAttachEnabled
          } = req.body;

          const config = {
            AvailabilityZone,
            Size: Size !== undefined && Size !== '' ? Number(Size) : undefined,
            VolumeType,
            Iops: Iops !== undefined && Iops !== '' ? Number(Iops) : undefined,
            Throughput: Throughput !== undefined && Throughput !== '' ? Number(Throughput) : undefined,
            SnapshotId: SnapshotId || '',
            Encrypted: Encrypted === 'true' || Encrypted === true,
            MultiAttachEnabled: MultiAttachEnabled === 'true' || MultiAttachEnabled === true,
            Tags: extractTags(req.body, 'volume')
          };

          const volume = simulator.createVolume(config);
          sendXml(res, EC2ResponseFormatter.formatCreateVolumeResponse(volume.toJSON()));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeVolumes: (req, res) => {
        try {
          const filters = {};
          const volumeIds = collectList(req.body, 'VolumeId');
          if (volumeIds) filters.volumeIds = volumeIds;

          const nf = normalizeFilters(req.body);
          if (nf['volume-id']) filters.volumeIds = nf['volume-id'];
          if (nf['status']) filters.status = nf['status'];
          if (nf['volume-type']) filters.volumeType = nf['volume-type'];
          if (nf['snapshot-id']) filters.snapshotId = nf['snapshot-id'][0];
          if (nf['availability-zone']) filters.availabilityZone = nf['availability-zone'][0];
          if (nf['attachment.instance-id']) filters.instanceId = nf['attachment.instance-id'][0];

          const volumes = simulator.describeVolumes(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeVolumesResponse(volumes.map(v => v.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      AttachVolume: (req, res) => {
        try {
          const { VolumeId, InstanceId, Device } = req.body;
          if (!VolumeId || !InstanceId) throw new Error('VolumeId and InstanceId are required');
          const volume = simulator.attachVolume(VolumeId, InstanceId, Device || '/dev/sdf');
          const attachment = volume.Attachments.find(a => a.InstanceId === InstanceId);
          sendXml(res, EC2ResponseFormatter.formatAttachVolumeResponse(attachment));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DetachVolume: (req, res) => {
        try {
          const { VolumeId, InstanceId, Device } = req.body;
          if (!VolumeId) throw new Error('VolumeId is required');
          simulator.detachVolume(VolumeId, InstanceId || null);
          sendXml(
            res,
            EC2ResponseFormatter.formatDetachVolumeResponse({
              VolumeId,
              InstanceId: InstanceId || '',
              Device: Device || '',
              State: 'detached',
              AttachTime: new Date().toISOString(),
              DeleteOnTermination: false
            })
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteVolume: (req, res) => {
        try {
          const { VolumeId } = req.body;
          if (!VolumeId) throw new Error('VolumeId is required');
          simulator.deleteVolume(VolumeId);
          sendXml(res, EC2ResponseFormatter.formatDeleteVolumeResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      ModifyVolume: (req, res) => {
        try {
          const { VolumeId, Size, VolumeType, Iops, Throughput } = req.body;
          if (!VolumeId) throw new Error('VolumeId is required');
          const modification = simulator.modifyVolume(VolumeId, { Size, VolumeType, Iops, Throughput });
          sendXml(res, EC2ResponseFormatter.formatModifyVolumeResponse(modification));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeVolumesModifications: (req, res) => {
        try {
          const filters = {};
          const volumeIds = collectList(req.body, 'VolumeId');
          if (volumeIds) filters.volumeIds = volumeIds;
          const modifications = simulator.describeVolumesModifications(filters);
          sendXml(res, EC2ResponseFormatter.formatDescribeVolumesModificationsResponse(modifications));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeVolumeStatus: (req, res) => {
        try {
          const filters = {};
          const volumeIds = collectList(req.body, 'VolumeId');
          if (volumeIds) filters.volumeIds = volumeIds;
          const volumes = simulator.describeVolumeStatus(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeVolumeStatusResponse(volumes.map(v => v.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ========== EBS Snapshots ==========

      CreateSnapshot: (req, res) => {
        try {
          const { VolumeId, Description } = req.body;
          if (!VolumeId) throw new Error('VolumeId is required');
          const tags = extractTags(req.body, 'snapshot');
          const snapshot = simulator.createSnapshot(VolumeId, Description || '', tags);
          sendXml(res, EC2ResponseFormatter.formatCreateSnapshotResponse(snapshot.toJSON()));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeSnapshots: (req, res) => {
        try {
          const filters = {};
          const snapshotIds = collectList(req.body, 'SnapshotId');
          if (snapshotIds) filters.snapshotIds = snapshotIds;

          const ownerIds = collectList(req.body, 'Owner');
          if (ownerIds) filters.ownerIds = ownerIds;

          const nf = normalizeFilters(req.body);
          if (nf['snapshot-id']) filters.snapshotIds = nf['snapshot-id'];
          if (nf['volume-id']) filters.volumeId = nf['volume-id'][0];
          if (nf['owner-id']) filters.ownerIds = nf['owner-id'];

          const snapshots = simulator.describeSnapshots(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeSnapshotsResponse(snapshots.map(s => s.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteSnapshot: (req, res) => {
        try {
          const { SnapshotId } = req.body;
          if (!SnapshotId) throw new Error('SnapshotId is required');
          simulator.deleteSnapshot(SnapshotId);
          sendXml(res, EC2ResponseFormatter.formatDeleteSnapshotResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ========== Launch Templates ==========

      CreateLaunchTemplate: (req, res) => {
        try {
          const { LaunchTemplateName, VersionDescription } = req.body;
          if (!LaunchTemplateName) throw new Error('LaunchTemplateName is required');
          const data = normalizeLaunchTemplateData(req.body.LaunchTemplateData || {});
          const tags = extractTags(req.body, 'launch-template');
          const template = simulator.createLaunchTemplate({
            LaunchTemplateName,
            VersionDescription,
            LaunchTemplateData: data,
            Tags: tags
          });
          sendXml(
            res,
            EC2ResponseFormatter.formatCreateLaunchTemplateResponse(template.toJSON())
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CreateLaunchTemplateVersion: (req, res) => {
        try {
          const { LaunchTemplateId, LaunchTemplateName, VersionDescription, SetAsDefault } =
            req.body;
          if (!LaunchTemplateId && !LaunchTemplateName) {
            throw new Error('LaunchTemplateId or LaunchTemplateName is required');
          }
          const data = normalizeLaunchTemplateData(req.body.LaunchTemplateData || {});
          const { template, version } = simulator.createLaunchTemplateVersion(
            LaunchTemplateId || LaunchTemplateName,
            {
              LaunchTemplateData: data,
              VersionDescription,
              SetAsDefault: toBool(SetAsDefault)
            }
          );
          sendXml(
            res,
            EC2ResponseFormatter.formatCreateLaunchTemplateVersionResponse(
              template.versionToJSON(version.VersionNumber)
            )
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeLaunchTemplates: (req, res) => {
        try {
          const filters = {};
          const ids = collectList(req.body, 'LaunchTemplateId');
          const names = collectList(req.body, 'LaunchTemplateName');
          if (ids) filters.launchTemplateIds = ids;
          if (names) filters.launchTemplateNames = names;

          const nf = normalizeFilters(req.body);
          if (nf['launch-template-id']) filters.launchTemplateIds = nf['launch-template-id'];
          if (nf['launch-template-name']) filters.launchTemplateNames = nf['launch-template-name'];

          const templates = simulator.describeLaunchTemplates(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeLaunchTemplatesResponse(
              templates.map(t => t.toJSON())
            )
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeLaunchTemplateVersions: (req, res) => {
        try {
          const filters = {};
          const ids = collectList(req.body, 'LaunchTemplateId');
          const names = collectList(req.body, 'LaunchTemplateName');
          const versions = collectList(req.body, 'LaunchTemplateVersion');
          if (ids) filters.launchTemplateId = ids[0];
          if (names) filters.launchTemplateName = names[0];

          const nf = normalizeFilters(req.body);
          if (nf['launch-template-id']) filters.launchTemplateId = nf['launch-template-id'][0];
          if (nf['launch-template-name']) filters.launchTemplateName = nf['launch-template-name'][0];
          if (versions) filters.versions = versions;

          const versionsList = simulator.describeLaunchTemplateVersions(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeLaunchTemplateVersionsResponse(versionsList)
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      GetLaunchTemplateData: (req, res) => {
        try {
          const { InstanceId } = req.body;
          // Na AWS, GetLaunchTemplateData recebe um InstanceId. O simulador não
          // vincula instância↔template, então aceitamos também o template direto.
          const nameOrId = req.body.LaunchTemplateId || req.body.LaunchTemplateName;
          if (!InstanceId && !nameOrId) throw new Error('InstanceId is required');
          if (!nameOrId) throw new Error('Instance does not have a launch template');
          const resolved = simulator.resolveLaunchTemplateData(nameOrId, req.body.Version);
          sendXml(
            res,
            EC2ResponseFormatter.formatGetLaunchTemplateDataResponse(resolved.version)
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteLaunchTemplate: (req, res) => {
        try {
          const nameOrId = req.body.LaunchTemplateId || req.body.LaunchTemplateName;
          if (!nameOrId) throw new Error('LaunchTemplateId or LaunchTemplateName is required');
          const template = simulator.deleteLaunchTemplate(nameOrId);
          sendXml(
            res,
            EC2ResponseFormatter.formatDeleteLaunchTemplateResponse(template.toJSON())
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteLaunchTemplateVersions: (req, res) => {
        try {
          const nameOrId = req.body.LaunchTemplateId || req.body.LaunchTemplateName;
          if (!nameOrId) throw new Error('LaunchTemplateId or LaunchTemplateName is required');
          const versions = collectList(req.body, 'LaunchTemplateVersion');
          if (!versions || versions.length === 0) {
            throw new Error('LaunchTemplateVersion is required');
          }
          const { template, deleted } = simulator.deleteLaunchTemplateVersions(nameOrId, versions);
          sendXml(
            res,
            EC2ResponseFormatter.formatDeleteLaunchTemplateVersionsResponse(
              template.toJSON(),
              deleted
            )
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      ModifyLaunchTemplate: (req, res) => {
        try {
          const nameOrId = req.body.LaunchTemplateId || req.body.LaunchTemplateName;
          if (!nameOrId) throw new Error('LaunchTemplateId or LaunchTemplateName is required');
          const defaultVersion = req.body.SetDefaultVersion;
          if (defaultVersion === undefined) throw new Error('SetDefaultVersion is required');
          const template = simulator.modifyLaunchTemplate(nameOrId, { defaultVersion });
          sendXml(
            res,
            EC2ResponseFormatter.formatModifyLaunchTemplateResponse(template.toJSON())
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Images (register/deregister) =====

      RegisterImage: (req, res) => {
        try {
          if (!req.body.Name) throw new Error('Name is required');
          const ami = simulator.registerImage({
            Name: req.body.Name,
            Description: req.body.Description || '',
            Architecture: req.body.Architecture,
            RootDeviceType: req.body.RootDeviceType,
            VirtualizationType: req.body.VirtualizationType,
            Tags: extractTags(req.body)
          });
          sendXml(res, EC2ResponseFormatter.formatRegisterImageResponse(ami.ImageId));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeregisterImage: (req, res) => {
        try {
          const { ImageId } = req.body;
          if (!ImageId) throw new Error('ImageId is required');
          simulator.deregisterImage(ImageId);
          sendXml(res, EC2ResponseFormatter.formatDeregisterImageResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Key Pairs =====

      CreateKeyPair: (req, res) => {
        try {
          const { KeyName } = req.body;
          if (!KeyName) throw new Error('KeyName is required');
          const kp = simulator.createKeyPair(KeyName, null, { Tags: extractTags(req.body) });
          sendXml(res, EC2ResponseFormatter.formatCreateKeyPairResponse(kp));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      ImportKeyPair: (req, res) => {
        try {
          const { KeyName, PublicKeyMaterial } = req.body;
          if (!KeyName) throw new Error('KeyName is required');
          if (!PublicKeyMaterial) throw new Error('PublicKeyMaterial is required');
          const kp = simulator.createKeyPair(KeyName, PublicKeyMaterial, {
            Tags: extractTags(req.body)
          });
          sendXml(res, EC2ResponseFormatter.formatImportKeyPairResponse(kp));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeKeyPairs: (req, res) => {
        try {
          const filters = {};
          const keyNames = collectList(req.body, 'KeyName');
          const keyPairIds = collectList(req.body, 'KeyPairId');
          if (keyNames) filters.keyNames = keyNames;
          if (keyPairIds) filters.keyPairIds = keyPairIds;
          const pairs = simulator.describeKeyPairs(filters);
          sendXml(res, EC2ResponseFormatter.formatDescribeKeyPairsResponse(pairs.map(k => k.toJSON())));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteKeyPair: (req, res) => {
        try {
          const { KeyName } = req.body;
          if (!KeyName) throw new Error('KeyName is required');
          simulator.deleteKeyPair(KeyName);
          sendXml(res, EC2ResponseFormatter.formatDeleteKeyPairResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Placement Groups =====

      CreatePlacementGroup: (req, res) => {
        try {
          const { GroupName, Strategy = 'spread', PartitionCount } = req.body;
          if (!GroupName) throw new Error('GroupName is required');
          simulator.createPlacementGroup(GroupName, Strategy, {
            PartitionCount,
            Tags: extractTags(req.body)
          });
          sendXml(res, EC2ResponseFormatter.formatCreatePlacementGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribePlacementGroups: (req, res) => {
        try {
          const filters = {};
          const groupNames = collectList(req.body, 'GroupName');
          const groupIds = collectList(req.body, 'GroupId');
          if (groupNames) filters.groupNames = groupNames;
          if (groupIds) filters.groupIds = groupIds;
          const groups = simulator.describePlacementGroups(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribePlacementGroupsResponse(groups.map(g => g.toJSON()))
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeletePlacementGroup: (req, res) => {
        try {
          const { GroupName } = req.body;
          if (!GroupName) throw new Error('GroupName is required');
          simulator.deletePlacementGroup(GroupName);
          sendXml(res, EC2ResponseFormatter.formatDeletePlacementGroupResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Dedicated Hosts =====

      AllocateHosts: (req, res) => {
        try {
          const { InstanceType, AvailabilityZone, Quantity = 1 } = req.body;
          if (!InstanceType) throw new Error('InstanceType is required');
          const hosts = simulator.allocateHosts(InstanceType, AvailabilityZone, Quantity, {
            Tags: extractTags(req.body)
          });
          sendXml(res, EC2ResponseFormatter.formatAllocateHostsResponse(hosts.map(h => h.HostId)));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeHosts: (req, res) => {
        try {
          const filters = {};
          const hostIds = collectList(req.body, 'HostId');
          if (hostIds) filters.hostIds = hostIds;
          const hosts = simulator.describeHosts(filters);
          sendXml(res, EC2ResponseFormatter.formatDescribeHostsResponse(hosts.map(h => h.toJSON())));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      ReleaseHosts: (req, res) => {
        try {
          const hostIds = collectList(req.body, 'HostId');
          if (!hostIds || hostIds.length === 0) throw new Error('HostId is required');
          const results = simulator.releaseHosts(hostIds);
          sendXml(res, EC2ResponseFormatter.formatReleaseHostsResponse(results.map(r => r.HostId)));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Capacity Reservations =====

      CreateCapacityReservation: (req, res) => {
        try {
          const {
            InstanceType,
            AvailabilityZone,
            InstanceCount = 1,
            InstancePlatform,
            Tenancy,
            EbsOptimized
          } = req.body;
          if (!InstanceType) throw new Error('InstanceType is required');
          const cr = simulator.createCapacityReservation(InstanceType, AvailabilityZone, InstanceCount, {
            InstancePlatform,
            Tenancy,
            EbsOptimized: !!EbsOptimized,
            Tags: extractTags(req.body)
          });
          sendXml(res, EC2ResponseFormatter.formatCreateCapacityReservationResponse(cr.toJSON()));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeCapacityReservations: (req, res) => {
        try {
          const filters = {};
          const ids = collectList(req.body, 'CapacityReservationId');
          if (ids) filters.capacityReservationIds = ids;
          const reservations = simulator.describeCapacityReservations(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeCapacityReservationsResponse(
              reservations.map(c => c.toJSON())
            )
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CancelCapacityReservation: (req, res) => {
        try {
          const { CapacityReservationId } = req.body;
          if (!CapacityReservationId) throw new Error('CapacityReservationId is required');
          simulator.cancelCapacityReservation(CapacityReservationId);
          sendXml(res, EC2ResponseFormatter.formatCancelCapacityReservationResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Spot Instance Requests =====

      RequestSpotInstances: (req, res) => {
        try {
          const launchSpec = req.body.LaunchSpecification || {};
          const requests = simulator.requestSpotInstances({
            SpotPrice: req.body.SpotPrice,
            Type: req.body.Type || 'one-time',
            AvailabilityZone: req.body.AvailabilityZone,
            ProductDescription: req.body.ProductDescription,
            LaunchSpecification: {
              ImageId: launchSpec.ImageId,
              InstanceType: launchSpec.InstanceType,
              AvailabilityZone: launchSpec.Placement?.AvailabilityZone
            },
            Tags: extractTags(req.body)
          });
          sendXml(
            res,
            EC2ResponseFormatter.formatRequestSpotInstancesResponse([requests.toJSON()])
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeSpotInstanceRequests: (req, res) => {
        try {
          const filters = {};
          const ids = collectList(req.body, 'SpotInstanceRequestId');
          if (ids) filters.spotInstanceRequestIds = ids;
          const requests = simulator.describeSpotInstanceRequests(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeSpotInstanceRequestsResponse(
              requests.map(r => r.toJSON())
            )
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      CancelSpotInstanceRequests: (req, res) => {
        try {
          const ids = collectList(req.body, 'SpotInstanceRequestId');
          if (!ids || ids.length === 0) throw new Error('SpotInstanceRequestId is required');
          const results = simulator.cancelSpotInstanceRequests(ids);
          sendXml(res, EC2ResponseFormatter.formatCancelSpotInstanceRequestsResponse(results));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Reserved Instances =====

      DescribeReservedInstancesOfferings: (req, res) => {
        try {
          const filters = {};
          if (req.body.InstanceType) filters.instanceType = req.body.InstanceType;
          const offeringId = collectList(req.body, 'ReservedInstancesOfferingId');
          if (offeringId && offeringId.length === 1) filters.offeringId = offeringId[0];
          const offerings = simulator.describeReservedInstancesOfferings(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeReservedInstancesOfferingsResponse(offerings)
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      PurchaseReservedInstancesOffering: (req, res) => {
        try {
          const { ReservedInstancesOfferingId, InstanceCount = 1 } = req.body;
          if (!ReservedInstancesOfferingId) {
            throw new Error('ReservedInstancesOfferingId is required');
          }
          const ri = simulator.purchaseReservedInstancesOffering(ReservedInstancesOfferingId, {
            InstanceCount
          });
          sendXml(
            res,
            EC2ResponseFormatter.formatPurchaseReservedInstancesOfferingResponse(ri.toJSON())
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DescribeReservedInstances: (req, res) => {
        try {
          const filters = {};
          const ids = collectList(req.body, 'ReservedInstancesId');
          if (ids) filters.reservedInstancesIds = ids;
          const reservations = simulator.describeReservedInstances(filters);
          sendXml(
            res,
            EC2ResponseFormatter.formatDescribeReservedInstancesResponse(
              reservations.map(r => r.toJSON())
            )
          );
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      // ===== Network Interfaces (create/delete) =====

      CreateNetworkInterface: (req, res) => {
        try {
          const { SubnetId, Description } = req.body;
          if (!SubnetId) throw new Error('SubnetId is required');
          let vpcId = req.body.VpcId || null;
          if (!vpcId && this.vpcSimulator) {
            try {
              vpcId = this.vpcSimulator.getSubnet(SubnetId).VpcId;
            } catch (_) {
              vpcId = null;
            }
          }
          const groups = collectList(req.body, 'SecurityGroupId') || [];
          const eni = simulator.createNetworkInterface(SubnetId, vpcId, {
            Description: Description || '',
            Groups: groups
          });
          sendXml(res, EC2ResponseFormatter.formatCreateNetworkInterfaceResponse(eni.toJSON()));
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      },

      DeleteNetworkInterface: (req, res) => {
        try {
          const { NetworkInterfaceId } = req.body;
          if (!NetworkInterfaceId) throw new Error('NetworkInterfaceId is required');
          simulator.deleteNetworkInterface(NetworkInterfaceId);
          sendXml(res, EC2ResponseFormatter.formatDeleteNetworkInterfaceResponse());
        } catch (error) {
          sendError(res, 'InternalError', error.message);
        }
      }
    };
  }

  _instanceStateChange(req, res, action) {
    try {
      const instanceIds = collectList(req.body, 'InstanceId');
      if (!instanceIds || instanceIds.length === 0) {
        throw new Error('InstanceId is required');
      }

      let instances;
      switch (action) {
        case 'StartInstances':
          instances = this.simulator.startInstances(instanceIds);
          break;
        case 'StopInstances':
          instances = this.simulator.stopInstances(instanceIds);
          break;
        case 'TerminateInstances':
          instances = this.simulator.terminateInstances(instanceIds);
          break;
        case 'RebootInstances':
          instances = this.simulator.rebootInstances(instanceIds);
          break;
        default:
          throw new Error(`Unsupported action: ${action}`);
      }

      res
        .status(200)
        .set('Content-Type', 'text/xml')
        .send(
          EC2ResponseFormatter.formatInstanceStateChangeResponse(
            action,
            instances.map(i => i.toJSON())
          )
        );
    } catch (error) {
      logger.error(`Error handling ${action}: ${error.message}`);
      res
        .status(400)
        .set('Content-Type', 'text/xml')
        .send(EC2ResponseFormatter.formatErrorResponse('InternalError', error.message));
    }
  }

  setupRoutes() {
    // ========== Instance Routes ==========

    // Run Instances
    this.app.post('/__admin/ec2/instances/run', (req, res) => {
      try {
        const { ImageId, MinCount = 1, MaxCount = 1, InstanceType = 't2.micro', ...config } =
          req.body;

        if (!ImageId) {
          return res.status(400).json({ error: 'ImageId is required' });
        }

        const instances = this.simulator.runInstances(ImageId, MinCount, InstanceType, config);

        // Iniciar servidores web para as instâncias
        instances.forEach(async (instance) => {
          // ProxyUrl tem prioridade sobre WebServerDir
          if (config.ProxyUrl) {
            await this.simulator.startInstanceServer(instance.InstanceId, null, config.ProxyUrl);
          } else if (config.WebServerDir) {
            await this.simulator.startInstanceServer(instance.InstanceId, config.WebServerDir);
          } else {
            await this.simulator.startInstanceServer(instance.InstanceId);
          }
        });

        res.json({ Instances: instances.map(i => i.toJSON()) });
      } catch (error) {
        logger.error(`Error running instances: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Instances
    this.app.get('/__admin/ec2/instances', (req, res) => {
      try {
        const filters = {};
        if (req.query.instanceIds) {
          filters.instanceIds = Array.isArray(req.query.instanceIds)
            ? req.query.instanceIds
            : [req.query.instanceIds];
        }
        if (req.query.state) {
          filters.state = req.query.state;
        }

        const instances = this.simulator.describeInstances(filters);
        res.json({ Instances: instances.map(i => i.toJSON()) });
      } catch (error) {
        logger.error(`Error describing instances: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Instance
    this.app.get('/__admin/ec2/instances/:instanceId', (req, res) => {
      try {
        const instance = this.simulator.getInstance(req.params.instanceId);
        res.json({ Instance: instance.toJSON() });
      } catch (error) {
        logger.error(`Error getting instance: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Start Instances
    this.app.post('/__admin/ec2/instances/:instanceId/start', (req, res) => {
      try {
        const instances = this.simulator.startInstances([req.params.instanceId]);
        res.json({ Instances: instances.map(i => i.toJSON()) });
      } catch (error) {
        logger.error(`Error starting instance: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Stop Instances
    this.app.post('/__admin/ec2/instances/:instanceId/stop', (req, res) => {
      try {
        const instances = this.simulator.stopInstances([req.params.instanceId]);
        res.json({ Instances: instances.map(i => i.toJSON()) });
      } catch (error) {
        logger.error(`Error stopping instance: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Reboot Instances
    this.app.post('/__admin/ec2/instances/:instanceId/reboot', (req, res) => {
      try {
        const instances = this.simulator.rebootInstances([req.params.instanceId]);
        res.json({ Instances: instances.map(i => i.toJSON()) });
      } catch (error) {
        logger.error(`Error rebooting instance: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Terminate Instances
    this.app.post('/__admin/ec2/instances/:instanceId/terminate', (req, res) => {
      try {
        const instances = this.simulator.terminateInstances([req.params.instanceId]);
        res.json({ Instances: instances.map(i => i.toJSON()) });
      } catch (error) {
        logger.error(`Error terminating instance: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Instance Status
    this.app.get('/__admin/ec2/instances/:instanceId/status', (req, res) => {
      try {
        const instance = this.simulator.getInstance(req.params.instanceId);
        res.json({
          InstanceId: instance.InstanceId,
          State: instance.State,
          StateTransitionReason: instance.StateTransitionReason,
          WebServerPort: instance.WebServerPort,
          WebServerUrl: `http://localhost:${instance.WebServerPort}`,
          PublicIp: instance.PublicIpAddress,
          PrivateIp: instance.PrivateIpAddress
        });
      } catch (error) {
        logger.error(`Error getting instance status: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // ========== Image Routes ==========

    // Describe Images
    this.app.get('/__admin/ec2/images', (req, res) => {
      try {
        const images = this.simulator.describeImages();
        res.json({ Images: images.map(img => img.toJSON()) });
      } catch (error) {
        logger.error(`Error describing images: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Security Group Routes ==========

    // Create Security Group
    this.app.post('/__admin/ec2/security-groups/create', (req, res) => {
      try {
        const { GroupName, Description = '', VpcId = null } = req.body;

        if (!GroupName) {
          return res.status(400).json({ error: 'GroupName is required' });
        }

        const sg = this.simulator.createSecurityGroup(GroupName, Description, VpcId);
        res.json({ SecurityGroup: sg.toJSON() });
      } catch (error) {
        logger.error(`Error creating security group: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Security Groups
    this.app.get('/__admin/ec2/security-groups', (req, res) => {
      try {
        const filters = {};
        if (req.query.groupIds) {
          filters.groupIds = Array.isArray(req.query.groupIds)
            ? req.query.groupIds
            : [req.query.groupIds];
        }

        const sgs = this.simulator.describeSecurityGroups(filters);
        res.json({ SecurityGroups: sgs.map(sg => sg.toJSON()) });
      } catch (error) {
        logger.error(`Error describing security groups: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Security Group
    this.app.get('/__admin/ec2/security-groups/:groupId', (req, res) => {
      try {
        const sg = this.simulator.getSecurityGroup(req.params.groupId);
        res.json({ SecurityGroup: sg.toJSON() });
      } catch (error) {
        logger.error(`Error getting security group: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Add Ingress Rule
    this.app.post('/__admin/ec2/security-groups/:groupId/ingress', (req, res) => {
      try {
        const { CidrIp, FromPort, ToPort, Protocol = 'tcp', Description = '' } = req.body;

        if (!FromPort || !ToPort) {
          return res.status(400).json({ error: 'FromPort and ToPort are required' });
        }

        const sg = this.simulator.getSecurityGroup(req.params.groupId);
        const rule = sg.addIngressRule(CidrIp, null, FromPort, ToPort, Protocol, Description);

        res.json({ Rule: rule });
      } catch (error) {
        logger.error(`Error adding ingress rule: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Security Group
    this.app.delete('/__admin/ec2/security-groups/:groupId', (req, res) => {
      try {
        this.simulator.deleteSecurityGroup(req.params.groupId);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting security group: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Network Interface Routes ==========

    // Describe Network Interfaces
    this.app.get('/__admin/ec2/network-interfaces', (req, res) => {
      try {
        const filters = {};
        if (req.query.networkInterfaceIds) {
          filters.networkInterfaceIds = Array.isArray(req.query.networkInterfaceIds)
            ? req.query.networkInterfaceIds
            : [req.query.networkInterfaceIds];
        }

        const enis = this.simulator.describeNetworkInterfaces(filters);
        res.json({ NetworkInterfaces: enis.map(eni => eni.toJSON()) });
      } catch (error) {
        logger.error(`Error describing network interfaces: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Network Interface
    this.app.get('/__admin/ec2/network-interfaces/:eniId', (req, res) => {
      try {
        const eni = this.simulator.getNetworkInterface(req.params.eniId);
        res.json({ NetworkInterface: eni.toJSON() });
      } catch (error) {
        logger.error(`Error getting network interface: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Create Network Interface
    this.app.post('/__admin/ec2/network-interfaces', (req, res) => {
      try {
        const { SubnetId, Description = '', SecurityGroupIds = [] } = req.body;
        if (!SubnetId) return res.status(400).json({ error: 'SubnetId is required' });
        let vpcId = req.body.VpcId || null;
        if (!vpcId && this.vpcSimulator) {
          try {
            vpcId = this.vpcSimulator.getSubnet(SubnetId).VpcId;
          } catch (_) {
            vpcId = null;
          }
        }
        const eni = this.simulator.createNetworkInterface(SubnetId, vpcId, {
          Description,
          Groups: SecurityGroupIds
        });
        res.json({ NetworkInterface: eni.toJSON() });
      } catch (error) {
        logger.error(`Error creating network interface: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Network Interface
    this.app.delete('/__admin/ec2/network-interfaces/:eniId', (req, res) => {
      try {
        this.simulator.deleteNetworkInterface(req.params.eniId);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting network interface: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== AMI Routes (register/deregister) ==========

    // Register Image
    this.app.post('/__admin/ec2/images', (req, res) => {
      try {
        const ami = this.simulator.registerImage(req.body || {});
        res.json({ Image: ami.toJSON() });
      } catch (error) {
        logger.error(`Error registering image: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Deregister Image
    this.app.delete('/__admin/ec2/images/:imageId', (req, res) => {
      try {
        this.simulator.deregisterImage(req.params.imageId);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deregistering image: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Key Pair Routes ==========

    // Create Key Pair
    this.app.post('/__admin/ec2/key-pairs', (req, res) => {
      try {
        const { KeyName, PublicKeyMaterial = null, Tags = [] } = req.body;
        if (!KeyName) return res.status(400).json({ error: 'KeyName is required' });
        const kp = this.simulator.createKeyPair(KeyName, PublicKeyMaterial, { Tags });
        res.json({ KeyPair: kp.toJSON(), PrivateKeyMaterial: kp.PrivateKeyMaterial });
      } catch (error) {
        logger.error(`Error creating key pair: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Key Pairs
    this.app.get('/__admin/ec2/key-pairs', (req, res) => {
      try {
        const keyPairs = this.simulator.describeKeyPairs();
        res.json({ KeyPairs: keyPairs.map(k => k.toJSON()) });
      } catch (error) {
        logger.error(`Error describing key pairs: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Key Pair
    this.app.delete('/__admin/ec2/key-pairs/:keyName', (req, res) => {
      try {
        this.simulator.deleteKeyPair(req.params.keyName);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting key pair: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Placement Group Routes ==========

    // Create Placement Group
    this.app.post('/__admin/ec2/placement-groups', (req, res) => {
      try {
        const { GroupName, Strategy = 'spread', PartitionCount, Tags = [] } = req.body;
        if (!GroupName) return res.status(400).json({ error: 'GroupName is required' });
        const pg = this.simulator.createPlacementGroup(GroupName, Strategy, {
          PartitionCount,
          Tags
        });
        res.json({ PlacementGroup: pg.toJSON() });
      } catch (error) {
        logger.error(`Error creating placement group: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Placement Groups
    this.app.get('/__admin/ec2/placement-groups', (req, res) => {
      try {
        const groups = this.simulator.describePlacementGroups();
        res.json({ PlacementGroups: groups.map(g => g.toJSON()) });
      } catch (error) {
        logger.error(`Error describing placement groups: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Placement Group
    this.app.delete('/__admin/ec2/placement-groups/:groupName', (req, res) => {
      try {
        this.simulator.deletePlacementGroup(req.params.groupName);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting placement group: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Dedicated Host Routes ==========

    // Allocate Hosts
    this.app.post('/__admin/ec2/dedicated-hosts', (req, res) => {
      try {
        const { InstanceType, AvailabilityZone, Quantity = 1, Tags = [] } = req.body;
        if (!InstanceType) return res.status(400).json({ error: 'InstanceType is required' });
        const hosts = this.simulator.allocateHosts(InstanceType, AvailabilityZone, Quantity, { Tags });
        res.json({ Hosts: hosts.map(h => h.toJSON()) });
      } catch (error) {
        logger.error(`Error allocating hosts: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Hosts
    this.app.get('/__admin/ec2/dedicated-hosts', (req, res) => {
      try {
        const hosts = this.simulator.describeHosts();
        res.json({ Hosts: hosts.map(h => h.toJSON()) });
      } catch (error) {
        logger.error(`Error describing hosts: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Release Hosts
    this.app.delete('/__admin/ec2/dedicated-hosts/:hostId', (req, res) => {
      try {
        this.simulator.releaseHosts([req.params.hostId]);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error releasing host: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Capacity Reservation Routes ==========

    // Create Capacity Reservation
    this.app.post('/__admin/ec2/capacity-reservations', (req, res) => {
      try {
        const { InstanceType, AvailabilityZone, InstanceCount = 1, InstancePlatform, Tags = [] } =
          req.body;
        if (!InstanceType) return res.status(400).json({ error: 'InstanceType is required' });
        const cr = this.simulator.createCapacityReservation(
          InstanceType,
          AvailabilityZone,
          InstanceCount,
          { InstancePlatform, Tags }
        );
        res.json({ CapacityReservation: cr.toJSON() });
      } catch (error) {
        logger.error(`Error creating capacity reservation: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Capacity Reservations
    this.app.get('/__admin/ec2/capacity-reservations', (req, res) => {
      try {
        const reservations = this.simulator.describeCapacityReservations();
        res.json({ CapacityReservations: reservations.map(c => c.toJSON()) });
      } catch (error) {
        logger.error(`Error describing capacity reservations: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Cancel Capacity Reservation
    this.app.delete('/__admin/ec2/capacity-reservations/:id', (req, res) => {
      try {
        this.simulator.cancelCapacityReservation(req.params.id);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error canceling capacity reservation: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Spot Instance Request Routes ==========

    // Request Spot Instances
    this.app.post('/__admin/ec2/spot-requests', (req, res) => {
      try {
        const sir = this.simulator.requestSpotInstances(req.body || {});
        res.json({ SpotInstanceRequest: sir.toJSON() });
      } catch (error) {
        logger.error(`Error requesting spot instances: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Spot Instance Requests
    this.app.get('/__admin/ec2/spot-requests', (req, res) => {
      try {
        const requests = this.simulator.describeSpotInstanceRequests();
        res.json({ SpotInstanceRequests: requests.map(r => r.toJSON()) });
      } catch (error) {
        logger.error(`Error describing spot instance requests: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Cancel Spot Instance Requests
    this.app.delete('/__admin/ec2/spot-requests/:id', (req, res) => {
      try {
        this.simulator.cancelSpotInstanceRequests([req.params.id]);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error canceling spot instance request: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Reserved Instance Routes ==========

    // Describe Reserved Instances Offerings
    this.app.get('/__admin/ec2/reserved-instances-offerings', (req, res) => {
      try {
        const offerings = this.simulator.describeReservedInstancesOfferings();
        res.json({ ReservedInstancesOfferings: offerings });
      } catch (error) {
        logger.error(`Error describing reserved instances offerings: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Purchase Reserved Instances Offering
    this.app.post('/__admin/ec2/reserved-instances', (req, res) => {
      try {
        const { ReservedInstancesOfferingId, InstanceCount = 1 } = req.body;
        if (!ReservedInstancesOfferingId) {
          return res.status(400).json({ error: 'ReservedInstancesOfferingId is required' });
        }
        const ri = this.simulator.purchaseReservedInstancesOffering(ReservedInstancesOfferingId, {
          InstanceCount
        });
        res.json({ ReservedInstance: ri.toJSON() });
      } catch (error) {
        logger.error(`Error purchasing reserved instance: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Reserved Instances
    this.app.get('/__admin/ec2/reserved-instances', (req, res) => {
      try {
        const reservations = this.simulator.describeReservedInstances();
        res.json({ ReservedInstances: reservations.map(r => r.toJSON()) });
      } catch (error) {
        logger.error(`Error describing reserved instances: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== EBS Volume Routes ==========

    // Create Volume
    this.app.post('/__admin/ec2/volumes', (req, res) => {
      try {
        const {
          AvailabilityZone,
          Size,
          VolumeType,
          Iops,
          Throughput,
          SnapshotId,
          Encrypted,
          MultiAttachEnabled,
          Tags = []
        } = req.body;

        const volume = this.simulator.createVolume({
          AvailabilityZone,
          Size: Size !== undefined && Size !== '' ? Number(Size) : undefined,
          VolumeType,
          Iops: Iops !== undefined && Iops !== '' ? Number(Iops) : undefined,
          Throughput: Throughput !== undefined && Throughput !== '' ? Number(Throughput) : undefined,
          SnapshotId: SnapshotId || '',
          Encrypted: !!Encrypted,
          MultiAttachEnabled: !!MultiAttachEnabled,
          Tags
        });

        res.json({ Volume: volume.toJSON() });
      } catch (error) {
        logger.error(`Error creating volume: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Volumes
    this.app.get('/__admin/ec2/volumes', (req, res) => {
      try {
        const filters = {};
        if (req.query.volumeIds) {
          filters.volumeIds = Array.isArray(req.query.volumeIds)
            ? req.query.volumeIds
            : [req.query.volumeIds];
        }
        if (req.query.instanceId) filters.instanceId = req.query.instanceId;

        const volumes = this.simulator.describeVolumes(filters);
        res.json({ Volumes: volumes.map(v => v.toJSON()) });
      } catch (error) {
        logger.error(`Error describing volumes: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Volume
    this.app.get('/__admin/ec2/volumes/:volumeId', (req, res) => {
      try {
        const volume = this.simulator.getVolume(req.params.volumeId);
        res.json({ Volume: volume.toJSON() });
      } catch (error) {
        logger.error(`Error getting volume: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Attach Volume
    this.app.post('/__admin/ec2/volumes/:volumeId/attach', (req, res) => {
      try {
        const { InstanceId, Device = '/dev/sdf', DeleteOnTermination = false } = req.body;
        if (!InstanceId) {
          return res.status(400).json({ error: 'InstanceId is required' });
        }
        const volume = this.simulator.attachVolume(
          req.params.volumeId,
          InstanceId,
          Device,
          DeleteOnTermination
        );
        res.json({ Volume: volume.toJSON() });
      } catch (error) {
        logger.error(`Error attaching volume: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Detach Volume
    this.app.post('/__admin/ec2/volumes/:volumeId/detach', (req, res) => {
      try {
        const { InstanceId = null } = req.body || {};
        const volume = this.simulator.detachVolume(req.params.volumeId, InstanceId);
        res.json({ Volume: volume.toJSON() });
      } catch (error) {
        logger.error(`Error detaching volume: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Modify Volume
    this.app.post('/__admin/ec2/volumes/:volumeId/modify', (req, res) => {
      try {
        const { Size, VolumeType, Iops, Throughput } = req.body;
        const modification = this.simulator.modifyVolume(req.params.volumeId, {
          Size,
          VolumeType,
          Iops,
          Throughput
        });
        const volume = this.simulator.getVolume(req.params.volumeId);
        res.json({ Volume: volume.toJSON(), Modification: modification });
      } catch (error) {
        logger.error(`Error modifying volume: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Volume
    this.app.delete('/__admin/ec2/volumes/:volumeId', (req, res) => {
      try {
        this.simulator.deleteVolume(req.params.volumeId);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting volume: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== EBS Snapshot Routes ==========

    // Create Snapshot
    this.app.post('/__admin/ec2/snapshots', (req, res) => {
      try {
        const { VolumeId, Description = '', Tags = [] } = req.body;
        if (!VolumeId) {
          return res.status(400).json({ error: 'VolumeId is required' });
        }
        const snapshot = this.simulator.createSnapshot(VolumeId, Description, Tags);
        res.json({ Snapshot: snapshot.toJSON() });
      } catch (error) {
        logger.error(`Error creating snapshot: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Snapshots
    this.app.get('/__admin/ec2/snapshots', (req, res) => {
      try {
        const filters = {};
        if (req.query.snapshotIds) {
          filters.snapshotIds = Array.isArray(req.query.snapshotIds)
            ? req.query.snapshotIds
            : [req.query.snapshotIds];
        }
        if (req.query.volumeId) filters.volumeId = req.query.volumeId;

        const snapshots = this.simulator.describeSnapshots(filters);
        res.json({ Snapshots: snapshots.map(s => s.toJSON()) });
      } catch (error) {
        logger.error(`Error describing snapshots: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Snapshot
    this.app.get('/__admin/ec2/snapshots/:snapshotId', (req, res) => {
      try {
        const snapshot = this.simulator.getSnapshot(req.params.snapshotId);
        res.json({ Snapshot: snapshot.toJSON() });
      } catch (error) {
        logger.error(`Error getting snapshot: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Delete Snapshot
    this.app.delete('/__admin/ec2/snapshots/:snapshotId', (req, res) => {
      try {
        this.simulator.deleteSnapshot(req.params.snapshotId);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting snapshot: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Lifecycle Manager (DLM) Routes ==========

    // Create Policy
    this.app.post('/__admin/ec2/lifecycle-policies', (req, res) => {
      try {
        const { Description = '', ResourceType, TargetTags, Schedules, ExecutionRoleArn, Tags = [] } =
          req.body || {};
        const policy = this.simulator.createLifecyclePolicy({
          Description,
          ResourceType,
          TargetTags,
          Schedules,
          ExecutionRoleArn,
          Tags
        });
        res.json({ Policy: policy.toJSON() });
      } catch (error) {
        logger.error(`Error creating lifecycle policy: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Policies
    this.app.get('/__admin/ec2/lifecycle-policies', (req, res) => {
      try {
        const filters = {};
        if (req.query.state) filters.state = req.query.state;
        const policies = this.simulator.describeLifecyclePolicies(filters);
        res.json({ Policies: policies.map(p => p.toJSON()) });
      } catch (error) {
        logger.error(`Error describing lifecycle policies: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Policy
    this.app.get('/__admin/ec2/lifecycle-policies/:policyId', (req, res) => {
      try {
        const policy = this.simulator.getLifecyclePolicy(req.params.policyId);
        res.json({ Policy: policy.toJSON() });
      } catch (error) {
        logger.error(`Error getting lifecycle policy: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Enable Policy
    this.app.post('/__admin/ec2/lifecycle-policies/:policyId/enable', (req, res) => {
      try {
        const policy = this.simulator.enableLifecyclePolicy(req.params.policyId);
        res.json({ Policy: policy.toJSON() });
      } catch (error) {
        logger.error(`Error enabling lifecycle policy: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Disable Policy
    this.app.post('/__admin/ec2/lifecycle-policies/:policyId/disable', (req, res) => {
      try {
        const policy = this.simulator.disableLifecyclePolicy(req.params.policyId);
        res.json({ Policy: policy.toJSON() });
      } catch (error) {
        logger.error(`Error disabling lifecycle policy: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Policy
    this.app.delete('/__admin/ec2/lifecycle-policies/:policyId', (req, res) => {
      try {
        this.simulator.deleteLifecyclePolicy(req.params.policyId);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting lifecycle policy: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== DLM API compatível (REST-JSON, usado por `aws dlm`) ==========
    // O DLM é uma API REST própria na AWS; expomos as mesmas rotas na porta do EC2
    // para que o AWS CLI funcione com --endpoint-url.

    this.app.post('/policies', (req, res) => {
      try {
        const { Description = '', ExecutionRoleArn, State, PolicyDetails = {}, Tags } = req.body || {};
        const policy = this.simulator.createLifecyclePolicy({
          Description,
          ExecutionRoleArn,
          State,
          PolicyType: PolicyDetails.PolicyType,
          ResourceType: (PolicyDetails.ResourceTypes || [])[0],
          TargetTags: PolicyDetails.TargetTags,
          Schedules: PolicyDetails.Schedules,
          Tags: this._dlmTagsToArray(Tags),
        });
        res.status(200).json({ PolicyId: policy.PolicyId });
      } catch (error) {
        logger.error(`Error creating DLM policy: ${error.message}`);
        res.status(400).json({ message: error.message });
      }
    });

    this.app.get(['/policies', '/policies/'], (req, res) => {
      try {
        const policies = this.simulator.describeLifecyclePolicies({
          state: req.query.state,
        });
        res.status(200).json({
          Policies: policies.map(p => ({
            PolicyId: p.PolicyId,
            Description: p.Description,
            State: p.State,
            Tags: this._dlmTagsToMap(p.Tags),
          })),
        });
      } catch (error) {
        logger.error(`Error listing DLM policies: ${error.message}`);
        res.status(400).json({ message: error.message });
      }
    });

    this.app.get(['/policies/:policyId', '/policies/:policyId/'], (req, res) => {
      try {
        const policy = this.simulator.getLifecyclePolicy(req.params.policyId);
        res.status(200).json({ Policy: this._dlmPolicyResponse(policy) });
      } catch (error) {
        logger.error(`Error getting DLM policy: ${error.message}`);
        res.status(404).json({ message: error.message });
      }
    });

    this.app.patch('/policies/:policyId', (req, res) => {
      try {
        const { Description, State, ExecutionRoleArn, PolicyDetails = {} } = req.body || {};
        this.simulator.updateLifecyclePolicy(req.params.policyId, {
          Description,
          State,
          ExecutionRoleArn,
          ResourceType: (PolicyDetails.ResourceTypes || [])[0],
          TargetTags: PolicyDetails.TargetTags,
          Schedules: PolicyDetails.Schedules,
        });
        res.status(200).json({});
      } catch (error) {
        logger.error(`Error updating DLM policy: ${error.message}`);
        res.status(400).json({ message: error.message });
      }
    });

    this.app.delete(['/policies/:policyId', '/policies/:policyId/'], (req, res) => {
      try {
        this.simulator.deleteLifecyclePolicy(req.params.policyId);
        res.status(200).json({});
      } catch (error) {
        logger.error(`Error deleting DLM policy: ${error.message}`);
        res.status(404).json({ message: error.message });
      }
    });

    // POST /policies/{policyId}/actions — habilita ou desabilita a política.
    // O AWS CLI envia a intenção no corpo ({"State": "ENABLE"|"DISABLE"}).
    this.app.post('/policies/:policyId/actions', (req, res) => {
      try {
        const raw = `${(req.body && (req.body.State || req.body.state || req.body.action)) || req.query.action || ''}`.toUpperCase();
        const disable = raw.includes('DISABLE') || raw === 'DISABLE' || raw === '0';
        const policy = disable
          ? this.simulator.disableLifecyclePolicy(req.params.policyId)
          : this.simulator.enableLifecyclePolicy(req.params.policyId);
        res.status(200).json({});
      } catch (error) {
        logger.error(`Error toggling DLM policy: ${error.message}`);
        res.status(400).json({ message: error.message });
      }
    });

    // ========== Launch Template Routes ==========

    // Create Launch Template
    this.app.post('/__admin/ec2/launch-templates', (req, res) => {
      try {
        const {
          LaunchTemplateName,
          VersionDescription = '',
          LaunchTemplateData = {},
          Tags = []
        } = req.body || {};

        if (!LaunchTemplateName) {
          return res.status(400).json({ error: 'LaunchTemplateName is required' });
        }

        const template = this.simulator.createLaunchTemplate({
          LaunchTemplateName,
          VersionDescription,
          LaunchTemplateData,
          Tags
        });
        res.json({ LaunchTemplate: template.toJSON() });
      } catch (error) {
        logger.error(`Error creating launch template: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Describe Launch Templates
    this.app.get('/__admin/ec2/launch-templates', (req, res) => {
      try {
        const templates = this.simulator.describeLaunchTemplates();
        res.json({ LaunchTemplates: templates.map(t => t.toJSON()) });
      } catch (error) {
        logger.error(`Error describing launch templates: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Create Launch Template Version
    this.app.post('/__admin/ec2/launch-templates/:id/versions', (req, res) => {
      try {
        const {
          VersionDescription = '',
          LaunchTemplateData = {},
          SetAsDefault = false
        } = req.body || {};

        const { template, version } = this.simulator.createLaunchTemplateVersion(
          req.params.id,
          { VersionDescription, LaunchTemplateData, SetAsDefault }
        );
        res.json({
          LaunchTemplate: template.toJSON(),
          Version: template.versionToJSON(version.VersionNumber)
        });
      } catch (error) {
        logger.error(`Error creating launch template version: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Set Default Version
    this.app.post('/__admin/ec2/launch-templates/:id/default-version', (req, res) => {
      try {
        const { DefaultVersionNumber } = req.body || {};
        const template = this.simulator.modifyLaunchTemplate(req.params.id, {
          defaultVersion: DefaultVersionNumber
        });
        res.json({ LaunchTemplate: template.toJSON() });
      } catch (error) {
        logger.error(`Error setting default launch template version: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Delete Launch Template Versions
    this.app.delete('/__admin/ec2/launch-templates/:id/versions', (req, res) => {
      try {
        const { Versions } = req.body || {};
        const { template, deleted } = this.simulator.deleteLaunchTemplateVersions(
          req.params.id,
          Versions || []
        );
        res.json({ LaunchTemplate: template.toJSON(), DeletedVersions: deleted });
      } catch (error) {
        logger.error(`Error deleting launch template versions: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Launch Template
    this.app.get('/__admin/ec2/launch-templates/:id', (req, res) => {
      try {
        const template = this.simulator.getLaunchTemplate(req.params.id);
        res.json({ LaunchTemplate: template.toJSON() });
      } catch (error) {
        logger.error(`Error getting launch template: ${error.message}`);
        res.status(404).json({ error: error.message });
      }
    });

    // Delete Launch Template
    this.app.delete('/__admin/ec2/launch-templates/:id', (req, res) => {
      try {
        this.simulator.deleteLaunchTemplate(req.params.id);
        res.json({ success: true });
      } catch (error) {
        logger.error(`Error deleting launch template: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // ========== Utility Routes ==========

    // Health Check
    this.app.get('/__admin/ec2/health', (req, res) => {
      res.json({ status: 'ok', service: 'ec2' });
    });

    // Get All Resources
    this.app.get('/__admin/ec2/resources', (req, res) => {
      try {
        const resources = this.simulator.getAllResources();
        const network = this.vpcSimulator ? this.vpcSimulator.getAllResources() : null;
        res.json({
          instances: resources.instances.map(i => i.toJSON()),
          amis: resources.amis.map(a => a.toJSON()),
          securityGroups: resources.securityGroups.map(sg => sg.toJSON()),
          networkInterfaces: resources.networkInterfaces.map(eni => eni.toJSON()),
          volumes: resources.volumes.map(v => v.toJSON()),
          snapshots: resources.snapshots.map(s => s.toJSON()),
          lifecyclePolicies: resources.lifecyclePolicies.map(p => p.toJSON()),
          launchTemplates: resources.launchTemplates.map(t => t.toJSON()),
          instanceServersCount: resources.instanceServersCount,
          vpcs: network ? network.vpcs.map(v => v.toJSON()) : [],
          subnets: network ? network.subnets.map(s => s.toJSON()) : [],
          routeTables: network ? network.routeTables.map(rt => rt.toJSON()) : [],
          internetGateways: network ? network.internetGateways.map(igw => igw.toJSON()) : [],
          networkAcls: network ? network.networkAcls.map(acl => acl.toJSON()) : [],
          vpcEndpoints: network ? network.vpcEndpoints.map(e => e.toJSON()) : []
        });
      } catch (error) {
        logger.error(`Error fetching resources: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });

    // Get Running Instances (simplificado)
    this.app.get('/__admin/ec2/instances-running', (req, res) => {
      try {
        const instances = this.simulator.describeInstances({ state: 'running' });
        res.json({
          count: instances.length,
          instances: instances.map(i => ({
            InstanceId: i.InstanceId,
            PublicIp: i.PublicIpAddress,
            PrivateIp: i.PrivateIpAddress,
            WebServerPort: i.WebServerPort,
            WebServerUrl: `http://localhost:${i.WebServerPort}`
          }))
        });
      } catch (error) {
        logger.error(`Error getting running instances: ${error.message}`);
        res.status(400).json({ error: error.message });
      }
    });
  }

  /**
   * Helper: converte Tags no formato da API DLM (mapa) para o array interno.
   */
  _dlmTagsToArray(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) {
      return tags.map(t => ({ Key: String(t.Key), Value: String(t.Value ?? '') }));
    }
    return Object.entries(tags).map(([Key, Value]) => ({ Key, Value: String(Value ?? '') }));
  }

  /**
   * Helper: converte Tags do array interno para o formato da API DLM (mapa).
   */
  _dlmTagsToMap(tags) {
    const out = {};
    (tags || []).forEach(t => { out[t.Key] = t.Value; });
    return out;
  }

  /**
   * Helper: converte uma LifecyclePolicy para o formato da resposta REST do DLM.
   */
  _dlmPolicyResponse(policy) {
    return {
      PolicyId: policy.PolicyId,
      Description: policy.Description,
      State: policy.State,
      ExecutionRoleArn: policy.ExecutionRoleArn,
      DateCreated: policy.DateCreated,
      DateModified: policy.DateModified,
      PolicyDetails: {
        PolicyType: policy.PolicyType,
        ResourceTypes: [policy.ResourceType],
        ResourceLocations: policy.ResourceLocations,
        TargetTags: policy.TargetTags,
        Schedules: policy.Schedules
      },
      Tags: this._dlmTagsToMap(policy.Tags)
    };
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`EC2 Server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('EC2 Server stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = EC2Server;
