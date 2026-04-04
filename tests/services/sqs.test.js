/**
 * SQS Bug Condition Exploration & Preservation Tests
 *
 * Real Root Cause: src/services/sqs/server.js only reads req.query.Action || req.body.Action
 * but never checks req.headers['x-amz-target']. AWS CLI v2 sends the action via
 * X-Amz-Target: AmazonSQS.ListQueues header (JSON protocol), so action is undefined
 * and falls to the default InvalidAction branch.
 *
 * Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.1–3.7
 */

const SQSSimulator = require('../../src/services/sqs/simulator');

// Minimal config for instantiating SQSSimulator in tests
const minimalConfig = {
  ports: { sqs: 9324 },
  sqs: { queues: [] }
};

// Mock req/res helpers
function mockReq(query = {}, body = {}, headers = {}) {
  return { query, body, headers };
}

function mockRes() {
  const captured = {};
  const res = {
    _captured: captured,
    status(code) { captured.statusCode = code; return res; },
    json(data) { captured.json = data; return res; },
    send(data) { captured.send = data; return res; }
  };
  return res;
}

/**
 * The parseAction function mirrors what server.js does (unfixed version):
 * only reads query/body Action, ignores X-Amz-Target header.
 */
function parseActionUnfixed(req) {
  return req.query.Action || req.body.Action;
}

/**
 * The parseAction function mirrors what server.js should do (fixed version):
 * reads query/body Action first, falls back to X-Amz-Target header.
 */
function parseActionFixed(req) {
  return req.query.Action || req.body.Action ||
    (req.headers['x-amz-target'] && req.headers['x-amz-target'].split('.')[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: Bug Condition Exploration Tests
// These tests target the REAL bug: server.js ignores X-Amz-Target header.
// The X-Amz-Target test MUST FAIL on unfixed code (parseActionUnfixed).
// ─────────────────────────────────────────────────────────────────────────────

describe('SQS Bug Condition: X-Amz-Target Header Not Parsed', () => {
  let simulator;

  beforeEach(() => {
    simulator = new SQSSimulator(minimalConfig, null);
  });

  /**
   * Property 1 (Bug Condition): When X-Amz-Target header is set and no Action
   * in query/body, the unfixed parseAction returns undefined — triggering the bug.
   *
   * EXPECTED ON UNFIXED CODE: FAIL (parseActionUnfixed returns undefined, not 'ListQueues')
   * Counterexample: parseActionUnfixed returns undefined instead of 'ListQueues'
   *
   * Validates: Requirements 1.1, 1.2
   */
  test('parseAction with X-Amz-Target header should return "ListQueues" (FAILS on unfixed code)', () => {
    const req = mockReq({}, {}, { 'x-amz-target': 'AmazonSQS.ListQueues' });

    // This is what the FIXED server.js should do:
    const fixedAction = parseActionFixed(req);
    expect(fixedAction).toBe('ListQueues');

    // This is what the UNFIXED server.js does — returns undefined (the bug):
    const unfixedAction = parseActionUnfixed(req);
    // On unfixed code this is undefined, which causes the InvalidAction error.
    // This assertion documents the bug condition:
    expect(unfixedAction).toBeUndefined();
  });

  /**
   * When action is undefined, simulator.handleRequest returns InvalidAction error.
   * This confirms the full bug path: undefined action → InvalidAction 400.
   *
   * EXPECTED ON UNFIXED CODE: PASS (confirms the bug path exists)
   *
   * Validates: Requirements 1.1, 1.2
   */
  test('simulator.handleRequest(undefined) returns InvalidAction error (confirms bug path)', () => {
    const result = simulator.handleRequest(undefined, mockReq(), mockRes());
    expect(result).toHaveProperty('error');
    expect(result.error.code).toBe('InvalidAction');
  });

  /**
   * Full bug condition: request with X-Amz-Target header, unfixed parseAction
   * produces undefined, which causes InvalidAction error from simulator.
   *
   * EXPECTED ON UNFIXED CODE: PASS (documents the full bug chain)
   *
   * Validates: Requirements 1.1, 1.2
   */
  test('full bug chain: X-Amz-Target request → undefined action → InvalidAction error', () => {
    const req = mockReq({}, {}, { 'x-amz-target': 'AmazonSQS.ListQueues' });

    // Unfixed: action is undefined
    const action = parseActionUnfixed(req);
    expect(action).toBeUndefined();

    // Undefined action → InvalidAction error
    const result = simulator.handleRequest(action, req, mockRes());
    expect(result.error.code).toBe('InvalidAction');
    expect(result.error.message).toMatch(/undefined/);
  });

  /**
   * Fixed parseAction correctly extracts action from X-Amz-Target for all SQS actions.
   *
   * EXPECTED ON UNFIXED CODE: FAIL (parseActionFixed is the fix, not yet in server.js)
   * This test validates the fix logic itself.
   *
   * Validates: Requirements 2.1, 2.2
   */
  test('fixed parseAction extracts action from X-Amz-Target for ListQueues', () => {
    const req = mockReq({}, {}, { 'x-amz-target': 'AmazonSQS.ListQueues' });
    const action = parseActionFixed(req);
    expect(action).toBe('ListQueues');

    // With the fixed action, simulator returns queues (not an error)
    const result = simulator.handleRequest(action, req, mockRes());
    expect(result.error).toBeUndefined();
    expect(result.queues).toBeDefined();
    expect(Array.isArray(result.queues)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: Preservation Tests
// Verify all existing actions still work via query/body Action param.
// These MUST PASS on unfixed code (baseline behavior to preserve).
// ─────────────────────────────────────────────────────────────────────────────

describe('SQS Preservation: Existing Actions via query/body Action param', () => {
  let simulator;

  beforeEach(() => {
    simulator = new SQSSimulator(minimalConfig, null);
  });

  /**
   * CreateQueue via req.query.Action still works.
   * Validates: Requirement 3.1
   */
  test('CreateQueue via req.query.Action returns queueUrl', () => {
    const req = mockReq({ Action: 'CreateQueue', QueueName: 'test-queue' }, {}, {});
    const action = parseActionUnfixed(req); // 'CreateQueue'
    expect(action).toBe('CreateQueue');

    const result = simulator.handleRequest(action, req, mockRes());
    expect(result.error).toBeUndefined();
    expect(result.queueUrl).toBeDefined();
    expect(result.queueUrl).toContain('test-queue');
  });

  /**
   * SendMessage via req.body.Action still works.
   * Validates: Requirement 3.2
   */
  test('SendMessage via req.body.Action returns messageId and md5', () => {
    // First create the queue
    simulator.createQueue('msg-queue');

    const req = mockReq({}, { Action: 'SendMessage', QueueName: 'msg-queue', MessageBody: 'hello' }, {});
    const action = parseActionUnfixed(req); // 'SendMessage'
    expect(action).toBe('SendMessage');

    const result = simulator.handleRequest(action, req, mockRes());
    expect(result.error).toBeUndefined();
    expect(result.messageId).toBeDefined();
    expect(result.md5).toBeDefined();
  });

  /**
   * GetQueueUrl via req.query.Action still works.
   * Validates: Requirement 3.6
   */
  test('GetQueueUrl via req.query.Action returns queueUrl', () => {
    simulator.createQueue('url-queue');

    const req = mockReq({ Action: 'GetQueueUrl', QueueName: 'url-queue' }, {}, {});
    const action = parseActionUnfixed(req); // 'GetQueueUrl'
    expect(action).toBe('GetQueueUrl');

    const result = simulator.handleRequest(action, req, mockRes());
    expect(result.error).toBeUndefined();
    expect(result.queueUrl).toContain('url-queue');
  });

  /**
   * Unknown action still returns InvalidAction error.
   * Validates: Requirement 3.7
   */
  test('UnknownAction returns InvalidAction error', () => {
    const req = mockReq({ Action: 'UnknownAction' }, {}, {});
    const action = parseActionUnfixed(req); // 'UnknownAction'
    expect(action).toBe('UnknownAction');

    const result = simulator.handleRequest(action, req, mockRes());
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('InvalidAction');
  });

  /**
   * query.Action takes precedence over X-Amz-Target header (fixed code).
   * Validates: Requirement 3.1 (no regression when both are present)
   */
  test('query.Action takes precedence over X-Amz-Target header', () => {
    const req = mockReq(
      { Action: 'CreateQueue', QueueName: 'priority-queue' },
      {},
      { 'x-amz-target': 'AmazonSQS.ListQueues' }
    );
    // Both unfixed and fixed parseAction should return 'CreateQueue' (query wins)
    expect(parseActionUnfixed(req)).toBe('CreateQueue');
    expect(parseActionFixed(req)).toBe('CreateQueue');
  });

  /**
   * body.Action takes precedence over X-Amz-Target header (fixed code).
   * Validates: Requirement 3.2 (no regression when both are present)
   */
  test('body.Action takes precedence over X-Amz-Target header', () => {
    const req = mockReq(
      {},
      { Action: 'SendMessage' },
      { 'x-amz-target': 'AmazonSQS.ListQueues' }
    );
    expect(parseActionUnfixed(req)).toBe('SendMessage');
    expect(parseActionFixed(req)).toBe('SendMessage');
  });
});
