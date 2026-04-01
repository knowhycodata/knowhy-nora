/**
 * Test 077: Test 3 VisualTestAgent basit akış — yapıcı ve durum duman testi
 * Tam görsel üretimi API gerektirir; burada sadece index.js ile uyum doğrulanır.
 */

const assert = require('assert');
const { VisualTestAgent } = require('../packages/backend/src/services/visualTestAgent');

function testConstructorMatchesIndexJs() {
  const agent = new VisualTestAgent('test-sid', () => {}, () => {}, 'tr');
  assert.strictEqual(agent.sessionId, 'test-sid');
  assert.strictEqual(agent.isActive, false);
  assert.strictEqual(agent.state, 'IDLE');
  assert.strictEqual(typeof agent.startTest, 'function');
  assert.strictEqual(typeof agent.recordAnswer, 'function');
  assert.strictEqual(typeof agent.onAgentTranscript, 'function');
}

function testNoOnUserTranscript() {
  const agent = new VisualTestAgent('x', () => {}, () => {}, 'tr');
  assert.strictEqual(agent.onUserTranscript, undefined);
}

function run() {
  testConstructorMatchesIndexJs();
  testNoOnUserTranscript();
  console.log('test_077_visual_agent_smoke: OK');
}

run();
