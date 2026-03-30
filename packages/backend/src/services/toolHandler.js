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
const { normalizeLanguage, pickText } = require('../lib/language');

const log = createLogger('ToolHandler');
const { scoreStoryRecall } = require('./scoring/storyRecall');
const { scoreVisualRecognition } = require('./scoring/visualRecognition');
const { generateStory } = require('./storyGenerator');
const { scoreOrientation } = require('./scoring/orientation');
const { scoreVideoAnalysis } = require('./scoring/videoAnalysis');
const { getImagePipeline } = require('./imageGenerator');
const { getStaticTestImage } = require('./staticTestImages');
const { VideoAnalysisAgent } = require('./videoAnalysisAgent');
const { DateTimeAgent } = require('./dateTimeAgent');
const { consumePrefetchedStory } = require('./storyPrefetchAgent');

// Visual Test Agent referansları (session bazlı)
const visualTestAgents = new Map(); // sessionId -> VisualTestAgent

// Video Analysis Agent referansları (session bazlı)
const videoAnalysisAgents = new Map(); // sessionId -> VideoAnalysisAgent

// Camera Presence Agent referansları (session bazlı)
const cameraPresenceAgents = new Map(); // sessionId -> CameraPresenceAgent

// Brain Agent referansları (session bazlı)
const brainAgents = new Map(); // sessionId -> BrainAgent

// DateTime Agent referansları (session bazlı)
const dateTimeAgents = new Map(); // sessionId -> DateTimeAgent

// Session dil tercihleri (session bazlı)
const sessionLanguages = new Map(); // sessionId -> 'tr' | 'en'

// Orientation guard state (session bazlı)
const orientationGuardStates = new Map(); // sessionId -> { blockedCount, lastRepromptAt, lastQuestionType }
const ORIENTATION_GUARD_REPROMPT_COOLDOWN_MS = 5000;
const ORIENTATION_GUARD_FALLBACK_THRESHOLD = 3;

function registerSessionLanguage(sessionId, language) {
  sessionLanguages.set(sessionId, normalizeLanguage(language));
}

function unregisterSessionLanguage(sessionId) {
  sessionLanguages.delete(sessionId);
  orientationGuardStates.delete(sessionId);
}

function getSessionLanguage(sessionId) {
  return sessionLanguages.get(sessionId) || 'tr';
}

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

// Video Analysis Agent kayıt işlemleri
function registerVideoAnalysisAgent(sessionId, agent) {
  videoAnalysisAgents.set(sessionId, agent);
}

function unregisterVideoAnalysisAgent(sessionId) {
  const agent = videoAnalysisAgents.get(sessionId);
  if (agent) agent.destroy();
  videoAnalysisAgents.delete(sessionId);
}

function getVideoAnalysisAgent(sessionId) {
  return videoAnalysisAgents.get(sessionId);
}

// Camera Presence Agent kayıt işlemleri
function registerCameraPresenceAgent(sessionId, agent) {
  cameraPresenceAgents.set(sessionId, agent);
}

function unregisterCameraPresenceAgent(sessionId) {
  const agent = cameraPresenceAgents.get(sessionId);
  if (agent) agent.destroy();
  cameraPresenceAgents.delete(sessionId);
}

function getCameraPresenceAgent(sessionId) {
  return cameraPresenceAgents.get(sessionId);
}

// Brain Agent kayıt işlemleri
function registerBrainAgent(sessionId, agent) {
  brainAgents.set(sessionId, agent);
}

function unregisterBrainAgent(sessionId) {
  brainAgents.delete(sessionId);
}

function getBrainAgent(sessionId) {
  return brainAgents.get(sessionId);
}

// DateTime Agent kayıt işlemleri
function registerDateTimeAgent(sessionId, agent) {
  dateTimeAgents.set(sessionId, agent);
}

function unregisterDateTimeAgent(sessionId) {
  const agent = dateTimeAgents.get(sessionId);
  if (agent) agent.destroy();
  dateTimeAgents.delete(sessionId);
}

function getDateTimeAgent(sessionId) {
  return dateTimeAgents.get(sessionId);
}

// Multi-Agent: Test 3 görselleri artık her session'da dinamik olarak seçilir.
// Bkz: visualTestKeywords.js → selectRandomKeywords()
// VisualTestAgent constructor'ında otomatik çağrılır.

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
    case 'generate_story':
      return await handleGenerateStory(args);
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
    case 'start_video_analysis':
      return await handleStartVideoAnalysis(args);
    case 'stop_video_analysis':
      return await handleStopVideoAnalysis(args);
    case 'send_camera_command':
      return await handleSendCameraCommand(args);
    case 'get_current_datetime':
      return await handleGetCurrentDateTime(args);
    case 'verify_orientation_answer':
      return await handleVerifyOrientationAnswer(args);
    case 'complete_session':
      return await handleCompleteSession(args);
    default:
      log.warn('Bilinmeyen tool call', { toolName, sessionId });
      return {
        error: pickText(
          getSessionLanguage(sessionId),
          `Bilinmeyen fonksiyon: ${toolName}`,
          `Unknown function: ${toolName}`
        ),
      };
  }
}

async function handleVerbalFluency({ sessionId, words, targetLetter, durationSeconds }) {
  const language = getSessionLanguage(sessionId);
  const brainAgent = brainAgents.get(sessionId);

  // Timer durmadan skor kaydı alınırsa UI ve test akışı tutarsızlaşır.
  if (brainAgent?.timerActive) {
    log.warn('submit_verbal_fluency engellendi - timer hala aktif', { sessionId });

    if (typeof brainAgent.sendTextToLive === 'function') {
      brainAgent.sendTextToLive(
        pickText(
          language,
          'VERBAL_FLUENCY_GUARD: Timer hala aktif. submit_verbal_fluency cagrisini iptal et. Kullaniciyi dinlemeye devam et ve sadece TIMER_COMPLETE/TIMER_STOPPED mesaji geldikten sonra submit_verbal_fluency cagir.',
          'VERBAL_FLUENCY_GUARD: The timer is still active. Cancel this submit_verbal_fluency call. Keep listening to the user and call submit_verbal_fluency only after a TIMER_COMPLETE/TIMER_STOPPED message.'
        )
      );
    }

    return {
      success: false,
      blocked: true,
      reason: 'TIMER_ACTIVE',
      message: pickText(
        language,
        'Timer hala aktif. Test 1 bitmeden skor kaydi alinamaz.',
        'The timer is still active. Test 1 cannot be scored before it ends.'
      ),
    };
  }

  // BUG-012 FIX: LLM halüsinasyonunu engelle.
  // BrainAgent'ın transkriptten topladığı gerçek kelimeleri öncelikli kaynak olarak kullan.
  // LLM'in gönderdiği words listesini yalnızca BrainAgent yoksa veya boşsa fallback olarak al.
  let trustedWords = words;
  let trustedLetter = targetLetter;
  let wordSource = 'llm';

  if (brainAgent) {
    if (brainAgent.collectedWords && brainAgent.collectedWords.length > 0) {
      trustedWords = [...brainAgent.collectedWords];
      wordSource = 'brain_agent';
      log.info('submit_verbal_fluency: BrainAgent kelimeleri kullanılıyor', {
        sessionId,
        brainAgentCount: trustedWords.length,
        llmCount: words?.length || 0,
      });
    }
    if (brainAgent.targetLetter) {
      trustedLetter = brainAgent.targetLetter;
    }
  }

  const result = scoreVerbalFluency(trustedWords, trustedLetter, durationSeconds, language);

  await prisma.testResult.upsert({
    where: { sessionId_testType: { sessionId, testType: 'VERBAL_FLUENCY' } },
    update: {
      rawData: { words: trustedWords, targetLetter: trustedLetter, durationSeconds, wordSource },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
    create: {
      sessionId,
      testType: 'VERBAL_FLUENCY',
      rawData: { words: trustedWords, targetLetter: trustedLetter, durationSeconds, wordSource },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
  });

  return {
    success: true,
    message: pickText(
      language,
      `Sözel akıcılık testi kaydedildi. ${result.details.validWords.length} geçerli kelime bulundu.`,
      `Verbal fluency test saved. ${result.details.validWords.length} valid words were found.`
    ),
    validWordCount: result.details.validWords.length,
    score: result.score,
    maxScore: result.maxScore,
  };
}

async function handleStoryRecall({ sessionId, originalStory, recalledStory }) {
  const language = getSessionLanguage(sessionId);
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
    message: pickText(language, 'Hikaye hatırlama testi kaydedildi.', 'Story recall test saved.'),
  };
}

/**
 * Gemini 3.1 Flash Lite ile anlık hikaye üretimi
 * Test 2 başlamadan önce çağrılır — Nöra'ya hikayeyi verir
 */
async function handleGenerateStory({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  log.info('Hikaye üretimi istendi', { sessionId });

  const prefetched = consumePrefetchedStory(sessionId);
  if (prefetched) {
    log.info('Ön-üretilmiş hikaye kullanılıyor (sıfır bekleme)', {
      sessionId,
      source: prefetched.source,
      model: prefetched.model,
      storyLength: prefetched.story.length,
    });

    return {
      success: true,
      story: prefetched.story,
      source: prefetched.source,
      model: prefetched.model || null,
      message: pickText(
        language,
        `Hikaye ön-üretim ile hazırlandı. Bu hikayeyi kullanıcıya anlat. Kullanıcı tekrar anlattıktan sonra submit_story_recall çağırırken originalStory olarak bu hikayeyi gönder.`,
        `A story was pre-generated for this session. Tell this exact story to the user. After the user repeats it, call submit_story_recall and send this story in originalStory.`
      ),
    };
  }

  // Cache boşsa normal akışa devam et (prefetch başarısız olmuş veya henüz tamamlanmamış)
  log.info('Prefetch cache boş, normal hikaye üretimi yapılıyor', { sessionId });

  try {
    const result = await generateStory(language);

    log.info('Hikaye hazır', {
      sessionId,
      source: result.source,
      model: result.model || 'fallback',
      storyLength: result.story.length,
    });

    return {
      success: true,
      story: result.story,
      source: result.source,
      model: result.model || null,
      message: pickText(
        language,
        `Hikaye ${result.source === 'ai' ? 'Gemini 3.1 Flash Lite ile üretildi' : 'havuzdan seçildi'}. Bu hikayeyi kullanıcıya anlat. Kullanıcı tekrar anlattıktan sonra submit_story_recall çağırırken originalStory olarak bu hikayeyi gönder.`,
        `A story was ${result.source === 'ai' ? 'generated with Gemini 3.1 Flash Lite' : 'selected from the fallback pool'}. Tell this exact story to the user. After the user repeats it, call submit_story_recall and send this story in originalStory.`
      ),
    };
  } catch (error) {
    log.error('Hikaye üretim hatası', { sessionId, error: error.message });
    return {
      success: false,
      error: error.message,
      message: pickText(
        language,
        'Hikaye üretilemedi. Lütfen kendi bilgine dayanarak kısa bir hikaye anlat.',
        'Story generation failed. Please tell a short story from your own knowledge.'
      ),
    };
  }
}

/**
 * Multi-Agent: start_visual_test
 * VisualTestAgent koordinasyonunda çalışır.
 * Gemini'ye ASLA base64 görsel gönderilmez — sadece hafif text metadata döner.
 * Görsel üretimi ve frontend'e gönderimi VisualTestAgent tarafından yapılır.
 */
async function handleStartVisualTest({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  log.info('start_visual_test çağrıldı', { sessionId });

  const agent = visualTestAgents.get(sessionId);
  if (!agent) {
    log.error('VisualTestAgent bulunamadı', { sessionId });
    return {
      success: false,
      message: pickText(
        language,
        'Görsel test ajanı henüz hazır değil. Lütfen tekrar deneyin.',
        'Visual test agent is not ready yet. Please try again.'
      ),
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
  const language = getSessionLanguage(sessionId);
  log.info('record_visual_answer çağrıldı', { sessionId, imageIndex, userAnswer });

  const agent = visualTestAgents.get(sessionId);
  if (!agent) {
    log.error('VisualTestAgent bulunamadı', { sessionId });
    return {
      success: false,
      message: pickText(language, 'Görsel test ajanı bulunamadı.', 'Visual test agent was not found.'),
    };
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
  const language = getSessionLanguage(sessionId);
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
    message: pickText(
      language,
      `Görsel ${imageIndex + 1} ekranda gösteriliyor. Kullanıcıya ne gördüğünü sor ve cevabını bekle.`,
      `Image ${imageIndex + 1} is shown on screen. Ask the user what they see and wait for their answer.`
    ),
  };
}

async function handleVisualRecognition({ sessionId, answers }) {
  const language = getSessionLanguage(sessionId);
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
    message: pickText(language, 'Görsel tanıma testi kaydedildi.', 'Visual recognition test saved.'),
  };
}

async function handleOrientation({ sessionId, answers }) {
  const language = getSessionLanguage(sessionId);
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
    message: pickText(language, 'Yönelim testi kaydedildi.', 'Orientation test saved.'),
  };
}

// ─── Video Analysis Agent Tool Handlers ──────────────────────────

async function handleStartVideoAnalysis({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  log.info('start_video_analysis çağrıldı', { sessionId });

  const agent = videoAnalysisAgents.get(sessionId);
  if (!agent) {
    log.error('VideoAnalysisAgent bulunamadı', { sessionId });
    return {
      success: false,
      message: pickText(language, 'Video analiz ajanı henüz hazır değil.', 'Video analysis agent is not ready yet.'),
    };
  }

  const presenceAgent = cameraPresenceAgents.get(sessionId);
  if (presenceAgent) {
    presenceAgent.startMonitoring();
  }

  const result = agent.startAnalysis();
  return {
    ...result,
    presenceMonitoring: !!presenceAgent,
  };
}

async function handleStopVideoAnalysis({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  log.info('stop_video_analysis çağrıldı', { sessionId });

  const agent = videoAnalysisAgents.get(sessionId);
  if (!agent) {
    return {
      success: false,
      message: pickText(language, 'Video analiz ajanı bulunamadı.', 'Video analysis agent was not found.'),
    };
  }

  const result = agent.stopAnalysis();
  const presenceAgent = cameraPresenceAgents.get(sessionId);
  const presenceSummary = presenceAgent ? presenceAgent.stopMonitoring() : null;

  // Sorun 1 FIX: Video analiz sonuçlarını skorla ve DB'ye kaydet
  const videoScore = scoreVideoAnalysis(result.summary);
  try {
    await prisma.testResult.upsert({
      where: { sessionId_testType: { sessionId, testType: 'VIDEO_ANALYSIS' } },
      update: {
        rawData: { analyses: result.analyses, presenceSummary },
        score: videoScore.score,
        maxScore: videoScore.maxScore,
        details: videoScore.details,
      },
      create: {
        sessionId,
        testType: 'VIDEO_ANALYSIS',
        rawData: { analyses: result.analyses, presenceSummary },
        score: videoScore.score,
        maxScore: videoScore.maxScore,
        details: videoScore.details,
      },
    });
    log.info('Video analiz skoru kaydedildi', {
      sessionId,
      score: videoScore.score,
      maxScore: videoScore.maxScore,
    });
  } catch (dbErr) {
    log.error('Video analiz DB kayıt hatası', { sessionId, error: dbErr.message });
  }

  return {
    success: true,
    message: pickText(
      language,
      `Video analizi tamamlandı. ${result.totalAnalyses} kare analiz edildi.`,
      `Video analysis completed. ${result.totalAnalyses} frames were analyzed.`
    ),
    summary: result.summary,
    videoScore: { score: videoScore.score, maxScore: videoScore.maxScore },
    presenceSummary,
  };
}

async function handleSendCameraCommand({ sessionId, command, params }) {
  const language = getSessionLanguage(sessionId);
  log.info('send_camera_command çağrıldı', { sessionId, command });

  const agent = videoAnalysisAgents.get(sessionId);
  if (!agent) {
    return {
      success: false,
      message: pickText(language, 'Video analiz ajani bulunamadi.', 'Video analysis agent was not found.'),
    };
  }

  return agent.sendCameraCommand(command, params || {});
}

// ─── DateTime Agent Tool Handlers ──────────────────────────────

async function handleGetCurrentDateTime({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  log.info('get_current_datetime çağrıldı', { sessionId });

  let agent = dateTimeAgents.get(sessionId);
  if (!agent) {
    // Otomatik oluştur
    agent = new DateTimeAgent(sessionId, language);
    dateTimeAgents.set(sessionId, agent);
  }

  const dt = agent.getCurrentDateTime();
  return {
    success: true,
    ...dt,
    message: pickText(
      language,
      `Güncel tarih: ${dt.formattedDate}, Saat: ${dt.formattedTime}, Gün: ${dt.dayOfWeek}, Mevsim: ${dt.season}`,
      `Current date: ${dt.formattedDate}, Time: ${dt.formattedTime}, Day: ${dt.dayOfWeek}, Season: ${dt.season}`
    ),
  };
}

async function handleVerifyOrientationAnswer({ sessionId, questionType, userAnswer, context }) {
  const language = getSessionLanguage(sessionId);
  log.info('verify_orientation_answer çağrıldı', { sessionId, questionType, userAnswer });

  let agent = dateTimeAgents.get(sessionId);
  if (!agent) {
    agent = new DateTimeAgent(sessionId, language);
    dateTimeAgents.set(sessionId, agent);
  }

  // LLM'in kendi basina cevap uydurmasini engellemek icin gercek user transkriptini zorunlu kil.
  const brainAgent = brainAgents.get(sessionId);
  let effectiveUserAnswer = userAnswer;
  const guardState = orientationGuardStates.get(sessionId) || {
    blockedCount: 0,
    lastRepromptAt: 0,
    lastQuestionType: null,
  };

  if (guardState.lastQuestionType !== questionType) {
    guardState.blockedCount = 0;
  }
  guardState.lastQuestionType = questionType;
  orientationGuardStates.set(sessionId, guardState);

  if (brainAgent && typeof brainAgent.consumeOrientationUserInput === 'function') {
    const realUserInput = brainAgent.consumeOrientationUserInput(15000);
    if (!realUserInput) {
      guardState.blockedCount += 1;
      orientationGuardStates.set(sessionId, guardState);

      const modelProvidedAnswer =
        typeof userAnswer === 'string'
          ? userAnswer.trim()
          : '';
      const hasModelProvidedAnswer = modelProvidedAnswer.length >= 2;
      const canUseFallbackAnswer =
        hasModelProvidedAnswer && guardState.blockedCount >= ORIENTATION_GUARD_FALLBACK_THRESHOLD;

      if (canUseFallbackAnswer) {
        effectiveUserAnswer = modelProvidedAnswer;
        log.warn('verify_orientation_answer fallback userAnswer kullanildi', {
          sessionId,
          questionType,
          blockedCount: guardState.blockedCount,
          userAnswer: modelProvidedAnswer,
        });
        guardState.blockedCount = 0;
        guardState.lastRepromptAt = 0;
        orientationGuardStates.set(sessionId, guardState);
      } else {
        log.warn('verify_orientation_answer engellendi - taze user cevabi yok', {
          sessionId,
          questionType,
          blockedCount: guardState.blockedCount,
        });

        const now = Date.now();
        const shouldReprompt =
          now - guardState.lastRepromptAt >= ORIENTATION_GUARD_REPROMPT_COOLDOWN_MS;

        if (shouldReprompt && typeof brainAgent.sendTextToLive === 'function') {
          brainAgent.sendTextToLive(
            pickText(
              language,
              'ORIENTATION_GUARD: Henüz net cevap yok. Soruyu en fazla bir kez tekrar et ve sonra sessizce kullanıcı cevabını bekle. Yeni cevap almadan verify_orientation_answer çağırma.',
              'ORIENTATION_GUARD: No clear user answer yet. Repeat the question at most once, then wait silently for the user response. Do not call verify_orientation_answer until a new user answer arrives.'
            )
          );
          guardState.lastRepromptAt = now;
          orientationGuardStates.set(sessionId, guardState);
        }

        return {
          success: false,
          blocked: true,
          reason: 'NO_FRESH_USER_ANSWER',
          questionType,
          retryAfterMs: 2000,
          blockedCount: guardState.blockedCount,
          message: pickText(
            language,
            'Henüz kullanıcıdan net bir cevap alınmadı. Soruyu bir kez tekrar sorup bekleyin.',
            'No clear user answer has been received yet. Repeat the question once and wait.'
          ),
        };
      }
    } else {
      effectiveUserAnswer = realUserInput;
      guardState.blockedCount = 0;
      guardState.lastRepromptAt = 0;
      orientationGuardStates.set(sessionId, guardState);
    }
  }

  const verification = agent.verifyOrientationAnswer(questionType, effectiveUserAnswer, context || {});
  return {
    success: true,
    ...verification,
    message: verification.isCorrect
      ? pickText(
          language,
          `Doğru cevap. (${verification.tolerance || 'Tam eşleşme'})`,
          `Correct answer. (${verification.tolerance || 'Exact match'})`
        )
      : pickText(
          language,
          `Yanlış cevap. Doğru: ${verification.correctAnswer}`,
          `Incorrect answer. Correct: ${verification.correctAnswer}`
        ),
  };
}

async function handleCompleteSession({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  const testResults = await prisma.testResult.findMany({
    where: { sessionId },
  });

  // Sorun 3 FIX: Normalize edilmiş ortalama — her test eşit ağırlıkta
  // Her testin yüzdesini hesapla, sonra ortalama al (farklı maxScore'lar adaletli tartılır)
  const rawTotal = testResults.reduce((sum, t) => sum + t.score, 0);
  const rawMax = testResults.reduce((sum, t) => sum + t.maxScore, 0);

  const percentage = testResults.length > 0
    ? testResults.reduce((sum, t) => {
        return sum + (t.maxScore > 0 ? (t.score / t.maxScore) * 100 : 0);
      }, 0) / testResults.length
    : 0;

  // totalScore: 100 üzerinden normalize edilmiş puan (Results sayfası bunu gösteriyor)
  const totalScore = Math.round(percentage * 100) / 100;

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
    rawTotal,
    rawMax,
    percentage: Math.round(percentage),
    riskLevel,
    testCount: testResults.length,
    message: pickText(
      language,
      `Oturum tamamlandı. Genel başarı: %${Math.round(percentage)}`,
      `Session completed. Overall score: ${Math.round(percentage)}%`
    ),
  };
}

module.exports = { 
  handleToolCall, 
  registerGeminiSession, 
  unregisterGeminiSession,
  registerVisualTestAgent,
  unregisterVisualTestAgent,
  getVisualTestAgent,
  registerVideoAnalysisAgent,
  unregisterVideoAnalysisAgent,
  getVideoAnalysisAgent,
  registerCameraPresenceAgent,
  unregisterCameraPresenceAgent,
  getCameraPresenceAgent,
  registerBrainAgent,
  unregisterBrainAgent,
  getBrainAgent,
  registerDateTimeAgent,
  unregisterDateTimeAgent,
  getDateTimeAgent,
  registerSessionLanguage,
  unregisterSessionLanguage,
  getSessionLanguage,
};
