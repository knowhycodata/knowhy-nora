/**
 * Visual Test Agent - Test 3 Koordinatör Ajanı
 * 
 * ADK SequentialAgent kalıbı ile çalışır:
 *   Step 1: ImageGeneratorAgent → Imagen 4 ile görsel üretir, frontend'e gönderir
 *   Step 2: ConversationAgent (Gemini Live / Nöra) → Kullanıcıya sorar, cevabı alır
 *   Step 3: Tekrar Step 1'e döner (3 görsel tamamlanana kadar)
 *   Step 4: submit_visual_recognition ile skorlama
 * 
 * KRİTİK: Görsel verisi (base64) ASLA Gemini Live API'ye gönderilmez.
 *          Sadece frontend'e WebSocket üzerinden gider.
 *          Gemini'ye sadece hafif text metadata gider.
 * 
 * Sorun: Gemini Live API tool response boyut sınırı var (~100KB).
 *        274KB base64 görsel → "Request contains an invalid argument" → session crash.
 * Çözüm: Görsel pipeline'ı Gemini tool calling'den ayırıp ayrı ajan yönetiyor.
 */

const { createLogger } = require('../lib/logger');
const { getImagePipeline } = require('./imageGenerator');
const { getStaticTestImage } = require('./staticTestImages');

const log = createLogger('VisualTestAgent');

// Test 3 görselleri - sırayla gösterilecek
const VISUAL_TEST_IMAGES = [
  { index: 0, subject: 'saat', correctAnswer: 'saat' },
  { index: 1, subject: 'anahtar', correctAnswer: 'anahtar' },
  { index: 2, subject: 'kalem', correctAnswer: 'kalem' },
];

/**
 * Visual Test Agent States
 * IDLE → GENERATING → WAITING_ANSWER → GENERATING → WAITING_ANSWER → ... → COLLECTING → DONE
 */
const VT_STATE = {
  IDLE: 'IDLE',
  GENERATING: 'GENERATING',           // Görsel üretiliyor
  WAITING_ANSWER: 'WAITING_ANSWER',   // Kullanıcı cevabı bekleniyor
  COLLECTING: 'COLLECTING',           // Tüm cevaplar toplandı, submit bekliyor
  DONE: 'DONE',                       // Test tamamlandı
};

class VisualTestAgent {
  constructor(sessionId, sendToClient, sendTextToLive) {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;       // Frontend'e WebSocket mesajı
    this.sendTextToLive = sendTextToLive;   // Gemini Live'a text mesaj

    // State
    this.state = VT_STATE.IDLE;
    this.currentImageIndex = -1;
    this.answers = [];                      // { imageIndex, userAnswer, correctAnswer }
    this.isActive = false;

    // Transkript buffer - kullanıcı cevabını toplamak için
    this.userAnswerBuffer = '';
    this.answerBufferTimeout = null;
    this.ANSWER_SETTLE_MS = 3000;  // 3 sn sessizlik → cevap tamamlandı

    log.info('VisualTestAgent oluşturuldu', { sessionId });
  }

  /**
   * Test 3'ü başlatır — Gemini'nin start_visual_test tool call'ı tetikler
   * Gemini'ye hafif bir response döner, asıl iş burada yapılır
   */
  async startTest() {
    if (this.isActive) {
      log.warn('Test zaten aktif', { sessionId: this.sessionId });
      return { success: false, message: 'Görsel tanıma testi zaten devam ediyor.' };
    }

    log.info('🎨 Visual Test başlatılıyor', { sessionId: this.sessionId });
    this.isActive = true;
    this.state = VT_STATE.IDLE;
    this.currentImageIndex = -1;
    this.answers = [];

    // Frontend'e test başladı bildirimi
    this.sendToClient({
      type: 'visual_test_started',
      totalImages: VISUAL_TEST_IMAGES.length,
    });

    // İlk görseli üret ve göster
    await this._generateAndShowNextImage();

    // Gemini'ye hafif response dön (GÖRSEL VERİSİ YOK!)
    return {
      success: true,
      message: 'Görsel tanıma testi başlatıldı. İlk görsel ekranda gösteriliyor. Kullanıcıya "Ne görüyorsunuz?" diye sor ve cevabını bekle. Cevabı aldıktan sonra sana bir sonraki görseli hazırlayacağım.',
      totalImages: VISUAL_TEST_IMAGES.length,
      currentImage: 1,
    };
  }

  /**
   * Sub-Agent: ImageGenerator — Sıradaki görseli üretir ve frontend'e gönderir
   * Gemini'ye asla görsel verisi gitmez
   */
  async _generateAndShowNextImage() {
    this.currentImageIndex++;

    if (this.currentImageIndex >= VISUAL_TEST_IMAGES.length) {
      log.info('Tüm görseller gösterildi', { sessionId: this.sessionId });
      this.state = VT_STATE.COLLECTING;
      return;
    }

    const imageConfig = VISUAL_TEST_IMAGES[this.currentImageIndex];
    this.state = VT_STATE.GENERATING;

    log.info('Görsel üretimi başlıyor', {
      sessionId: this.sessionId,
      imageIndex: this.currentImageIndex,
      subject: imageConfig.subject,
    });

    // Frontend'e "üretiliyor" bildirimi
    this.sendToClient({
      type: 'visual_test_generating',
      imageIndex: this.currentImageIndex,
      totalImages: VISUAL_TEST_IMAGES.length,
    });

    try {
      const pipeline = getImagePipeline();
      const prompt = `Basit, net ve tanınabilir bir ${imageConfig.subject} görseli. Minimalist, temiz arka plan.`;
      const result = await pipeline.run(prompt, { aspectRatio: '1:1' });

      if (result.success && result.image) {
        log.info('Görsel üretildi (AI)', {
          sessionId: this.sessionId,
          imageIndex: this.currentImageIndex,
          dataLength: result.image.data?.length || 0,
        });

        // Frontend'e görseli gönder (Gemini'ye DEĞİL!)
        this.sendToClient({
          type: 'visual_test_image',
          imageIndex: this.currentImageIndex,
          imageBase64: result.image.data,
          mimeType: result.image.mimeType,
          generatedByAI: true,
          totalImages: VISUAL_TEST_IMAGES.length,
        });
      } else {
        // Fallback: Statik görsel
        this._sendFallbackImage(this.currentImageIndex, imageConfig.subject);
      }
    } catch (error) {
      log.error('Görsel üretim hatası', {
        sessionId: this.sessionId,
        imageIndex: this.currentImageIndex,
        error: error.message,
      });
      this._sendFallbackImage(this.currentImageIndex, imageConfig.subject);
    }

    // State: Kullanıcı cevabını bekle
    this.state = VT_STATE.WAITING_ANSWER;
    this.userAnswerBuffer = '';

    log.info('Görsel gösterildi, cevap bekleniyor', {
      sessionId: this.sessionId,
      imageIndex: this.currentImageIndex,
      state: this.state,
    });
  }

  /**
   * Fallback: Statik SVG görsel gönder
   */
  _sendFallbackImage(imageIndex, subject) {
    const staticImage = getStaticTestImage(subject);
    if (staticImage) {
      this.sendToClient({
        type: 'visual_test_image',
        imageIndex,
        imageBase64: staticImage.data,
        mimeType: staticImage.mimeType,
        generatedByAI: false,
        totalImages: VISUAL_TEST_IMAGES.length,
      });
    } else {
      // Hiç görsel yoksa bile frontend'e bildir
      this.sendToClient({
        type: 'visual_test_image',
        imageIndex,
        imageBase64: null,
        mimeType: null,
        generatedByAI: false,
        fallback: true,
        totalImages: VISUAL_TEST_IMAGES.length,
      });
    }
  }

  /**
   * Kullanıcı transkriptini analiz et — cevap toplama
   * Brain Agent'tan çağrılır
   */
  onUserTranscript(text) {
    if (!this.isActive || this.state !== VT_STATE.WAITING_ANSWER) return;

    const cleanText = text.trim();
    if (!cleanText) return;

    this.userAnswerBuffer += ' ' + cleanText;

    log.debug('Kullanıcı cevap veriyor', {
      sessionId: this.sessionId,
      imageIndex: this.currentImageIndex,
      buffer: this.userAnswerBuffer.trim().substring(0, 100),
    });

    // Debounce: Kullanıcı konuşmayı bitirince cevabı kaydet
    if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);
    this.answerBufferTimeout = setTimeout(() => {
      this._finalizeCurrentAnswer();
    }, this.ANSWER_SETTLE_MS);
  }

  /**
   * Agent transkriptini analiz et — Nöra "ne görüyorsunuz" dedi mi?
   * Bu bilgiyi sadece loglama/debug için kullanıyoruz
   */
  onAgentTranscript(text) {
    // Agent transkriptlerini loglama amaçlı takip et
    if (!this.isActive) return;

    const lowerText = text.toLowerCase();
    // Nöra cevabı aldıktan sonra "ikinci/üçüncü görsel" vs. diyorsa
    // ama biz zaten kendi akışımızı yönetiyoruz
    log.debug('Agent transcript (visual test)', {
      sessionId: this.sessionId,
      state: this.state,
      text: text.substring(0, 80),
    });
  }

  /**
   * Mevcut görselin cevabını kaydet ve sonraki görsele geç
   */
  async _finalizeCurrentAnswer() {
    if (this.state !== VT_STATE.WAITING_ANSWER) return;

    const answer = this.userAnswerBuffer.trim();
    const imageConfig = VISUAL_TEST_IMAGES[this.currentImageIndex];

    if (!answer) {
      log.warn('Boş cevap', { sessionId: this.sessionId, imageIndex: this.currentImageIndex });
      // Boş cevap da kaydedelim
    }

    this.answers.push({
      imageIndex: this.currentImageIndex,
      imageId: `image_${this.currentImageIndex}`,
      userAnswer: answer,
      correctAnswer: imageConfig.correctAnswer,
    });

    log.info('Cevap kaydedildi', {
      sessionId: this.sessionId,
      imageIndex: this.currentImageIndex,
      userAnswer: answer.substring(0, 100),
      correctAnswer: imageConfig.correctAnswer,
      answeredCount: this.answers.length,
      totalImages: VISUAL_TEST_IMAGES.length,
    });

    // Frontend'e cevap kaydedildi bildirimi
    this.sendToClient({
      type: 'visual_test_answer_recorded',
      imageIndex: this.currentImageIndex,
      answeredCount: this.answers.length,
      totalImages: VISUAL_TEST_IMAGES.length,
    });

    // Sırada görsel var mı?
    if (this.currentImageIndex + 1 < VISUAL_TEST_IMAGES.length) {
      // Sonraki görsele geç
      log.info('Sonraki görsele geçiliyor', {
        sessionId: this.sessionId,
        nextIndex: this.currentImageIndex + 1,
      });

      // Gemini'ye bildir — hafif text, görsel yok
      this.sendTextToLive(
        `VISUAL_TEST_NEXT: Kullanıcı görsel ${this.currentImageIndex + 1}'e "${answer}" cevabını verdi. ` +
        `Şimdi görsel ${this.currentImageIndex + 2}/${VISUAL_TEST_IMAGES.length} ekranda gösteriliyor. ` +
        `Kullanıcıya "Şimdi ekrandaki yeni görsele bakın. Ne görüyorsunuz?" diye sor ve cevabını bekle.`
      );

      // Sonraki görseli üret ve göster
      await this._generateAndShowNextImage();
    } else {
      // Tüm görseller tamamlandı → submit
      log.info('Tüm görseller cevaplandı, submit yapılıyor', {
        sessionId: this.sessionId,
        answers: this.answers,
      });

      this.state = VT_STATE.COLLECTING;

      // Gemini'ye submit talimatı gönder — cevap verileri ile birlikte
      const answersForSubmit = this.answers.map(a => ({
        imageIndex: a.imageIndex,
        userAnswer: a.userAnswer,
        correctAnswer: a.correctAnswer,
      }));

      this.sendTextToLive(
        `VISUAL_TEST_COMPLETE: Tüm ${VISUAL_TEST_IMAGES.length} görsel cevaplandı. ` +
        `Cevaplar: ${JSON.stringify(answersForSubmit)}. ` +
        `Şimdi submit_visual_recognition fonksiyonunu çağır: ` +
        `sessionId: "${this.sessionId}", ` +
        `answers: ${JSON.stringify(answersForSubmit)}. ` +
        `Submit ettikten sonra kullanıcıya "Görsel tanıma testini tamamladınız! Son testimize geçmeye hazır mısınız?" de.`
      );

      this.state = VT_STATE.DONE;
      this.isActive = false;

      // Frontend'e test bitti bildirimi
      this.sendToClient({
        type: 'visual_test_completed',
        answeredCount: this.answers.length,
        totalImages: VISUAL_TEST_IMAGES.length,
      });
    }
  }

  /**
   * record_visual_answer tool call'ı ile cevap kaydetme
   * Nöra kullanıcıdan cevabı aldığında bu tool'u çağırır
   * VisualTestAgent cevabı kaydeder ve sonraki görsele geçer
   */
  async recordAnswer(imageIndex, userAnswer) {
    if (!this.isActive) {
      log.warn('recordAnswer: Test aktif değil', { sessionId: this.sessionId });
      return { success: false, message: 'Görsel tanıma testi aktif değil.' };
    }

    // Debounce timeout'u iptal et (artık cevap geldi)
    if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);

    const imageConfig = VISUAL_TEST_IMAGES[imageIndex] || VISUAL_TEST_IMAGES[this.currentImageIndex];
    const answer = (userAnswer || '').trim();

    // Cevabı kaydet
    // Aynı imageIndex için tekrar cevap geldiyse güncelle
    const existingIdx = this.answers.findIndex(a => a.imageIndex === imageIndex);
    if (existingIdx >= 0) {
      this.answers[existingIdx].userAnswer = answer;
      log.info('Cevap güncellendi (record_visual_answer)', { sessionId: this.sessionId, imageIndex, answer: answer.substring(0, 50) });
    } else {
      this.answers.push({
        imageIndex,
        imageId: `image_${imageIndex}`,
        userAnswer: answer,
        correctAnswer: imageConfig ? imageConfig.correctAnswer : '',
      });
      log.info('Cevap kaydedildi (record_visual_answer)', { sessionId: this.sessionId, imageIndex, answer: answer.substring(0, 50) });
    }

    // Frontend'e bildir
    this.sendToClient({
      type: 'visual_test_answer_recorded',
      imageIndex,
      answeredCount: this.answers.length,
      totalImages: VISUAL_TEST_IMAGES.length,
    });

    // Sırada görsel var mı?
    if (this.currentImageIndex + 1 < VISUAL_TEST_IMAGES.length) {
      // Sonraki görseli üret ve göster
      await this._generateAndShowNextImage();

      return {
        success: true,
        message: `Görsel ${imageIndex + 1} cevabı kaydedildi. Görsel ${this.currentImageIndex + 1}/${VISUAL_TEST_IMAGES.length} ekranda gösteriliyor. Kullanıcıya "Şimdi ekrandaki yeni görsele bakın. Ne görüyorsunuz?" diye sor ve cevabını bekle.`,
        currentImage: this.currentImageIndex + 1,
        totalImages: VISUAL_TEST_IMAGES.length,
        remainingImages: VISUAL_TEST_IMAGES.length - this.answers.length,
      };
    } else {
      // Tüm görseller tamamlandı
      this.state = VT_STATE.DONE;
      this.isActive = false;

      // Frontend'e test bitti bildirimi
      this.sendToClient({
        type: 'visual_test_completed',
        answeredCount: this.answers.length,
        totalImages: VISUAL_TEST_IMAGES.length,
      });

      const answersForSubmit = this.answers.map(a => ({
        imageIndex: a.imageIndex,
        userAnswer: a.userAnswer,
        correctAnswer: a.correctAnswer,
      }));

      return {
        success: true,
        allComplete: true,
        message: `Tüm ${VISUAL_TEST_IMAGES.length} görsel cevaplandı. Şimdi submit_visual_recognition fonksiyonunu çağır: sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}. Submit ettikten sonra kullanıcıya "Görsel tanıma testini tamamladınız! Son testimize geçmeye hazır mısınız?" de.`,
        answers: answersForSubmit,
      };
    }
  }

  /**
   * Dışarıdan cevabı zorla finalize et
   * (Gemini cevabı algıladığında veya kullanıcı başka konuya geçtiğinde)
   */
  forceFinalize() {
    if (this.state === VT_STATE.WAITING_ANSWER) {
      if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);
      this._finalizeCurrentAnswer();
    }
  }

  /**
   * Test aktif mi?
   */
  get isTestActive() {
    return this.isActive;
  }

  /**
   * Mevcut durum bilgisi
   */
  getStatus() {
    return {
      isActive: this.isActive,
      state: this.state,
      currentImageIndex: this.currentImageIndex,
      answeredCount: this.answers.length,
      totalImages: VISUAL_TEST_IMAGES.length,
    };
  }

  destroy() {
    if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);
    this.isActive = false;
    log.info('VisualTestAgent temizlendi', { sessionId: this.sessionId });
  }
}

module.exports = { VisualTestAgent, VISUAL_TEST_IMAGES, VT_STATE };
