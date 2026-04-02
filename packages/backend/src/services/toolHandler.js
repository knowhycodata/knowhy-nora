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

// Kamera erişim durumu (session bazlı)
const cameraAccessStates = new Map(); // sessionId -> camera state

// Orientation guard state (session bazlı)
const orientationGuardStates = new Map(); // sessionId -> { blockedCount, lastRepromptAt, lastQuestionType }
const ORIENTATION_GUARD_REPROMPT_COOLDOWN_MS = 5000;
const ORIENTATION_GUARD_FALLBACK_THRESHOLD = 3;
// VIDEO_ANALYSIS opsiyoneldir — 4 ana test zorunlu, video analiz ek bilgi sağlar
const REQUIRED_TEST_TYPES = [
  'VERBAL_FLUENCY',
  'STORY_RECALL',
  'VISUAL_RECOGNITION',
  'ORIENTATION',
];

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

function ensureCameraAccessState(sessionId) {
  if (!cameraAccessStates.has(sessionId)) {
    cameraAccessStates.set(sessionId, {
      required: false,
      permissionGranted: false,
      permissionDenied: false,
      frameReceived: false,
      lastStatus: 'idle',
      lastError: null,
      lastUpdatedAt: null,
    });
  }

  return cameraAccessStates.get(sessionId);
}

function markCameraPermissionRequested(sessionId) {
  const state = ensureCameraAccessState(sessionId);
  Object.assign(state, {
    required: true,
    permissionGranted: false,
    permissionDenied: false,
    frameReceived: false,
    lastStatus: 'pending',
    lastError: null,
    lastUpdatedAt: Date.now(),
  });
  return state;
}

function markCameraPermissionStatus(sessionId, status, errorMessage = null) {
  const state = ensureCameraAccessState(sessionId);
  state.required = true;
  state.lastStatus = status || 'unknown';
  state.lastError = errorMessage || null;
  state.lastUpdatedAt = Date.now();

  if (status === 'granted') {
    state.permissionGranted = true;
    state.permissionDenied = false;
    return state;
  }

  state.permissionGranted = false;
  state.permissionDenied = status === 'denied';
  return state;
}

function markCameraFrameReceived(sessionId) {
  const state = ensureCameraAccessState(sessionId);
  state.required = true;
  state.permissionGranted = true;
  state.permissionDenied = false;
  state.frameReceived = true;
  state.lastStatus = 'streaming';
  state.lastUpdatedAt = Date.now();
  return state;
}

function getCameraAccessState(sessionId) {
  return ensureCameraAccessState(sessionId);
}

function unregisterCameraAccessState(sessionId) {
  cameraAccessStates.delete(sessionId);
}

function getCameraBlockedResult(language, cameraState) {
  const isPermissionDenied = cameraState?.permissionDenied;
  const reason = isPermissionDenied ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_REQUIRED';
  const message = pickText(
    language,
    isPermissionDenied
      ? 'Kamera izni reddedildi. Test 4 ve oturum tamamlama icin kamera izni zorunludur. Kullanicidan tarayici izinlerinden kamerayi acmasini iste.'
      : 'Kamera hazir degil. Test 4 ve oturum tamamlama icin once kameranin acilmasi gerekir.',
    isPermissionDenied
      ? 'Camera permission was denied. Camera access is required to continue Test 4 and complete the session. Ask the user to allow camera access from browser settings.'
      : 'Camera is not ready. The camera must be opened before Test 4 and session completion can continue.'
  );

  return {
    success: false,
    blocked: true,
    reason,
    message,
  };
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
      const elapsed = brainAgent.timerStartTime ? Math.floor((Date.now() - brainAgent.timerStartTime) / 1000) : '?';
      const remaining = brainAgent.timerStartTime ? Math.max(0, brainAgent.timerDuration - elapsed) : '?';
      brainAgent.sendTextToLive(
        pickText(
          language,
          `VERBAL_FLUENCY_GUARD: TIMER HALA AKTIF (${remaining} saniye kaldi)! ` +
            'submit_verbal_fluency cagrisi REDDEDILDI. Test 1 BITMEDI. ' +
            'HEMEN kullaniciya "Afedersiniz, sureniz hala devam ediyor. Kelime soylemeye devam edebilirsiniz" de. ' +
            '"Tebrikler" veya "tamamladiniz" deme. Sadece TIMER_COMPLETE/TIMER_STOPPED mesaji geldikten sonra submit_verbal_fluency cagir.',
          `VERBAL_FLUENCY_GUARD: TIMER IS STILL ACTIVE (${remaining} seconds left)! ` +
            'submit_verbal_fluency call was REJECTED. Test 1 is NOT finished. ' +
            'IMMEDIATELY tell the user "Sorry, your time is still running. You can keep saying words." ' +
            'Do NOT say "congratulations" or "completed". Only call submit_verbal_fluency after TIMER_COMPLETE/TIMER_STOPPED message.'
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
  const result = scoreStoryRecall(originalStory, recalledStory, language);

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
  const agent = visualTestAgents.get(sessionId);
  const authoritativeAnswers =
    agent && typeof agent.canSubmitRecognition === 'function' && agent.canSubmitRecognition()
      ? agent.getAnswersForSubmit()
      : null;

  if (agent && !authoritativeAnswers) {
    const status = typeof agent.getStatus === 'function' ? agent.getStatus() : null;
    return {
      success: false,
      blocked: true,
      reason: 'VISUAL_TEST_INCOMPLETE',
      message: pickText(
        language,
        'Gorsel tanima testi henuz tamamlanmadi. Tum gorseller record_visual_answer ile kapanmadan submit_visual_recognition cagirilemez.',
        'The visual recognition test is not complete yet. Call submit_visual_recognition only after every image has been recorded via record_visual_answer.'
      ),
      status,
    };
  }

  const trustedAnswers = authoritativeAnswers || answers;
  const result = scoreVisualRecognition(trustedAnswers, language);

  await prisma.testResult.upsert({
    where: { sessionId_testType: { sessionId, testType: 'VISUAL_RECOGNITION' } },
    update: {
      rawData: { answers: trustedAnswers },
      score: result.score,
      maxScore: result.maxScore,
      details: result,
    },
    create: {
      sessionId,
      testType: 'VISUAL_RECOGNITION',
      rawData: { answers: trustedAnswers },
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
  const cameraState = getCameraAccessState(sessionId);

  if (cameraState.required && !cameraState.permissionGranted && !cameraState.frameReceived) {
    return getCameraBlockedResult(language, cameraState);
  }

  const result = scoreOrientation(answers, language);

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
  markCameraPermissionRequested(sessionId);

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
    awaitingClientPermission: true,
    gate: 'CAMERA_PERMISSION',
    message: pickText(
      language,
      'Kamera izin akisi baslatildi. Kamera kullanima hazir olana kadar Test 4 sorularina devam etme.',
      'Camera permission flow has started. Do not continue Test 4 questions until camera access is ready.'
    ),
    presenceMonitoring: !!presenceAgent,
  };
}

async function handleStopVideoAnalysis({ sessionId }) {
  const language = getSessionLanguage(sessionId);
  log.info('stop_video_analysis çağrıldı', { sessionId });
  const cameraState = getCameraAccessState(sessionId);

  if (cameraState.required && !cameraState.frameReceived) {
    return getCameraBlockedResult(language, cameraState);
  }

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
  const cameraState = getCameraAccessState(sessionId);

  if (cameraState.required && !cameraState.permissionGranted && !cameraState.frameReceived) {
    return {
      ...getCameraBlockedResult(language, cameraState),
      questionType,
      retryAfterMs: 2000,
    };
  }

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
  const cameraState = getCameraAccessState(sessionId);
  const completedTestTypes = new Set(testResults.map((result) => result.testType));

  // 4 ana test zorunlu, VIDEO_ANALYSIS opsiyonel
  const CORE_TEST_TYPES = ['VERBAL_FLUENCY', 'STORY_RECALL', 'VISUAL_RECOGNITION', 'ORIENTATION'];
  const missingCoreTests = CORE_TEST_TYPES.filter((testType) => !completedTestTypes.has(testType));

  if (missingCoreTests.length > 0) {
    const cameraBlocked = cameraState.required && !cameraState.frameReceived;
    const baseBlockedResult = cameraBlocked
      ? getCameraBlockedResult(language, cameraState)
      : {
          success: false,
          blocked: true,
          reason: 'MISSING_TEST_RESULTS',
          message: pickText(
            language,
            `Oturum henuz tamamlanamiyor. Eksik testler var: ${missingCoreTests.join(', ')}.`,
            `The session cannot be completed yet. Missing test results: ${missingCoreTests.join(', ')}.`
          ),
        };

    return {
      ...baseBlockedResult,
      missingTests: missingCoreTests,
    };
  }

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
  markCameraPermissionRequested,
  markCameraPermissionStatus,
  markCameraFrameReceived,
  getCameraAccessState,
  unregisterCameraAccessState,
};
