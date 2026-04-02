/**
 * Visual Test Agent - Test 3 Koordinator Ajani (Basitlestirilmis)
 * 
 * Akis: Gorsel goster → Gemini kullaniciya sorar → Kullanici cevaplar →
 * Gemini record_visual_answer tool call yapar → Kayit → Sonraki gorsel
 * 
 * Onay mekanizmasi KALDIRILDI - tum kontrol Gemini'de,
 * backend sadece kayit ve gorsel yonetimi yapar.
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
  canta: 'bag',
  ayna: 'mirror',
  tabak: 'plate',
  catal: 'fork',
  makas: 'scissors',
  semsiye: 'umbrella',
  kedi: 'cat',
  kopek: 'dog',
  kus: 'bird',
  balik: 'fish',
  kelebek: 'butterfly',
  at: 'horse',
  tavsan: 'rabbit',
  araba: 'car',
  bisiklet: 'bicycle',
  gemi: 'ship',
  ucak: 'airplane',
  tren: 'train',
  elma: 'apple',
  ekmek: 'bread',
  muz: 'banana',
  portakal: 'orange',
  cilek: 'strawberry',
  agac: 'tree',
  cicek: 'flower',
  gunes: 'sun',
  yildiz: 'star',
  bulut: 'cloud',
  dag: 'mountain',
  sapka: 'hat',
  gozluk: 'glasses',
  ayakkabi: 'shoe',
  eldiven: 'glove',
};

const AGENT_GUARD_COOLDOWN_MS = 3000;

const AGENT_ADVANCE_PATTERNS = [
  /\bsonraki gorsel\b/,
  /\bsonraki gorsele\b/,
  /\bsiradaki gorsel\b/,
  /\bsiradaki gorsele\b/,
  /\bikinci gorsel\b/,
  /\bikinci gorsele\b/,
  /\bucuncu gorsel\b/,
  /\bucuncu gorsele\b/,
  /\bgorsele gec(?:iyor|iyoruz|elim|elim mi)\b/,
  /\bnext image\b/,
  /\bsecond image\b/,
  /\bthird image\b/,
  /\bvisual recognition test is complete\b/,
  /\bgorsel tanima testini tamamladiniz\b/,
  /\bsubmit_visual_recognition\b/,
  /\btest 4\b/,
  /\bmoving on to the next\b/,
  /\blet me show you the next\b/,
  /\bnow for the next image\b/,
  /\bimage number (?:two|three|2|3)\b/,
  /\bvisual test is (?:complete|done|finished)\b/,
  /\ball images (?:are |have been )?answered\b/,
];

function normalizeForIntent(rawText, language) {
  if (!rawText) return '';
  let t = String(rawText).toLowerCase().trim();
  t = t.replace(/[.,!?;:'"()\[\]{}<>\/\\@#$%^&*_+=~`|]/g, ' ');
  t = t
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/İ/g, 'i')
    .replace(/Ö/g, 'o')
    .replace(/Ü/g, 'u')
    .replace(/Ş/g, 's')
    .replace(/Ç/g, 'c')
    .replace(/Ğ/g, 'g');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function matchesAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

/** Havuzdaki Türkçe subject → TR_TO_EN_SUBJECT anahtarı (ASCII) */
function asciiSubjectKey(trSubject) {
  return String(trSubject || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .trim();
}

class VisualTestAgent {
  /** index.js: new VisualTestAgent(sessionId, sendToClient, sendTextToLive, language) */
  constructor(sessionId, sendToClient, sendTextToLive, language = 'tr') {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.language = normalizeLanguage(language);

    this.isActive = false;
    this.state = VT_STATE.IDLE;
    this.testImages = [];
    this.currentImageIndex = 0;
    this.answers = [];
    this.lastAgentGuardAt = 0;
  }

  async startTest() {
    this.isActive = true;
    this.state = VT_STATE.GENERATING;
    this.currentImageIndex = 0;
    this.answers = [];

    const keywords = selectRandomKeywords(3);
    this.testImages = keywords.map((kw, index) => {
      const subjectTr = kw.subject;
      const asciiKey = asciiSubjectKey(subjectTr);
      const enLabel = TR_TO_EN_SUBJECT[asciiKey] || asciiKey;
      return {
        index,
        subjectTr,
        enLabel,
        localizedCorrectAnswer: isEnglish(this.language) ? enLabel : kw.correctAnswer,
        imageBase64: null,
        mimeType: null,
        generatedByAI: false,
      };
    });

    log.info('Gorsel testi baslatildi', {
      sessionId: this.sessionId,
      keywords: this.testImages.map((img) => img.subjectTr),
    });

    this.sendToClient({
      type: 'visual_test_started',
      totalImages: this.testImages.length,
    });

    await this._generateAndShowImage(0);

    return {
      success: true,
      totalImages: this.testImages.length,
      message: pickText(
        this.language,
        `Gorsel tanima testi baslatildi. ${this.testImages.length} gorsel gosterilecek. Ilk gorsel ekranda. Kullaniciya ne gordugunu sor.`,
        `Visual recognition test started. ${this.testImages.length} images will be shown. The first image is on screen. Ask the user what they see.`
      ),
    };
  }

  async _generateAndShowImage(imageIndex) {
    if (imageIndex >= this.testImages.length) return;

    this.currentImageIndex = imageIndex;
    this.state = VT_STATE.WAITING_ANSWER;
    const imageConfig = this.testImages[imageIndex];

    this.sendToClient({
      type: 'visual_test_generating',
      imageIndex,
      totalImages: this.testImages.length,
    });

    const pipeline = getImagePipeline();
    if (pipeline) {
      try {
        const result = await pipeline.run(imageConfig.subjectTr);
        if (result?.success && result.image?.data) {
          imageConfig.imageBase64 = result.image.data;
          imageConfig.mimeType = result.image.mimeType || 'image/jpeg';
          imageConfig.generatedByAI = true;

          this.sendToClient({
            type: 'visual_test_image',
            imageIndex,
            imageBase64: result.image.data,
            mimeType: imageConfig.mimeType,
            generatedByAI: true,
            totalImages: this.testImages.length,
          });

          log.info('AI gorsel olusturuldu', {
            sessionId: this.sessionId,
            imageIndex,
            subject: imageConfig.subjectTr,
          });
          return;
        }
      } catch (error) {
        log.warn('AI gorsel olusturma basarisiz, statik gorsele donuluyor', {
          sessionId: this.sessionId,
          imageIndex,
          error: error.message,
        });
      }
    }

    const staticImage = getStaticTestImage(imageConfig.subjectTr);
    if (staticImage) {
      imageConfig.imageBase64 = staticImage.data;
      imageConfig.mimeType = staticImage.mimeType;
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

  onAgentTranscript(text) {
    if (!this.isActive || this.state !== VT_STATE.WAITING_ANSWER) return;

    const normalized = normalizeForIntent(text, this.language);
    if (!matchesAnyPattern(normalized, AGENT_ADVANCE_PATTERNS)) return;

    const now = Date.now();
    if (now - this.lastAgentGuardAt < AGENT_GUARD_COOLDOWN_MS) return;
    this.lastAgentGuardAt = now;

    this.sendTextToLive(
      pickText(
        this.language,
        `VISUAL_TEST_GUARD: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} henuz cevaplanmadi. Sonraki gorsele gecme. Kullaniciya ne gordugunu sor.`,
        `VISUAL_TEST_GUARD: Image ${this.currentImageIndex + 1}/${this.testImages.length} is not answered yet. Do not move to the next image. Ask the user what they see.`
      )
    );
  }

  async recordAnswer(imageIndex, userAnswer) {
    const effectiveImageIndex = this.currentImageIndex;
    const answer = String(userAnswer || '').trim();

    log.info('Visual record', {
      sessionId: this.sessionId,
      state: this.state,
      currentImageIndex: this.currentImageIndex,
      effectiveImageIndex,
      userAnswer: answer,
    });

    const existingAnswer = this.answers.find((a) => a.imageIndex === effectiveImageIndex);
    if (existingAnswer) {
      return this._buildDuplicateResult(existingAnswer);
    }

    if (!this.isActive) {
      return {
        success: false,
        blocked: true,
        reason: 'VISUAL_TEST_INACTIVE',
        message: pickText(this.language, 'Gorsel tanima testi aktif degil.', 'Visual recognition test is not active.'),
      };
    }

    if (!answer) {
      return {
        success: false,
        blocked: true,
        reason: 'EMPTY_ANSWER',
        message: pickText(
          this.language,
          `Gorsel ${effectiveImageIndex + 1}: Bos cevap gonderilemez. Kullaniciya tekrar sor.`,
          `Image ${effectiveImageIndex + 1}: Empty answer cannot be recorded. Ask the user again.`
        ),
      };
    }

    const imageConfig = this.testImages[effectiveImageIndex];
    const answerRecord = {
      imageIndex: effectiveImageIndex,
      imageId: `image_${effectiveImageIndex}`,
      userAnswer: answer,
      correctAnswer: imageConfig.localizedCorrectAnswer,
      answerKind: 'direct',
    };

    this.answers.push(answerRecord);

    this.sendToClient({
      type: 'visual_test_answer_recorded',
      imageIndex: effectiveImageIndex,
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    });

    log.info('Visual cevap kaydedildi', {
      sessionId: this.sessionId,
      imageIndex: effectiveImageIndex,
      userAnswer: answer,
      correctAnswer: imageConfig.localizedCorrectAnswer,
      answeredCount: this.answers.length,
    });

    if (effectiveImageIndex + 1 < this.testImages.length) {
      await this._generateAndShowImage(effectiveImageIndex + 1);
      return {
        success: true,
        message: pickText(
          this.language,
          `Gorsel ${effectiveImageIndex + 1} cevabi kaydedildi. Simdi gorsel ${this.currentImageIndex + 1}/${this.testImages.length} ekranda. Kullaniciya ne gordugunu sor.`,
          `Answer for image ${effectiveImageIndex + 1} recorded. Image ${this.currentImageIndex + 1}/${this.testImages.length} is now on screen. Ask the user what they see.`
        ),
        currentImage: this.currentImageIndex + 1,
        totalImages: this.testImages.length,
        remainingImages: this.testImages.length - this.answers.length,
        recordedAnswer: answer,
      };
    }

    this.state = VT_STATE.DONE;
    this.isActive = false;
    this.sendToClient({
      type: 'visual_test_completed',
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
    });

    const answersForSubmit = this.getAnswersForSubmit();
    return {
      success: true,
      allComplete: true,
      message: pickText(
        this.language,
        `Tum ${this.testImages.length} gorsel cevaplandi. Simdi submit_visual_recognition fonksiyonunu cagir. sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}.`,
        `All ${this.testImages.length} images answered. Now call submit_visual_recognition with sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}.`
      ),
      answers: answersForSubmit,
    };
  }

  _buildDuplicateResult(existingAnswer) {
    return {
      success: true,
      duplicate: true,
      imageIndex: existingAnswer.imageIndex,
      recordedAnswer: existingAnswer.userAnswer,
      currentImage: this.currentImageIndex + 1,
      totalImages: this.testImages.length,
      message: pickText(
        this.language,
        `Gorsel ${existingAnswer.imageIndex + 1} cevabi zaten kayitli.`,
        `The answer for image ${existingAnswer.imageIndex + 1} is already recorded.`
      ),
      allComplete: !this.isActive && this.answers.length === this.testImages.length,
      answers: this.getAnswersForSubmit(),
    };
  }

  canSubmitRecognition() {
    return this.answers.length === this.testImages.length && !this.isActive;
  }

  getAnswersForSubmit() {
    return this.answers
      .slice()
      .sort((left, right) => left.imageIndex - right.imageIndex)
      .map((answer) => ({
        imageIndex: answer.imageIndex,
        imageId: answer.imageId,
        userAnswer: answer.userAnswer,
        correctAnswer: answer.correctAnswer,
        answerKind: answer.answerKind || 'direct',
      }));
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
    this.isActive = false;
    log.info('VisualTestAgent temizlendi', { sessionId: this.sessionId });
  }
}

module.exports = { VisualTestAgent };
