/**
 * EC2ResponseFormatter
 * Converte respostas do VPC Simulator para formato XML compatível com AWS CLI
 */

const xml = require('xmlbuilder');

class EC2ResponseFormatter {
  /**
   * Formata resposta DescribeVpcs para XML
   */
  static formatDescribeVpcsResponse(vpcs, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpcsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        vpcSet: {
          item: vpcs.map(vpc => ({
            vpcId: vpc.VpcId,
            state: vpc.State,
            cidrBlock: vpc.CidrBlock,
            dhcpOptionsId: vpc.DhcpOptionsId || 'dopt-default',
            tagSet: this._formatTags(vpc.Tags),
            isDefault: vpc.IsDefault || false,
            cidrBlockAssociationSet: {
              item: {
                cidrBlock: vpc.CidrBlock,
                cidrBlockState: {
                  state: 'associated'
                }
              }
            }
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateVpc para XML
   */
  static formatCreateVpcResponse(vpc, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateVpcResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        vpc: {
          vpcId: vpc.VpcId,
          state: vpc.State,
          cidrBlock: vpc.CidrBlock,
          dhcpOptionsId: vpc.DhcpOptionsId || 'dopt-default',
          tagSet: this._formatTags(vpc.Tags),
          isDefault: vpc.IsDefault || false,
          cidrBlockAssociationSet: {
            item: {
              cidrBlock: vpc.CidrBlock,
              cidrBlockState: {
                state: 'associated'
              }
            }
          }
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteVpc para XML
   */
  static formatDeleteVpcResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteVpcResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeSubnets para XML
   */
  static formatDescribeSubnetsResponse(subnets, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeSubnetsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        subnetSet: {
          item: subnets.map(subnet => ({
            subnetId: subnet.SubnetId,
            state: subnet.State,
            vpcId: subnet.VpcId,
            cidrBlock: subnet.CidrBlock,
            ipv6CidrBlockAssociationSet: {
              item: []
            },
            availabilityZone: subnet.AvailabilityZone,
            availabilityZoneId: this._getAZId(subnet.AvailabilityZone),
            availableIpAddressCount: subnet.AvailableIpAddressCount || 251,
            defaultForAz: false,
            mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch || false,
            mapCustomerOwnedIpOnLaunch: false,
            tagSet: this._formatTags(subnet.Tags)
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateSubnet para XML
   */
  static formatCreateSubnetResponse(subnet, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateSubnetResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        subnet: {
          subnetId: subnet.SubnetId,
          state: subnet.State,
          vpcId: subnet.VpcId,
          cidrBlock: subnet.CidrBlock,
          ipv6CidrBlockAssociationSet: {
            item: []
          },
          availabilityZone: subnet.AvailabilityZone,
          availabilityZoneId: this._getAZId(subnet.AvailabilityZone),
          availableIpAddressCount: subnet.AvailableIpAddressCount || 251,
          defaultForAz: false,
          mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch || false,
          mapCustomerOwnedIpOnLaunch: false,
          tagSet: this._formatTags(subnet.Tags)
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteSubnet para XML
   */
  static formatDeleteSubnetResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteSubnetResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeInternetGateways para XML
   */
  static formatDescribeIgwResponse(igws, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeInternetGatewaysResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        internetGatewaySet: {
          item: igws.map(igw => ({
            internetGatewayId: igw.InternetGatewayId,
            attachmentSet: {
              item: igw.Attachments.map(att => ({
                vpcId: att.VpcId,
                state: att.State
              }))
            },
            tagSet: this._formatTags(igw.Tags)
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateInternetGateway para XML
   */
  static formatCreateIgwResponse(igw, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateInternetGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        internetGateway: {
          internetGatewayId: igw.InternetGatewayId,
          attachmentSet: {
            item: igw.Attachments.map(att => ({
              vpcId: att.VpcId,
              state: att.State
            }))
          },
          tagSet: this._formatTags(igw.Tags)
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta AttachInternetGateway para XML
   */
  static formatAttachIgwResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      AttachInternetGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DetachInternetGateway para XML
   */
  static formatDetachIgwResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DetachInternetGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteInternetGateway para XML
   */
  static formatDeleteIgwResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteInternetGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeRouteTables para XML
   */
  static formatDescribeRouteTablesResponse(routeTables, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeRouteTablesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        routeTableSet: {
          item: routeTables.map(rt => ({
            routeTableId: rt.RouteTableId,
            vpcId: rt.VpcId,
            routeSet: {
              item: rt.Routes.map(route => ({
                destinationCidrBlock: route.DestinationCidrBlock,
                target: route.Target,
                state: route.State || 'active',
                origin: route.Origin || 'CreateRouteTable'
              }))
            },
            associationSet: {
              item: rt.Associations.map(assoc => ({
                routeTableAssociationId: assoc.RouteTableAssociationId,
                routeTableId: assoc.RouteTableId,
                subnetId: assoc.SubnetId || '',
                main: assoc.Main || false,
                associationState: {
                  state: assoc.State || 'associated'
                }
              }))
            },
            tagSet: this._formatTags(rt.Tags),
            propagatingVgwSet: []
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateRouteTable para XML
   */
  static formatCreateRouteTableResponse(routeTable, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateRouteTableResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        routeTable: {
          routeTableId: routeTable.RouteTableId,
          vpcId: routeTable.VpcId,
          routeSet: {
            item: routeTable.Routes.map(route => ({
              destinationCidrBlock: route.DestinationCidrBlock,
              target: route.Target,
              state: route.State || 'active',
              origin: route.Origin || 'CreateRouteTable'
            }))
          },
          associationSet: {
            item: routeTable.Associations.map(assoc => ({
              routeTableAssociationId: assoc.RouteTableAssociationId,
              routeTableId: assoc.RouteTableId,
              subnetId: assoc.SubnetId || '',
              main: assoc.Main || false,
              associationState: {
                state: assoc.State || 'associated'
              }
            }))
          },
          tagSet: this._formatTags(routeTable.Tags),
          propagatingVgwSet: []
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteRouteTable para XML
   */
  static formatDeleteRouteTableResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteRouteTableResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateRoute para XML
   */
  static formatCreateRouteResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateRouteResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId: requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Mapa de nome de estado -> código numérico EC2
   */
  static _stateCode(stateName) {
    const codes = {
      pending: 0,
      running: 16,
      'shutting-down': 32,
      terminated: 48,
      stopping: 64,
      stopped: 80
    };
    return codes[stateName] !== undefined ? codes[stateName] : 16;
  }

  /**
   * Helper: estado de instância no formato XML
   */
  static _instanceState(stateName) {
    return {
      code: this._stateCode(stateName),
      name: stateName
    };
  }

  /**
   * Helper: monta o item de uma instância dentro do reservationSet
   */
  static _instanceItem(instance) {
    return {
      instanceId: instance.InstanceId,
      imageId: instance.ImageId,
      instanceState: this._instanceState(instance.State),
      privateDnsName: instance.PrivateIpAddress
        ? `ip-${String(instance.PrivateIpAddress).replace(/\./g, '-')}.ec2.internal`
        : '',
      dnsName: instance.PublicIpAddress
        ? `ec2-${String(instance.PublicIpAddress).replace(/\./g, '-')}.compute.amazonaws.com`
        : '',
      reason: instance.StateTransitionReason || '',
      keyName: instance.KeyName || '',
      amiLaunchIndex: 0,
      productCodes: { item: [] },
      instanceType: instance.InstanceType,
      launchTime: instance.LaunchTime,
      placement: {
        availabilityZone: instance.AvailabilityZone || 'us-east-1a',
        groupName: '',
        tenancy: 'default'
      },
      monitoring: {
        state: instance.Monitoring?.State || 'disabled'
      },
      subnetId: instance.SubnetId || '',
      vpcId: instance.VpcId || '',
      privateIpAddress: instance.PrivateIpAddress || '',
      publicIpAddress: instance.PublicIpAddress || '',
      architecture: instance.Architecture || 'x86_64',
      rootDeviceType: instance.RootDeviceType || 'ebs',
      rootDeviceName: '/dev/sda1',
      blockDeviceMapping: { item: [] },
      virtualizationType: instance.VirtualizationType || 'hvm',
      hypervisor: instance.Hypervisor || 'xen',
      iamInstanceProfile: instance.IamInstanceProfile
        ? { arn: instance.IamInstanceProfile.Arn || instance.IamInstanceProfile }
        : undefined,
      groupSet: {
        item: (instance.SecurityGroupIds || []).map(groupId => ({
          groupId,
          groupName: groupId
        }))
      },
      tagSet: this._formatTags(instance.Tags)
    };
  }

  /**
   * Helper: monta o reservationSet (formato DescribeInstances / RunInstances)
   */
  static _reservationSet(instances) {
    return {
      item: [
        {
          reservationId: `r-${(instances[0] && instances[0].InstanceId) || 'default'}`.replace(
            /^r-i-/,
            'r-'
          ),
          ownerId: '123456789012',
          groupSet: { item: [] },
          instancesSet: {
            item: instances.map(i => this._instanceItem(i))
          }
        }
      ]
    };
  }

  /**
   * Formata resposta DescribeInstances para XML
   */
  static formatDescribeInstancesResponse(instances, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeInstancesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        reservationSet: this._reservationSet(instances)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta RunInstances para XML
   */
  static formatRunInstancesResponse(instances, requestId = 'ec2-request-1') {
    const xmlObj = {
      RunInstancesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        reservationId: `r-${(instances[0] && instances[0].InstanceId) || 'default'}`.replace(
          /^r-i-/,
          'r-'
        ),
        ownerId: '123456789012',
        groupSet: { item: [] },
        instancesSet: {
          item: instances.map(i => this._instanceItem(i))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta de mudança de estado (Start/Stop/Terminate/Reboot Instances)
   */
  static formatInstanceStateChangeResponse(action, instances, requestId = 'ec2-request-1') {
    const previousByAction = {
      StartInstances: 'stopped',
      StopInstances: 'running',
      TerminateInstances: 'running',
      RebootInstances: 'running'
    };
    const previous = previousByAction[action] || 'running';

    const xmlObj = {
      [`${action}Response`]: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        instancesSet: {
          item: instances.map(instance => ({
            instanceId: instance.InstanceId,
            currentState: this._instanceState(instance.State),
            previousState: this._instanceState(previous)
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeImages para XML
   */
  static formatDescribeImagesResponse(images, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeImagesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        imagesSet: {
          item: images.map(image => ({
            imageId: image.ImageId,
            imageLocation: image.Name,
            imageState: image.State || 'available',
            imageOwnerId: image.Owner || '123456789012',
            isPublic: image.Public !== false,
            architecture: image.Architecture || 'x86_64',
            imageType: 'machine',
            name: image.Name,
            description: image.Description || '',
            rootDeviceType: image.RootDeviceType || 'ebs',
            rootDeviceName: '/dev/sda1',
            virtualizationType: image.VirtualizationType || 'hvm',
            sriovNetSupport: image.SriovNetSupport || false,
            enaSupport: image.EnaSupport !== false,
            creationDate: image.CreatedAt
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um security group no XML
   */
  static _securityGroupXml(sg) {
    const toIpPermission = rule => ({
      ipProtocol: rule.IpProtocol,
      fromPort: rule.FromPort,
      toPort: rule.ToPort,
      groups: { item: [] },
      ipRanges: {
        item: (rule.IpRanges || []).map(range => ({
          cidrIp: range.CidrIp,
          description: range.Description || ''
        }))
      },
      prefixListIds: { item: [] },
      ipv6Ranges: { item: [] },
      userIdGroupPairs: {
        item: (rule.UserIdGroupPairs || []).map(pair => ({ groupId: pair.GroupId }))
      }
    });

    return {
      ownerId: sg.OwnerId || '123456789012',
      groupName: sg.GroupName,
      groupId: sg.GroupId,
      description: sg.Description || '',
      vpcId: sg.VpcId || '',
      ipPermissions: { item: (sg.IpPermissions || []).map(toIpPermission) },
      ipPermissionsEgress: { item: (sg.IpPermissionsEgress || []).map(toIpPermission) },
      tagSet: this._formatTags(sg.Tags)
    };
  }

  /**
   * Formata resposta DescribeSecurityGroups para XML
   */
  static formatDescribeSecurityGroupsResponse(securityGroups, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeSecurityGroupsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        securityGroupInfo: {
          item: securityGroups.map(sg => this._securityGroupXml(sg))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateSecurityGroup para XML
   */
  static formatCreateSecurityGroupResponse(securityGroup, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateSecurityGroupResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        groupId: securityGroup.GroupId,
        tagSet: this._formatTags(securityGroup.Tags)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteSecurityGroup para XML
   */
  static formatDeleteSecurityGroupResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeleteSecurityGroupResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta AuthorizeSecurityGroupIngress para XML
   */
  static formatAuthorizeSecurityGroupIngressResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      AuthorizeSecurityGroupIngressResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta RevokeSecurityGroupIngress para XML
   */
  static formatRevokeSecurityGroupIngressResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      RevokeSecurityGroupIngressResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeNetworkInterfaces para XML
   */
  static formatDescribeNetworkInterfacesResponse(enis, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeNetworkInterfacesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        networkInterfaceSet: {
          item: enis.map(eni => ({
            networkInterfaceId: eni.NetworkInterfaceId,
            subnetId: eni.SubnetId,
            vpcId: eni.VpcId,
            availabilityZone: eni.AvailabilityZone || 'us-east-1a',
            description: eni.Description || '',
            ownerId: '123456789012',
            status: eni.Status || 'available',
            macAddress: eni.MacAddress || '',
            privateIpAddress: eni.PrivateIpAddresses?.[0]?.PrivateIpAddress || '',
            sourceDestCheck: eni.SourceDestCheck !== false,
            groupSet: {
              item: (eni.Groups || []).map(groupId => ({ groupId }))
            },
            attachment: eni.Attachment
              ? {
                  attachmentId: eni.Attachment.AttachmentId,
                  instanceId: eni.Attachment.InstanceId,
                  deviceIndex: eni.Attachment.DeviceIndex,
                  status: eni.Attachment.Status,
                  attachTime: eni.Attachment.AttachTime,
                  deleteOnTermination: false
                }
              : undefined,
            privateIpAddressesSet: {
              item: (eni.PrivateIpAddresses || []).map(ip => ({
                privateIpAddress: ip.PrivateIpAddress,
                primary: !!ip.Primary
              }))
            },
            tagSet: this._formatTags(eni.Tags)
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta uma Network ACL no XML
   */
  static _networkAclXml(acl) {
    const entryToXml = entry => {
      const obj = {
        ruleNumber: entry.RuleNumber,
        protocol: String(entry.Protocol),
        ruleAction: entry.RuleAction,
        egress: !!entry.Egress,
        cidrBlock: entry.CidrBlock
      };
      if (entry.IcmpTypeCode) {
        obj.icmpTypeCode = {
          code: entry.IcmpTypeCode.Code,
          type: entry.IcmpTypeCode.Type
        };
      }
      if (entry.PortRange) {
        obj.portRange = {
          from: entry.PortRange.From,
          to: entry.PortRange.To
        };
      }
      return obj;
    };

    return {
      networkAclId: acl.NetworkAclId,
      vpcId: acl.VpcId,
      ownerId: acl.OwnerId || '123456789012',
      isDefault: !!acl.IsDefault,
      entrySet: { item: (acl.Entries || []).map(entryToXml) },
      associationSet: {
        item: (acl.Associations || []).map(assoc => ({
          networkAclAssociationId: assoc.NetworkAclAssociationId,
          networkAclId: assoc.NetworkAclId,
          subnetId: assoc.SubnetId
        }))
      },
      tagSet: this._formatTags(acl.Tags)
    };
  }

  /**
   * Formata resposta DescribeNetworkAcls para XML
   */
  static formatDescribeNetworkAclsResponse(networkAcls, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeNetworkAclsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        networkAclSet: {
          item: networkAcls.map(acl => this._networkAclXml(acl))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateNetworkAcl para XML
   */
  static formatCreateNetworkAclResponse(networkAcl, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateNetworkAclResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        networkAcl: this._networkAclXml(networkAcl)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteNetworkAcl para XML
   */
  static formatDeleteNetworkAclResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteNetworkAclResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateNetworkAclEntry para XML
   */
  static formatCreateNetworkAclEntryResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateNetworkAclEntryResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteNetworkAclEntry para XML
   */
  static formatDeleteNetworkAclEntryResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteNetworkAclEntryResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ReplaceNetworkAclAssociation para XML
   */
  static formatReplaceNetworkAclAssociationResponse(association, requestId = 'vpc-request-1') {
    const xmlObj = {
      ReplaceNetworkAclAssociationResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        newAssociationId: association.NetworkAclAssociationId
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um Volume EBS no XML
   */
  static _volumeXml(volume) {
    return {
      volumeId: volume.VolumeId,
      size: volume.Size,
      snapshotId: volume.SnapshotId || '',
      availabilityZone: volume.AvailabilityZone,
      status: volume.State,
      createTime: volume.CreateTime,
      volumeType: volume.VolumeType,
      iops: volume.Iops,
      throughput: volume.Throughput,
      encrypted: !!volume.Encrypted,
      multiAttachEnabled: !!volume.MultiAttachEnabled,
      attachmentSet: {
        item: (volume.Attachments || []).map(att => ({
          volumeId: att.VolumeId,
          instanceId: att.InstanceId,
          device: att.Device,
          status: att.State,
          attachTime: att.AttachTime,
          deleteOnTermination: !!att.DeleteOnTermination
        }))
      },
      tagSet: this._formatTags(volume.Tags)
    };
  }

  /**
   * Formata resposta DescribeVolumes para XML
   */
  static formatDescribeVolumesResponse(volumes, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeVolumesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        volumeSet: {
          item: volumes.map(v => this._volumeXml(v))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateVolume para XML
   */
  static formatCreateVolumeResponse(volume, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateVolumeResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        ...this._volumeXml(volume)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um anexo de volume no XML
   */
  static _volumeAttachmentXml(attachment) {
    return {
      volumeId: attachment.VolumeId,
      instanceId: attachment.InstanceId,
      device: attachment.Device,
      status: attachment.State,
      attachTime: attachment.AttachTime,
      deleteOnTermination: !!attachment.DeleteOnTermination
    };
  }

  /**
   * Formata resposta AttachVolume para XML
   */
  static formatAttachVolumeResponse(attachment, requestId = 'ec2-request-1') {
    const xmlObj = {
      AttachVolumeResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        ...this._volumeAttachmentXml(attachment)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DetachVolume para XML
   */
  static formatDetachVolumeResponse(attachment, requestId = 'ec2-request-1') {
    const xmlObj = {
      DetachVolumeResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        ...this._volumeAttachmentXml(attachment)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteVolume para XML
   */
  static formatDeleteVolumeResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeleteVolumeResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ModifyVolume para XML
   */
  static formatModifyVolumeResponse(modification, requestId = 'ec2-request-1') {
    const xmlObj = {
      ModifyVolumeResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        volumeModification: this._volumeModificationXml(modification)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta uma modificação de volume no XML
   */
  static _volumeModificationXml(mod) {
    return {
      volumeId: mod.VolumeId,
      modificationState: mod.ModificationState,
      targetSize: mod.TargetSize,
      targetVolumeType: mod.TargetVolumeType,
      targetIops: mod.TargetIops,
      targetThroughput: mod.TargetThroughput,
      originalSize: mod.OriginalSize,
      originalVolumeType: mod.OriginalVolumeType,
      originalIops: mod.OriginalIops,
      originalThroughput: mod.OriginalThroughput,
      progress: mod.Progress,
      startTime: mod.StartTime,
      endTime: mod.EndTime
    };
  }

  /**
   * Formata resposta DescribeVolumesModifications para XML
   */
  static formatDescribeVolumesModificationsResponse(modifications, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeVolumesModificationsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        volumeModificationSet: {
          item: modifications.map(m => this._volumeModificationXml(m))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeVolumeStatus para XML
   */
  static formatDescribeVolumeStatusResponse(volumes, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeVolumeStatusResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        volumeStatusSet: {
          item: volumes.map(v => ({
            volumeId: v.VolumeId,
            availabilityZone: v.AvailabilityZone,
            volumeStatus: {
              status: 'ok',
              details: { item: [] }
            },
            actionsSet: { item: [] },
            eventsSet: { item: [] }
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um Snapshot EBS no XML
   */
  static _snapshotXml(snapshot) {
    return {
      snapshotId: snapshot.SnapshotId,
      volumeId: snapshot.VolumeId,
      status: snapshot.State,
      startTime: snapshot.StartTime,
      progress: snapshot.Progress,
      ownerId: snapshot.OwnerId || '123456789012',
      volumeSize: snapshot.VolumeSize,
      description: snapshot.Description || '',
      encrypted: !!snapshot.Encrypted,
      tagSet: this._formatTags(snapshot.Tags)
    };
  }

  /**
   * Formata resposta DescribeSnapshots para XML
   */
  static formatDescribeSnapshotsResponse(snapshots, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeSnapshotsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        snapshotSet: {
          item: snapshots.map(s => this._snapshotXml(s))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateSnapshot para XML
   */
  static formatCreateSnapshotResponse(snapshot, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateSnapshotResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        ...this._snapshotXml(snapshot)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteSnapshot para XML
   */
  static formatDeleteSnapshotResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeleteSnapshotResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta o LaunchTemplateData no XML.
   */
  static _launchTemplateDataXml(data = {}) {
    const toBlockDevice = bdm => {
      const obj = { deviceName: bdm.DeviceName || bdm.deviceName };
      const ebs = bdm.Ebs || bdm.ebs;
      if (ebs) {
        obj.ebs = {
          volumeSize: ebs.VolumeSize,
          volumeType: ebs.VolumeType,
          deleteOnTermination: ebs.DeleteOnTermination,
          encrypted: ebs.Encrypted,
          iops: ebs.Iops,
          throughput: ebs.Throughput
        };
      }
      return obj;
    };

    const securityGroupIds = data.SecurityGroupIds || [];
    const networkInterfaces = data.NetworkInterfaces || [];

    return {
      imageId: data.ImageId,
      instanceType: data.InstanceType,
      keyName: data.KeyName,
      userData: data.UserData,
      securityGroupIdSet: {
        item: securityGroupIds.map(groupId => ({ groupId }))
      },
      iamInstanceProfile: data.IamInstanceProfile
        ? {
            arn: data.IamInstanceProfile.Arn || data.IamInstanceProfile.arn,
            name: data.IamInstanceProfile.Name || data.IamInstanceProfile.name
          }
        : undefined,
      monitoring: data.Monitoring ? { enabled: !!data.Monitoring.Enabled } : undefined,
      placement: data.Placement
        ? { availabilityZone: data.Placement.AvailabilityZone }
        : undefined,
      creditSpecification: data.CreditSpecification
        ? { cpuCredits: data.CreditSpecification.CpuCredits }
        : undefined,
      instanceInitiatedShutdownBehavior: data.ShutdownBehavior,
      metadataOptions: data.MetadataOptions,
      blockDeviceMappingSet: data.BlockDeviceMappings
        ? { item: data.BlockDeviceMappings.map(toBlockDevice) }
        : undefined,
      networkInterfaceSet: networkInterfaces.length
        ? {
            item: networkInterfaces.map(ni => ({
              deviceIndex: ni.DeviceIndex,
              subnetId: ni.SubnetId,
              description: ni.Description,
              groups: {
                item: (ni.Groups || []).map(groupId => ({ groupId }))
              },
              associatePublicIpAddress: ni.AssociatePublicIpAddress
            }))
          }
        : undefined,
      tagSpecificationSet: data.TagSpecifications
        ? {
            item: data.TagSpecifications.map(spec => ({
              resourceType: spec.ResourceType,
              tagSet: this._formatTags(spec.Tags || [])
            }))
          }
        : undefined
    };
  }

  /**
   * Helper: monta a representação de um launch template (sem versões).
   */
  static _launchTemplateXml(template) {
    return {
      launchTemplateId: template.LaunchTemplateId,
      launchTemplateName: template.LaunchTemplateName,
      createTime: template.CreateTime,
      createdBy: template.CreatedBy,
      defaultVersionNumber: template.DefaultVersionNumber,
      latestVersionNumber: template.LatestVersionNumber,
      tagSet: this._formatTags(template.Tags)
    };
  }

  /**
   * Helper: monta uma versão de launch template no XML.
   */
  static _launchTemplateVersionXml(version) {
    return {
      launchTemplateId: version.LaunchTemplateId,
      launchTemplateName: version.LaunchTemplateName,
      versionNumber: version.VersionNumber,
      versionDescription: version.VersionDescription,
      createTime: version.CreateTime,
      createdBy: version.CreatedBy,
      defaultVersion: !!version.DefaultVersion,
      launchTemplateData: this._launchTemplateDataXml(version.LaunchTemplateData)
    };
  }

  /**
   * Formata resposta DescribeLaunchTemplates para XML
   */
  static formatDescribeLaunchTemplatesResponse(templates, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeLaunchTemplatesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplates: {
          item: templates.map(t => this._launchTemplateXml(t))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateLaunchTemplate para XML
   */
  static formatCreateLaunchTemplateResponse(template, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateLaunchTemplateResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplate: this._launchTemplateXml(template)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeLaunchTemplateVersions para XML
   */
  static formatDescribeLaunchTemplateVersionsResponse(versions, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeLaunchTemplateVersionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplateVersionSet: {
          item: versions.map(v => this._launchTemplateVersionXml(v))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateLaunchTemplateVersion para XML
   */
  static formatCreateLaunchTemplateVersionResponse(version, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateLaunchTemplateVersionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplateVersion: this._launchTemplateVersionXml(version)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteLaunchTemplate para XML
   */
  static formatDeleteLaunchTemplateResponse(template, requestId = 'ec2-request-1') {
    const xmlObj = {
      DeleteLaunchTemplateResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplate: this._launchTemplateXml(template)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteLaunchTemplateVersions para XML
   */
  static formatDeleteLaunchTemplateVersionsResponse(
    template,
    deletedVersions = [],
    requestId = 'ec2-request-1'
  ) {
    const xmlObj = {
      DeleteLaunchTemplateVersionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplateVersionSet: {
          item: deletedVersions.map(versionNumber => ({
            launchTemplateId: template.LaunchTemplateId,
            launchTemplateName: template.LaunchTemplateName,
            versionNumber
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ModifyLaunchTemplate para XML
   */
  static formatModifyLaunchTemplateResponse(template, requestId = 'ec2-request-1') {
    const xmlObj = {
      ModifyLaunchTemplateResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplate: this._launchTemplateXml(template)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta GetLaunchTemplateData para XML
   */
  static formatGetLaunchTemplateDataResponse(version, requestId = 'ec2-request-1') {
    const xmlObj = {
      GetLaunchTemplateDataResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        launchTemplateData: this._launchTemplateDataXml(version.LaunchTemplateData)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um Elastic IP no XML
   */
  static _addressXml(address) {
    return {
      publicIp: address.PublicIp,
      allocationId: address.AllocationId,
      domain: address.Domain || 'vpc',
      associationId: address.AssociationId || undefined,
      instanceId: address.InstanceId || undefined,
      networkInterfaceId: address.NetworkInterfaceId || undefined,
      privateIpAddress: address.PrivateIpAddress || undefined,
      tagSet: this._formatTags(address.Tags)
    };
  }

  /**
   * Formata resposta DescribeAddresses para XML
   */
  static formatDescribeAddressesResponse(addresses, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeAddressesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        addressSet: {
          item: addresses.map(a => this._addressXml(a))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta AllocateAddress para XML
   */
  static formatAllocateAddressResponse(address, requestId = 'vpc-request-1') {
    const xmlObj = {
      AllocateAddressResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        publicIp: address.PublicIp,
        allocationId: address.AllocationId,
        domain: address.Domain || 'vpc',
        publicIpv4Pool: address.PublicIpv4Pool,
        networkBorderGroup: address.NetworkBorderGroup
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ReleaseAddress para XML
   */
  static formatReleaseAddressResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      ReleaseAddressResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta AssociateAddress para XML
   */
  static formatAssociateAddressResponse(address, requestId = 'vpc-request-1') {
    const xmlObj = {
      AssociateAddressResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        associationId: address.AssociationId
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DisassociateAddress para XML
   */
  static formatDisassociateAddressResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DisassociateAddressResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um Egress-only Internet Gateway no XML
   */
  static _egressOnlyIgwXml(eigw) {
    return {
      egressOnlyInternetGatewayId: eigw.EgressOnlyInternetGatewayId,
      attachmentSet: {
        item: (eigw.Attachments || []).map(att => ({
          vpcId: att.VpcId,
          state: att.State || 'attached'
        }))
      },
      tagSet: this._formatTags(eigw.Tags)
    };
  }

  /**
   * Formata resposta DescribeEgressOnlyInternetGateways para XML
   */
  static formatDescribeEgressOnlyInternetGatewaysResponse(eigws, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeEgressOnlyInternetGatewaysResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        egressOnlyInternetGatewaySet: {
          item: eigws.map(e => this._egressOnlyIgwXml(e))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateEgressOnlyInternetGateway para XML
   */
  static formatCreateEgressOnlyInternetGatewayResponse(eigw, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateEgressOnlyInternetGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        egressOnlyInternetGateway: this._egressOnlyIgwXml(eigw),
        clientToken: ''
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteEgressOnlyInternetGateway para XML
   */
  static formatDeleteEgressOnlyInternetGatewayResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteEgressOnlyInternetGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        returnCode: true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um DHCP option set no XML
   */
  static _dhcpOptionsXml(options) {
    return {
      dhcpOptionsId: options.DhcpOptionsId,
      dhcpConfigurationSet: {
        item: (options.DhcpConfigurations || []).map(cfg => ({
          key: cfg.Key,
          valueSet: {
            item: (cfg.Values || []).map(v => ({ value: v.Value }))
          }
        }))
      },
      tagSet: this._formatTags(options.Tags)
    };
  }

  /**
   * Formata resposta DescribeDhcpOptions para XML
   */
  static formatDescribeDhcpOptionsResponse(optionsList, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeDhcpOptionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        dhcpOptionsSet: {
          item: optionsList.map(o => this._dhcpOptionsXml(o))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateDhcpOptions para XML
   */
  static formatCreateDhcpOptionsResponse(options, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateDhcpOptionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        dhcpOptions: this._dhcpOptionsXml(options)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteDhcpOptions para XML
   */
  static formatDeleteDhcpOptionsResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteDhcpOptionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta AssociateDhcpOptions para XML
   */
  static formatAssociateDhcpOptionsResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      AssociateDhcpOptionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um NAT Gateway no XML
   */
  static _natGatewayXml(natGw) {
    const addressItem = {
      allocationId: natGw.AllocationId || undefined,
      publicIp: natGw.PublicIp || undefined,
      privateIp: natGw.PrivateIp || undefined,
      networkInterfaceId: natGw.NetworkInterfaceId || undefined
    };

    return {
      natGatewayId: natGw.NatGatewayId,
      subnetId: natGw.SubnetId,
      state: natGw.State,
      createTime: natGw.CreateTime,
      deleteTime: natGw.DeleteTime || undefined,
      connectivityType: natGw.ConnectivityType || 'public',
      failureCode: natGw.FailureCode || undefined,
      failureMessage: natGw.FailureMessage || undefined,
      natGatewayAddressSet: {
        item: [addressItem]
      },
      tagSet: this._formatTags(natGw.Tags)
    };
  }

  /**
   * Formata resposta DescribeNatGateways para XML
   */
  static formatDescribeNatGatewaysResponse(natGateways, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeNatGatewaysResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        natGatewaySet: {
          item: natGateways.map(ng => this._natGatewayXml(ng))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateNatGateway para XML
   */
  static formatCreateNatGatewayResponse(natGw, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateNatGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        natGateway: this._natGatewayXml(natGw),
        clientToken: ''
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteNatGateway para XML
   */
  static formatDeleteNatGatewayResponse(natGatewayId, requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteNatGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        natGatewayId: natGatewayId
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um VPC Endpoint no XML
   */
  static _vpcEndpointXml(endpoint) {
    const result = {
      vpcEndpointId: endpoint.VpcEndpointId,
      vpcEndpointType: endpoint.VpcEndpointType,
      vpcId: endpoint.VpcId,
      serviceName: endpoint.ServiceName,
      state: endpoint.State,
      policyDocument: endpoint.PolicyDocument
        ? typeof endpoint.PolicyDocument === 'string'
          ? endpoint.PolicyDocument
          : JSON.stringify(endpoint.PolicyDocument)
        : undefined,
      routeTableIdSet: { item: (endpoint.RouteTableIds || []).map(id => ({ routeTableId: id })) },
      subnetIdSet: { item: (endpoint.SubnetIds || []).map(id => ({ subnetId: id })) },
      groupSet: { item: (endpoint.SecurityGroupIds || []).map(id => ({ groupId: id })) },
      networkInterfaceIdSet: {
        item: (endpoint.NetworkInterfaceIds || []).map(id => ({ networkInterfaceId: id }))
      },
      dnsEntrySet: { item: [] },
      privateDnsEnabled: !!endpoint.PrivateDnsEnabled,
      requesterManaged: false,
      ownerId: endpoint.OwnerId || '123456789012',
      creationTimestamp: endpoint.CreationTimestamp,
      tagSet: this._formatTags(endpoint.Tags)
    };
    return result;
  }

  /**
   * Formata resposta DescribeVpcEndpoints para XML
   */
  static formatDescribeVpcEndpointsResponse(endpoints, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpcEndpointsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpcEndpointSet: {
          item: endpoints.map(e => this._vpcEndpointXml(e))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateVpcEndpoint para XML
   */
  static formatCreateVpcEndpointResponse(endpoint, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateVpcEndpointResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpcEndpoint: this._vpcEndpointXml(endpoint),
        clientToken: ''
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ModifyVpcEndpoint para XML
   */
  static formatModifyVpcEndpointResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      ModifyVpcEndpointResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteVpcEndpoint para XML
   */
  static formatDeleteVpcEndpointsResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteVpcEndpointsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        unsuccessful: { item: [] }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta o bloco *VpcInfo de uma conexão de peering
   */
  static _peeringVpcInfoXml(info = {}) {
    return {
      vpcId: info.VpcId,
      ownerId: info.OwnerId || '123456789012',
      cidrBlock: info.CidrBlock,
      region: info.Region || 'us-east-1',
      cidrBlockSet: {
        item: (info.CidrBlockSet || (info.CidrBlock ? [{ CidrBlock: info.CidrBlock }] : [])).map(c => ({
          cidrBlock: c.CidrBlock
        }))
      },
      peeringOptions: info.PeeringOptions
        ? {
            allowDnsResolutionFromRemoteVpc:
              !!info.PeeringOptions.AllowDnsResolutionFromRemoteVpc,
            allowEgressFromLocalClassicLinkToRemoteVpc:
              !!info.PeeringOptions.AllowEgressFromLocalClassicLinkToRemoteVpc,
            allowEgressFromLocalVpcToRemoteClassicLink:
              !!info.PeeringOptions.AllowEgressFromLocalVpcToRemoteClassicLink
          }
        : undefined
    };
  }

  /**
   * Helper: monta uma VPC Peering Connection no XML
   */
  static _peeringConnectionXml(connection) {
    return {
      vpcPeeringConnectionId: connection.VpcPeeringConnectionId,
      requesterVpcInfo: this._peeringVpcInfoXml(connection.RequesterVpcInfo),
      accepterVpcInfo: this._peeringVpcInfoXml(connection.AccepterVpcInfo),
      status: {
        code: connection.Status?.Code,
        message: connection.Status?.Message
      },
      tagSet: this._formatTags(connection.Tags),
      expirationTime: connection.ExpirationTime || undefined
    };
  }

  /**
   * Formata resposta DescribeVpcPeeringConnections para XML
   */
  static formatDescribeVpcPeeringConnectionsResponse(connections, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpcPeeringConnectionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpcPeeringConnectionSet: {
          item: connections.map(c => this._peeringConnectionXml(c))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateVpcPeeringConnection para XML
   */
  static formatCreateVpcPeeringConnectionResponse(connection, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateVpcPeeringConnectionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpcPeeringConnection: this._peeringConnectionXml(connection)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta AcceptVpcPeeringConnection para XML
   */
  static formatAcceptVpcPeeringConnectionResponse(connection, requestId = 'vpc-request-1') {
    const xmlObj = {
      AcceptVpcPeeringConnectionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpcPeeringConnection: this._peeringConnectionXml(connection)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta RejectVpcPeeringConnection para XML
   */
  static formatRejectVpcPeeringConnectionResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      RejectVpcPeeringConnectionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteVpcPeeringConnection para XML
   */
  static formatDeleteVpcPeeringConnectionResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteVpcPeeringConnectionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta uma configuração de serviço de endpoint no XML
   */
  static _endpointServiceConfigXml(service) {
    return {
      serviceId: service.ServiceId,
      serviceName: service.ServiceName,
      serviceState: service.ServiceState,
      serviceType: {
        item: (service.ServiceType || []).map(t => ({ serviceType: t.ServiceType }))
      },
      networkLoadBalancerArnSet: {
        item: (service.NetworkLoadBalancerArns || []).map(arn => ({
          networkLoadBalancerArn: arn
        }))
      },
      baseEndpointDnsNameSet: {
        item: (service.BaseEndpointDnsNames || []).map(name => ({ dnsName: name }))
      },
      availabilityZoneSet: {
        item: (service.AvailabilityZones || []).map(zone => ({ zoneName: zone.ZoneName }))
      },
      acceptanceRequired: !!service.AcceptanceRequired,
      privateDnsName: service.PrivateDnsName || undefined,
      tagSet: this._formatTags(service.Tags)
    };
  }

  /**
   * Formata resposta DescribeVpcEndpointServiceConfigurations para XML
   */
  static formatDescribeVpcEndpointServiceConfigurationsResponse(services, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpcEndpointServiceConfigurationsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        serviceConfigurationSet: {
          item: services.map(s => this._endpointServiceConfigXml(s))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta CreateVpcEndpointServiceConfiguration para XML
   */
  static formatCreateVpcEndpointServiceConfigurationResponse(service, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateVpcEndpointServiceConfigurationResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        serviceConfiguration: this._endpointServiceConfigXml(service)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ModifyVpcEndpointServiceConfiguration para XML
   */
  static formatModifyVpcEndpointServiceConfigurationResponse(service, requestId = 'vpc-request-1') {
    const xmlObj = {
      ModifyVpcEndpointServiceConfigurationResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteVpcEndpointServiceConfigurations para XML
   */
  static formatDeleteVpcEndpointServiceConfigurationsResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteVpcEndpointServiceConfigurationsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        unsuccessful: { item: [] }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeVpcEndpointServices para XML
   */
  static formatDescribeVpcEndpointServicesResponse(services, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpcEndpointServicesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        serviceNameSet: {
          item: services.map(s => ({ serviceName: s.ServiceName }))
        },
        serviceDetailSet: {
          item: services.map(s => ({
            serviceName: s.ServiceName,
            serviceId: s.ServiceId,
            serviceType: {
              item: (s.ServiceType || []).map(t => ({ serviceType: t.ServiceType }))
            },
            availabilityZoneSet: {
              item: (s.AvailabilityZones || []).map(z => ({ zoneName: z.ZoneName || z }))
            },
            baseEndpointDnsNameSet: {
              item: (s.BaseEndpointDnsNames || []).map(name => ({ dnsName: name }))
            },
            owner: s.Owner,
            acceptanceRequired: !!s.AcceptanceRequired,
            privateDnsName: s.PrivateDnsName || undefined,
            vpcEndpointPolicySupported: !!s.VpcEndpointPolicySupported
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um Customer Gateway no XML
   */
  static _customerGatewayXml(gateway) {
    return {
      customerGatewayId: gateway.CustomerGatewayId,
      state: gateway.State,
      type: gateway.Type,
      ipAddress: gateway.IpAddress || undefined,
      bgpAsn: gateway.BgpAsn,
      certificateArn: gateway.CertificateArn || undefined,
      tagSet: this._formatTags(gateway.Tags)
    };
  }

  static formatDescribeCustomerGatewaysResponse(gateways, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeCustomerGatewaysResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        customerGatewaySet: { item: gateways.map(g => this._customerGatewayXml(g)) }
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatCreateCustomerGatewayResponse(gateway, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateCustomerGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        customerGateway: this._customerGatewayXml(gateway)
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatDeleteCustomerGatewayResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteCustomerGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };
    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um VPN Gateway no XML
   */
  static _vpnGatewayXml(gateway) {
    return {
      vpnGatewayId: gateway.VpnGatewayId,
      state: gateway.State,
      type: gateway.Type,
      availabilityZone: gateway.AvailabilityZone || undefined,
      amazonSideAsn: gateway.AmazonSideAsn,
      vpcAttachmentSet: {
        item: (gateway.VpcAttachments || []).map(a => ({
          vpcId: a.VpcId,
          state: a.State
        }))
      },
      tagSet: this._formatTags(gateway.Tags)
    };
  }

  static formatDescribeVpnGatewaysResponse(gateways, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpnGatewaysResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpnGatewaySet: { item: gateways.map(g => this._vpnGatewayXml(g)) }
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatCreateVpnGatewayResponse(gateway, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateVpnGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpnGateway: this._vpnGatewayXml(gateway)
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatAttachVpnGatewayResponse(vpcId, requestId = 'vpc-request-1') {
    const xmlObj = {
      AttachVpnGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        attachment: { vpcId, state: 'attached' }
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatDetachVpnGatewayResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DetachVpnGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatDeleteVpnGatewayResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteVpnGatewayResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };
    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta uma VPN Connection no XML
   */
  static _vpnConnectionXml(connection) {
    return {
      vpnConnectionId: connection.VpnConnectionId,
      state: connection.State,
      customerGatewayId: connection.CustomerGatewayId,
      vpnGatewayId: connection.VpnGatewayId,
      category: connection.Category || 'VPN',
      type: connection.Type,
      options: {
        staticRoutesOnly: !!(connection.Options && connection.Options.StaticRoutesOnly),
        tunnelOptionSet: {
          item: ((connection.Options && connection.Options.TunnelOptions) || []).map(t => ({
            outsideIpAddress: t.OutsideIpAddress,
            tunnelInsideCidr: t.TunnelInsideCidr
          }))
        }
      },
      vgwTelemetry: {
        item: (connection.VgwTelemetry || []).map(t => ({
          outsideIpAddress: t.OutsideIpAddress,
          status: t.Status,
          acceptedRouteCount: t.AcceptedRouteCount
        }))
      },
      tagSet: this._formatTags(connection.Tags)
    };
  }

  static formatDescribeVpnConnectionsResponse(connections, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeVpnConnectionsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpnConnectionSet: { item: connections.map(c => this._vpnConnectionXml(c)) }
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatCreateVpnConnectionResponse(connection, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateVpnConnectionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        vpnConnection: this._vpnConnectionXml(connection)
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatDeleteVpnConnectionResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteVpnConnectionResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };
    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta um Client VPN Endpoint no XML
   */
  static _clientVpnEndpointXml(endpoint) {
    return {
      clientVpnEndpointId: endpoint.ClientVpnEndpointId,
      description: endpoint.Description || undefined,
      status: { code: endpoint.Status && endpoint.Status.Code },
      clientCidrBlock: endpoint.ClientCidrBlock,
      dnsServerSet: { item: (endpoint.DnsServers || []).map(d => ({ dnsName: d })) },
      splitTunnel: !!endpoint.SplitTunnel,
      vpnProtocol: endpoint.VpnProtocol,
      transportProtocol: endpoint.TransportProtocol,
      vpnPort: endpoint.VpnPort,
      associatedTargetNetwork: {
        item: (endpoint.AssociatedTargetNetworks || []).map(n => ({
          networkId: n.TargetNetworkId,
          networkType: 'subnet',
          status: { code: n.Status && n.Status.Code }
        }))
      },
      authenticationOptions: {
        item: (endpoint.AuthenticationOptions || []).map(a => ({ type: a.Type }))
      },
      connectionLogOptions: { enabled: !!(endpoint.ConnectionLogOptions && endpoint.ConnectionLogOptions.Enabled) },
      serverCertificateArn: endpoint.ServerCertificateArn || undefined,
      securityGroupIdSet: {
        item: (endpoint.SecurityGroupIds || []).map(id => ({ groupId: id }))
      },
      vpcId: endpoint.VpcId || undefined,
      selfServicePortal: endpoint.SelfServicePortal,
      clientConnectOptions: { enabled: !!(endpoint.ClientConnectOptions && endpoint.ClientConnectOptions.Enabled) },
      sessionTimeoutHours: endpoint.SessionTimeoutHours,
      creationTime: endpoint.CreationTime,
      tagSet: this._formatTags(endpoint.Tags)
    };
  }

  static formatDescribeClientVpnEndpointsResponse(endpoints, requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeClientVpnEndpointsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        clientVpnEndpoint: { item: endpoints.map(e => this._clientVpnEndpointXml(e)) }
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatCreateClientVpnEndpointResponse(endpoint, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateClientVpnEndpointResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        clientVpnEndpointId: endpoint.ClientVpnEndpointId,
        status: { code: endpoint.Status && endpoint.Status.Code },
        dnsName: `${endpoint.ClientVpnEndpointId}.cvpn-endpoint.us-east-1.amazonaws.com`
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatDeleteClientVpnEndpointResponse(requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteClientVpnEndpointResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        status: { code: 'deleting' }
      }
    };
    return this._buildXml(xmlObj);
  }

  static formatAssociateClientVpnTargetNetworkResponse(endpoint, subnetId, requestId = 'vpc-request-1') {
    const xmlObj = {
      AssociateClientVpnTargetNetworkResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        associationId: `cvpn-assoc-${endpoint.ClientVpnEndpointId.replace('cvpn-endpoint-', '')}`,
        status: { code: 'associating' },
        subnetId
      }
    };
    return this._buildXml(xmlObj);
  }

  /**
   * Helper: monta uma Managed Prefix List no XML
   */
  static _managedPrefixListXml(list) {
    return {
      prefixListId: list.PrefixListId,
      prefixListName: list.PrefixListName,
      addressFamily: list.AddressFamily,
      maxEntries: list.MaxEntries,
      state: list.State,
      version: list.Version,
      ownerId: list.OwnerId,
      prefixListArn: list.PrefixListArn,
      tagSet: this._formatTags(list.Tags)
    };
  }

  /**
   * Formata resposta CreateManagedPrefixList para XML
   */
  static formatCreateManagedPrefixListResponse(list, requestId = 'vpc-request-1') {
    const xmlObj = {
      CreateManagedPrefixListResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        prefixList: this._managedPrefixListXml(list)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DescribeManagedPrefixLists para XML
   */
  static formatDescribeManagedPrefixListsResponse(lists = [], requestId = 'vpc-request-1') {
    const xmlObj = {
      DescribeManagedPrefixListsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        prefixListSet: {
          item: lists.map(list => this._managedPrefixListXml(list))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta DeleteManagedPrefixList para XML
   */
  static formatDeleteManagedPrefixListResponse(list = {}, requestId = 'vpc-request-1') {
    const xmlObj = {
      DeleteManagedPrefixListResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        prefixList: {
          prefixListId: list.PrefixListId,
          state: 'delete-complete'
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta ModifyManagedPrefixList para XML
   */
  static formatModifyManagedPrefixListResponse(list, requestId = 'vpc-request-1') {
    const xmlObj = {
      ModifyManagedPrefixListResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        prefixList: this._managedPrefixListXml(list)
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata resposta GetManagedPrefixListEntries para XML
   */
  static formatGetManagedPrefixListEntriesResponse(
    { entries = [], nextToken = null },
    requestId = 'vpc-request-1'
  ) {
    const xmlObj = {
      GetManagedPrefixListEntriesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        entrySet: {
          item: entries.map(entry => ({
            cidr: entry.Cidr,
            description: entry.Description || undefined
          }))
        },
        nextToken: nextToken || undefined
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Key Pairs ───────────────────────────────────────────────────────────

  static formatCreateKeyPairResponse(keyPair, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateKeyPairResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        keyName: keyPair.KeyName,
        keyFingerprint: keyPair.KeyFingerprint,
        keyMaterial: keyPair.PrivateKeyMaterial || '',
        keyPairId: keyPair.KeyPairId
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatImportKeyPairResponse(keyPair, requestId = 'ec2-request-1') {
    const xmlObj = {
      ImportKeyPairResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        keyName: keyPair.KeyName,
        keyFingerprint: keyPair.KeyFingerprint,
        keyPairId: keyPair.KeyPairId,
        tagSet: this._formatTags(keyPair.Tags)
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDescribeKeyPairsResponse(keyPairs, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeKeyPairsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        keySet: {
          item: keyPairs.map(kp => ({
            keyName: kp.KeyName,
            keyFingerprint: kp.KeyFingerprint,
            keyPairId: kp.KeyPairId,
            keyType: kp.KeyType || 'rsa',
            tagSet: this._formatTags(kp.Tags)
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDeleteKeyPairResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeleteKeyPairResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Placement Groups ────────────────────────────────────────────────────

  static formatCreatePlacementGroupResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      CreatePlacementGroupResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDescribePlacementGroupsResponse(groups, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribePlacementGroupsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        placementGroupSet: {
          item: groups.map(g => ({
            groupName: g.GroupName,
            groupId: g.GroupId,
            strategy: g.Strategy,
            state: g.State,
            partitionCount: g.PartitionCount,
            tagSet: this._formatTags(g.Tags)
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDeletePlacementGroupResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeletePlacementGroupResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Dedicated Hosts ─────────────────────────────────────────────────────

  static _dedicatedHostXml(host, formatter) {
    return {
      hostId: host.HostId,
      hostProperties: {
        instanceType: host.InstanceType,
        cores: 4,
        sockets: 2,
        totalVCpus: 8
      },
      state: host.State,
      availabilityZone: host.AvailabilityZone,
      allocationTime: host.AllocationTime,
      autoPlacement: host.AutoPlacement,
      hostRecovery: host.HostRecovery,
      instanceFamily: 'm5',
      ownerId: host.OwnerId || '123456789012',
      availableCapacity: {
        availableInstanceCapacity: {
          item: (host.AvailableCapacity?.AvailableInstanceCapacity || []).map(c => ({
            instanceType: c.InstanceType,
            availableCapacity: c.AvailableCapacity,
            totalCapacity: c.TotalCapacity
          }))
        },
        availableVCpus: host.AvailableCapacity?.AvailableVCpus || 0
      },
      instances: { item: [] },
      tagSet: formatter._formatTags(host.Tags)
    };
  }

  static formatAllocateHostsResponse(hostIds, requestId = 'ec2-request-1') {
    const xmlObj = {
      AllocateHostsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        hostIdSet: { item: hostIds }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDescribeHostsResponse(hosts, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeHostsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        hostSet: { item: hosts.map(h => this._dedicatedHostXml(h, this)) }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatReleaseHostsResponse(hostIds, requestId = 'ec2-request-1') {
    const xmlObj = {
      ReleaseHostsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        successful: { item: hostIds },
        unsuccessful: { item: [] }
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Capacity Reservations ───────────────────────────────────────────────

  static _capacityReservationXml(cr) {
    return {
      capacityReservationId: cr.CapacityReservationId,
      ownerId: cr.OwnerId || '123456789012',
      capacityReservationArn: `arn:aws:ec2:us-east-1:123456789012:capacity-reservation/${cr.CapacityReservationId}`,
      availabilityZone: cr.AvailabilityZone,
      instanceType: cr.InstanceType,
      instancePlatform: cr.InstancePlatform,
      tenancy: cr.Tenancy,
      totalInstanceCount: cr.TotalInstanceCount,
      availableInstanceCount: cr.AvailableInstanceCount,
      ebsOptimized: cr.EbsOptimized,
      state: cr.State,
      startDate: cr.StartDate,
      endDateType: cr.EndDateType,
      createDate: cr.CreateDate
    };
  }

  static formatCreateCapacityReservationResponse(cr, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateCapacityReservationResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        capacityReservation: this._capacityReservationXml(cr)
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDescribeCapacityReservationsResponse(reservations, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeCapacityReservationsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        capacityReservationSet: {
          item: reservations.map(cr => this._capacityReservationXml(cr))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatCancelCapacityReservationResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      CancelCapacityReservationResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Spot Instance Requests ──────────────────────────────────────────────

  static _spotRequestXml(sir) {
    return {
      spotInstanceRequestId: sir.SpotInstanceRequestId,
      spotPrice: sir.SpotPrice,
      type: sir.Type,
      state: sir.State,
      status: {
        code: sir.Status?.Code,
        message: sir.Status?.Message,
        updateTime: sir.Status?.UpdateTime
      },
      instanceId: sir.InstanceId,
      createTime: sir.CreateTime,
      productDescription: sir.ProductDescription,
      instanceType: sir.InstanceType,
      launchSpecification: {
        imageId: sir.ImageId,
        instanceType: sir.InstanceType,
        availabilityZone: sir.AvailabilityZone
      },
      tagSet: this._formatTags(sir.Tags)
    };
  }

  static formatRequestSpotInstancesResponse(requests, requestId = 'ec2-request-1') {
    const xmlObj = {
      RequestSpotInstancesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        spotInstanceRequestSet: {
          item: requests.map(sir => this._spotRequestXml(sir))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDescribeSpotInstanceRequestsResponse(requests, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeSpotInstanceRequestsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        spotInstanceRequestSet: {
          item: requests.map(sir => this._spotRequestXml(sir))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatCancelSpotInstanceRequestsResponse(results, requestId = 'ec2-request-1') {
    const xmlObj = {
      CancelSpotInstanceRequestsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        spotInstanceRequestSet: {
          item: results.map(r => ({
            spotInstanceRequestId: r.SpotInstanceRequestId,
            state: r.State
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Reserved Instances ──────────────────────────────────────────────────

  static formatDescribeReservedInstancesOfferingsResponse(offerings, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeReservedInstancesOfferingsResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        reservedInstancesOfferingsSet: {
          item: offerings.map(o => ({
            reservedInstancesOfferingId: o.ReservedInstancesOfferingId,
            instanceType: o.InstanceType,
            availabilityZone: o.AvailabilityZone,
            duration: o.Duration,
            fixedPrice: o.FixedPrice,
            usagePrice: o.UsagePrice,
            productDescription: o.ProductDescription,
            instanceTenancy: o.InstanceTenancy,
            currencyCode: o.CurrencyCode,
            offeringType: o.OfferingType,
            recurringCharges: { item: [] },
            marketplace: o.Marketplace,
            offeringClass: o.OfferingClass,
            scope: o.Scope
          }))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static _reservedInstanceXml(ri, formatter) {
    return {
      reservedInstancesId: ri.ReservedInstancesId,
      instanceType: ri.InstanceType,
      availabilityZone: ri.AvailabilityZone,
      duration: ri.Duration,
      usagePrice: ri.UsagePrice,
      fixedPrice: ri.FixedPrice,
      instanceCount: ri.InstanceCount,
      productDescription: ri.ProductDescription,
      state: ri.State,
      start: ri.Start,
      end: ri.End,
      instanceTenancy: ri.InstanceTenancy,
      currencyCode: ri.CurrencyCode,
      offeringType: ri.OfferingType,
      offeringClass: ri.OfferingClass,
      scope: ri.Scope,
      tagSet: formatter._formatTags(ri.Tags)
    };
  }

  static formatPurchaseReservedInstancesOfferingResponse(reservation, requestId = 'ec2-request-1') {
    const xmlObj = {
      PurchaseReservedInstancesOfferingResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        reservedInstancesId: reservation.ReservedInstancesId
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDescribeReservedInstancesResponse(reservations, requestId = 'ec2-request-1') {
    const xmlObj = {
      DescribeReservedInstancesResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        reservedInstancesSet: {
          item: reservations.map(ri => this._reservedInstanceXml(ri, this))
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── AMI Register/Deregister ─────────────────────────────────────────────

  static formatRegisterImageResponse(imageId, requestId = 'ec2-request-1') {
    const xmlObj = {
      RegisterImageResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        imageId
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDeregisterImageResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeregisterImageResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  // ── Network Interface Create/Delete ─────────────────────────────────────

  static formatCreateNetworkInterfaceResponse(eni, requestId = 'ec2-request-1') {
    const xmlObj = {
      CreateNetworkInterfaceResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        networkInterface: {
          networkInterfaceId: eni.NetworkInterfaceId,
          subnetId: eni.SubnetId,
          vpcId: eni.VpcId,
          availabilityZone: eni.AvailabilityZone || 'us-east-1a',
          description: eni.Description || '',
          ownerId: '123456789012',
          status: eni.Status || 'available',
          macAddress: eni.MacAddress || '',
          privateIpAddress: eni.PrivateIpAddresses?.[0]?.PrivateIpAddress || '',
          sourceDestCheck: eni.SourceDestCheck !== false,
          groupSet: { item: (eni.Groups || []).map(groupId => ({ groupId })) },
          privateIpAddressesSet: {
            item: (eni.PrivateIpAddresses || []).map(ip => ({
              privateIpAddress: ip.PrivateIpAddress,
              primary: !!ip.Primary
            }))
          },
          tagSet: this._formatTags(eni.Tags)
        }
      }
    };

    return this._buildXml(xmlObj);
  }

  static formatDeleteNetworkInterfaceResponse(requestId = 'ec2-request-1') {
    const xmlObj = {
      DeleteNetworkInterfaceResponse: {
        '@xmlns': 'http://ec2.amazonaws.com/doc/2016-11-15/',
        requestId,
        'return': true
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Formata erro para XML
   */
  static formatErrorResponse(code, message, requestId = 'vpc-request-1') {
    const xmlObj = {
      Response: {
        Errors: {
          Error: {
            Code: code,
            Message: message
          }
        },
        RequestId: requestId
      }
    };

    return this._buildXml(xmlObj);
  }

  /**
   * Helper: formata tags em XML
   */
  static _formatTags(tags = []) {
    if (!tags || tags.length === 0) {
      return { item: [] };
    }

    return {
      item: tags.map(tag => ({
        key: tag.Key || tag.key,
        value: tag.Value || tag.value
      }))
    };
  }

  /**
   * Helper: converte zona de disponibilidade para AZ ID
   */
  static _getAZId(availabilityZone) {
    // Exemplo: us-east-1a -> use1-az1
    const azMap = {
      'us-east-1a': 'use1-az1',
      'us-east-1b': 'use1-az2',
      'us-east-1c': 'use1-az4',
      'us-west-1a': 'usw1-az1',
      'us-west-1b': 'usw1-az2',
      'eu-west-1a': 'euw1-az1',
      'eu-west-1b': 'euw1-az2',
      'eu-west-1c': 'euw1-az3'
    };

    return azMap[availabilityZone] || 'use1-az1';
  }

  /**
   * Helper: constrói XML a partir de objeto
   */
  static _buildXml(obj) {
    const root = xml.create(obj);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + root.toString();
  }
}

module.exports = EC2ResponseFormatter;
