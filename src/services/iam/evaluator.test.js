const IAMSimulator = require('./simulator');

// Mock logger to avoid console noise during tests
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}));

// Mock fs to avoid actual disk I/O during unit tests
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn()
}));

describe('IAMSimulator - Policy Evaluation Engine (Task 8.1)', () => {
  let simulator;

  beforeEach(async () => {
    simulator = new IAMSimulator({});
    // Set up a user with an access key
    await simulator.createUser({ UserName: 'testuser' });
    const key = await simulator.createAccessKey({ UserName: 'testuser' });
    simulator._testAccessKeyId = key.AccessKeyId;
  });

  describe('resolveIdentity', () => {
    it('should return identity for a valid access key', () => {
      const identity = simulator.resolveIdentity(simulator._testAccessKeyId);

      expect(identity).not.toBeNull();
      expect(identity.type).toBe('user');
      expect(identity.userName).toBe('testuser');
      expect(identity.accessKeyId).toBe(simulator._testAccessKeyId);
    });

    it('should return null for an unknown access key', () => {
      const identity = simulator.resolveIdentity('AKIANONEXISTENT');

      expect(identity).toBeNull();
    });
  });

  describe('_collectPolicies', () => {
    it('should return empty array when user has no policies', () => {
      const identity = { type: 'user', userName: 'testuser' };
      const statements = simulator._collectPolicies(identity);

      expect(statements).toEqual([]);
    });

    it('should collect statements from directly attached user policies', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sqs:*', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'SQSAccess', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/SQSAccess' });

      const identity = { type: 'user', userName: 'testuser' };
      const statements = simulator._collectPolicies(identity);

      expect(statements).toHaveLength(1);
      expect(statements[0].Effect).toBe('Allow');
      expect(statements[0].Action).toBe('sqs:*');
    });

    it('should collect statements from group policies', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sns:Publish', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'SNSPublish', PolicyDocument: policyDoc });
      await simulator.createGroup({ GroupName: 'publishers' });
      await simulator.addUserToGroup({ GroupName: 'publishers', UserName: 'testuser' });
      await simulator.attachGroupPolicy({ GroupName: 'publishers', PolicyArn: 'arn:aws:iam::123456789012:policy/SNSPublish' });

      const identity = { type: 'user', userName: 'testuser' };
      const statements = simulator._collectPolicies(identity);

      expect(statements).toHaveLength(1);
      expect(statements[0].Action).toBe('sns:Publish');
    });

    it('should collect statements from multiple policies across user and groups', async () => {
      const userPolicyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' }]
      };
      const groupPolicyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sns:Publish', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'UserPolicy', PolicyDocument: userPolicyDoc });
      await simulator.createPolicy({ PolicyName: 'GroupPolicy', PolicyDocument: groupPolicyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/UserPolicy' });
      await simulator.createGroup({ GroupName: 'mygroup' });
      await simulator.addUserToGroup({ GroupName: 'mygroup', UserName: 'testuser' });
      await simulator.attachGroupPolicy({ GroupName: 'mygroup', PolicyArn: 'arn:aws:iam::123456789012:policy/GroupPolicy' });

      const identity = { type: 'user', userName: 'testuser' };
      const statements = simulator._collectPolicies(identity);

      expect(statements).toHaveLength(2);
    });
  });

  describe('evaluateAccess', () => {
    it('should deny access when accessKeyId is invalid', () => {
      const result = simulator.evaluateAccess({
        accessKeyId: 'AKIAINVALID',
        action: 'sqs:SendMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
        context: {}
      });

      expect(result).toBe('Deny');
    });

    it('should deny access when no policies are attached (default deny)', () => {
      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:SendMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
        context: {}
      });

      expect(result).toBe('Deny');
    });

    it('should allow access when an Allow policy matches', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'AllowSQS', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/AllowSQS' });

      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:SendMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
        context: {}
      });

      expect(result).toBe('Allow');
    });

    it('should deny access when an explicit Deny policy matches', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Action: '*', Resource: '*' },
          { Effect: 'Deny', Action: 'sqs:DeleteQueue', Resource: '*' }
        ]
      };
      await simulator.createPolicy({ PolicyName: 'DenyDelete', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/DenyDelete' });

      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:DeleteQueue',
        resource: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
        context: {}
      });

      expect(result).toBe('Deny');
    });

    it('should allow access when wildcard Action matches', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'FullAccess', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/FullAccess' });

      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'lambda:InvokeFunction',
        resource: 'arn:aws:lambda:us-east-1:123456789012:function:my-fn',
        context: {}
      });

      expect(result).toBe('Allow');
    });

    it('should deny when action does not match any statement', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'SQSSend', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/SQSSend' });

      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:ReceiveMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
        context: {}
      });

      expect(result).toBe('Deny');
    });

    it('should handle Action as an array in the policy statement', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['sqs:SendMessage', 'sqs:ReceiveMessage'], Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'SQSReadWrite', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/SQSReadWrite' });

      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:ReceiveMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
        context: {}
      });

      expect(result).toBe('Allow');
    });

    it('should handle Resource as an array in the policy statement', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: 'sqs:SendMessage',
          Resource: [
            'arn:aws:sqs:us-east-1:123456789012:queue-a',
            'arn:aws:sqs:us-east-1:123456789012:queue-b'
          ]
        }]
      };
      await simulator.createPolicy({ PolicyName: 'TwoQueues', PolicyDocument: policyDoc });
      await simulator.attachUserPolicy({ UserName: 'testuser', PolicyArn: 'arn:aws:iam::123456789012:policy/TwoQueues' });

      const resultA = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:SendMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:queue-a',
        context: {}
      });
      const resultC = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sqs:SendMessage',
        resource: 'arn:aws:sqs:us-east-1:123456789012:queue-c',
        context: {}
      });

      expect(resultA).toBe('Allow');
      expect(resultC).toBe('Deny');
    });

    it('should use group policies in evaluation', async () => {
      const policyDoc = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sns:Publish', Resource: '*' }]
      };
      await simulator.createPolicy({ PolicyName: 'GroupSNS', PolicyDocument: policyDoc });
      await simulator.createGroup({ GroupName: 'snsgroup' });
      await simulator.addUserToGroup({ GroupName: 'snsgroup', UserName: 'testuser' });
      await simulator.attachGroupPolicy({ GroupName: 'snsgroup', PolicyArn: 'arn:aws:iam::123456789012:policy/GroupSNS' });

      const result = simulator.evaluateAccess({
        accessKeyId: simulator._testAccessKeyId,
        action: 'sns:Publish',
        resource: 'arn:aws:sns:us-east-1:123456789012:my-topic',
        context: {}
      });

      expect(result).toBe('Allow');
    });
  });
});
