/**
 * Brain Agent - Transkript Analiz ve Test Yönetim Ajanı
 *
 * Gemini Live (ses ajanı) sadece konuşur ve dinler.
 * Brain Agent ise transkriptleri analiz eder ve:
 * - Timer başlatma/durdurma kararı verir
 * - Test state'ini yönetir
 * - Frontend'e event gönderir
 */

const { createLogger } = require('../lib/logger');
const { normalizeLanguage, pickText } = require('../lib/language');

const log = createLogger('BrainAgent');

const KEYWORDS = {
  verbalIntro: [
    'sözel akıcılık', 'sozəl akicilik', 'ilk test', 'bir harf',
    'kelime söyle', 'hazır mısınız', 'hazir misiniz', 'harf vereceğim',
    'verbal fluency', 'first test', 'letter', 'say words',
    'are you ready', 'i will give you a letter',
  ],
  verbalStart: [
    'başlayabilirsiniz', 'baslayabilirsiniz', 'süreniz başladı', 'sureniz basladi',
    'başlayın', 'baslayin', 'haydi başlayalım', 'haydi baslayalim',
    'you can start', 'your time has started', 'start now', 'timer started',
  ],
  userReady: [
    'hazır', 'hazir', 'evet', 'başla', 'basla', 'tamam', 'olur', 'tabii',
    'hazırım', 'hazirim', 'devam', 'devam edelim', 'geçelim', 'gecelim',
    'başlayalım', 'baslayalim', 'gidebiliriz', 'hadi',
    'ready', 'yes', 'start', 'okay', 'ok', 'sure', "let's go",
    "i'm ready", 'im ready', 'go ahead', 'continue', "let's continue",
  ],
  userNotReady: [
    'kötü', 'kotu', 'iyi değil', 'iyi degil', 'yorgun', 'hasta', 'korkuyorum',
    'tedirgin', 'gergin', 'endişeli', 'endiseli', 'bilmiyorum', 'emin değilim',
    'emin degilim', 'biraz bekle', 'bir dakika', 'dur', 'hayır', 'hayir',
    'not good', 'tired', 'scared', 'nervous', 'anxious', "i don't know",
    'not sure', 'wait', 'no', 'hold on', 'not ready',
  ],
  userStop: [
    'durdur', 'duralım', 'duralim', 'bitirelim', 'tamam bitti',
    'bitirdim', 'tamamladım', 'tamamladim', 'tamamdır',
    'aklıma gelmiyor', 'aklima gelmiyor',
    'bu kadar', 'artık yeter', 'artik yeter', 'daha fazla yok', 'başka yok',
    'baska yok', 'o kadar', 'durduralım', 'durduralim',
    'süreyi durdur', 'sureyi durdur',
    'stop now', 'that is enough', 'i am done', "i'm done",
    'no more words', "i can't think of more", 'nothing else',
    'thats all', "that's all", "that's it", 'thats it', 'i am finished',
    "i'm finished", 'done now', 'i have no more',
    'cannot think of more', "can't remember more", 'cant remember more',
    'bu kadar yeter', 'daha fazla soyleyemiyorum', 'baska soyleyemiyorum',
    'testi bitir', 'testi bitirelim', 'yeter artik', 'yeter artık',
  ],
  dangerWhileTimer: [
    'hikaye', 'test 2', 'ikinci test', 'testi tamamladınız', 'testi tamamladiniz',
    'bitirdiniz', 'story', 'second test', 'you completed the first test',
    'tamamladınız', 'tamamladiniz', 'tebrikler', 'tebrik', 'ilk testi',
    'first test', 'congratulations', 'completed', 'well done',
    'aferin', 'bravo', 'başarılı', 'basarili', 'sonuç', 'sonuc',
    'güzel kelimeler', 'guzel kelimeler', 'nice words',
    'test bitti', 'test is over', 'test is done', 'test is complete',
    'süre bitti', 'sure bitti', 'süreniz bitti', 'sureniz bitti',
    'time is up', "time's up", 'timer is over',
  ],
  storyStart: [
    'hikaye', 'hikaye hatirlama', 'kısa bir hikaye', 'kisa bir hikaye',
    'dikkatle dinleyin', 'ikinci test', 'ikinci testimiz', 'ikinci teste',
    'story', 'story recall', 'listen carefully', 'second test',
  ],
  storyRecallPrompt: [
    'hatırladığınız', 'hatirladiginiz', 'anlatır mısınız', 'anlatir misiniz',
    'tekrar anlatın', 'tekrar anlatin', 'anlatmanızı', 'anlatmanizi',
    'hatırladıklarınızı', 'hatirladiklarinizi', 'ne hatırlıyorsunuz', 'ne hatirliyorsunuz',
    'siz anlatın', 'siz anlatin', 'şimdi sıra sizde', 'simdi sira sizde',
    'can you retell', 'tell me what you remember', 'what do you remember',
    'please retell', 'your turn to tell', 'now tell me',
  ],
  visualStart: [
    'görsel tanıma', 'gorsel tanima', 'görsel test', 'gorsel test',
    'ekranınıza', 'ekraniniza', 'görsel göstereceğim', 'gorsel gosterecegim',
    'visual recognition', 'image test', 'i will show images', 'look at the screen',
  ],
  visualDone: [
    'görsel tanıma testini tamamladınız', 'gorsel tanima testini tamamladiniz',
    'son testimize', 'yönelim', 'yonelim',
    'visual recognition test is complete', 'last test', 'orientation test',
  ],
  orientationStart: [
    'yönelim', 'yonelim', 'son test', 'zaman ve mekan', 'tarih', 'günümüz', 'gunumuz',
    'sorular soracağım', 'sorular soracagim', 'kamera',
    'orientation', 'last test', 'time and place', 'date',
    'i will ask questions', 'camera',
  ],
  orientationDone: [
    'tüm testleri tamamladınız', 'tum testleri tamamladiniz',
    'oturumu sonlandır', 'oturumu sonlandir', 'testler tamamlandı', 'testler tamamlandi',
    'teşekkür ederim', 'tesekkur ederim', 'oturum tamamlandı', 'oturum tamamlandi',
    'all tests are completed', 'end the session', 'session completed', 'thank you',
  ],
};

const COMMON_FILLER_WORDS = new Set([
  'hmm', 'hmmm', 'hmmmm', 'umm', 'um', 'uh', 'aa', 'aaa', 'ee', 'eee', 'ah', 'oh',
]);

const FILLER_WORDS_BY_LANGUAGE = {
  tr: new Set(['hım', 'hımm', 'hımmm', 'himm', 'ıı', 'ııı', 'ii', 'iii', 'sey', 'şey', 'yani', 'aslinda', 'aslında']),
  en: new Set(['uhh', 'uhhh', 'ummm', 'erm', 'huh']),
};

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function getLocale(language) {
  return normalizeLanguage(language) === 'en' ? 'en-US' : 'tr-TR';
}

function normalizeForMatch(text, language) {
  if (!text) return '';
  return String(text)
    .toLocaleLowerCase(getLocale(language))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class BrainAgent {
  constructor(sessionId, sendToClient, sendTextToLive, language = 'tr') {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.language = normalizeLanguage(language);
    this.visualTestAgent = null;
    this.videoAnalysisAgent = null;

    this.testPhase = 'IDLE';
    this.targetLetter = null;
    this.collectedWords = [];
    this.timerActive = false;
    this.timerStartTime = null;
    this.timerDuration = 60;
    this.timerId = null;
    this.timerTimeout = null;
    this.inactivityCheckInterval = null;
    this.lastUserSpeechAt = null;
    this.lastProgressAt = null;
    this.inactivityWarningSent = false;
    this.INACTIVITY_WARN_AFTER_MS = parsePositiveInt(process.env.TEST1_INACTIVITY_WARN_MS, 15000);
    this.INACTIVITY_STOP_AFTER_MS = parsePositiveInt(process.env.TEST1_INACTIVITY_STOP_MS, 30000);
    this.MIN_AUTO_STOP_ELAPSED_MS = parsePositiveInt(process.env.TEST1_AUTO_STOP_MIN_ELAPSED_MS, 30000);

    // BUG-010: Test 2 (Story Recall) inactivity timeout
    this.storyRecallStartedAt = null;
    this.storyRecallLastUserAt = null;
    this.storyRecallLastAgentAt = null;
    this.storyRecallAgentDone = false;
    this.storyRecallWarningSent = false;
    this.storyRecallInactivityInterval = null;
    this.STORY_RECALL_WARN_MS = parsePositiveInt(process.env.TEST2_INACTIVITY_WARN_MS, 35000);
    this.STORY_RECALL_TIMEOUT_MS = parsePositiveInt(process.env.TEST2_INACTIVITY_TIMEOUT_MS, 60000);
    this.storyRecallSubmitAllowed = false; // kullanici onay verene kadar submit bloklenir

    // Transition agent state
    this.transitionAttempts = 0;
    this.MAX_TRANSITION_ATTEMPTS = 3;
    this.transitionStartedAt = null;
    this.TRANSITION_TIMEOUT_MS = parsePositiveInt(process.env.TRANSITION_TIMEOUT_MS, 60000);
    this.transitionTimeoutHandle = null;

    this.agentBuffer = '';
    this.userBuffer = '';
    this.bufferResetTimeout = null;
    this.BUFFER_WINDOW_MS = 5000;

    // Karsilama korumasi: session baslangicinda belirli bir sure boyunca
    // IDLE → VERBAL_FLUENCY_WAITING gecisini engelle (ajan karsilama yaparken
    // "hazir misiniz" gibi kelimeleri test baslangici olarak algilamamasi icin)
    this.sessionStartedAt = Date.now();
    this.GREETING_GUARD_MS = parsePositiveInt(process.env.GREETING_GUARD_MS, 15000);
    this.greetingDone = false; // kullanici ilk kez konusunca true olur

    this.orientationUserInputBuffer = '';
    this.orientationLastUserAt = 0;

    log.info('BrainAgent oluşturuldu', { sessionId, language: this.language });
  }

  onTranscript(role, text) {
    if (!text || text.trim().length === 0) return;

    const cleanText = text.trim();
    if (role === 'agent') {
      this.agentBuffer += ` ${cleanText}`;
      if (this.testPhase === 'STORY_RECALL_ACTIVE') {
        this.storyRecallLastAgentAt = Date.now();
      }
    } else {
      this.userBuffer += ` ${cleanText}`;
      this._updateStoryRecallActivity();
      if (this.testPhase === 'ORIENTATION_ACTIVE') {
        this.orientationUserInputBuffer += ` ${cleanText}`;
        this.orientationLastUserAt = Date.now();
      }
    }

    log.info('Transkript', {
      sessionId: this.sessionId,
      role,
      text: cleanText.substring(0, 100),
      phase: this.testPhase,
      agentBuf: this.agentBuffer.substring(0, 60),
      userBuf: this.userBuffer.substring(0, 60),
    });

    if (this.bufferResetTimeout) clearTimeout(this.bufferResetTimeout);
    this.bufferResetTimeout = setTimeout(() => {
      this.agentBuffer = '';
      this.userBuffer = '';
    }, this.BUFFER_WINDOW_MS);

    this._analyzePhase(role, cleanText);
  }

  onToolCall(toolName) {
    if (toolName === 'generate_story' && ['VERBAL_FLUENCY_DONE', 'TRANSITION_TO_TEST2', 'IDLE'].includes(this.testPhase)) {
      log.info('Faz geçişi (tool call): → STORY_RECALL_ACTIVE', { sessionId: this.sessionId, toolName, from: this.testPhase });
      this.testPhase = 'STORY_RECALL_ACTIVE';
      this.storyRecallAgentDone = false;
      this.storyRecallLastAgentAt = Date.now();
      if (this._storyRecallWatcherFallbackTimeout) clearTimeout(this._storyRecallWatcherFallbackTimeout);
      this._storyRecallWatcherFallbackTimeout = setTimeout(() => {
        if (this.testPhase === 'STORY_RECALL_ACTIVE' && !this.storyRecallAgentDone) {
          log.warn('Story Recall watcher fallback (tool call path)', { sessionId: this.sessionId });
          this.storyRecallAgentDone = true;
          this._startStoryRecallWatcher();
        }
      }, 60000);
    } else if (toolName === 'submit_story_recall') {
      log.info('submit_story_recall tool call - TRANSITION_TO_TEST3 hazırlığı', { sessionId: this.sessionId, from: this.testPhase });
      this._stopStoryRecallWatcher();
      // Kisa gecikme sonrasi transition fazina gec
      setTimeout(() => {
        if (this.testPhase === 'STORY_RECALL_ACTIVE' || this.testPhase === 'VERBAL_FLUENCY_DONE') {
          log.info('Faz geçişi: → TRANSITION_TO_TEST3', { sessionId: this.sessionId });
          this._enterTransition('TRANSITION_TO_TEST3');
        }
      }, 2000);
    } else if (toolName === 'start_visual_test' && !['VISUAL_TEST_ACTIVE'].includes(this.testPhase) && 
               ['STORY_RECALL_DONE', 'TRANSITION_TO_TEST3', 'STORY_RECALL_ACTIVE', 'VERBAL_FLUENCY_DONE', 'IDLE'].includes(this.testPhase)) {
      log.info('Faz geçişi (tool call): → VISUAL_TEST_ACTIVE', { sessionId: this.sessionId, toolName, from: this.testPhase });
      this.testPhase = 'VISUAL_TEST_ACTIVE';
      this._stopStoryRecallWatcher();
    } else if (toolName === 'submit_visual_recognition') {
      log.info('submit_visual_recognition tool call - TRANSITION_TO_TEST4 hazırlığı', { sessionId: this.sessionId, from: this.testPhase });
      setTimeout(() => {
        if (this.testPhase === 'VISUAL_TEST_ACTIVE' || this.testPhase === 'VISUAL_TEST_DONE') {
          log.info('Faz geçişi: → TRANSITION_TO_TEST4', { sessionId: this.sessionId });
          this._enterTransition('TRANSITION_TO_TEST4');
        }
      }, 2000);
    } else if (toolName === 'submit_orientation') {
      log.info('Faz geçişi (tool call): → ORIENTATION_DONE', { sessionId: this.sessionId, toolName });
      this.testPhase = 'ORIENTATION_DONE';
    }
  }

  _analyzePhase(role, text) {
    const rawText = text;
    const agentBuf = this.agentBuffer;
    const userBuf = this.userBuffer;

    switch (this.testPhase) {
      case 'IDLE':
        this._handleIdle(role, rawText, agentBuf);
        break;
      case 'TRANSITION_TO_TEST1':
      case 'TRANSITION_TO_TEST2':
      case 'TRANSITION_TO_TEST3':
      case 'TRANSITION_TO_TEST4':
        this._handleTransition(role, rawText, userBuf);
        break;
      case 'VERBAL_FLUENCY_WAITING':
        this._handleWaiting(role, rawText, agentBuf, userBuf);
        break;
      case 'VERBAL_FLUENCY_ACTIVE':
        this._handleActive(role, rawText, text, userBuf);
        break;
      case 'VERBAL_FLUENCY_DONE':
      case 'STORY_RECALL_ACTIVE':
        this._handlePostTest1(role, rawText, agentBuf);
        break;
      case 'STORY_RECALL_DONE':
        break;
      case 'VISUAL_TEST_ACTIVE':
        this._handleVisualTestActive(role, rawText, text);
        break;
      case 'VISUAL_TEST_DONE':
        this._handlePostVisualTest(role, rawText, agentBuf);
        break;
      case 'ORIENTATION_ACTIVE':
        this._handleOrientationActive(role, rawText);
        break;
      default:
        break;
    }
  }

  _handleIdle(role, text, agentBuf) {
    // Kullanici ilk kez konustugunda greetingDone = true yap
    if (role === 'user' && !this.greetingDone) {
      this.greetingDone = true;
      log.info('Greeting guard: kullanici ilk kez konustu, karsilama tamamlandi', { sessionId: this.sessionId });
    }

    if (role !== 'agent') return;

    // Karsilama korumasi: session basladigindan beri GREETING_GUARD_MS gecmemisse
    // VE kullanici henuz konusmamissa, faz gecisi yapma
    const sinceStart = Date.now() - this.sessionStartedAt;
    if (!this.greetingDone && sinceStart < this.GREETING_GUARD_MS) {
      log.debug('Greeting guard aktif - IDLE gecisi engellendi', {
        sessionId: this.sessionId,
        sinceStartMs: sinceStart,
        guardMs: this.GREETING_GUARD_MS,
        text: text.substring(0, 60),
      });
      return;
    }

    if (this._containsAny(agentBuf, KEYWORDS.verbalIntro) || this._containsAny(text, KEYWORDS.verbalIntro)) {
      log.info('Faz geçişi: IDLE → VERBAL_FLUENCY_WAITING (agent test açıklaması algılandı)', { sessionId: this.sessionId });
      this.testPhase = 'VERBAL_FLUENCY_WAITING';
      this._tryExtractLetter(agentBuf);
      this._tryExtractLetter(text);
    }
  }

  // ─── TRANSITION AGENT ─────────────────────────────────────────
  _enterTransition(targetPhase) {
    this.testPhase = targetPhase;
    this.transitionAttempts = 0;
    this.transitionStartedAt = Date.now();
    this._transitionAdvancing = false;
    this.userBuffer = '';
    this.agentBuffer = '';

    if (this.transitionTimeoutHandle) clearTimeout(this.transitionTimeoutHandle);
    this.transitionTimeoutHandle = setTimeout(() => {
      if (this.testPhase === targetPhase) {
        log.warn('Transition timeout - zorla ilerleniyor', { sessionId: this.sessionId, phase: targetPhase });
        this._advanceFromTransition();
      }
    }, this.TRANSITION_TIMEOUT_MS);

    const testName = this._transitionTargetName(targetPhase);
    log.info(`Transition fazı başladı: ${targetPhase}`, { sessionId: this.sessionId, testName });

    this.sendToClient({
      type: 'test_phase_change',
      phase: targetPhase,
      message: pickText(this.language,
        `${testName} için hazırlık`,
        `Preparing for ${testName}`),
    });
  }

  _handleTransition(role, text, userBuf) {
    if (role !== 'user') return;
    if (this._transitionAdvancing) return;

    // Transition basladiktan sonra en az 3 saniye bekle (Gemini'nin soru sormasi icin)
    const sinceTransitionStart = Date.now() - (this.transitionStartedAt || 0);
    if (sinceTransitionStart < 3000) return;

    // Sadece mevcut text'e bak, userBuf eski testlerden kalma veri icerebilir
    const isReady = this._containsAny(text, KEYWORDS.userReady);
    const isNotReady = this._containsAny(text, KEYWORDS.userNotReady);

    if (isReady) {
      log.info('Kullanıcı hazır - transition tamamlanıyor', {
        sessionId: this.sessionId,
        phase: this.testPhase,
        attempts: this.transitionAttempts,
      });
      this._advanceFromTransition();
      return;
    }

    if (isNotReady) {
      this.transitionAttempts += 1;
      log.info('Kullanıcı hazır değil - teşvik gönderiliyor', {
        sessionId: this.sessionId,
        phase: this.testPhase,
        attempt: this.transitionAttempts,
      });

      if (this.transitionAttempts >= this.MAX_TRANSITION_ATTEMPTS) {
        this.sendTextToLive(
          pickText(
            this.language,
            'TRANSITION_NUDGE: Kullanıcı birkaç kez hazır olmadığını belirtti. ' +
              'Nazikce "Sizin tempönüze saygı duyuyorum ama devam etmemiz gerekiyor. ' +
              'Endişelenmeyin, çok kısa ve basit olacak." de ve sonraki teste başla.',
            'TRANSITION_NUDGE: The user has expressed not being ready multiple times. ' +
              'Gently say "I respect your pace but we need to continue. ' +
              'Don\'t worry, it will be quick and simple." and start the next test.'
          )
        );
        setTimeout(() => {
          if (this.testPhase.startsWith('TRANSITION_')) {
            this._advanceFromTransition();
          }
        }, 8000);
        return;
      }

      const encouragements = this.language === 'tr'
        ? [
          'TRANSITION_SUPPORT: Kullanıcı kendini iyi hissetmiyor veya hazır değil. ' +
            'Empatik ol: "Anlıyorum, acele etmeyelim. Kendinizi hazır hissettiğinizde devam ederiz. ' +
            'Test çok kısa ve kolay, endişelenmenize gerek yok." de. Hazır olup olmadığını tekrar sor.',
          'TRANSITION_SUPPORT: Kullanıcı hala tereddütlü. "Gayet normal, birçok kişi benzer hissediyor. ' +
            'Sadece birkaç basit soru, yanlış cevap diye bir şey yok. Hazır mısınız?" de.',
        ]
        : [
          'TRANSITION_SUPPORT: The user is not feeling well or not ready. ' +
            'Be empathetic: "I understand, no rush. We\'ll continue when you feel ready. ' +
            'The test is very short and easy, nothing to worry about." Ask if they are ready again.',
          'TRANSITION_SUPPORT: The user is still hesitant. "That\'s completely normal, many people feel the same. ' +
            'Just a few simple questions, there are no wrong answers. Are you ready?" ',
        ];
      const idx = Math.min(this.transitionAttempts - 1, encouragements.length - 1);
      this.sendTextToLive(encouragements[idx]);
    }
  }

  _advanceFromTransition() {
    this._transitionAdvancing = true;

    if (this.transitionTimeoutHandle) {
      clearTimeout(this.transitionTimeoutHandle);
      this.transitionTimeoutHandle = null;
    }

    const phase = this.testPhase;
    switch (phase) {
      case 'TRANSITION_TO_TEST1':
        log.info('Transition → VERBAL_FLUENCY_WAITING', { sessionId: this.sessionId });
        this.testPhase = 'VERBAL_FLUENCY_WAITING';
        this.sendToClient({
          type: 'test_phase_change',
          phase: 'VERBAL_FLUENCY_WAITING',
          message: pickText(this.language, 'Sözel akıcılık testi başlıyor', 'Verbal fluency test starting'),
        });
        this.sendTextToLive(
          pickText(
            this.language,
            'TRANSITION_READY: Kullanıcı hazır. Şimdi Test 1 (Sözel Akıcılık) testini açıkla ve başlat. ' +
              'Bir harf seç ve kuralları anlat.',
            'TRANSITION_READY: The user is ready. Now explain and start Test 1 (Verbal Fluency). ' +
              'Pick a letter and explain the rules.'
          )
        );
        break;

      case 'TRANSITION_TO_TEST2':
        log.info('Transition → VERBAL_FLUENCY_DONE (generate_story bekleniyor)', { sessionId: this.sessionId });
        this.testPhase = 'VERBAL_FLUENCY_DONE';
        this.sendToClient({
          type: 'test_phase_change',
          phase: 'STORY_RECALL_ACTIVE',
          message: pickText(this.language, 'Hikaye hatırlama testi başlıyor', 'Story recall test starting'),
        });
        this.sendTextToLive(
          pickText(
            this.language,
            'TRANSITION_READY: Kullanıcı ikinci test için hazır. ' +
              'Şimdi Test 2 (Hikaye Hatırlama) testini açıkla: "Size kısa bir hikaye anlatacağım, dikkatle dinleyin." ' +
              'Sonra HEMEN generate_story() fonksiyonunu çağır. Hikayeyi kendin UYDURMA.',
            'TRANSITION_READY: The user is ready for Test 2. ' +
              'Explain Test 2 (Story Recall): "I will tell you a short story, listen carefully." ' +
              'Then IMMEDIATELY call generate_story(). Do NOT make up a story yourself.'
          )
        );
        break;

      case 'TRANSITION_TO_TEST3':
        log.info('Transition → STORY_RECALL_DONE (start_visual_test bekleniyor)', { sessionId: this.sessionId });
        this.testPhase = 'STORY_RECALL_DONE';
        this.sendToClient({
          type: 'test_phase_change',
          phase: 'VISUAL_TEST_ACTIVE',
          message: pickText(this.language, 'Görsel tanıma testi başlıyor', 'Visual recognition test starting'),
        });
        this.sendTextToLive(
          pickText(
            this.language,
            'TRANSITION_READY: Kullanıcı üçüncü test için hazır. ' +
              'Şimdi Test 3 (Görsel Tanıma) testini açıkla: "Ekranınıza sırayla görseller göstereceğim, ne olduğunu söylemenizi isteyeceğim." ' +
              'Sonra HEMEN start_visual_test() fonksiyonunu çağır.',
            'TRANSITION_READY: The user is ready for Test 3. ' +
              'Explain Test 3 (Visual Recognition): "I will show images on your screen, tell me what you see." ' +
              'Then IMMEDIATELY call start_visual_test().'
          )
        );
        break;

      case 'TRANSITION_TO_TEST4':
        log.info('Transition → ORIENTATION_ACTIVE', { sessionId: this.sessionId });
        this.testPhase = 'ORIENTATION_ACTIVE';
        this.orientationUserInputBuffer = '';
        this.orientationLastUserAt = 0;
        this.sendToClient({
          type: 'test_phase_change',
          phase: 'ORIENTATION_ACTIVE',
          message: pickText(this.language, 'Yönelim testi başlıyor', 'Orientation test starting'),
        });
        this.sendTextToLive(
          pickText(
            this.language,
            'TRANSITION_READY: Kullanıcı son test için hazır. ' +
              'Şimdi Test 4 (Yönelim) testini başlat. ' +
              'Kullanıcıya zaman ve mekânla ilgili 7 soru sor (yıl, ay, gün, mevsim, şehir, ülke, bulunduğu yer).',
            'TRANSITION_READY: The user is ready for the last test. ' +
              'Now start Test 4 (Orientation). ' +
              'Ask the user 7 questions about time and place (year, month, day, season, city, country, current location).'
          )
        );
        break;

      default:
        log.warn('Bilinmeyen transition fazı', { sessionId: this.sessionId, phase });
    }
  }

  _transitionTargetName(phase) {
    const map = {
      TRANSITION_TO_TEST1: pickText(this.language, 'Sözel Akıcılık Testi', 'Verbal Fluency Test'),
      TRANSITION_TO_TEST2: pickText(this.language, 'Hikaye Hatırlama Testi', 'Story Recall Test'),
      TRANSITION_TO_TEST3: pickText(this.language, 'Görsel Tanıma Testi', 'Visual Recognition Test'),
      TRANSITION_TO_TEST4: pickText(this.language, 'Yönelim Testi', 'Orientation Test'),
    };
    return map[phase] || phase;
  }

  _handleWaiting(role, text, agentBuf) {
    if (role === 'agent') {
      this._tryExtractLetter(text);
      this._tryExtractLetter(agentBuf);

      if (this._containsAny(text, KEYWORDS.verbalStart) || this._containsAny(agentBuf, KEYWORDS.verbalStart)) {
        log.info('Timer başlatma sinyali algılandı (agent)', { sessionId: this.sessionId, text: text.substring(0, 60) });
        this._startTimer();
      }
      return;
    }

    if (role === 'user' && this.targetLetter && !this.timerActive && this._containsAny(text, KEYWORDS.userReady)) {
      setTimeout(() => {
        if (!this.timerActive && this.testPhase === 'VERBAL_FLUENCY_WAITING') {
          log.info('Kullanıcı hazır ama timer başlamadı - zorla başlat', { sessionId: this.sessionId });
          this._startTimer();
        }
      }, 2500);
    }
  }

  _handleActive(role, text, rawText, userBuf = '') {
    if (role === 'user') {
      this.lastUserSpeechAt = Date.now();

      const elapsed = this.timerStartTime ? Date.now() - this.timerStartTime : 0;
      const MIN_ELAPSED_FOR_USER_STOP = 15000;

      if (elapsed >= MIN_ELAPSED_FOR_USER_STOP &&
          (this._containsAny(text, KEYWORDS.userStop) || this._containsAny(userBuf, KEYWORDS.userStop))) {
        log.info('Stop sinyali algılandı', { sessionId: this.sessionId, text, elapsedMs: elapsed });
        this._stopTimer('user_stop');
        return;
      }

      const addedWords = this._collectWords(rawText);
      if (addedWords > 0) {
        this.lastProgressAt = Date.now();
        this.inactivityWarningSent = false;
      }
      return;
    }

    if (role === 'agent' && this.timerActive) {
      // Ajan kelime sayiyor mu? (hedef harfle baslayan kelime soyluyorsa)
      if (this.targetLetter && this._agentIsSayingWords(text)) {
        log.warn('KRITIK: Ajan Test 1 sirasinda kelime sayiyor!', {
          sessionId: this.sessionId,
          text: text.substring(0, 120),
          targetLetter: this.targetLetter,
        });
        this.agentBuffer = '';
        this.sendTextToLive(
          pickText(
            this.language,
            `KELIME_UYARI: SEN AZ ONCE KELİME SOYLEDİN! "${text.trim()}" — Bu YASAK! ` +
              'Sen SINAV GOZETMENİSİN, kelime sayma senin isin DEGIL. ' +
              'Kullanici kelime sayiyor, sen SADECE dinliyorsun. HEMEN SUS ve bir daha kelime soyleme. ' +
              'Hicbir onay, hicbir kelime, hicbir yorum yapma. TAMAMEN SESSIZ KAL.',
            `WORD_WARNING: YOU JUST SAID A WORD! "${text.trim()}" — This is FORBIDDEN! ` +
              'You are the EXAM PROCTOR, saying words is NOT your job. ' +
              'The user is saying words, you are ONLY listening. STOP IMMEDIATELY and do not say any more words. ' +
              'No confirmations, no words, no comments. BE COMPLETELY SILENT.'
          )
        );
        return;
      }

      const dangerInText = this._containsAny(text, KEYWORDS.dangerWhileTimer);
      const dangerInBuf = this._containsAny(this.agentBuffer, KEYWORDS.dangerWhileTimer);
      if (dangerInText || dangerInBuf) {
        const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
        const remaining = this.timerDuration - elapsed;
        log.warn('KRITIK: Ajan timer aktifken test bitirmeye/gecise calisiyor', {
          sessionId: this.sessionId,
          elapsed,
          remaining,
          text: text.substring(0, 80),
          agentBuf: this.agentBuffer.substring(0, 80),
        });
        this.agentBuffer = '';
        this.sendTextToLive(
          pickText(
            this.language,
            `KRITIK_UYARI: TIMER HALA AKTIF! ${remaining} saniye kaldi. ` +
              'Test 1 DEVAM EDIYOR. "Tebrikler" veya "tamamladiniz" gibi ifadeler kullanma! ' +
              'Testi bitirme yetkisi sende DEGIL. Sadece TIMER_COMPLETE veya TIMER_STOPPED mesaji gelince testi bitirebilirsin. ' +
              'Simdi kullaniciya "Sureniz devam ediyor, kelime soylemeye devam edebilirsiniz" de.',
            `CRITICAL_WARNING: TIMER IS STILL ACTIVE! ${remaining} seconds left. ` +
              'Test 1 is STILL RUNNING. Do NOT say "congratulations" or "completed"! ' +
              'You do NOT have authority to end the test. Only TIMER_COMPLETE or TIMER_STOPPED message can end it. ' +
              'Now tell the user "Your time is still running, you can keep saying words."'
          )
        );
      }
    }
  }

  _tryExtractLetter(text) {
    if (this.targetLetter) return;

    const patterns = [
      /harfiniz\s+['"'""]?([A-ZÇĞİÖŞÜ])['"'""]?\b/i,
      /harfiniz\s+['"'""]?([A-ZÇĞİÖŞÜ])['"'""]?\./i,
      /\b([A-ZÇĞİÖŞÜ])['"'""]?\s+harfi/i,
      /your\s+letter\s+is\s+['"'""]?([A-Z])['"'""]?\b/i,
      /letter\s+is\s+['"'""]?([A-Z])['"'""]?\b/i,
      /letter[:\s]+['"'""]?([A-Z])['"'""]?\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]?.length === 1) {
        this.targetLetter = match[1].toUpperCase();
        log.info('Hedef harf bulundu', { sessionId: this.sessionId, letter: this.targetLetter, match: match[0] });
        return;
      }
    }
  }

  _collectWords(text) {
    const words = text.split(/[\s,\.;!?]+/).filter((w) => w.length > 1);
    let addedWords = 0;
    const locale = getLocale(this.language);
    const languageFillers = FILLER_WORDS_BY_LANGUAGE[this.language] || FILLER_WORDS_BY_LANGUAGE.tr;

    for (const word of words) {
      const clean = word
        .toLocaleLowerCase(locale)
        .replace(/^[^a-zA-ZÇĞİÖŞÜçğıöşü]+|[^a-zA-ZÇĞİÖŞÜçğıöşü]+$/g, '')
        .trim();

      if (clean.length <= 1 || COMMON_FILLER_WORDS.has(clean) || languageFillers.has(clean)) continue;

      if (!this.collectedWords.includes(clean)) {
        this.collectedWords.push(clean);
        addedWords += 1;
      }
    }
    if (words.length > 0) {
      log.debug('Kelimeler', { sessionId: this.sessionId, new: words, total: this.collectedWords.length });
    }

    return addedWords;
  }

  /**
   * Ajan Test 1 sirasinda hedef harfle baslayan kelime soyluyor mu?
   * Izin verilen kisa tesvik cumlelerini ("devam edin", "suresiniz devam ediyor") haric tutar.
   */
  _agentIsSayingWords(text) {
    if (!this.targetLetter || !text) return false;

    const cleaned = text.toLocaleLowerCase(getLocale(this.language)).trim();
    if (cleaned.length <= 2) return false;

    const allowedPatterns = [
      'devam', 'süre', 'sure', 'zaman', 'time', 'continue', 'running',
      'bekle', 'düşün', 'dusun', 'seconds', 'saniye', 'dakika',
    ];
    if (allowedPatterns.some(p => cleaned.includes(p))) return false;

    const words = cleaned.split(/[\s,\.;!?]+/).filter(w => w.length > 1);
    const letter = this.targetLetter.toLocaleLowerCase(getLocale(this.language));

    let matchCount = 0;
    for (const word of words) {
      const w = word.replace(/^[^a-zA-ZÇĞİÖŞÜçğıöşü]+/, '');
      if (w.length > 1 && w.startsWith(letter) && !COMMON_FILLER_WORDS.has(w)) {
        matchCount++;
      }
    }

    return matchCount >= 1;
  }

  _startTimer() {
    if (this.timerActive) return;

    this.timerActive = true;
    this.timerStartTime = Date.now();
    this.timerId = `${Date.now()}_VF`;
    this.collectedWords = [];
    this.testPhase = 'VERBAL_FLUENCY_ACTIVE';
    this.lastUserSpeechAt = null;
    this.lastProgressAt = null;
    this.inactivityWarningSent = false;

    this.sendToClient({
      type: 'timer_started',
      timerId: this.timerId,
      durationSeconds: this.timerDuration,
      testType: 'VERBAL_FLUENCY',
    });

    this.timerTimeout = setTimeout(() => {
      if (this.timerActive) this._stopTimer('timeout');
    }, this.timerDuration * 1000);

    this._startInactivityWatcher();
  }

  _stopTimer(reason) {
    if (!this.timerActive) return;

    this.timerActive = false;
    this._stopInactivityWatcher();
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }

    const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
    const remaining = Math.max(0, this.timerDuration - elapsed);
    const isTimeout = reason === 'timeout';

    if (isTimeout) {
      this.sendToClient({ type: 'timer_complete', timerId: this.timerId, testType: 'VERBAL_FLUENCY' });
    } else {
      this.sendToClient({ type: 'timer_stopped', timerId: this.timerId, remaining, reason });
    }

    const wordList = this.collectedWords.length > 0
      ? this.collectedWords.join(', ')
      : pickText(this.language, 'kelime toplanamadi', 'no words were captured');

    const letter = this.targetLetter || 'P';
    const prefix = isTimeout ? 'TIMER_COMPLETE' : 'TIMER_STOPPED';
    const wordJson = this.collectedWords.map((w) => `"${w}"`).join(', ');
    const stopReasonTextTr = reason === 'auto_inactivity'
      ? `Kullanici uzun sure sessiz kaldigi ve yeni kelime gelmedigi icin test otomatik durduruldu. ${elapsed} saniye gecti.`
      : `Kullanici durdurmak istedi. ${elapsed} saniye gecti.`;
    const stopReasonTextEn = reason === 'auto_inactivity'
      ? `The test was automatically stopped due to prolonged silence and no new words. ${elapsed} seconds elapsed.`
      : `The user asked to stop. ${elapsed} seconds elapsed.`;

    this.sendTextToLive(
      pickText(
        this.language,
        `${prefix}: ${isTimeout ? '60 saniyelik sure doldu.' : stopReasonTextTr} ` +
          `Kullanicinin soyledigi kelimeler: [${wordList}]. Toplam ${this.collectedWords.length} kelime. ` +
          `Simdi submit_verbal_fluency fonksiyonunu cagir. words: [${wordJson}], targetLetter: "${letter}", sessionId: "${this.sessionId}", durationSeconds: ${elapsed}. ` +
          'submit_verbal_fluency cagirdiktan sonra kullaniciya "Tebrikler, ilk testi tamamladınız!" de. ' +
          'Sonra nasıl hissettiğini sor ve ikinci teste hazır olup olmadığını sor. Onay bekle.',
        `${prefix}: ${isTimeout ? 'The 60-second timer is over.' : stopReasonTextEn} ` +
          `User words: [${wordList}]. Total ${this.collectedWords.length} words. ` +
          `Now call submit_verbal_fluency with words: [${wordJson}], targetLetter: "${letter}", sessionId: "${this.sessionId}", durationSeconds: ${elapsed}. ` +
          'After submit_verbal_fluency, say "Congratulations on completing the first test!" ' +
          'Then ask how they feel and whether they are ready for Test 2. Wait for explicit confirmation.'
      )
    );

    this.testPhase = 'VERBAL_FLUENCY_DONE';
    // Kisa gecikme sonrasi transition fazina gec
    setTimeout(() => {
      if (this.testPhase === 'VERBAL_FLUENCY_DONE') {
        log.info('Faz geçişi: VERBAL_FLUENCY_DONE → TRANSITION_TO_TEST2', { sessionId: this.sessionId });
        this._enterTransition('TRANSITION_TO_TEST2');
      }
    }, 2000);
  }

  _startInactivityWatcher() {
    this._stopInactivityWatcher();
    this.inactivityCheckInterval = setInterval(() => {
      this._checkAutoStopByInactivity();
    }, 1000);
  }

  _stopInactivityWatcher() {
    if (this.inactivityCheckInterval) {
      clearInterval(this.inactivityCheckInterval);
      this.inactivityCheckInterval = null;
    }
  }

  _checkAutoStopByInactivity() {
    if (!this.timerActive || !this.timerStartTime) return;
    if (!this.lastUserSpeechAt) return;

    const now = Date.now();
    const elapsed = now - this.timerStartTime;
    if (elapsed < this.MIN_AUTO_STOP_ELAPSED_MS) return;

    const baseForProgress = this.lastProgressAt || this.lastUserSpeechAt;
    const silenceMs = now - this.lastUserSpeechAt;
    const noProgressMs = now - baseForProgress;

    if (!this.inactivityWarningSent && silenceMs >= this.INACTIVITY_WARN_AFTER_MS) {
      this.inactivityWarningSent = true;
      this.sendTextToLive(
        pickText(
          this.language,
          'TIMER_HINT: Kullanici bir suredir sessiz. Test 1 hala aktif. Kisa bir tesvik cumlesi kur: "Devam edebilirsiniz, sureniz devam ediyor."',
          'TIMER_HINT: The user has been silent for a while. Test 1 is still active. Give a short encouragement: "You can continue, your time is still running."'
        )
      );
      return;
    }

    if (silenceMs >= this.INACTIVITY_STOP_AFTER_MS && noProgressMs >= this.INACTIVITY_STOP_AFTER_MS) {
      log.info('Timer otomatik durduruldu (inactivity)', {
        sessionId: this.sessionId,
        silenceMs,
        noProgressMs,
      });
      this._stopTimer('auto_inactivity');
    }
  }

  _handlePostTest1(role, text, agentBuf) {
    // Ajan hikayeyi anlatip kullanicidan cevap istedigini tespit et
    if (role === 'agent' && this.testPhase === 'STORY_RECALL_ACTIVE' && !this.storyRecallAgentDone) {
      if (this._containsAny(text, KEYWORDS.storyRecallPrompt) || this._containsAny(agentBuf, KEYWORDS.storyRecallPrompt)) {
        log.info('Ajan hikayeyi anlatti, kullanicidan cevap bekliyor - watcher baslatiliyor', { sessionId: this.sessionId });
        this.storyRecallAgentDone = true;
        this._startStoryRecallWatcher();
      }
    }

    // Ajan "bitti mi? / isleme alayim mi?" sorusunu sordugunu tespit et
    if (role === 'agent' && this.testPhase === 'STORY_RECALL_ACTIVE') {
      const confirmQuestion = ['bitti mi', 'bitirdiniz mi', 'işleme alayım', 'isleme alayim',
        'dikkate alayım', 'dikkate alayim', 'kaydedeyim mi', 'are you done', 'should i process',
        'shall i record', 'should i record'];
      if (this._containsAny(text, confirmQuestion) || this._containsAny(agentBuf, confirmQuestion)) {
        log.info('Ajan onay sorusu sordu - submit_story_recall bloklandi, kullanici onayi bekleniyor', { sessionId: this.sessionId });
        this.storyRecallSubmitAllowed = false;
      }
    }

    // Kullanici onay verdigini tespit et ("evet", "tamam", "al", "kaydet")
    if (role === 'user' && this.testPhase === 'STORY_RECALL_ACTIVE' && !this.storyRecallSubmitAllowed) {
      const confirmYes = ['evet', 'tamam', 'olur', 'kaydet', 'al', 'yes', 'okay', 'ok', 'go ahead', 'sure'];
      const confirmNo = ['hayır', 'hayir', 'bekle', 'daha var', 'devam', 'no', 'wait', 'not yet'];
      if (this._containsAny(text, confirmYes)) {
        log.info('Kullanici onay verdi - submit_story_recall izin verildi', { sessionId: this.sessionId });
        this.storyRecallSubmitAllowed = true;
      } else if (this._containsAny(text, confirmNo)) {
        log.info('Kullanici hayir dedi - dinlemeye devam', { sessionId: this.sessionId });
        this.storyRecallSubmitAllowed = false;
        this.storyRecallWarningSent = false;
        if (this.storyRecallLastUserAt) this.storyRecallLastUserAt = Date.now();
      }
    }
  }

  _handleVisualTestActive(role, text, rawText) {
    if (this.visualTestAgent && this.visualTestAgent.isTestActive) {
      if (role === 'user') {
        this.visualTestAgent.onUserTranscript(rawText);
      } else {
        this.visualTestAgent.onAgentTranscript(rawText);
      }
    }

    if (role === 'agent' && this._containsAny(text, KEYWORDS.visualDone)) {
      // VisualTestAgent'in gercekten tamamlanip tamamlanmadigini kontrol et
      // LLM'in erken gecis yapmasini engelle
      const vtDone = this.visualTestAgent && !this.visualTestAgent.isTestActive;
      if (vtDone) {
        log.info('Faz geçişi: VISUAL_TEST_ACTIVE → VISUAL_TEST_DONE', { sessionId: this.sessionId });
        this.testPhase = 'VISUAL_TEST_DONE';
      } else {
        log.warn('LLM erken VISUAL_TEST_DONE sinyali verdi ama VisualTestAgent hala aktif - engelleniyor', {
          sessionId: this.sessionId,
          vtState: this.visualTestAgent?.state || 'unknown',
          answeredCount: this.visualTestAgent?.answers?.length || 0,
        });
        // LLM'e geri bildirim gonder
        this.sendTextToLive(
          pickText(
            this.language,
            'VISUAL_TEST_GUARD: Gorsel tanima testi henuz tamamlanmadi. Tum gorseller cevaplanmadan Test 4e gecme. Su anki gorselde kal ve devam et.',
            'VISUAL_TEST_GUARD: Visual recognition test is NOT complete yet. Do not move to Test 4 until all images are answered. Stay on the current image.'
          )
        );
      }
    }
  }

  _handlePostVisualTest(role, text, agentBuf) {
    // Transition yapisi artik tool call (submit_visual_recognition) ve _enterTransition uzerinden calisiyor.
    // Keyword fallback: eger tool call uzerinden transition baslatilmadiysa
    if (role === 'agent' && this.testPhase === 'VISUAL_TEST_DONE') {
      if (this._containsAny(agentBuf, KEYWORDS.orientationStart) || this._containsAny(text, KEYWORDS.orientationStart)) {
        log.info('Faz geçişi (keyword fallback): VISUAL_TEST_DONE → TRANSITION_TO_TEST4', { sessionId: this.sessionId });
        this._enterTransition('TRANSITION_TO_TEST4');
      }
    }
  }

  _handleOrientationActive(role, text) {
    if (role !== 'agent') return;

    if (this._containsAny(text, KEYWORDS.orientationDone)) {
      log.info('Faz geçişi: ORIENTATION_ACTIVE → ORIENTATION_DONE', { sessionId: this.sessionId });
      this.testPhase = 'ORIENTATION_DONE';

      this.sendToClient({
        type: 'test_phase_change',
        phase: 'ORIENTATION_DONE',
        message: pickText(this.language, 'Yonelim testi tamamlandi', 'Orientation test is completed'),
      });

      this.sendTextToLive(
        pickText(
          this.language,
          `ORIENTATION_DONE: Tum testler tamamlandi. Simdi complete_session fonksiyonunu cagir. sessionId: "${this.sessionId}". Fonksiyondan sonra kullaniciya tesekkur edip vedalas.`,
          `ORIENTATION_DONE: All tests are complete. Now call complete_session with sessionId: "${this.sessionId}". After that, thank the user and say goodbye.`
        )
      );
    }
  }

  // BUG-010: Test 2 (Story Recall) inactivity watcher
  _startStoryRecallWatcher() {
    this._stopStoryRecallWatcher();
    this.storyRecallStartedAt = Date.now();
    this.storyRecallLastUserAt = null;
    this.storyRecallWarningSent = false;

    this.storyRecallInactivityInterval = setInterval(() => {
      this._checkStoryRecallInactivity();
    }, 2000);

    log.info('Story Recall inactivity watcher başlatıldı', { sessionId: this.sessionId });
  }

  _stopStoryRecallWatcher() {
    if (this.storyRecallInactivityInterval) {
      clearInterval(this.storyRecallInactivityInterval);
      this.storyRecallInactivityInterval = null;
    }
    if (this._storyRecallWatcherFallbackTimeout) {
      clearTimeout(this._storyRecallWatcherFallbackTimeout);
      this._storyRecallWatcherFallbackTimeout = null;
    }
  }

  _checkStoryRecallInactivity() {
    if (this.testPhase !== 'STORY_RECALL_ACTIVE') {
      this._stopStoryRecallWatcher();
      return;
    }

    // Ajan hala konusuyorsa (hikaye anlatiyorsa) inactivity sayma
    // Son 5 saniye icinde ajan transcript geldiyse ajan aktif demektir
    const now = Date.now();
    const agentRecentlySpoke = this.storyRecallLastAgentAt && (now - this.storyRecallLastAgentAt < 5000);
    if (agentRecentlySpoke) {
      return;
    }

    const referenceTime = this.storyRecallLastUserAt || this.storyRecallStartedAt;
    if (!referenceTime) return;

    const silenceMs = now - referenceTime;

    if (!this.storyRecallWarningSent && silenceMs >= this.STORY_RECALL_WARN_MS) {
      this.storyRecallWarningSent = true;
      this.sendTextToLive(
        pickText(
          this.language,
          'STORY_RECALL_HINT: Kullanici bir suredir sessiz. Hikaye hatirlama testi devam ediyor. ' +
            'Kullaniciyi nazikce tesvik et: "Hatirladiginiz kadarini anlatabilirsiniz, eksik olsa da sorun degil." ' +
            'UYARI: Henuz submit_story_recall CAGIRMA! Kullanici konusmaya devam edebilir.',
          'STORY_RECALL_HINT: The user has been silent for a while. Story recall test is still active. ' +
            'Gently encourage: "You can tell as much as you remember, it is okay if it is incomplete." ' +
            'WARNING: Do NOT call submit_story_recall yet! The user may continue speaking.'
        )
      );
      return;
    }

    if (silenceMs >= this.STORY_RECALL_TIMEOUT_MS) {
      log.info('Story Recall timeout - kullanıcı uzun süre sessiz', {
        sessionId: this.sessionId,
        silenceMs,
      });
      this._stopStoryRecallWatcher();
      this.storyRecallSubmitAllowed = true;
      this.sendTextToLive(
        pickText(
          this.language,
          'STORY_RECALL_TIMEOUT: Kullanici uzun suredir sessiz. ' +
            'Kullaniciya "Anlatmaniz bitti mi? Cevabinizi bu sekilde isleme alayim mi?" diye sor. ' +
            'Kullanici EVET derse veya hicbir sey soylemediyse submit_story_recall cagir. ' +
            'HAYIR derse biraz daha bekle. ' +
            'submit_story_recall cagirdiktan sonra "Tebrikler, ikinci testi tamamladiniz!" de ve nasil hissettigini sor.',
          'STORY_RECALL_TIMEOUT: The user has been silent for too long. ' +
            'Ask the user "Are you done? Should I process your answer as is?" ' +
            'If user says YES or said nothing at all, call submit_story_recall. ' +
            'If NO, wait a bit more. ' +
            'After submit_story_recall, say "Congratulations on completing the second test!" and ask how they feel.'
        )
      );
    }
  }

  // Story Recall fazında kullanıcı konuştuğunda son konuşma zamanını güncelle
  _updateStoryRecallActivity() {
    if (this.testPhase === 'STORY_RECALL_ACTIVE') {
      this.storyRecallLastUserAt = Date.now();
      this.storyRecallWarningSent = false;
    }
  }

  destroy() {
    if (this.timerTimeout) clearTimeout(this.timerTimeout);
    if (this.transitionTimeoutHandle) clearTimeout(this.transitionTimeoutHandle);
    this._stopInactivityWatcher();
    this._stopStoryRecallWatcher();
    if (this._storyRecallWatcherFallbackTimeout) {
      clearTimeout(this._storyRecallWatcherFallbackTimeout);
      this._storyRecallWatcherFallbackTimeout = null;
    }
    if (this.bufferResetTimeout) clearTimeout(this.bufferResetTimeout);
    this.visualTestAgent = null;
    this.videoAnalysisAgent = null;
    this.orientationUserInputBuffer = '';
    this.orientationLastUserAt = 0;
    log.info('BrainAgent temizlendi', { sessionId: this.sessionId });
  }

  consumeOrientationUserInput(maxAgeMs = 15000) {
    const now = Date.now();
    const text = this.orientationUserInputBuffer.trim();

    if (!text) return null;
    if (!this.orientationLastUserAt || now - this.orientationLastUserAt > maxAgeMs) {
      this.orientationUserInputBuffer = '';
      this.orientationLastUserAt = 0;
      return null;
    }

    this.orientationUserInputBuffer = '';
    this.orientationLastUserAt = 0;
    return text;
  }

  _containsAny(text, keywords) {
    if (!text) return false;
    const normalizedText = normalizeForMatch(text, this.language);
    return keywords.some((keyword) => normalizedText.includes(normalizeForMatch(keyword, this.language)));
  }
}

module.exports = { BrainAgent };
