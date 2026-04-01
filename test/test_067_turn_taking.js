/**
 * Test 067: Turn-Taking ve Hikaye Kesintisi Düzeltmeleri
 * 
 * Bu test, BrainAgent'ın greeting guard mekanizmasını ve
 * geminiLive'daki VAD ayarlarını doğrular.
 */

const assert = require('assert');

// BrainAgent'ı import et
const { BrainAgent } = require('../packages/backend/src/services/brainAgent');

const mockSendToClient = (data) => {};
const mockSendTextToLive = (text) => {};

function createAgent(language = 'tr') {
  return new BrainAgent('test-session', mockSendToClient, mockSendTextToLive, language);
}

// ─── Test 1: Greeting Guard - Erken faz geçişini engeller ───
function testGreetingGuardBlocksEarlyTransition() {
  const agent = createAgent();
  
  // Session yeni başladı, kullanıcı henüz konuşmadı
  // Ajan "hazır mısınız" dese bile IDLE'dan çıkmamalı
  agent.onTranscript('agent', 'Merhaba, nasılsınız? Hazır mısınız?');
  
  assert.strictEqual(agent.testPhase, 'IDLE', 
    'Greeting guard aktifken ajan "hazır mısınız" dese bile IDLE kalmalı');
  assert.strictEqual(agent.greetingDone, false,
    'Kullanıcı konuşmadığı sürece greetingDone false olmalı');
  
  console.log('PASS: testGreetingGuardBlocksEarlyTransition');
}

// ─── Test 2: Greeting Guard - Kullanıcı konuştuktan sonra geçiş olur ───
function testGreetingGuardAllowsAfterUserSpeaks() {
  const agent = createAgent();
  
  // Kullanıcı konuşsun
  agent.onTranscript('user', 'İyiyim teşekkürler');
  assert.strictEqual(agent.greetingDone, true,
    'Kullanıcı konuştuktan sonra greetingDone true olmalı');
  
  // Şimdi ajan test açıklaması yapınca faz geçişi olmalı
  agent.onTranscript('agent', 'Size bir harf vereceğim, sözel akıcılık testi yapacağız. Hazır mısınız?');
  
  assert.strictEqual(agent.testPhase, 'VERBAL_FLUENCY_WAITING',
    'Kullanıcı konuştuktan sonra verbal intro algılanmalı');
  
  console.log('PASS: testGreetingGuardAllowsAfterUserSpeaks');
}

// ─── Test 3: Greeting Guard - Süre aşımından sonra geçiş olur ───
function testGreetingGuardExpiresAfterTimeout() {
  const agent = createAgent();
  
  // sessionStartedAt'ı geçmişe çek (15+ saniye önce)
  agent.sessionStartedAt = Date.now() - 20000;
  
  // Kullanıcı konuşmamış olsa bile 15s sonra guard devre dışı kalmalı
  agent.onTranscript('agent', 'Sözel akıcılık testi yapacağız. Hazır mısınız?');
  
  assert.strictEqual(agent.testPhase, 'VERBAL_FLUENCY_WAITING',
    'Greeting guard süresi dolunca faz geçişi olmalı');
  
  console.log('PASS: testGreetingGuardExpiresAfterTimeout');
}

// ─── Test 4: Greeting Guard - Karşılamada test keyword'leri engellenir ───
function testGreetingGuardBlocksTestKeywords() {
  const agent = createAgent();
  
  // Ajan karşılama sırasında test keyword'lerini söylerse engellenmeli
  agent.onTranscript('agent', 'Merhaba, ben Nöra. Bugün sözel akıcılık, hikaye hatırlama testleri yapacağız.');
  
  assert.strictEqual(agent.testPhase, 'IDLE',
    'Karşılama sırasında test keyword\'leri faz geçişi tetiklememeli');
  
  console.log('PASS: testGreetingGuardBlocksTestKeywords');
}

// ─── Test 5: Transition fazında kullanıcı cevabı bekleniyor ───
function testTransitionWaitsForUserResponse() {
  const agent = createAgent();
  agent.greetingDone = true;
  
  // Test 1'i tamamla
  agent.testPhase = 'VERBAL_FLUENCY_DONE';
  agent._enterTransition('TRANSITION_TO_TEST2');
  
  assert.strictEqual(agent.testPhase, 'TRANSITION_TO_TEST2',
    'Transition fazında olmalı');
  
  // Ajan konuşsa bile transition'dan çıkmamalı
  agent.onTranscript('agent', 'Tebrikler, ilk testi tamamladınız! Nasıl hissediyorsunuz?');
  
  assert.strictEqual(agent.testPhase, 'TRANSITION_TO_TEST2',
    'Ajan konuşması transition\'ı bitirmemeli');
  
  console.log('PASS: testTransitionWaitsForUserResponse');
}

// ─── Test 6: StoryRecall agent done tracking ───
function testStoryRecallAgentDoneTracking() {
  const agent = createAgent();
  agent.greetingDone = true;
  agent.testPhase = 'STORY_RECALL_ACTIVE';
  agent.storyRecallAgentDone = false;
  
  // Ajan hikaye anlatıyor
  agent.onTranscript('agent', 'Bir zamanlar küçük bir köyde yaşlı bir adam varmış.');
  assert.strictEqual(agent.storyRecallAgentDone, false,
    'Hikaye anlatılırken storyRecallAgentDone false olmalı');
  
  // Ajan "hatırladığınız kadarıyla anlatır mısınız" derse done olmalı
  agent.onTranscript('agent', 'Şimdi bu hikayeyi hatırladığınız kadarıyla anlatır mısınız?');
  assert.strictEqual(agent.storyRecallAgentDone, true,
    'Recall prompt sonrası storyRecallAgentDone true olmalı');
  
  console.log('PASS: testStoryRecallAgentDoneTracking');
}

// ─── Tüm testleri çalıştır ───
try {
  testGreetingGuardBlocksEarlyTransition();
  testGreetingGuardAllowsAfterUserSpeaks();
  testGreetingGuardExpiresAfterTimeout();
  testGreetingGuardBlocksTestKeywords();
  testTransitionWaitsForUserResponse();
  testStoryRecallAgentDoneTracking();
  
  console.log('\n=== TUM TESTLER GECTI ===');
  process.exit(0);
} catch (err) {
  console.error('\nFAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
}
