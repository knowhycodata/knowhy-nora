/**
 * Brain Agent - Transkript Analiz ve Test Yönetim Ajanı
 * 
 * Gemini Live (ses ajanı) sadece konuşur ve dinler.
 * Brain Agent ise transkriptleri analiz eder ve:
 * - Timer başlatma/durdurma kararı verir
 * - Test state'ini yönetir
 * - Frontend'e event gönderir
 * 
 * Mimari:
 *   Browser ↔ WS ↔ Backend ↔ Gemini Live (ses)
 *                      ↕
 *                Brain Agent (rule-based analiz)
 *                      ↕
 *                VisualTestAgent (Test 3 koordinatörü)
 */

const { createLogger } = require('../lib/logger');

const log = createLogger('BrainAgent');

class BrainAgent {
  constructor(sessionId, sendToClient, sendTextToLive) {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.visualTestAgent = null; // Dışarıdan set edilir
    
    // State
    this.testPhase = 'IDLE';
    this.targetLetter = null;
    this.collectedWords = [];
    this.timerActive = false;
    this.timerStartTime = null;
    this.timerDuration = 60;
    this.timerId = null;
    this.timerTimeout = null;
    
    // Birleşik transkript buffer - son N saniyeyi birleştirir
    this.agentBuffer = '';     // Son agent transkriptlerini birleştirir
    this.userBuffer = '';      // Son user transkriptlerini birleştirir
    this.bufferResetTimeout = null;
    this.BUFFER_WINDOW_MS = 5000; // 5 saniyelik pencere
    
    log.info('BrainAgent oluşturuldu', { sessionId });
  }

  /**
   * Yeni transkript geldiğinde çağrılır (input veya output)
   * Transkriptler parçalı gelir - birleştirip analiz ederiz
   */
  onTranscript(role, text) {
    if (!text || text.trim().length === 0) return;
    
    const cleanText = text.trim();
    
    // Buffer'a ekle
    if (role === 'agent') {
      this.agentBuffer += ' ' + cleanText;
    } else {
      this.userBuffer += ' ' + cleanText;
    }
    
    log.info('Transkript', { 
      sessionId: this.sessionId, 
      role, 
      text: cleanText.substring(0, 100), 
      phase: this.testPhase,
      agentBuf: this.agentBuffer.substring(0, 60),
      userBuf: this.userBuffer.substring(0, 60),
    });
    
    // Buffer'ı belirli aralıklarla temizle
    if (this.bufferResetTimeout) clearTimeout(this.bufferResetTimeout);
    this.bufferResetTimeout = setTimeout(() => {
      this.agentBuffer = '';
      this.userBuffer = '';
    }, this.BUFFER_WINDOW_MS);
    
    // Faz bazlı analiz - hem tek parça hem birleşik buffer üzerinde
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
      // VISUAL_TEST_DONE, ORIENTATION_ACTIVE, DONE - Brain Agent pasif
    }
  }

  _handleIdle(role, text, agentBuf) {
    if (role !== 'agent') return;
    
    // Ajan test 1'den bahsediyorsa → WAITING'e geç
    const testKeywords = [
      'sözel akıcılık', 'ilk test', 'bir harf', 'kelime söyle', 
      'hazır mısınız', 'harf vereceğim', 'kelimeler söylemeniz',
      'test', 'akıcılık', 'hazır mı'
    ];
    
    if (this._containsAny(agentBuf, testKeywords) || this._containsAny(text, testKeywords)) {
      log.info('Faz geçişi: IDLE → VERBAL_FLUENCY_WAITING', { sessionId: this.sessionId });
      this.testPhase = 'VERBAL_FLUENCY_WAITING';
      this._tryExtractLetter(agentBuf);
      this._tryExtractLetter(text);
    }
  }

  _handleWaiting(role, text, agentBuf, userBuf) {
    if (role === 'agent') {
      this._tryExtractLetter(text);
      this._tryExtractLetter(agentBuf);
      
      // Ajan "başlayabilirsiniz", "süreniz başladı" diyorsa → TIMER BAŞLAT
      const startKeywords = [
        'başlayabilirsiniz', 'süreniz başladı', 'başlayın', 
        'başladı', 'saniyeniz var', 'saniye süreniz',
        'süre başlıyor', 'haydi başlayalım'
      ];
      
      if (this._containsAny(text, startKeywords) || this._containsAny(agentBuf, startKeywords)) {
        log.info('Timer başlatma sinyali algılandı (agent)', { sessionId: this.sessionId, text: text.substring(0, 60) });
        this._startTimer();
      }
    }
    
    if (role === 'user') {
      // Kullanıcı hazır - ajan harf vermişse ve "başlayın" dediyse timer çoktan başlamış olmalı
      // Ama başlamamışsa, kullanıcı kelime söylemeye başladıysa da timer başlat
      if (this.targetLetter && !this.timerActive) {
        // Kullanıcı direkt kelime söylemeye başlamışsa (ajan "başlayın" dedi ama algılanmadıysa)
        const readyKeywords = ['hazır', 'evet', 'başla', 'tamam', 'olur', 'tabii'];
        if (this._containsAny(text, readyKeywords)) {
          // 2 saniye bekle - ajan "başlayın" demesini bekle
          setTimeout(() => {
            if (!this.timerActive && this.testPhase === 'VERBAL_FLUENCY_WAITING') {
              log.info('Kullanıcı hazır ama timer başlamadı - zorla başlat', { sessionId: this.sessionId });
              this._startTimer();
            }
          }, 2500);
        }
      }
    }
  }

  _handleActive(role, text, rawText) {
    if (role === 'user') {
      // Stop sinyalleri kontrol et
      const stopKeywords = [
        'durdur', 'duralım', 'bitirelim', 'yeter', 'kafi', 'tamam bitti', 
        'bitir', 'bitirdim', 'bitti', 'tamamladım', 'tamamdır',
        'kalmadı', 'gelmiyor', 'aklıma gelmiyor', 'daha yok', 
        'yetiyor', 'stop', 'dur', 'bırak', 'yetişir', 'bu kadar',
        'artık yeter', 'daha fazla yok', 'başka yok', 'o kadar',
        'bitsin', 'bitiyor', 'durduralım', 'süreyi durdur'
      ];
      
      if (this._containsAny(text, stopKeywords)) {
        log.info('Stop sinyali algılandı', { sessionId: this.sessionId, text });
        this._stopTimer('kullanıcı isteği');
        return;
      }
      
      // Kelimeleri topla
      this._collectWords(rawText);
    }
    
    // Ajan timer aktifken araya girerse uyarı gönder
    if (role === 'agent' && this.timerActive) {
      // Ajan test 2'ye geçmeye veya testi bitirmeye çalışıyorsa engelle
      const dangerKeywords = ['hikaye', 'test 2', 'ikinci test', 'testi tamamladınız', 'bitirdiniz'];
      if (this._containsAny(text, dangerKeywords)) {
        log.warn('Ajan timer aktifken test geçişi yapmaya çalışıyor - uyarı gönder', { 
          sessionId: this.sessionId, text: text.substring(0, 60) 
        });
        const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
        const remaining = this.timerDuration - elapsed;
        this.sendTextToLive(`UYARI: Timer hala aktif! ${remaining} saniye kaldı. Test 1 devam ediyor. Lütfen kullanıcının kelime söylemesini beklemeye devam et. Test 2'ye GEÇMEYİN.`);
      }
    }
  }

  _tryExtractLetter(text) {
    if (this.targetLetter) return; // Zaten bulundu
    
    // Öncelik sırasıyla dene - en spesifik kalıplar önce
    const patterns = [
      // "Harfiniz P" - en yaygın format
      /harfiniz\s+['"'""]?([A-ZÇĞİÖŞÜ])['"'""]?\b/i,
      // "Harfiniz P." - nokta ile
      /harfiniz\s+['"'""]?([A-ZÇĞİÖŞÜ])['"'""]?\./i,
      // "P harfi" veya "'P' harfi"
      /\b([A-ZÇĞİÖŞÜ])['"'""]?\s+harfi/i,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1].length === 1) {
        const letter = match[1].toUpperCase();
        // Tek harfli yaygın Türkçe kelimelerin parçası olmadığından emin ol
        // "vereceğim" → V, "bir" → B gibi yanlış eşleşmeleri önle
        // match'in etrafındaki bağlam kontrol et
        const fullMatch = match[0].toLowerCase();
        if (fullMatch.includes('harfiniz') || fullMatch.includes('harfi')) {
          this.targetLetter = letter;
          log.info('Hedef harf bulundu', { sessionId: this.sessionId, letter: this.targetLetter, match: match[0] });
          return;
        }
      }
    }
  }

  _collectWords(text) {
    const words = text.split(/[\s,\.;!?]+/).filter(w => w.length > 1);
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
    
    log.info('⏱️ TIMER BAŞLADI', { 
      sessionId: this.sessionId, 
      timerId: this.timerId,
      duration: this.timerDuration,
      targetLetter: this.targetLetter 
    });
    
    // Frontend'e bildir
    this.sendToClient({
      type: 'timer_started',
      timerId: this.timerId,
      durationSeconds: this.timerDuration,
      testType: 'VERBAL_FLUENCY',
    });
    
    // Timer timeout
    this.timerTimeout = setTimeout(() => {
      if (this.timerActive) {
        this._stopTimer('süre doldu');
      }
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
    
    log.info('⏱️ TIMER DURDU', { 
      sessionId: this.sessionId, reason, elapsed, remaining,
      words: this.collectedWords, wordCount: this.collectedWords.length 
    });
    
    // Frontend'e bildir
    if (reason === 'süre doldu') {
      this.sendToClient({ type: 'timer_complete', timerId: this.timerId, testType: 'VERBAL_FLUENCY' });
    } else {
      this.sendToClient({ type: 'timer_stopped', timerId: this.timerId, remaining, reason });
    }
    
    // Live ajan'a mesaj gönder - kelimeleri ve submit talimatını ver
    const wordList = this.collectedWords.length > 0 
      ? this.collectedWords.join(', ') 
      : 'kelime toplanamadı';
    
    const letter = this.targetLetter || 'P';
    const prefix = reason === 'süre doldu' ? 'TIMER_COMPLETE' : 'TIMER_STOPPED';
    
    const msg = `${prefix}: ${reason === 'süre doldu' ? '60 saniyelik süre doldu.' : `Kullanıcı durdurmak istedi. ${elapsed} saniye geçti.`} Kullanıcının söylediği kelimeler: [${wordList}]. Toplam ${this.collectedWords.length} kelime. Şimdi submit_verbal_fluency fonksiyonunu çağır. words: [${this.collectedWords.map(w => `"${w}"`).join(', ')}], targetLetter: "${letter}", sessionId: "${this.sessionId}", durationSeconds: ${elapsed}. ⚠️ submit_verbal_fluency çağırdıktan sonra kullanıcıya tebrik et ve "İkinci teste geçmeye hazır mısınız?" diye sor. Kullanıcı onay verene kadar Test 2'ye GEÇME.`;
    
    this.sendTextToLive(msg);
    this.testPhase = 'VERBAL_FLUENCY_DONE';
  }

  /**
   * Test 1 bittikten sonra Test 2 ve Test 3 geçişlerini takip et
   */
  _handlePostTest1(role, text, agentBuf) {
    if (role !== 'agent') return;
    
    // Test 2 başladı mı?
    const storyKeywords = ['hikaye', 'hikaye hatirlama', 'kısa bir hikaye', 'dikkatle dinleyin'];
    if (this.testPhase === 'VERBAL_FLUENCY_DONE' && this._containsAny(agentBuf, storyKeywords)) {
      log.info('Faz geçişi: VERBAL_FLUENCY_DONE → STORY_RECALL_ACTIVE', { sessionId: this.sessionId });
      this.testPhase = 'STORY_RECALL_ACTIVE';
    }
    
    // Test 3'e geçiş algila - görsel tanıma testi başlıyor
    const visualKeywords = ['görsel tanıma', 'görsel test', 'ekranınıza', 'görsel göstereceğim'];
    if (this._containsAny(agentBuf, visualKeywords) || this._containsAny(text, visualKeywords)) {
      log.info('Faz geçişi: → VISUAL_TEST_ACTIVE', { sessionId: this.sessionId });
      this.testPhase = 'VISUAL_TEST_ACTIVE';
    }
  }

  /**
   * Test 3 aktifken kullanıcı transkriptlerini VisualTestAgent'a ilet
   */
  _handleVisualTestActive(role, text, rawText) {
    if (this.visualTestAgent && this.visualTestAgent.isTestActive) {
      if (role === 'user') {
        this.visualTestAgent.onUserTranscript(rawText);
      } else {
        this.visualTestAgent.onAgentTranscript(rawText);
      }
    }
    
    // Test 3 bitti mi? (submit_visual_recognition çağrıldıktan sonra)
    if (role === 'agent') {
      const doneKeywords = ['görsel tanıma testini tamamladınız', 'son testimize', 'yönelim'];
      if (this._containsAny(text, doneKeywords)) {
        log.info('Faz geçişi: VISUAL_TEST_ACTIVE → VISUAL_TEST_DONE', { sessionId: this.sessionId });
        this.testPhase = 'VISUAL_TEST_DONE';
      }
    }
  }

  destroy() {
    if (this.timerTimeout) clearTimeout(this.timerTimeout);
    if (this.bufferResetTimeout) clearTimeout(this.bufferResetTimeout);
    if (this.visualTestAgent) {
      this.visualTestAgent = null;
    }
    log.info('BrainAgent temizlendi', { sessionId: this.sessionId });
  }

  _containsAny(text, keywords) {
    return keywords.some(k => text.includes(k));
  }
}

module.exports = { BrainAgent };
