/**
 * SQS ListQueues Bug Condition Exploration Test
 *
 * Property 1: Bug Condition - ListQueues Action Returns InvalidAction Error
 *
 * CRITICAL: This test is EXPECTED TO FAIL on unfixed code.
 * Failure confirms the bug exists: the second `handleRequest` definition
 * overrides the first at runtime, and the second definition omits the
 * `ListQueues` case, causing it to fall through to the default InvalidAction branch.
 *
 * Validates: Requirements 1.1, 1.2
 */

const SQSSimulator = require('../../src/services/sqs/simulator');

// Minimal config for instantiating SQSSimulator in tests
const minimalConfig = {
  ports: { sqs: 9324 },
  sqs: { queues: [] }
};

// Mock req/res helpers
function mockReq(query = {}, body = {}) {
  return { query, body };
}

function mockRes() {
  return {};
}

describe('SQS Bug Condition: ListQueues Action', () => {
  let simulator;

  beforeEach(() => {
    simulator = new SQSSimulator(minimalConfig, null);
    // No initialize() call needed — we test handleRequest directly
    // which only needs the queues Map (already set up in constructor)
  });

  /**
   * Property 1 (Bug Condition): isBugCondition("ListQueues") === true
   *
   * When handleRequest is called with action "ListQueues", the runtime-active
   * (second) handleRequest definition has no ListQueues case, so it falls
   * through to the default branch and returns an InvalidAction error.
   *
   * EXPECTED ON UNFIXED CODE: FAIL
   * Counterexample: result = { error: { code: 'InvalidAction', message: 'Action ListQueues not supported' }, status: 400 }
   */
  test('handleRequest("ListQueues") should NOT return InvalidAction error and SHOULD return queues array', () => {
    const result = simulator.handleRequest('ListQueues', mockReq(), mockRes());

    // These assertions encode the EXPECTED (correct) behavior.
    // On unfixed code, they will FAIL because the second handleRequest
    // definition overrides the first and has no ListQueues case.
    expect(result.error).toBeUndefined();
    expect(result.queues).toBeDefined();
    expect(Array.isArray(result.queues)).toBe(true);
  });

  /**
   * ListQueues on empty simulator should return empty queues array (not an error).
   *
   * EXPECTED ON UNFIXED CODE: FAIL
   */
  test('handleRequest("ListQueues") on empty simulator returns { queues: [] }', () => {
    const result = simulator.handleRequest('ListQueues', mockReq(), mockRes());

    expect(result).not.toHaveProperty('error');
    expect(result.queues).toEqual([]);
  });

  /**
   * ListQueues after creating two queues should return both queue URLs.
   *
   * EXPECTED ON UNFIXED CODE: FAIL
   * Counterexample: result.error.code === 'InvalidAction' instead of queues array
   */
  test('handleRequest("ListQueues") after creating two queues returns both queue URLs', () => {
    // Create two queues directly via createQueue (bypasses handleRequest)
    simulator.createQueue('queue-alpha');
    simulator.createQueue('queue-beta');

    const result = simulator.handleRequest('ListQueues', mockReq(), mockRes());

    expect(result.error).toBeUndefined();
    expect(result.queues).toBeDefined();
    expect(Array.isArray(result.queues)).toBe(true);
    expect(result.queues).toHaveLength(2);

    const urls = result.queues.map(q => q.url);
    expect(urls).toContain('http://localhost:9324/queue/queue-alpha');
    expect(urls).toContain('http://localhost:9324/queue/queue-beta');
  });
});
