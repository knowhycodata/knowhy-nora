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
    'ready', 'yes', 'start', 'okay', 'ok', 'sure',
  ],
  userStop: [
    'durdur', 'duralım', 'duralim', 'bitirelim', 'yeter', 'kafi', 'tamam bitti',
    'bitir', 'bitirdim', 'bitti', 'tamamladım', 'tamamladim', 'tamamdır',
    'kalmadı', 'kalmadi', 'gelmiyor', 'aklıma gelmiyor', 'aklima gelmiyor',
    'daha yok', 'stop', 'dur', 'bırak', 'birak', 'yetişir', 'yetisir',
    'bu kadar', 'artık yeter', 'artik yeter', 'daha fazla yok', 'başka yok',
    'baska yok', 'o kadar', 'bitsin', 'bitiyor', 'durduralım', 'durduralim',
    'süreyi durdur', 'sureyi durdur',
    'finish', 'stop now', 'enough', 'that is enough', 'i am done', "i'm done",
    'no more words', "i can't think of more", 'nothing else',
    'thats all', "that's all", "that's it", 'thats it', 'i am finished',
    "i'm finished", 'finished', 'done now', 'i have no more', 'no more',
    'cannot think of more', "can't remember more", 'cant remember more',
    'bu kadar yeter', 'daha fazla soyleyemiyorum', 'baska soyleyemiyorum',
  ],
  dangerWhileTimer: [
    'hikaye', 'test 2', 'ikinci test', 'testi tamamladınız', 'testi tamamladiniz',
    'bitirdiniz', 'story', 'second test', 'you completed the first test',
  ],
  storyStart: [
    'hikaye', 'hikaye hatirlama', 'kısa bir hikaye', 'kisa bir hikaye',
    'dikkatle dinleyin', 'story', 'story recall', 'listen carefully',
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
    this.INACTIVITY_WARN_AFTER_MS = parsePositiveInt(process.env.TEST1_INACTIVITY_WARN_MS, 10000);
    this.INACTIVITY_STOP_AFTER_MS = parsePositiveInt(process.env.TEST1_INACTIVITY_STOP_MS, 16000);
    this.MIN_AUTO_STOP_ELAPSED_MS = parsePositiveInt(process.env.TEST1_AUTO_STOP_MIN_ELAPSED_MS, 20000);

    // BUG-010: Test 2 (Story Recall) inactivity timeout
    this.storyRecallStartedAt = null;
    this.storyRecallLastUserAt = null;
    this.storyRecallWarningSent = false;
    this.storyRecallInactivityInterval = null;
    this.STORY_RECALL_WARN_MS = parsePositiveInt(process.env.TEST2_INACTIVITY_WARN_MS, 20000);
    this.STORY_RECALL_TIMEOUT_MS = parsePositiveInt(process.env.TEST2_INACTIVITY_TIMEOUT_MS, 45000);

    this.agentBuffer = '';
    this.userBuffer = '';
    this.bufferResetTimeout = null;
    this.BUFFER_WINDOW_MS = 5000;

    this.orientationUserInputBuffer = '';
    this.orientationLastUserAt = 0;

    log.info('BrainAgent oluşturuldu', { sessionId, language: this.language });
  }

  onTranscript(role, text) {
    if (!text || text.trim().length === 0) return;

    const cleanText = text.trim();
    if (role === 'agent') {
      this.agentBuffer += ` ${cleanText}`;
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

  _analyzePhase(role, text) {
    const rawText = text;
    const agentBuf = this.agentBuffer;
    const userBuf = this.userBuffer;

    switch (this.testPhase) {
      case 'IDLE':
        this._handleIdle(role, rawText, agentBuf);
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
    if (role !== 'agent') return;
    if (this._containsAny(agentBuf, KEYWORDS.verbalIntro) || this._containsAny(text, KEYWORDS.verbalIntro)) {
      log.info('Faz geçişi: IDLE → VERBAL_FLUENCY_WAITING', { sessionId: this.sessionId });
      this.testPhase = 'VERBAL_FLUENCY_WAITING';
      this._tryExtractLetter(agentBuf);
      this._tryExtractLetter(text);
    }
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
      if (this._containsAny(text, KEYWORDS.userStop) || this._containsAny(userBuf, KEYWORDS.userStop)) {
        log.info('Stop sinyali algılandı', { sessionId: this.sessionId, text });
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

    if (role === 'agent' && this.timerActive && this._containsAny(text, KEYWORDS.dangerWhileTimer)) {
      log.warn('Ajan timer aktifken test geçişi yapmaya çalışıyor - uyarı gönder', {
        sessionId: this.sessionId,
        text: text.substring(0, 60),
      });
      const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
      const remaining = this.timerDuration - elapsed;
      this.sendTextToLive(
        pickText(
          this.language,
          `UYARI: Timer hala aktif. ${remaining} saniye kaldi. Test 1 devam ediyor. Kullaniciya beklemesi icin alan tanimaya devam et ve Test 2'ye gecme.`,
          `WARNING: The timer is still active. ${remaining} seconds left. Test 1 is still running. Keep waiting for user words and do not move to Test 2.`
        )
      );
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
          'submit_verbal_fluency cagirdiktan sonra kullaniciya ikinci teste hazir olup olmadigini sor ve onay bekle.',
        `${prefix}: ${isTimeout ? 'The 60-second timer is over.' : stopReasonTextEn} ` +
          `User words: [${wordList}]. Total ${this.collectedWords.length} words. ` +
          `Now call submit_verbal_fluency with words: [${wordJson}], targetLetter: "${letter}", sessionId: "${this.sessionId}", durationSeconds: ${elapsed}. ` +
          'After submit_verbal_fluency, ask whether the user is ready for Test 2 and wait for explicit confirmation.'
      )
    );

    this.testPhase = 'VERBAL_FLUENCY_DONE';
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
    if (role !== 'agent') return;

    if (this.testPhase === 'VERBAL_FLUENCY_DONE' && this._containsAny(agentBuf, KEYWORDS.storyStart)) {
      log.info('Faz geçişi: VERBAL_FLUENCY_DONE → STORY_RECALL_ACTIVE', { sessionId: this.sessionId });
      this.testPhase = 'STORY_RECALL_ACTIVE';
      this._startStoryRecallWatcher();
    }

    if (this._containsAny(agentBuf, KEYWORDS.visualStart) || this._containsAny(text, KEYWORDS.visualStart)) {
      log.info('Faz geçişi: → VISUAL_TEST_ACTIVE', { sessionId: this.sessionId });
      this.testPhase = 'VISUAL_TEST_ACTIVE';
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
      log.info('Faz geçişi: VISUAL_TEST_ACTIVE → VISUAL_TEST_DONE', { sessionId: this.sessionId });
      this.testPhase = 'VISUAL_TEST_DONE';
    }
  }

  _handlePostVisualTest(role, text, agentBuf) {
    if (role !== 'agent') return;

    if (this._containsAny(agentBuf, KEYWORDS.orientationStart) || this._containsAny(text, KEYWORDS.orientationStart)) {
      log.info('Faz geçişi: VISUAL_TEST_DONE → ORIENTATION_ACTIVE', { sessionId: this.sessionId });
      this.testPhase = 'ORIENTATION_ACTIVE';
      this.orientationUserInputBuffer = '';
      this.orientationLastUserAt = 0;

      this.sendToClient({
        type: 'test_phase_change',
        phase: 'ORIENTATION_ACTIVE',
        message: pickText(this.language, 'Yonelim testi basliyor', 'Orientation test is starting'),
      });
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
  }

  _checkStoryRecallInactivity() {
    if (this.testPhase !== 'STORY_RECALL_ACTIVE') {
      this._stopStoryRecallWatcher();
      return;
    }

    const now = Date.now();
    const referenceTime = this.storyRecallLastUserAt || this.storyRecallStartedAt;
    if (!referenceTime) return;

    const silenceMs = now - referenceTime;

    if (!this.storyRecallWarningSent && silenceMs >= this.STORY_RECALL_WARN_MS) {
      this.storyRecallWarningSent = true;
      this.sendTextToLive(
        pickText(
          this.language,
          'STORY_RECALL_HINT: Kullanici bir suredir sessiz. Hikaye hatirlama testi devam ediyor. Kullaniciyi nazikce tesvik et: "Hatirladiginiz kadarini anlatabilirsiniz, eksik olsa da sorun degil."',
          'STORY_RECALL_HINT: The user has been silent for a while. Story recall test is still active. Gently encourage: "You can tell as much as you remember, it is okay if it is incomplete."'
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
      this.sendTextToLive(
        pickText(
          this.language,
          'STORY_RECALL_TIMEOUT: Kullanici uzun suredir sessiz. Hikaye hatirlama testini mevcut bilgiyle tamamla. Eger kullanici hicbir sey soylemediyse bos cevap olarak submit_story_recall cagir. Sonra Test 3e gec.',
          'STORY_RECALL_TIMEOUT: The user has been silent for too long. Complete the story recall test with available info. If user said nothing, call submit_story_recall with empty response. Then move to Test 3.'
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
    this._stopInactivityWatcher();
    this._stopStoryRecallWatcher();
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
