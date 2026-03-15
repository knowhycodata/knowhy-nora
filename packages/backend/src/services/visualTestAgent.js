/**
 * Visual Test Agent - Test 3 Koordinatör Ajanı
 */

const { createLogger } = require('../lib/logger');
const { normalizeLanguage, pickText, isEnglish } = require('../lib/language');
const { getImagePipeline } = require('./imageGenerator');
const { getStaticTestImage } = require('./staticTestImages');
const { selectRandomKeywords } = require('./visualTestKeywords');

const log = createLogger('VisualTestAgent');

const VT_STATE = {
  IDLE: 'IDLE',
  GENERATING: 'GENERATING',
  WAITING_ANSWER: 'WAITING_ANSWER',
  COLLECTING: 'COLLECTING',
  DONE: 'DONE',
};

const TR_TO_EN_SUBJECT = {
  saat: 'clock',
  anahtar: 'key',
  kalem: 'pen',
  masa: 'table',
  sandalye: 'chair',
  bardak: 'glass',
  kitap: 'book',
  lamba: 'lamp',
  telefon: 'phone',
  çanta: 'bag',
  ayna: 'mirror',
  tabak: 'plate',
  çatal: 'fork',
  makas: 'scissors',
  şemsiye: 'umbrella',
  kedi: 'cat',
  köpek: 'dog',
  kuş: 'bird',
  balık: 'fish',
  kelebek: 'butterfly',
  at: 'horse',
  tavşan: 'rabbit',
  araba: 'car',
  bisiklet: 'bicycle',
  gemi: 'ship',
  uçak: 'airplane',
  tren: 'train',
  elma: 'apple',
  ekmek: 'bread',
  muz: 'banana',
  portakal: 'orange',
  çilek: 'strawberry',
  ağaç: 'tree',
  çiçek: 'flower',
  güneş: 'sun',
  yıldız: 'star',
  bulut: 'cloud',
  dağ: 'mountain',
  şapka: 'hat',
  gözlük: 'glasses',
  ayakkabı: 'shoe',
  eldiven: 'glove',
};

function mapSubjectToEnglish(subject) {
  return TR_TO_EN_SUBJECT[subject] || subject;
}

class VisualTestAgent {
  constructor(sessionId, sendToClient, sendTextToLive, language = 'tr') {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.language = normalizeLanguage(language);

    this.testImages = selectRandomKeywords(3).map((item) => {
      const localized = isEnglish(this.language)
        ? mapSubjectToEnglish(item.subject)
        : item.subject;
      return {
        ...item,
        localizedSubject: localized,
        localizedCorrectAnswer: localized,
      };
    });
    log.info('Session için rastgele görseller seçildi', {
      sessionId,
      language: this.language,
      keywords: this.testImages.map((k) => k.localizedSubject),
    });

    this.state = VT_STATE.IDLE;
    this.currentImageIndex = -1;
    this.answers = [];
    this.isActive = false;

    this.userAnswerBuffer = '';
    this.answerBufferTimeout = null;
    this.ANSWER_SETTLE_MS = 3000;
  }

  async startTest() {
    if (this.isActive) {
      return {
        success: false,
        message: pickText(
          this.language,
          'Gorsel tanima testi zaten devam ediyor.',
          'Visual recognition test is already in progress.'
        ),
      };
    }

    this.isActive = true;
    this.state = VT_STATE.IDLE;
    this.currentImageIndex = -1;
    this.answers = [];

    this.sendToClient({
      type: 'visual_test_started',
      totalImages: this.testImages.length,
    });

    await this._generateAndShowNextImage();

    return {
      success: true,
      message: pickText(
        this.language,
        `Gorsel tanima testi baslatildi. Bu oturumdaki gorseller: ${this.testImages.map((k) => k.localizedSubject).join(', ')}. Ilk gorsel ekranda. Kullanicidan "Ne goruyorsunuz?" diye cevap al.`,
        `Visual recognition test started. Subjects in this session: ${this.testImages.map((k) => k.localizedSubject).join(', ')}. The first image is on screen. Ask the user: "What do you see?"`
      ),
      totalImages: this.testImages.length,
      currentImage: 1,
      selectedSubjects: this.testImages.map((k) => k.localizedSubject),
    };
  }

  async _generateAndShowNextImage() {
    this.currentImageIndex += 1;
    if (this.currentImageIndex >= this.testImages.length) {
      this.state = VT_STATE.COLLECTING;
      return;
    }

    const imageConfig = this.testImages[this.currentImageIndex];
    this.state = VT_STATE.GENERATING;

    this.sendToClient({
      type: 'visual_test_generating',
      imageIndex: this.currentImageIndex,
      totalImages: this.testImages.length,
    });

    try {
      const pipeline = getImagePipeline();
      const prompt = isEnglish(this.language)
        ? `A simple, clear and recognizable image of ${imageConfig.localizedSubject}. Minimalist composition, clean background.`
        : `Basit, net ve taninabilir bir ${imageConfig.localizedSubject} gorseli. Minimalist, temiz arka plan.`;
      const result = await pipeline.run(prompt, { aspectRatio: '1:1' });

      if (result.success && result.image) {
        this.sendToClient({
          type: 'visual_test_image',
          imageIndex: this.currentImageIndex,
          imageBase64: result.image.data,
          mimeType: result.image.mimeType,
          generatedByAI: true,
          totalImages: this.testImages.length,
        });
      } else {
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

    this.state = VT_STATE.WAITING_ANSWER;
    this.userAnswerBuffer = '';
  }

  _sendFallbackImage(imageIndex, subject) {
    const staticImage = getStaticTestImage(subject);
    if (staticImage) {
      this.sendToClient({
        type: 'visual_test_image',
        imageIndex,
        imageBase64: staticImage.data,
        mimeType: staticImage.mimeType,
        generatedByAI: false,
        totalImages: this.testImages.length,
      });
      return;
    }

    this.sendToClient({
      type: 'visual_test_image',
      imageIndex,
      imageBase64: null,
      mimeType: null,
      generatedByAI: false,
      fallback: true,
      totalImages: this.testImages.length,
    });
  }

  onUserTranscript(text) {
    if (!this.isActive || this.state !== VT_STATE.WAITING_ANSWER) return;
    const cleanText = (text || '').trim();
    if (!cleanText) return;

    this.userAnswerBuffer += ` ${cleanText}`;
    if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);
    this.answerBufferTimeout = setTimeout(() => this._finalizeCurrentAnswer(), this.ANSWER_SETTLE_MS);
  }

  onAgentTranscript(text) {
    if (!this.isActive) return;
    log.debug('Agent transcript (visual test)', {
      sessionId: this.sessionId,
      state: this.state,
      text: text.substring(0, 80),
    });
  }

  async _finalizeCurrentAnswer() {
    if (this.state !== VT_STATE.WAITING_ANSWER) return;

    const answer = this.userAnswerBuffer.trim();
    const imageConfig = this.testImages[this.currentImageIndex];
    this.answers.push({
      imageIndex: this.currentImageIndex,
      imageId: `image_${this.currentImageIndex}`,
      userAnswer: answer,
      correctAnswer: imageConfig.localizedCorrectAnswer,
    });

    this.sendToClient({
      type: 'visual_test_answer_recorded',
      imageIndex: this.currentImageIndex,
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    });

    if (this.currentImageIndex + 1 < this.testImages.length) {
      this.sendTextToLive(
        pickText(
          this.language,
          `VISUAL_TEST_NEXT: Kullanici gorsel ${this.currentImageIndex + 1} icin "${answer}" cevabini verdi. Simdi gorsel ${this.currentImageIndex + 2}/${this.testImages.length} ekranda. Kullanicidan yeni gorseli tarif etmesini iste.`,
          `VISUAL_TEST_NEXT: The user answered "${answer}" for image ${this.currentImageIndex + 1}. Image ${this.currentImageIndex + 2}/${this.testImages.length} is now on screen. Ask the user to describe the new image.`
        )
      );
      await this._generateAndShowNextImage();
      return;
    }

    this.state = VT_STATE.COLLECTING;
    const answersForSubmit = this.answers.map((a) => ({
      imageIndex: a.imageIndex,
      userAnswer: a.userAnswer,
      correctAnswer: a.correctAnswer,
    }));

    this.sendTextToLive(
      pickText(
        this.language,
        `VISUAL_TEST_COMPLETE: Tum ${this.testImages.length} gorsel tamamlandi. Cevaplar: ${JSON.stringify(answersForSubmit)}. ` +
          `Simdi submit_visual_recognition fonksiyonunu cagir. sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}. ` +
          'Sonra kullaniciya son teste gecmeye hazir olup olmadigini sor.',
        `VISUAL_TEST_COMPLETE: All ${this.testImages.length} images are answered. Answers: ${JSON.stringify(answersForSubmit)}. ` +
          `Now call submit_visual_recognition with sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}. ` +
          'Then ask if the user is ready for the final test.'
      )
    );

    this.state = VT_STATE.DONE;
    this.isActive = false;
    this.sendToClient({
      type: 'visual_test_completed',
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    });
  }

  async recordAnswer(imageIndex, userAnswer) {
    if (!this.isActive) {
      return {
        success: false,
        message: pickText(
          this.language,
          'Gorsel tanima testi aktif degil.',
          'Visual recognition test is not active.'
        ),
      };
    }

    if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);

    const imageConfig = this.testImages[imageIndex] || this.testImages[this.currentImageIndex];
    const answer = (userAnswer || '').trim();
    const existingIdx = this.answers.findIndex((a) => a.imageIndex === imageIndex);
    if (existingIdx >= 0) {
      this.answers[existingIdx].userAnswer = answer;
    } else {
      this.answers.push({
        imageIndex,
        imageId: `image_${imageIndex}`,
        userAnswer: answer,
        correctAnswer: imageConfig ? imageConfig.localizedCorrectAnswer : '',
      });
    }

    this.sendToClient({
      type: 'visual_test_answer_recorded',
      imageIndex,
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    });

    if (this.currentImageIndex + 1 < this.testImages.length) {
      await this._generateAndShowNextImage();
      return {
        success: true,
        message: pickText(
          this.language,
          `Gorsel ${imageIndex + 1} cevabi kaydedildi. Simdi gorsel ${this.currentImageIndex + 1}/${this.testImages.length} ekranda.`,
          `Answer for image ${imageIndex + 1} is saved. Image ${this.currentImageIndex + 1}/${this.testImages.length} is now on screen.`
        ),
        currentImage: this.currentImageIndex + 1,
        totalImages: this.testImages.length,
        remainingImages: this.testImages.length - this.answers.length,
      };
    }

    this.state = VT_STATE.DONE;
    this.isActive = false;
    this.sendToClient({
      type: 'visual_test_completed',
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    });

    const answersForSubmit = this.answers.map((a) => ({
      imageIndex: a.imageIndex,
      userAnswer: a.userAnswer,
      correctAnswer: a.correctAnswer,
    }));

    return {
      success: true,
      allComplete: true,
      message: pickText(
        this.language,
        `Tum ${this.testImages.length} gorsel cevaplandi. Simdi submit_visual_recognition fonksiyonunu cagir. sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}.`,
        `All ${this.testImages.length} images are answered. Now call submit_visual_recognition with sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}.`
      ),
      answers: answersForSubmit,
    };
  }

  forceFinalize() {
    if (this.state === VT_STATE.WAITING_ANSWER) {
      if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);
      this._finalizeCurrentAnswer();
    }
  }

  get isTestActive() {
    return this.isActive;
  }

  getStatus() {
    return {
      isActive: this.isActive,
      state: this.state,
      currentImageIndex: this.currentImageIndex,
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    };
  }

  getSelectedKeywords() {
    return this.testImages;
  }

  destroy() {
    if (this.answerBufferTimeout) clearTimeout(this.answerBufferTimeout);
    this.isActive = false;
    log.info('VisualTestAgent temizlendi', { sessionId: this.sessionId });
  }
}

module.exports = { VisualTestAgent, VT_STATE };
