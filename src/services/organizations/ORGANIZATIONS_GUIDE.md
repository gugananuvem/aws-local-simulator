# AWS Organizations & Control Tower Guide

## Overview

The Organizations service in AWS Local Simulator provides a complete simulation of AWS Organizations and AWS Control Tower, including:

- **Organization Management**: Create and manage AWS Organizations with hierarchical structure (Organization → OUs → Accounts)
- **Service Control Policies (SCPs)**: Define and evaluate permission boundaries at the organization level
- **Control Tower**: Set up landing zones with guardrails (preventive and detective)
- **IAM Integration**: Evaluate combined SCP + IAM policies for permission decisions
- **VPC Integration**: Validate regional restrictions and resource constraints
- **Compliance Reporting**: Generate compliance reports for Control Tower guardrails

## Service Configuration

**Default Port**: `4580`
**Service Name**: `organizations`
**Dependencies**: IAM service

### Enable in Config

```javascript
// config.js
module.exports = {
  services: {
    organizations: true,
  },
  ports: {
    organizations: 4580,
  }
};
```

## Architecture

### Models

#### Organization
Represents the root organization structure with organizational units (OUs) and accounts.

```
Organization
  ├── Root OU (ou-0000-root)
  │   ├── OU: Security (ou-xxxx)
  │   │   └── Account: audit-account-123456
  │   ├── OU: Workloads (ou-yyyy)
  │   │   ├── Account: prod-account-987654
  │   │   └── Account: dev-account-555555
  │   └── Policies (SCPs)
  └── Management Account: 123456789012
```

#### Service Control Policy (SCP)
Defines permission boundaries using AWS Policy Language with support for:
- Allow/Deny statements
- Wildcard pattern matching (`*`, `service:*`)
- Resource ARNs
- Conditions

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ec2:*",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        }
      }
    },
    {
      "Effect": "Deny",
      "Action": "iam:DeleteUser",
      "Resource": "*"
    }
  ]
}
```

#### Organizational Role
Represents a role within the organization hierarchy with trust policies and permissions.

#### Control Tower Guardrails
- **Preventive**: Block certain actions (e.g., "Disallow Creation of Access Keys")
- **Detective**: Monitor and report (e.g., "Detect CloudTrail Disabled")

### Simulators

#### OrganizationsSimulator
Manages organization structure, policies, and evaluation logic.

**Key Methods**:
- `createOrganization()` - Initialize organization
- `createOrganizationalUnit(parentId, name)` - Create OU
- `createAccount(email, name, parentOuId)` - Create new AWS account
- `attachPolicy(policyId, targetId)` - Attach SCP to OU or account
- `evaluateSCPs(accountId, action, resource)` - Evaluate if action is allowed
- `listAccounts()` - List all accounts
- `describeOrganization()` - Get organization details

#### ControlTowerSimulator
Manages landing zones, guardrails, and compliance.

**Key Methods**:
- `setupLandingZone(config)` - Initialize landing zone
- `enableGuardrail(guardrailId, targetOuId)` - Enable guardrail
- `checkCompliance(accountId, guardrailId)` - Check if account complies
- `generateComplianceReport()` - Generate full compliance report

### Integration Modules

#### IAMIntegration
Combines SCP evaluation with IAM policies for final permission decision.

**Supports**:
- Assume role validation
- Principal evaluation (user, role, assumed-role)
- Condition checking (IP, region, time)
- Combined Allow/Deny logic

#### VPCIntegration
Validates regional restrictions and resource constraints from SCPs.

**Validates**:
- Regional restrictions per SCP
- Resource type constraints
- CIDR block validation
- Security group rule validation

## REST API Reference

### Base URL
```
http://localhost:4580
```

### Organizations Operations

#### CreateOrganization
Creates a new AWS Organization.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.CreateOrganization

{
  "FeatureSet": "ALL"
}
```

**Response**:
```json
{
  "Organization": {
    "Arn": "arn:aws:organizations::123456789012:organization/o-exampleorgid",
    "Id": "o-exampleorgid",
    "MasterAccountArn": "arn:aws:organizations::123456789012:account/o-exampleorgid/123456789012",
    "MasterAccountEmail": "org-admin@example.com",
    "MasterAccountId": "123456789012",
    "FeatureSet": "ALL",
    "Arn": "arn:aws:organizations::123456789012:organization/o-exampleorgid",
    "CreatedTime": "2024-01-15T10:00:00.000Z"
  }
}
```

#### DescribeOrganization
Get organization details.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.DescribeOrganization
```

**Response**:
```json
{
  "Organization": {
    "Id": "o-exampleorgid",
    "Arn": "arn:aws:organizations::123456789012:organization/o-exampleorgid",
    "MasterAccountId": "123456789012",
    "MasterAccountArn": "arn:aws:organizations::123456789012:account/o-exampleorgid/123456789012",
    "MasterAccountEmail": "org-admin@example.com",
    "FeatureSet": "ALL",
    "CreatedTime": "2024-01-15T10:00:00.000Z"
  }
}
```

#### CreateOrganizationalUnit
Create an OU within the organization.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.CreateOrganizationalUnit

{
  "ParentId": "ou-0000-root",
  "Name": "Security"
}
```

**Response**:
```json
{
  "OrganizationalUnit": {
    "Id": "ou-xxxx-security",
    "Arn": "arn:aws:organizations::123456789012:ou/o-exampleorgid/ou-xxxx-security",
    "Name": "Security",
    "CreatedTime": "2024-01-15T10:00:00.000Z"
  }
}
```

#### CreateAccount
Create a new AWS account in the organization.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.CreateAccount

{
  "Email": "account-admin@example.com",
  "AccountName": "Production Account",
  "ParentOuId": "ou-xxxx-workloads"
}
```

**Response**:
```json
{
  "CreateAccountStatus": {
    "Id": "car-examplecreateaccountrequestid",
    "Status": "SUCCEEDED",
    "AccountName": "Production Account",
    "Email": "account-admin@example.com",
    "GovCloudAccountId": null,
    "AccountId": "987654321098"
  }
}
```

#### ListAccounts
List all accounts in the organization.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.ListAccounts
```

**Response**:
```json
{
  "Accounts": [
    {
      "Id": "123456789012",
      "Arn": "arn:aws:organizations::123456789012:account/o-exampleorgid/123456789012",
      "Email": "org-admin@example.com",
      "Name": "Management Account",
      "Status": "ACTIVE",
      "JoinedMethod": "INVITED",
      "JoinedTimestamp": "2024-01-15T10:00:00.000Z"
    },
    {
      "Id": "987654321098",
      "Arn": "arn:aws:organizations::123456789012:account/o-exampleorgid/987654321098",
      "Email": "prod@example.com",
      "Name": "Production Account",
      "Status": "ACTIVE",
      "JoinedMethod": "CREATED",
      "JoinedTimestamp": "2024-01-15T10:05:00.000Z"
    }
  ]
}
```

#### ListOrganizationalUnitsForParent
List OUs under a parent.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.ListOrganizationalUnitsForParent

{
  "ParentId": "ou-0000-root"
}
```

**Response**:
```json
{
  "OrganizationalUnits": [
    {
      "Id": "ou-xxxx-security",
      "Arn": "arn:aws:organizations::123456789012:ou/o-exampleorgid/ou-xxxx-security",
      "Name": "Security",
      "CreatedTime": "2024-01-15T10:00:00.000Z"
    },
    {
      "Id": "ou-yyyy-workloads",
      "Arn": "arn:aws:organizations::123456789012:ou/o-exampleorgid/ou-yyyy-workloads",
      "Name": "Workloads",
      "CreatedTime": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

#### CreatePolicy
Create a Service Control Policy.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.CreatePolicy

{
  "Content": {
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "ec2:*",
        "Resource": "*",
        "Condition": {
          "StringEquals": {
            "aws:RequestedRegion": "us-east-1"
          }
        }
      }
    ]
  },
  "Description": "Restrict EC2 to us-east-1 only",
  "Name": "EC2-Region-Restriction",
  "Type": "SERVICE_CONTROL_POLICY"
}
```

**Response**:
```json
{
  "Policy": {
    "PolicySummary": {
      "Id": "p-examplepolicyid",
      "Arn": "arn:aws:organizations::123456789012:policy/o-exampleorgid/service_control_policy/p-examplepolicyid",
      "Name": "EC2-Region-Restriction",
      "Description": "Restrict EC2 to us-east-1 only",
      "Type": "SERVICE_CONTROL_POLICY",
      "AwsManaged": false,
      "CreatedTime": "2024-01-15T10:00:00.000Z"
    },
    "Content": "{\"Statement\": [{...}]}"
  }
}
```

#### AttachPolicy
Attach a policy to an OU or account.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSOrganizationsV20161128.AttachPolicy

{
  "PolicyId": "p-examplepolicyid",
  "TargetId": "ou-xxxx-security"
}
```

**Response**:
```json
{}
```

#### EvaluateSCPs
Evaluate if an action is allowed by SCPs.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: Custom.EvaluateSCPs

{
  "AccountId": "987654321098",
  "Action": "ec2:RunInstances",
  "Resource": "arn:aws:ec2:us-west-2:987654321098:instance/*"
}
```

**Response**:
```json
{
  "Allowed": true,
  "EvaluationResults": [
    {
      "PolicyId": "p-examplepolicyid",
      "PolicyName": "EC2-Region-Restriction",
      "Effect": "Allow"
    }
  ]
}
```

### Control Tower Operations

#### SetupLandingZone
Configure a Control Tower landing zone.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: Custom.SetupLandingZone

{
  "AWSRegion": "us-east-1",
  "EnableGuardrails": true,
  "LoggingBucket": "landing-zone-logs",
  "SecurityOu": "ou-xxxx-security",
  "WorkloadsOu": "ou-yyyy-workloads"
}
```

**Response**:
```json
{
  "LandingZone": {
    "Arn": "arn:aws:controltower::123456789012:landing-zone/lz-exampleid",
    "Id": "lz-exampleid",
    "Status": "ACTIVE",
    "LatestAvailableVersion": "3.1.0",
    "LatestDeployedVersion": "3.1.0",
    "ManifestVersion": "2.0",
    "CreatedTime": "2024-01-15T10:00:00.000Z"
  }
}
```

#### EnableGuardrail
Enable a guardrail for an OU.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: Custom.EnableGuardrail

{
  "GuardrailIdentifier": "aws-foundational-security-best-practices-1.1.0",
  "TargetOuId": "ou-yyyy-workloads"
}
```

**Response**:
```json
{
  "Guardrail": {
    "GuardrailId": "gr-exampleid",
    "Name": "Disallow Creation of Access Keys",
    "Type": "PREVENTIVE",
    "Status": "ENABLED",
    "TargetOuId": "ou-yyyy-workloads",
    "CreatedTime": "2024-01-15T10:00:00.000Z"
  }
}
```

#### CheckCompliance
Check if account complies with guardrails.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: Custom.CheckCompliance

{
  "AccountId": "987654321098",
  "GuardrailId": "aws-foundational-security-best-practices-1.1.0"
}
```

**Response**:
```json
{
  "Compliant": true,
  "GuardrailId": "aws-foundational-security-best-practices-1.1.0",
  "AccountId": "987654321098",
  "LastCheckedTime": "2024-01-15T10:00:00.000Z"
}
```

#### GenerateComplianceReport
Generate full compliance report.

**Request**:
```bash
POST /
Content-Type: application/x-amz-json-1.1
X-Amz-Target: Custom.GenerateComplianceReport
```

**Response**:
```json
{
  "Report": {
    "GeneratedTime": "2024-01-15T10:00:00.000Z",
    "TotalGuardrails": 15,
    "TotalAccounts": 5,
    "ComplianceSummary": {
      "FullyCompliant": 3,
      "PartiallyCompliant": 1,
      "NonCompliant": 1
    },
    "AccountCompliance": [
      {
        "AccountId": "987654321098",
        "AccountName": "Production",
        "ComplianceScore": 100,
        "GuardrailStatus": [
          {
            "GuardrailId": "aws-foundational-security-best-practices-1.1.0",
            "Status": "COMPLIANT"
          }
        ]
      }
    ]
  }
}
```

## Policy Language

### Statement Structure

```json
{
  "Statement": [
    {
      "Effect": "Allow|Deny",
      "Action": "service:action|service:*|*",
      "Resource": "arn:aws:service::account:resource|*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        },
        "IpAddress": {
          "aws:SourceIp": "192.0.2.0/24"
        }
      }
    }
  ]
}
```

### Pattern Matching

**Wildcard support**:
- `*` - Matches any string
- `service:*` - All actions in a service
- `*:action` - Action across all services
- `arn:aws:service:*:account:*` - Wildcard in resource ARN

### Evaluation Order

1. **Explicit Deny** - Immediate deny if any policy has explicit Deny
2. **Explicit Allow** - Allow if any policy grants Allow
3. **Default Deny** - Implicit deny if no explicit Allow

### Conditions

Supported condition operators:
- `StringEquals`, `StringNotEquals`
- `StringLike`, `StringNotLike`
- `IpAddress`, `NotIpAddress`
- `Bool`
- `Date` (ISO 8601 format)
- `Numeric`

## Integration with Other Services

### IAM Integration

```javascript
// Check if IAM role can perform action (considers both IAM policies and SCPs)
const allowed = organizationsService.evaluateIAMAction(
  roleId,
  'ec2:RunInstances',
  'arn:aws:ec2:us-east-1:*:instance/*'
);
```

### VPC Integration

```javascript
// Validate if EC2 instance creation is allowed in region
const allowed = organizationsService.validateRegionalRestrictions(
  accountId,
  'us-east-1',
  'ec2'
);
```

### EC2 Integration

```javascript
// Check if instance can be created considering SCPs and regional restrictions
const allowed = organizationsService.validateEC2Instance(
  accountId,
  't2.micro',
  'us-east-1'
);
```

## Compliance and Governance

### Built-in Guardrails

**Preventive Guardrails**:
- Disallow Creation of Access Keys
- Disallow Public S3 Bucket Access
- Disallow Deletion of CloudTrail Logs
- Enforce MFA on Root Account
- Enforce IMDSv2 on EC2 Instances

**Detective Guardrails**:
- Detect CloudTrail Disabled
- Detect S3 Public Bucket
- Detect Unencrypted RDS Database
- Detect Missing VPC Encryption
- Detect IAM Root Account Usage

### Audit Trail

All organization actions are logged with:
- Timestamp
- User/Principal
- Action
- Resource
- Effect (Allow/Deny)
- Conditions evaluated

Access via:
```bash
GET /__admin/organizations/audit-log
```

## Best Practices

1. **Policy Hierarchy**: Design policies to be clear and maintainable
2. **Least Privilege**: Apply most restrictive policies at OU level
3. **Regular Audits**: Use compliance reports to identify gaps
4. **Testing**: Use evaluation endpoints to test policies before attaching
5. **Documentation**: Document policy intent and conditions
6. **Review**: Regularly review attached policies and guardrails
7. **Regional Strategy**: Clearly define regional restrictions

## Troubleshooting

### Policy Not Taking Effect

1. Check policy is attached to correct OU/Account
2. Use `EvaluateSCPs` endpoint to test
3. Verify syntax of SCP JSON
4. Check for conflicting policies

### Guardrail Not Enforcing

1. Verify guardrail is enabled for the OU
2. Check account is in scope OU
3. Verify guardrail type (Preventive vs Detective)
4. Review compliance report

### Cross-Service Permission Issues

1. Verify combined IAM + SCP evaluation
2. Check conditions (region, IP, time)
3. Review integration logs
4. Test with simplified policy first

## Performance Considerations

- **Policy Evaluation**: Optimized for O(n) where n = number of attached policies
- **Compliance Checks**: Run asynchronously for large organizations
- **Caching**: Policy evaluation results cached for 60 seconds
- **Concurrency**: Thread-safe operations for multi-threaded usage
