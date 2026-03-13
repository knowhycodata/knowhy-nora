/**
 * Tool Calling Handler
 * 
 * Gemini Live API'den gelen tool call'ları işler.
 * Skorlama ve veritabanı kayıt işlemlerini yapar.
 * LLM asla hesaplama yapmaz — tüm skorlama burada gerçekleşir.
 */

const prisma = require('../lib/prisma');
const { createLogger } = require('../lib/logger');
const { scoreVerbalFluency } = require('./scoring/verbalFluency');

const log = createLogger('ToolHandler');
const { scoreStoryRecall } = require('./scoring/storyRecall');
const { scoreVisualRecognition } = require('./scoring/visualRecognition');
const { scoreOrientation } = require('./scoring/orientation');
const { getImagePipeline } = require('./imageGenerator');
const { getStaticTestImage } = require('./staticTestImages');

// Visual Test Agent referansları (session bazlı)
const visualTestAgents = new Map(); // sessionId -> VisualTestAgent

function registerVisualTestAgent(sessionId, agent) {
  visualTestAgents.set(sessionId, agent);
}

function unregisterVisualTestAgent(sessionId) {
  const agent = visualTestAgents.get(sessionId);
  if (agent) agent.destroy();
  visualTestAgents.delete(sessionId);
}

function getVisualTestAgent(sessionId) {
  return visualTestAgents.get(sessionId);
}

// Multi-Agent: Test görselleri Imagen 4 Fast ile otomatik üretilir
// API kota aşımında statik SVG görseller fallback olarak kullanılır
const TEST_IMAGE_SUBJECTS = [
  { index: 0, subject: 'saat', correctAnswer: 'saat' },
  { index: 1, subject: 'anahtar', correctAnswer: 'anahtar' },
  { index: 2, subject: 'kalem', correctAnswer: 'kalem' },
];

// Gemini session'ları takip et (Brain Agent için hala gerekli olabilir)
const geminiSessions = new Map(); // sessionId -> GeminiLiveSession

function registerGeminiSession(sessionId, session) {
  geminiSessions.set(sessionId, session);
}

function unregisterGeminiSession(sessionId) {
  geminiSessions.delete(sessionId);
}

async function handleToolCall(toolName, args, clientWs = null, sessionId = null) {
  switch (toolName) {
    case 'submit_verbal_fluency':
      return await handleVerbalFluency(args);
    case 'submit_story_recall':
      return await handleStoryRecall(args);
    case 'start_visual_test':
      return await handleStartVisualTest(args);
    case 'record_visual_answer':
      return await handleRecordVisualAnswer(args);
    case 'generate_test_image':
      return await handleGenerateTestImage(args);
    case 'submit_visual_recognition':
      return await handleVisualRecognition(args);
    case 'submit_orientation':
      return await handleOrientation(args);
    case 'complete_session':
      return await handleCompleteSession(args);
    default:
      log.warn('Bilinmeyen tool call', { toolName, sessionId });
      return { error: `Bilinmeyen fonksiyon: ${toolName}` };
  }
}

async function handleVerbalFluency({ sessionId, words, targetLetter, durationSeconds }) {
  const result = scoreVerbalFluency(words, targetLetter);

  await prisma.testResult.upsert({
    where: { sessionId_testType: { sessionId, testType: 'VERBAL_FLUENCY' } },
    update: {
      rawData: { words, targetLetter, durationSeconds },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
    create: {
      sessionId,
      testType: 'VERBAL_FLUENCY',
      rawData: { words, targetLetter, durationSeconds },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
  });

  return {
    success: true,
    message: `Sözel akıcılık testi kaydedildi. ${result.details.validWords.length} geçerli kelime bulundu.`,
    validWordCount: result.details.validWords.length,
    score: result.score,
    maxScore: result.maxScore,
  };
}

async function handleStoryRecall({ sessionId, originalStory, recalledStory }) {
  const result = scoreStoryRecall(originalStory, recalledStory);

  await prisma.testResult.upsert({
    where: { sessionId_testType: { sessionId, testType: 'STORY_RECALL' } },
    update: {
      rawData: { originalStory, recalledStory },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
    create: {
      sessionId,
      testType: 'STORY_RECALL',
      rawData: { originalStory, recalledStory },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
  });

  return {
    success: true,
    message: `Hikaye hatırlama testi kaydedildi.`,
  };
}

/**
 * Multi-Agent: start_visual_test
 * VisualTestAgent koordinasyonunda çalışır.
 * Gemini'ye ASLA base64 görsel gönderilmez — sadece hafif text metadata döner.
 * Görsel üretimi ve frontend'e gönderimi VisualTestAgent tarafından yapılır.
 */
async function handleStartVisualTest({ sessionId }) {
  log.info('start_visual_test çağrıldı', { sessionId });

  const agent = visualTestAgents.get(sessionId);
  if (!agent) {
    log.error('VisualTestAgent bulunamadı', { sessionId });
    return {
      success: false,
      message: 'Görsel test ajanı henüz hazır değil. Lütfen tekrar deneyin.',
    };
  }

  // VisualTestAgent testi başlatır — görsel üretir ve frontend'e gönderir
  const result = await agent.startTest();
  
  // Gemini'ye dönen response: GÖRSEL VERİSİ YOK, sadece talimat
  return result;
}

/**
 * Multi-Agent: record_visual_answer
 * Nöra kullanıcıdan cevap aldığında bu tool'u çağırır.
 * VisualTestAgent cevabı kaydeder ve sonraki görsele geçer.
 */
async function handleRecordVisualAnswer({ sessionId, imageIndex, userAnswer }) {
  log.info('record_visual_answer çağrıldı', { sessionId, imageIndex, userAnswer });

  const agent = visualTestAgents.get(sessionId);
  if (!agent) {
    log.error('VisualTestAgent bulunamadı', { sessionId });
    return { success: false, message: 'Görsel test ajanı bulunamadı.' };
  }

  // Cevabı kaydet ve sonraki görsele geç
  const result = await agent.recordAnswer(imageIndex, userAnswer);
  return result;
}

/**
 * Legacy: generate_test_image — geriye uyumluluk için bırakıldı
 * Yeni akışta start_visual_test kullanılır.
 * Eğer bu çağrılırsa, base64 veriyi Gemini'ye göndermez.
 */
async function handleGenerateTestImage({ imageIndex, subject, sessionId }) {
  log.warn('Legacy generate_test_image çağrıldı — start_visual_test kullanılmalı', { imageIndex, subject });

  // VisualTestAgent varsa ona yönlendir
  const agent = visualTestAgents.get(sessionId);
  if (agent && !agent.isTestActive) {
    const result = await agent.startTest();
    return result;
  }

  // Fallback: Eski davranış ama base64'ü Gemini'ye göndermeden
  return {
    success: true,
    imageIndex,
    correctAnswer: subject,
    message: `Görsel ${imageIndex + 1} ekranda gösteriliyor. Kullanıcıya ne gördüğünü sor ve cevabını bekle.`,
  };
}

async function handleVisualRecognition({ sessionId, answers }) {
  const result = scoreVisualRecognition(answers);

  await prisma.testResult.upsert({
    where: { sessionId_testType: { sessionId, testType: 'VISUAL_RECOGNITION' } },
    update: {
      rawData: { answers },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
    create: {
      sessionId,
      testType: 'VISUAL_RECOGNITION',
      rawData: { answers },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
  });

  return {
    success: true,
    message: `Görsel tanıma testi kaydedildi.`,
  };
}

async function handleOrientation({ sessionId, answers }) {
  const result = scoreOrientation(answers);

  await prisma.testResult.upsert({
    where: { sessionId_testType: { sessionId, testType: 'ORIENTATION' } },
    update: {
      rawData: { answers },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
    create: {
      sessionId,
      testType: 'ORIENTATION',
      rawData: { answers },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
  });

  return {
    success: true,
    message: `Yönelim testi kaydedildi.`,
  };
}

async function handleCompleteSession({ sessionId }) {
  const testResults = await prisma.testResult.findMany({
    where: { sessionId },
  });

  const totalScore = testResults.reduce((sum, t) => sum + t.score, 0);
  const maxPossible = testResults.reduce((sum, t) => sum + t.maxScore, 0);
  const percentage = maxPossible > 0 ? (totalScore / maxPossible) * 100 : 0;

  let riskLevel = 'LOW';
  if (percentage < 50) riskLevel = 'HIGH';
  else if (percentage < 75) riskLevel = 'MODERATE';

  await prisma.testSession.update({
    where: { id: sessionId },
    data: {
      status: 'COMPLETED',
      totalScore,
      riskLevel,
      completedAt: new Date(),
    },
  });

  return {
    success: true,
    totalScore,
    maxPossible,
    percentage: Math.round(percentage),
    riskLevel,
    message: `Oturum tamamlandı. Toplam puan: ${totalScore}/${maxPossible}`,
  };
}

module.exports = { 
  handleToolCall, 
  registerGeminiSession, 
  unregisterGeminiSession,
  registerVisualTestAgent,
  unregisterVisualTestAgent,
  getVisualTestAgent,
  TEST_IMAGE_SUBJECTS 
};
