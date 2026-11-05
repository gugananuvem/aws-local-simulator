/**
 * VPC Integration Module
 * Integra Organizations com VPC para restrições regionais e de serviços
 */

const logger = require('../../utils/logger');

class VPCIntegration {
  constructor(organizationsSimulator, vpcService, ec2Service) {
    this.organizationsSimulator = organizationsSimulator;
    this.vpcService = vpcService;
    this.ec2Service = ec2Service;
  }

  /**
   * Valida se um recurso VPC pode ser criado em uma conta/região
   */
  validateVPCResource(accountId, region, resourceType, config = {}) {
    logger.debug(`Validating VPC resource: ${resourceType} in ${region} for account ${accountId}`);

    // 1. Verifica se SCP permite operação em serviço VPC
    const scpEvaluation = this.organizationsSimulator.evaluateSCPs(
      accountId,
      `ec2:Create*`,
      `arn:aws:ec2:${region}:${accountId}:*`
    );

    if (!scpEvaluation.allowed) {
      return {
        allowed: false,
        deniedBy: 'SCP',
        reason: `Service Control Policy denies VPC operations in region ${region}`,
        details: scpEvaluation
      };
    }

    // 2. Verifica restrições regionais por SCP
    const regionalCheck = this.checkRegionalRestrictions(accountId, region);
    if (!regionalCheck.allowed) {
      return {
        allowed: false,
        deniedBy: 'RegionalSCP',
        reason: regionalCheck.reason,
        details: regionalCheck
      };
    }

    // 3. Valida tipo de recurso específico
    const typeValidation = this.validateResourceType(resourceType, region, config);
    if (!typeValidation.allowed) {
      return typeValidation;
    }

    return {
      allowed: true,
      accountId,
      region,
      resourceType,
      message: 'VPC resource creation allowed'
    };
  }

  /**
   * Verifica restrições regionais definidas em SCP
   */
  checkRegionalRestrictions(accountId, region) {
    try {
      const account = this.organizationsSimulator.organization.getAccount(accountId);
      if (!account) {
        return {
          allowed: false,
          reason: `Account ${accountId} not found`
        };
      }

      // Coleta todas as SCPs aplicáveis à conta
      const applicablePolicies = [];
      
      let currentOUId = account.parentId;
      while (currentOUId) {
        const policies = this.organizationsSimulator.organization.listPoliciesForTarget(currentOUId);
        applicablePolicies.push(...policies);
        
        const ou = this.organizationsSimulator.organization.getOrganizationalUnit(currentOUId);
        currentOUId = ou?.parentId;
      }

      const accountPolicies = this.organizationsSimulator.organization.listPoliciesForTarget(accountId);
      applicablePolicies.push(...accountPolicies);

      // Verifica se há restrições regionais
      const allowedRegions = this.extractAllowedRegions(applicablePolicies);

      if (allowedRegions.length > 0 && !allowedRegions.includes(region)) {
        return {
          allowed: false,
          reason: `Region ${region} not in allowed regions: ${allowedRegions.join(', ')}`,
          allowedRegions
        };
      }

      const deniedRegions = this.extractDeniedRegions(applicablePolicies);
      if (deniedRegions.includes(region)) {
        return {
          allowed: false,
          reason: `Region ${region} is explicitly denied`,
          deniedRegions
        };
      }

      return {
        allowed: true,
        allowedRegions: allowedRegions.length > 0 ? allowedRegions : 'all',
        deniedRegions
      };

    } catch (error) {
      logger.error(`Error checking regional restrictions: ${error.message}`);
      return {
        allowed: false,
        reason: error.message
      };
    }
  }

  /**
   * Extrai regiões permitidas de policies
   */
  extractAllowedRegions(policies) {
    const regions = new Set();

    for (const policy of policies) {
      if (!policy.document || !policy.document.Statement) continue;

      for (const statement of policy.document.Statement) {
        if (statement.Effect === 'Allow') {
          // Procura por restrições de região na Resource ou Condition
          if (statement.Resource) {
            const resourceRegions = this.extractRegionsFromResources(statement.Resource);
            resourceRegions.forEach(r => regions.add(r));
          }

          if (statement.Condition?.StringEquals?.['aws:RequestedRegion']) {
            const regionValues = statement.Condition.StringEquals['aws:RequestedRegion'];
            const regionList = Array.isArray(regionValues) ? regionValues : [regionValues];
            regionList.forEach(r => regions.add(r));
          }
        }
      }
    }

    return Array.from(regions);
  }

  /**
   * Extrai regiões negadas de policies
   */
  extractDeniedRegions(policies) {
    const regions = new Set();

    for (const policy of policies) {
      if (!policy.document || !policy.document.Statement) continue;

      for (const statement of policy.document.Statement) {
        if (statement.Effect === 'Deny') {
          if (statement.Resource) {
            const resourceRegions = this.extractRegionsFromResources(statement.Resource);
            resourceRegions.forEach(r => regions.add(r));
          }

          if (statement.Condition?.StringEquals?.['aws:RequestedRegion']) {
            const regionValues = statement.Condition.StringEquals['aws:RequestedRegion'];
            const regionList = Array.isArray(regionValues) ? regionValues : [regionValues];
            regionList.forEach(r => regions.add(r));
          }
        }
      }
    }

    return Array.from(regions);
  }

  /**
   * Extrai regiões de um ARN
   */
  extractRegionsFromResources(resources) {
    const regions = new Set();
    const resourceList = Array.isArray(resources) ? resources : [resources];

    for (const resource of resourceList) {
      // ARN format: arn:aws:service:region:account:resource
      const parts = resource.split(':');
      if (parts.length >= 4) {
        const region = parts[3];
        if (region && region !== '*') {
          regions.add(region);
        }
      }
    }

    return Array.from(regions);
  }

  /**
   * Valida tipo de recurso específico
   */
  validateResourceType(resourceType, region, config = {}) {
    try {
      switch (resourceType.toLowerCase()) {
        case 'vpc':
          return this.validateVPC(region, config);
        
        case 'subnet':
          return this.validateSubnet(region, config);
        
        case 'securitygroup':
        case 'security-group':
          return this.validateSecurityGroup(region, config);
        
        case 'routetable':
        case 'route-table':
          return this.validateRouteTable(region, config);
        
        case 'internetgateway':
        case 'internet-gateway':
          return this.validateInternetGateway(region, config);
        
        case 'natgateway':
        case 'nat-gateway':
          return this.validateNATGateway(region, config);
        
        default:
          return {
            allowed: true,
            message: `Resource type ${resourceType} validation passed`
          };
      }
    } catch (error) {
      logger.error(`Error validating resource type ${resourceType}: ${error.message}`);
      return {
        allowed: false,
        reason: error.message
      };
    }
  }

  /**
   * Valida criação de VPC
   */
  validateVPC(region, config = {}) {
    // Validações específicas para VPC
    if (!config.cidrBlock) {
      return {
        allowed: false,
        reason: 'CIDR block is required for VPC'
      };
    }

    // Verifica se CIDR é válido
    if (!this.isValidCIDR(config.cidrBlock)) {
      return {
        allowed: false,
        reason: `Invalid CIDR block: ${config.cidrBlock}`
      };
    }

    return {
      allowed: true,
      message: 'VPC creation validation passed'
    };
  }

  /**
   * Valida criação de Subnet
   */
  validateSubnet(region, config = {}) {
    if (!config.vpcId) {
      return {
        allowed: false,
        reason: 'VPC ID is required for subnet'
      };
    }

    if (!config.cidrBlock) {
      return {
        allowed: false,
        reason: 'CIDR block is required for subnet'
      };
    }

    if (!this.isValidCIDR(config.cidrBlock)) {
      return {
        allowed: false,
        reason: `Invalid CIDR block: ${config.cidrBlock}`
      };
    }

    return {
      allowed: true,
      message: 'Subnet creation validation passed'
    };
  }

  /**
   * Valida criação de Security Group
   */
  validateSecurityGroup(region, config = {}) {
    if (!config.groupName) {
      return {
        allowed: false,
        reason: 'Group name is required'
      };
    }

    return {
      allowed: true,
      message: 'Security group creation validation passed'
    };
  }

  /**
   * Valida criação de Route Table
   */
  validateRouteTable(region, config = {}) {
    if (!config.vpcId) {
      return {
        allowed: false,
        reason: 'VPC ID is required for route table'
      };
    }

    return {
      allowed: true,
      message: 'Route table creation validation passed'
    };
  }

  /**
   * Valida criação de Internet Gateway
   */
  validateInternetGateway(region, config = {}) {
    return {
      allowed: true,
      message: 'Internet gateway creation validation passed'
    };
  }

  /**
   * Valida criação de NAT Gateway
   */
  validateNATGateway(region, config = {}) {
    if (!config.subnetId) {
      return {
        allowed: false,
        reason: 'Subnet ID is required for NAT gateway'
      };
    }

    if (!config.allocationId) {
      return {
        allowed: false,
        reason: 'Elastic IP allocation ID is required for NAT gateway'
      };
    }

    return {
      allowed: true,
      message: 'NAT gateway creation validation passed'
    };
  }

  /**
   * Valida CIDR block
   */
  isValidCIDR(cidr) {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    
    if (!cidrRegex.test(cidr)) {
      return false;
    }

    // Valida octetos
    const [network, prefix] = cidr.split('/');
    const octets = network.split('.');
    
    for (const octet of octets) {
      const num = parseInt(octet, 10);
      if (num < 0 || num > 255) {
        return false;
      }
    }

    // Valida prefix length
    const prefixLen = parseInt(prefix, 10);
    return prefixLen >= 0 && prefixLen <= 32;
  }

  /**
   * Valida regra de Security Group
   */
  validateSecurityGroupRule(rule, direction = 'ingress') {
    if (!rule.protocol) {
      return {
        allowed: false,
        reason: 'Protocol is required'
      };
    }

    if (rule.protocol !== '-1' && !['tcp', 'udp', 'icmp'].includes(rule.protocol.toLowerCase())) {
      return {
        allowed: false,
        reason: `Invalid protocol: ${rule.protocol}`
      };
    }

    if (rule.protocol !== '-1' && direction === 'ingress') {
      if (rule.fromPort === undefined || rule.toPort === undefined) {
        return {
          allowed: false,
          reason: 'Port range is required for protocol'
        };
      }

      if (rule.fromPort < 0 || rule.fromPort > 65535) {
        return {
          allowed: false,
          reason: `Invalid from port: ${rule.fromPort}`
        };
      }

      if (rule.toPort < 0 || rule.toPort > 65535) {
        return {
          allowed: false,
          reason: `Invalid to port: ${rule.toPort}`
        };
      }

      if (rule.fromPort > rule.toPort) {
        return {
          allowed: false,
          reason: 'From port cannot be greater than to port'
        };
      }
    }

    return {
      allowed: true,
      message: 'Security group rule validation passed'
    };
  }
}

module.exports = VPCIntegration;
