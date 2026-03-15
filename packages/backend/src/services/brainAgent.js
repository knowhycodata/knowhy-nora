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
    const lowerText = text.toLowerCase();
    const agentBuf = this.agentBuffer.toLowerCase();
    const userBuf = this.userBuffer.toLowerCase();

    switch (this.testPhase) {
      case 'IDLE':
        this._handleIdle(role, lowerText, agentBuf);
        break;
      case 'VERBAL_FLUENCY_WAITING':
        this._handleWaiting(role, lowerText, agentBuf, userBuf);
        break;
      case 'VERBAL_FLUENCY_ACTIVE':
        this._handleActive(role, lowerText, text);
        break;
      case 'VERBAL_FLUENCY_DONE':
      case 'STORY_RECALL_ACTIVE':
        this._handlePostTest1(role, lowerText, agentBuf);
        break;
      case 'VISUAL_TEST_ACTIVE':
        this._handleVisualTestActive(role, lowerText, text);
        break;
      case 'VISUAL_TEST_DONE':
        this._handlePostVisualTest(role, lowerText, agentBuf);
        break;
      case 'ORIENTATION_ACTIVE':
        this._handleOrientationActive(role, lowerText);
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

  _handleActive(role, text, rawText) {
    if (role === 'user') {
      if (this._containsAny(text, KEYWORDS.userStop)) {
        log.info('Stop sinyali algılandı', { sessionId: this.sessionId, text });
        this._stopTimer('user_stop');
        return;
      }
      this._collectWords(rawText);
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
    for (const word of words) {
      const clean = word.toLowerCase().trim();
      if (clean.length > 1 && !this.collectedWords.includes(clean)) {
        this.collectedWords.push(clean);
      }
    }
    if (words.length > 0) {
      log.debug('Kelimeler', { sessionId: this.sessionId, new: words, total: this.collectedWords.length });
    }
  }

  _startTimer() {
    if (this.timerActive) return;

    this.timerActive = true;
    this.timerStartTime = Date.now();
    this.timerId = `${Date.now()}_VF`;
    this.collectedWords = [];
    this.testPhase = 'VERBAL_FLUENCY_ACTIVE';

    this.sendToClient({
      type: 'timer_started',
      timerId: this.timerId,
      durationSeconds: this.timerDuration,
      testType: 'VERBAL_FLUENCY',
    });

    this.timerTimeout = setTimeout(() => {
      if (this.timerActive) this._stopTimer('timeout');
    }, this.timerDuration * 1000);
  }

  _stopTimer(reason) {
    if (!this.timerActive) return;

    this.timerActive = false;
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

    this.sendTextToLive(
      pickText(
        this.language,
        `${prefix}: ${isTimeout ? '60 saniyelik sure doldu.' : `Kullanici durdurmak istedi. ${elapsed} saniye gecti.`} ` +
          `Kullanicinin soyledigi kelimeler: [${wordList}]. Toplam ${this.collectedWords.length} kelime. ` +
          `Simdi submit_verbal_fluency fonksiyonunu cagir. words: [${wordJson}], targetLetter: "${letter}", sessionId: "${this.sessionId}", durationSeconds: ${elapsed}. ` +
          'submit_verbal_fluency cagirdiktan sonra kullaniciya ikinci teste hazir olup olmadigini sor ve onay bekle.',
        `${prefix}: ${isTimeout ? 'The 60-second timer is over.' : `The user asked to stop. ${elapsed} seconds elapsed.`} ` +
          `User words: [${wordList}]. Total ${this.collectedWords.length} words. ` +
          `Now call submit_verbal_fluency with words: [${wordJson}], targetLetter: "${letter}", sessionId: "${this.sessionId}", durationSeconds: ${elapsed}. ` +
          'After submit_verbal_fluency, ask whether the user is ready for Test 2 and wait for explicit confirmation.'
      )
    );

    this.testPhase = 'VERBAL_FLUENCY_DONE';
  }

  _handlePostTest1(role, text, agentBuf) {
    if (role !== 'agent') return;

    if (this.testPhase === 'VERBAL_FLUENCY_DONE' && this._containsAny(agentBuf, KEYWORDS.storyStart)) {
      log.info('Faz geçişi: VERBAL_FLUENCY_DONE → STORY_RECALL_ACTIVE', { sessionId: this.sessionId });
      this.testPhase = 'STORY_RECALL_ACTIVE';
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

  destroy() {
    if (this.timerTimeout) clearTimeout(this.timerTimeout);
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
    return keywords.some((keyword) => text.includes(keyword));
  }
}

module.exports = { BrainAgent };

