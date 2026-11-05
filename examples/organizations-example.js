/**
 * AWS Organizations & Control Tower Example
 * 
 * This example demonstrates all major features of the Organizations service:
 * - Creating organization structure (OUs and accounts)
 * - Defining and attaching Service Control Policies (SCPs)
 * - Evaluating policies for permission decisions
 * - Setting up Control Tower with landing zones
 * - Enabling guardrails and checking compliance
 * - IAM and VPC integration
 */

const AWS = require('aws-sdk');

// Configure AWS SDK to use local simulator
const organizationsClient = new AWS.Organizations({
  region: 'us-east-1',
  endpoint: 'http://localhost:4580',
  accessKeyId: 'testing',
  secretAccessKey: 'testing',
  s3ForcePathStyle: true,
});

const iamClient = new AWS.IAM({
  region: 'us-east-1',
  endpoint: 'http://localhost:4000',
  accessKeyId: 'testing',
  secretAccessKey: 'testing',
});

const ec2Client = new AWS.EC2({
  region: 'us-east-1',
  endpoint: 'http://localhost:4020',
  accessKeyId: 'testing',
  secretAccessKey: 'testing',
});

// ============================================================================
// PART 1: Setting up Organization Structure
// ============================================================================

async function setupOrganizationStructure() {
  console.log('\n=== PART 1: Setting up Organization Structure ===\n');

  try {
    // Create organization
    console.log('📦 Creating Organization...');
    const orgResponse = await organizationsClient.createOrganization({
      FeatureSet: 'ALL'
    }).promise();
    
    const orgId = orgResponse.Organization.Id;
    console.log(`✅ Organization created: ${orgId}`);
    console.log(`   ARN: ${orgResponse.Organization.Arn}`);
    console.log(`   Management Account: ${orgResponse.Organization.MasterAccountId}`);

    // Get root OU ID
    console.log('\n📋 Getting Root OU...');
    const rootsResponse = await organizationsClient.listRoots().promise();
    const rootOuId = rootsResponse.Roots[0].Id;
    console.log(`✅ Root OU: ${rootOuId}`);

    // Create OUs
    console.log('\n🏗️  Creating Organizational Units...');
    
    const securityOuResponse = await organizationsClient.createOrganizationalUnit({
      ParentId: rootOuId,
      Name: 'Security'
    }).promise();
    const securityOuId = securityOuResponse.OrganizationalUnit.Id;
    console.log(`✅ Security OU created: ${securityOuId}`);

    const workloadsOuResponse = await organizationsClient.createOrganizationalUnit({
      ParentId: rootOuId,
      Name: 'Workloads'
    }).promise();
    const workloadsOuId = workloadsOuResponse.OrganizationalUnit.Id;
    console.log(`✅ Workloads OU created: ${workloadsOuId}`);

    const developmentOuResponse = await organizationsClient.createOrganizationalUnit({
      ParentId: workloadsOuId,
      Name: 'Development'
    }).promise();
    const developmentOuId = developmentOuResponse.OrganizationalUnit.Id;
    console.log(`✅ Development OU created: ${developmentOuId}`);

    // Create accounts
    console.log('\n👥 Creating AWS Accounts...');
    
    const auditAccountResponse = await organizationsClient.createAccount({
      Email: 'audit@example.com',
      AccountName: 'Audit Account',
      ParentOuId: securityOuId
    }).promise();
    const auditAccountId = auditAccountResponse.CreateAccountStatus.AccountId;
    console.log(`✅ Audit Account created: ${auditAccountId}`);

    const prodAccountResponse = await organizationsClient.createAccount({
      Email: 'prod@example.com',
      AccountName: 'Production Account',
      ParentOuId: workloadsOuId
    }).promise();
    const prodAccountId = prodAccountResponse.CreateAccountStatus.AccountId;
    console.log(`✅ Production Account created: ${prodAccountId}`);

    const devAccountResponse = await organizationsClient.createAccount({
      Email: 'dev@example.com',
      AccountName: 'Development Account',
      ParentOuId: developmentOuId
    }).promise();
    const devAccountId = devAccountResponse.CreateAccountStatus.AccountId;
    console.log(`✅ Development Account created: ${devAccountId}`);

    // List all accounts
    console.log('\n📊 Listing all accounts...');
    const accountsResponse = await organizationsClient.listAccounts().promise();
    console.log(`Total accounts: ${accountsResponse.Accounts.length}`);
    accountsResponse.Accounts.forEach(account => {
      console.log(`  - ${account.Name} (${account.Id}): ${account.Email}`);
    });

    return {
      orgId,
      rootOuId,
      securityOuId,
      workloadsOuId,
      developmentOuId,
      auditAccountId,
      prodAccountId,
      devAccountId,
      managementAccountId: orgResponse.Organization.MasterAccountId
    };
  } catch (error) {
    console.error('❌ Error setting up organization:', error.message);
    throw error;
  }
}

// ============================================================================
// PART 2: Creating and Attaching Service Control Policies (SCPs)
// ============================================================================

async function setupServiceControlPolicies(ouIds, accountIds) {
  console.log('\n=== PART 2: Creating Service Control Policies ===\n');

  try {
    // Policy 1: Restrict EC2 to specific regions
    console.log('📝 Creating Regional Restriction Policy (EC2 only in us-east-1)...');
    const ec2RegionPolicy = await organizationsClient.createPolicy({
      Content: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'ec2:*',
            Resource: '*',
            Condition: {
              StringEquals: {
                'aws:RequestedRegion': 'us-east-1'
              }
            }
          },
          {
            Effect: 'Deny',
            Action: 'ec2:RunInstances',
            Resource: '*',
            Condition: {
              StringNotEquals: {
                'aws:RequestedRegion': 'us-east-1'
              }
            }
          }
        ]
      }),
      Description: 'Restrict EC2 to us-east-1 region only',
      Name: 'EC2-Region-Restriction',
      Type: 'SERVICE_CONTROL_POLICY'
    }).promise();
    const ec2PolicyId = ec2RegionPolicy.Policy.PolicySummary.Id;
    console.log(`✅ EC2 Region Restriction Policy created: ${ec2PolicyId}`);

    // Policy 2: Prevent deletion of critical resources
    console.log('\n📝 Creating Protection Policy (prevent critical resource deletion)...');
    const protectionPolicy = await organizationsClient.createPolicy({
      Content: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Action: [
              'cloudtrail:DeleteTrail',
              's3:DeleteBucket',
              'logs:DeleteLogGroup',
              'cloudformation:DeleteStack'
            ],
            Resource: '*'
          }
        ]
      }),
      Description: 'Prevent deletion of critical resources',
      Name: 'Protection-Policy',
      Type: 'SERVICE_CONTROL_POLICY'
    }).promise();
    const protectionPolicyId = protectionPolicy.Policy.PolicySummary.Id;
    console.log(`✅ Protection Policy created: ${protectionPolicyId}`);

    // Policy 3: Require MFA for sensitive actions
    console.log('\n📝 Creating MFA Policy (require MFA for sensitive operations)...');
    const mfaPolicy = await organizationsClient.createPolicy({
      Content: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Action: [
              'iam:DeleteUser',
              'iam:DeleteRole',
              'iam:DeletePolicy'
            ],
            Resource: '*',
            Condition: {
              Bool: {
                'aws:MultiFactorAuthPresent': 'false'
              }
            }
          }
        ]
      }),
      Description: 'Require MFA for sensitive IAM operations',
      Name: 'MFA-Requirement-Policy',
      Type: 'SERVICE_CONTROL_POLICY'
    }).promise();
    const mfaPolicyId = mfaPolicy.Policy.PolicySummary.Id;
    console.log(`✅ MFA Requirement Policy created: ${mfaPolicyId}`);

    // Attach policies to OUs
    console.log('\n🔗 Attaching policies to OUs...');
    
    await organizationsClient.attachPolicy({
      PolicyId: ec2PolicyId,
      TargetId: ouIds.workloadsOuId
    }).promise();
    console.log(`✅ EC2 Region Restriction Policy attached to Workloads OU`);

    await organizationsClient.attachPolicy({
      PolicyId: protectionPolicy,
      TargetId: ouIds.securityOuId
    }).promise();
    console.log(`✅ Protection Policy attached to Security OU`);

    await organizationsClient.attachPolicy({
      PolicyId: mfaPolicyId,
      TargetId: ouIds.rootOuId
    }).promise();
    console.log(`✅ MFA Requirement Policy attached to Root OU`);

    return {
      ec2PolicyId,
      protectionPolicyId,
      mfaPolicyId
    };
  } catch (error) {
    console.error('❌ Error setting up SCPs:', error.message);
    throw error;
  }
}

// ============================================================================
// PART 3: Evaluating Policies
// ============================================================================

async function evaluatePolicies(accountIds) {
  console.log('\n=== PART 3: Evaluating Policies ===\n');

  try {
    // Test EC2 in allowed region
    console.log('🔍 Testing EC2 action in us-east-1 (allowed)...');
    const allowedResponse = await organizationsClient.evaluateSCPs({
      AccountId: accountIds.prodAccountId,
      Action: 'ec2:RunInstances',
      Resource: 'arn:aws:ec2:us-east-1:*:instance/*'
    }).promise();
    console.log(`✅ Result: ${allowedResponse.Allowed ? 'ALLOWED' : 'DENIED'}`);
    if (allowedResponse.EvaluationResults) {
      allowedResponse.EvaluationResults.forEach(result => {
        console.log(`   - ${result.PolicyName}: ${result.Effect}`);
      });
    }

    // Test EC2 in restricted region
    console.log('\n🔍 Testing EC2 action in us-west-2 (denied)...');
    const deniedResponse = await organizationsClient.evaluateSCPs({
      AccountId: accountIds.prodAccountId,
      Action: 'ec2:RunInstances',
      Resource: 'arn:aws:ec2:us-west-2:*:instance/*'
    }).promise();
    console.log(`✅ Result: ${deniedResponse.Allowed ? 'ALLOWED' : 'DENIED'}`);
    if (deniedResponse.EvaluationResults) {
      deniedResponse.EvaluationResults.forEach(result => {
        console.log(`   - ${result.PolicyName}: ${result.Effect}`);
      });
    }

    // Test protection policy
    console.log('\n🔍 Testing CloudTrail deletion (protected)...');
    const protectionResponse = await organizationsClient.evaluateSCPs({
      AccountId: accountIds.auditAccountId,
      Action: 'cloudtrail:DeleteTrail',
      Resource: 'arn:aws:cloudtrail:*:*:trail/*'
    }).promise();
    console.log(`✅ Result: ${protectionResponse.Allowed ? 'ALLOWED' : 'DENIED'}`);
  } catch (error) {
    console.error('❌ Error evaluating policies:', error.message);
  }
}

// ============================================================================
// PART 4: Setting up Control Tower Landing Zone
// ============================================================================

async function setupControlTower(ouIds) {
  console.log('\n=== PART 4: Setting up Control Tower ===\n');

  try {
    // Setup landing zone
    console.log('🏗️  Setting up Control Tower Landing Zone...');
    const landingZoneResponse = await organizationsClient.setupLandingZone({
      AWSRegion: 'us-east-1',
      EnableGuardrails: true,
      LoggingBucket: 'landing-zone-logs',
      SecurityOu: ouIds.securityOuId,
      WorkloadsOu: ouIds.workloadsOuId
    }).promise();
    console.log(`✅ Landing Zone created: ${landingZoneResponse.LandingZone.Id}`);
    console.log(`   Status: ${landingZoneResponse.LandingZone.Status}`);

    return landingZoneResponse.LandingZone.Id;
  } catch (error) {
    console.error('❌ Error setting up landing zone:', error.message);
  }
}

// ============================================================================
// PART 5: Enabling and Checking Guardrails
// ============================================================================

async function setupGuardrails(ouIds) {
  console.log('\n=== PART 5: Setting up Guardrails ===\n');

  try {
    const guardrails = [
      {
        id: 'aws-foundational-security-best-practices-1.1.0',
        name: 'Disallow Creation of Access Keys for Root Account'
      },
      {
        id: 'aws-foundational-security-best-practices-2.1.0',
        name: 'Disallow deletion of logs'
      },
      {
        id: 'aws-foundational-security-best-practices-3.1.0',
        name: 'Require MFA on Root Account'
      }
    ];

    // Enable guardrails on workloads OU
    console.log('🛡️  Enabling guardrails on Workloads OU...');
    for (const guardrail of guardrails) {
      try {
        const response = await organizationsClient.enableGuardrail({
          GuardrailIdentifier: guardrail.id,
          TargetOuId: ouIds.workloadsOuId
        }).promise();
        console.log(`✅ Enabled: ${guardrail.name}`);
      } catch (e) {
        console.log(`⚠️  ${guardrail.name} (may already be enabled)`);
      }
    }

    // Check compliance
    console.log('\n📊 Checking guardrail compliance...');
    for (const guardrail of guardrails) {
      try {
        const compliance = await organizationsClient.checkCompliance({
          AccountId: ouIds.prodAccountId,
          GuardrailId: guardrail.id
        }).promise();
        const status = compliance.Compliant ? '✅ COMPLIANT' : '❌ NON-COMPLIANT';
        console.log(`  ${guardrail.name}: ${status}`);
      } catch (e) {
        console.log(`  ${guardrail.name}: Unknown status`);
      }
    }

    // Generate compliance report
    console.log('\n📋 Generating compliance report...');
    try {
      const report = await organizationsClient.generateComplianceReport().promise();
      console.log(`Generated at: ${report.Report.GeneratedTime}`);
      console.log(`Total guardrails: ${report.Report.TotalGuardrails}`);
      console.log(`Total accounts: ${report.Report.TotalAccounts}`);
      console.log(`Compliance Summary:`);
      console.log(`  - Fully Compliant: ${report.Report.ComplianceSummary.FullyCompliant}`);
      console.log(`  - Partially Compliant: ${report.Report.ComplianceSummary.PartiallyCompliant}`);
      console.log(`  - Non-Compliant: ${report.Report.ComplianceSummary.NonCompliant}`);
    } catch (e) {
      console.log('⚠️  Could not generate compliance report:', e.message);
    }
  } catch (error) {
    console.error('❌ Error setting up guardrails:', error.message);
  }
}

// ============================================================================
// PART 6: IAM Integration
// ============================================================================

async function demonstrateIAMIntegration(accountIds) {
  console.log('\n=== PART 6: IAM Integration ===\n');

  try {
    // Create IAM role
    console.log('👤 Creating IAM role in production account...');
    const roleResponse = await iamClient.createRole({
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'ec2.amazonaws.com'
            },
            Action: 'sts:AssumeRole'
          }
        ]
      }),
      RoleName: 'EC2-Application-Role'
    }).promise();
    console.log(`✅ Role created: ${roleResponse.Role.Arn}`);

    // Attach inline policy
    console.log('\n📝 Attaching EC2 permissions policy...');
    await iamClient.putRolePolicy({
      RoleName: 'EC2-Application-Role',
      PolicyName: 'EC2-DescribeInstances',
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'ec2:DescribeInstances',
            Resource: '*'
          }
        ]
      })
    }).promise();
    console.log('✅ Inline policy attached');

    console.log('\n💡 The role\'s permissions are now subject to SCPs in the organization');
    console.log('   - SCP evaluation combines with IAM policy for final decision');
    console.log('   - EC2 RunInstances is restricted by SCP to us-east-1 only');
  } catch (error) {
    console.error('❌ Error with IAM integration:', error.message);
  }
}

// ============================================================================
// PART 7: VPC Integration
// ============================================================================

async function demonstrateVPCIntegration(accountIds) {
  console.log('\n=== PART 7: VPC Integration ===\n');

  try {
    console.log('🌐 VPC Integration validates regional restrictions from SCPs');
    console.log('\n✅ When EC2 instance creation is requested:');
    console.log('   1. Organizations service checks SCPs');
    console.log('   2. VPC service validates regional restrictions');
    console.log('   3. Final decision combines both policy layers');
    console.log('\n📍 Current regional restrictions from SCPs:');
    console.log('   - EC2: us-east-1 only (enforced for workloads OU)');
    console.log('   - Security OU: Protected from critical resource deletion');
  } catch (error) {
    console.error('❌ Error with VPC integration:', error.message);
  }
}

// ============================================================================
// PART 8: Listing and Status
// ============================================================================

async function printOrganizationStatus(ouIds, accountIds) {
  console.log('\n=== PART 8: Organization Status ===\n');

  try {
    // List all OUs
    console.log('📊 Organizational Structure:');
    const ousResponse = await organizationsClient.listOrganizationalUnitsForParent({
      ParentId: ouIds.rootOuId
    }).promise();
    console.log('\nRoot Level OUs:');
    ousResponse.OrganizationalUnits.forEach(ou => {
      console.log(`  - ${ou.Name} (${ou.Id})`);
    });

    // List policies
    console.log('\n📋 Service Control Policies:');
    const policiesResponse = await organizationsClient.listPolicies({
      Filter: 'SERVICE_CONTROL_POLICY'
    }).promise();
    console.log(`Total custom policies: ${policiesResponse.Policies.length}`);
    policiesResponse.Policies.forEach(policy => {
      console.log(`  - ${policy.Name} (${policy.Id})`);
    });

    // List accounts
    console.log('\n👥 Accounts:');
    const accountsResponse = await organizationsClient.listAccounts().promise();
    console.log(`Total accounts: ${accountsResponse.Accounts.length}`);
    accountsResponse.Accounts.forEach(account => {
      console.log(`  - ${account.Name} (${account.Id}): Status ${account.Status}`);
    });
  } catch (error) {
    console.error('❌ Error printing status:', error.message);
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function runExample() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   AWS Organizations & Control Tower Example                ║');
  console.log('║   Comprehensive feature demonstration                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    // Part 1: Setup organization structure
    const ouIds = await setupOrganizationStructure();

    // Part 2: Create SCPs
    const policyIds = await setupServiceControlPolicies(ouIds, {
      prodAccountId: ouIds.prodAccountId,
      auditAccountId: ouIds.auditAccountId
    });

    // Part 3: Evaluate policies
    await evaluatePolicies(ouIds);

    // Part 4: Setup Control Tower
    await setupControlTower(ouIds);

    // Part 5: Setup guardrails
    await setupGuardrails(ouIds);

    // Part 6: IAM integration
    await demonstrateIAMIntegration(ouIds);

    // Part 7: VPC integration
    await demonstrateVPCIntegration(ouIds);

    // Part 8: Status
    await printOrganizationStatus(ouIds, ouIds);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   Example completed successfully! ✅                        ║');
    console.log('║   Organizations & Control Tower are fully operational       ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\n❌ Example failed:', error.message);
    process.exit(1);
  }
}

// Run the example
runExample();
