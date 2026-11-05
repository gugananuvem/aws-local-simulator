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

describe('IAMSimulator - User CRUD (Task 3.1)', () => {
  let simulator;

  beforeEach(() => {
    simulator = new IAMSimulator({});
  });

  describe('createUser', () => {
    it('should create a user with valid params', async () => {
      const result = await simulator.createUser({ UserName: 'testuser' });

      expect(result.UserName).toBe('testuser');
      expect(result.UserId).toMatch(/^AIDA[A-Z0-9]+$/);
      expect(result.Arn).toBe('arn:aws:iam::123456789012:user/testuser');
      expect(result.Path).toBe('/');
      expect(result.CreateDate).toBeDefined();
    });

    it('should create a user with custom path', async () => {
      const result = await simulator.createUser({ UserName: 'admin', Path: '/admins/' });

      expect(result.Path).toBe('/admins/');
      expect(result.Arn).toBe('arn:aws:iam::123456789012:user/admins/admin');
    });

    it('should initialize userPolicies and userGroups for new user', async () => {
      await simulator.createUser({ UserName: 'testuser' });

      expect(simulator.userPolicies.has('testuser')).toBe(true);
      expect(simulator.userGroups.has('testuser')).toBe(true);
    });

    it('should throw ValidationError when UserName is missing', async () => {
      await expect(simulator.createUser({})).rejects.toMatchObject({
        code: 'ValidationError',
        statusCode: 400
      });
    });

    it('should throw EntityAlreadyExists when user already exists', async () => {
      await simulator.createUser({ UserName: 'duplicate' });

      await expect(simulator.createUser({ UserName: 'duplicate' })).rejects.toMatchObject({
        code: 'EntityAlreadyExists',
        statusCode: 409
      });
    });
  });

  describe('getUser', () => {
    it('should return user when it exists', async () => {
      const created = await simulator.createUser({ UserName: 'findme' });
      const found = await simulator.getUser({ UserName: 'findme' });

      expect(found).toEqual(created);
    });

    it('should throw NoSuchEntity when user does not exist', async () => {
      await expect(simulator.getUser({ UserName: 'ghost' })).rejects.toMatchObject({
        code: 'NoSuchEntity',
        statusCode: 404
      });
    });
  });

  describe('listUsers', () => {
    it('should return all users with default PathPrefix', async () => {
      await simulator.createUser({ UserName: 'user1' });
      await simulator.createUser({ UserName: 'user2' });

      const result = await simulator.listUsers({});

      expect(result.Users).toHaveLength(2);
    });

    it('should filter users by PathPrefix', async () => {
      await simulator.createUser({ UserName: 'admin1', Path: '/admins/' });
      await simulator.createUser({ UserName: 'dev1', Path: '/devs/' });
      await simulator.createUser({ UserName: 'admin2', Path: '/admins/' });

      const result = await simulator.listUsers({ PathPrefix: '/admins/' });

      expect(result.Users).toHaveLength(2);
      expect(result.Users.every(u => u.Path.startsWith('/admins/'))).toBe(true);
    });

    it('should return empty array when no users match', async () => {
      await simulator.createUser({ UserName: 'user1', Path: '/team/' });

      const result = await simulator.listUsers({ PathPrefix: '/other/' });

      expect(result.Users).toHaveLength(0);
    });
  });

  describe('deleteUser', () => {
    it('should delete an existing user', async () => {
      await simulator.createUser({ UserName: 'deleteme' });
      await simulator.deleteUser({ UserName: 'deleteme' });

      expect(simulator.users.has('deleteme')).toBe(false);
      expect(simulator.userPolicies.has('deleteme')).toBe(false);
      expect(simulator.userGroups.has('deleteme')).toBe(false);
    });

    it('should throw NoSuchEntity when deleting non-existent user', async () => {
      await expect(simulator.deleteUser({ UserName: 'ghost' })).rejects.toMatchObject({
        code: 'NoSuchEntity',
        statusCode: 404
      });
    });

    it('should revoke all access keys for the user', async () => {
      await simulator.createUser({ UserName: 'keyuser' });
      // Simulate access keys existing for this user
      simulator.accessKeys.set('AKIATEST1', { AccessKeyId: 'AKIATEST1', UserName: 'keyuser' });
      simulator.accessKeys.set('AKIATEST2', { AccessKeyId: 'AKIATEST2', UserName: 'keyuser' });
      simulator.accessKeys.set('AKIAOTHER', { AccessKeyId: 'AKIAOTHER', UserName: 'otheruser' });

      await simulator.deleteUser({ UserName: 'keyuser' });

      expect(simulator.accessKeys.has('AKIATEST1')).toBe(false);
      expect(simulator.accessKeys.has('AKIATEST2')).toBe(false);
      expect(simulator.accessKeys.has('AKIAOTHER')).toBe(true);
    });

    it('should remove user from all groups', async () => {
      await simulator.createUser({ UserName: 'groupuser' });
      // Simulate user being in groups
      simulator.userGroups.set('groupuser', new Set(['devs', 'admins']));
      simulator.groupMembers.set('devs', new Set(['groupuser', 'other']));
      simulator.groupMembers.set('admins', new Set(['groupuser']));

      await simulator.deleteUser({ UserName: 'groupuser' });

      expect(simulator.groupMembers.get('devs').has('groupuser')).toBe(false);
      expect(simulator.groupMembers.get('devs').has('other')).toBe(true);
      expect(simulator.groupMembers.get('admins').has('groupuser')).toBe(false);
    });
  });
});
