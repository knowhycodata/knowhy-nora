/**
 * Visual Test Agent - Test 3 Koordinator Ajani
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
  WAITING_CANDIDATE: 'WAITING_CANDIDATE',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  READY_TO_RECORD: 'READY_TO_RECORD',
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

const INPUT_SETTLE_MS = 1800;
const MAX_INVALID_ATTEMPTS = 2;
const AGENT_GUARD_COOLDOWN_MS = 2500;

const FILLER_ONLY_PHRASES = new Set([
  'hmm',
  'hmmm',
  'umm',
  'uh',
  'aa',
  'aaa',
  'ee',
  'eee',
  'sey',
  'yani',
  'bir saniye',
  'dur',
  'wait',
  'one second',
]);

const SKIP_PATTERNS = [
  /\batla\b/,
  /\bpas gec\b/,
  /\bsorulari atla\b/,
  /\bsonraki(?:ne)? gec\b/,
  /\bdevam et\b/,
  /\bskip\b/,
  /\bpass\b/,
  /\bnext\b/,
];

const UNKNOWN_PATTERNS = [
  /\bbilmiyorum\b/,
  /\bgoremiyorum\b/,
  /\bgoremedim\b/,
  /\bemin degilim\b/,
  /\banlayamadim\b/,
  /\bi do not know\b/,
  /\bi dont know\b/,
  /\bnot sure\b/,
  /\bcant tell\b/,
  /\bcannot tell\b/,
  /\bi cant see\b/,
  /\bi cannot see\b/,
];

const CONFIRM_YES_PATTERNS = [
  /\bevet\b/,
  /\bkaydet\b/,
  /\btamam\b/,
  /\bolur\b/,
  /\bdogru\b/,
  /\byes\b/,
  /\bsave it\b/,
  /\bcorrect\b/,
  /\bthats right\b/,
  /\bthat's right\b/,
];

const CONFIRM_NO_PATTERNS = [
  /\bhayir\b/,
  /\byanlis\b/,
  /\bdegil\b/,
  /\bno\b/,
  /\bnot that\b/,
  /\bincorrect\b/,
];

const NON_ANSWER_PATTERNS = [
  /\btekrar\b/,
  /\bbir daha\b/,
  /\banlamadim\b/,
  /\bduymadim\b/,
  /\bwhat\b/,
  /\brepeat\b/,
  /\bsoruyu tekrar\b/,
  /\bcan you repeat\b/,
];

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
];

const LEADING_TR_PHRASES = [
  'bu bir ',
  'bu ',
  'galiba ',
  'sanirim ',
  'sanirim bu ',
  'sanki ',
  'bence ',
];

const TRAILING_TR_PHRASES = [
  ' galiba',
  ' sanirim',
  ' herhalde',
  ' olabilir',
];

const LEADING_EN_PHRASES = [
  'it is ',
  "it's ",
  'this is ',
  'i think it is ',
  "i think it's ",
  'maybe it is ',
  'looks like ',
  'it looks like ',
  'a ',
  'an ',
  'the ',
];

const TRAILING_EN_PHRASES = [
  ' i think',
  ' maybe',
  ' i guess',
];

function mapSubjectToEnglish(subject) {
  return TR_TO_EN_SUBJECT[subject] || subject;
}

function normalizeForIntent(text, language = 'tr') {
  if (!text) return '';
  const locale = isEnglish(language) ? 'en-US' : 'tr-TR';
  return String(text)
    .toLocaleLowerCase(locale)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`"]/g, '')
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function trimPhraseList(text, phrases, fromStart = true) {
  let value = text;
  let changed = true;

  while (changed) {
    changed = false;
    for (const phrase of phrases) {
      if (fromStart && value.startsWith(phrase)) {
        value = value.slice(phrase.length).trim();
        changed = true;
      }
      if (!fromStart && value.endsWith(phrase)) {
        value = value.slice(0, value.length - phrase.length).trim();
        changed = true;
      }
    }
  }

  return value;
}

function normalizeCandidateAnswer(rawText, language) {
  if (!rawText) return '';

  let normalized = normalizeForIntent(rawText, language)
    .replace(/^(cevabim|cevap|answer)\s+/g, '')
    .trim();

  if (isEnglish(language)) {
    normalized = trimPhraseList(normalized, LEADING_EN_PHRASES, true);
    normalized = trimPhraseList(normalized, TRAILING_EN_PHRASES, false);
  } else {
    normalized = trimPhraseList(normalized, LEADING_TR_PHRASES, true);
    normalized = trimPhraseList(normalized, TRAILING_TR_PHRASES, false);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

class VisualTestAgent {
  constructor(sessionId, sendToClient, sendTextToLive, language = 'tr') {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.language = normalizeLanguage(language);

    this.testImages = selectRandomKeywords(3).map((item) => {
      const localized = isEnglish(this.language)
        ? mapSubjectToEnglish(normalizeForIntent(item.subject, 'tr'))
        : item.subject;
      return {
        ...item,
        localizedSubject: localized,
        localizedCorrectAnswer: localized,
      };
    });
    log.info('Session icin rastgele gorseller secildi', {
      sessionId,
      language: this.language,
      keywords: this.testImages.map((k) => k.localizedSubject),
    });

    this.state = VT_STATE.IDLE;
    this.currentImageIndex = -1;
    this.answers = [];
    this.isActive = false;

    this.userInputBuffer = '';
    this.inputBufferTimeout = null;
    this.pendingAnswerCandidate = null;
    this.readyToRecordAnswer = null;
    this.retryCountByImage = new Map();
    this.lastAgentGuardAt = 0;
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
    this.pendingAnswerCandidate = null;
    this.readyToRecordAnswer = null;
    this.retryCountByImage.clear();
    this._clearBufferedInput();

    this.sendToClient({
      type: 'visual_test_started',
      totalImages: this.testImages.length,
    });

    await this._generateAndShowNextImage();

    return {
      success: true,
      message: pickText(
        this.language,
        `Gorsel tanima testi baslatildi. Bu oturumdaki gorseller: ${this.testImages.map((k) => k.localizedSubject).join(', ')}. Ilk gorsel ekranda. Kullanicidan sadece ne gordugunu soylemesini iste. "Atla" komutunu kabul etme; kullanici isterse "bilmiyorum" diyebilir. Her cevabi kaydetmeden once sesli onay al.`,
        `Visual recognition test started. Subjects in this session: ${this.testImages.map((k) => k.localizedSubject).join(', ')}. The first image is on screen. Ask the user only what they see. Do not accept skip commands; the user may say "I don't know". Confirm every answer aloud before recording it.`
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

    this.pendingAnswerCandidate = null;
    this.readyToRecordAnswer = null;
    this._clearBufferedInput();

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
      log.error('Gorsel uretim hatasi', {
        sessionId: this.sessionId,
        imageIndex: this.currentImageIndex,
        error: error.message,
      });
      this._sendFallbackImage(this.currentImageIndex, imageConfig.subject);
    }

    this.state = VT_STATE.WAITING_CANDIDATE;
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
    if (!this.isActive) return;
    if (![VT_STATE.WAITING_CANDIDATE, VT_STATE.AWAITING_CONFIRMATION].includes(this.state)) return;

    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    this.userInputBuffer = `${this.userInputBuffer} ${cleanText}`.trim();
    if (this.inputBufferTimeout) clearTimeout(this.inputBufferTimeout);
    this.inputBufferTimeout = setTimeout(() => {
      this._finalizeBufferedUserInput().catch((error) => {
        log.error('Visual user input finalize hatasi', {
          sessionId: this.sessionId,
          state: this.state,
          error: error.message,
        });
      });
    }, INPUT_SETTLE_MS);
  }

  onAgentTranscript(text) {
    if (!this.isActive) return;

    const preview = String(text || '').substring(0, 80);
    log.debug('Agent transcript (visual test)', {
      sessionId: this.sessionId,
      state: this.state,
      text: preview,
    });

    if (![VT_STATE.WAITING_CANDIDATE, VT_STATE.AWAITING_CONFIRMATION].includes(this.state)) {
      return;
    }

    const normalized = normalizeForIntent(text, this.language);
    if (!matchesAnyPattern(normalized, AGENT_ADVANCE_PATTERNS)) {
      return;
    }

    const now = Date.now();
    if (now - this.lastAgentGuardAt < AGENT_GUARD_COOLDOWN_MS) {
      return;
    }

    this.lastAgentGuardAt = now;
    this.sendTextToLive(
      pickText(
        this.language,
        `VISUAL_TEST_GUARD: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} henuz kapanmadi. Sonraki gorsele veya teste gectigini soyleme. Ayni gorselde kal; eger cevap bekleniyorsa sadece "Ne goruyorsunuz?" diye sor, eger onay bekleniyorsa sadece cevabi onaylat.`,
        `VISUAL_TEST_GUARD: Image ${this.currentImageIndex + 1}/${this.testImages.length} is not closed yet. Do not say or imply that you moved to the next image or next test. Stay on the same image; if an answer is pending ask only what the user sees, and if confirmation is pending ask only for confirmation.`
      )
    );
  }

  async _finalizeBufferedUserInput() {
    this.inputBufferTimeout = null;
    const text = this.userInputBuffer.trim();
    this.userInputBuffer = '';

    if (!text || !this.isActive) {
      return;
    }

    if (this.state === VT_STATE.WAITING_CANDIDATE) {
      await this._handleCandidateInput(text);
      return;
    }

    if (this.state === VT_STATE.AWAITING_CONFIRMATION) {
      await this._handleConfirmationInput(text);
    }
  }

  async _handleCandidateInput(text) {
    const normalized = normalizeForIntent(text, this.language);

    if (!normalized) {
      return;
    }

    if (matchesAnyPattern(normalized, SKIP_PATTERNS)) {
      this._handleRejectedInput('VISUAL_SKIP_REJECTED');
      return;
    }

    if (matchesAnyPattern(normalized, UNKNOWN_PATTERNS)) {
      this._lockAnswerForRecording(pickText(this.language, 'bilmiyorum', "i don't know"), 'explicit_unknown');
      return;
    }

    if (matchesAnyPattern(normalized, NON_ANSWER_PATTERNS) || FILLER_ONLY_PHRASES.has(normalized)) {
      this._handleRejectedInput('NO_CLEAR_VISUAL_ANSWER');
      return;
    }

    const candidate = normalizeCandidateAnswer(text, this.language);
    if (!candidate || candidate.split(' ').length > 8 || FILLER_ONLY_PHRASES.has(candidate)) {
      this._handleRejectedInput('NO_CLEAR_VISUAL_ANSWER');
      return;
    }

    this.pendingAnswerCandidate = {
      imageIndex: this.currentImageIndex,
      userAnswer: candidate,
    };
    this.state = VT_STATE.AWAITING_CONFIRMATION;

    this.sendTextToLive(
      pickText(
        this.language,
        `VISUAL_TEST_CONFIRM: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} icin kullanicinin aday cevabi "${candidate}". Sonraki gorsele gecme. Sadece "${candidate}" olarak kaydedeyim mi? diye sor ve net evet/hayir cevabi bekle. "Atla" komutunu kabul etme; kullanici isterse "bilmiyorum" diyebilir.`,
        `VISUAL_TEST_CONFIRM: The candidate answer for image ${this.currentImageIndex + 1}/${this.testImages.length} is "${candidate}". Do not move to the next image. Ask only whether you should record "${candidate}" and wait for a clear yes/no answer. Do not accept skip commands; the user may say "I don't know".`
      )
    );
  }

  async _handleConfirmationInput(text) {
    const normalized = normalizeForIntent(text, this.language);

    if (!normalized) {
      return;
    }

    if (matchesAnyPattern(normalized, CONFIRM_YES_PATTERNS) && this.pendingAnswerCandidate) {
      this._lockAnswerForRecording(this.pendingAnswerCandidate.userAnswer, 'confirmed');
      return;
    }

    if (matchesAnyPattern(normalized, UNKNOWN_PATTERNS)) {
      this.pendingAnswerCandidate = null;
      this._lockAnswerForRecording(pickText(this.language, 'bilmiyorum', "i don't know"), 'explicit_unknown');
      return;
    }

    if (matchesAnyPattern(normalized, CONFIRM_NO_PATTERNS)) {
      this.pendingAnswerCandidate = null;
      this.state = VT_STATE.WAITING_CANDIDATE;
      this.sendTextToLive(
        pickText(
          this.language,
          `VISUAL_TEST_REASK: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} icin onceki cevap kaydedilmedi. Ayni gorselde kal ve kullanicidan sadece ne gordugunu tekrar soylemesini iste.`,
          `VISUAL_TEST_REASK: The previous answer for image ${this.currentImageIndex + 1}/${this.testImages.length} was not recorded. Stay on the same image and ask the user again what they see.`
        )
      );
      return;
    }

    if (matchesAnyPattern(normalized, SKIP_PATTERNS)) {
      this.pendingAnswerCandidate = null;
      this.state = VT_STATE.WAITING_CANDIDATE;
      this._handleRejectedInput('VISUAL_SKIP_REJECTED');
      return;
    }

    this.sendTextToLive(
      pickText(
        this.language,
        `VISUAL_TEST_CONFIRM_RETRY: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} icin sadece evet, hayir veya bilmiyorum turu net bir cevap iste. Sonraki gorsele gecme.`,
        `VISUAL_TEST_CONFIRM_RETRY: For image ${this.currentImageIndex + 1}/${this.testImages.length}, ask for a clear yes, no, or I don't know answer only. Do not move to the next image.`
      )
    );
  }

  _handleRejectedInput(reason) {
    const currentAttempts = (this.retryCountByImage.get(this.currentImageIndex) || 0) + 1;
    this.retryCountByImage.set(this.currentImageIndex, currentAttempts);
    this.pendingAnswerCandidate = null;
    this.state = VT_STATE.WAITING_CANDIDATE;

    const offerUnknown = currentAttempts >= MAX_INVALID_ATTEMPTS;
    this.sendTextToLive(
      pickText(
        this.language,
        offerUnknown
          ? `VISUAL_TEST_REPROMPT: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} icin "atla" gecersiz. Ayni gorselde kal. Kullaniciya sadece ne gordugunu soylemesini iste; goremiyorsa veya bilmiyorsa bunu acikca "bilmiyorum" diye belirtebilecegini soyle.`
          : `VISUAL_TEST_REPROMPT: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} henuz cevaplanmadi. Ayni gorselde kal. Kullaniciya sadece ne gordugunu soylemesini iste. "Atla" komutunu kabul etme.`,
        offerUnknown
          ? `VISUAL_TEST_REPROMPT: Skip is invalid for image ${this.currentImageIndex + 1}/${this.testImages.length}. Stay on the same image. Ask the user only what they see; if they truly cannot identify it, tell them they may clearly say "I don't know".`
          : `VISUAL_TEST_REPROMPT: Image ${this.currentImageIndex + 1}/${this.testImages.length} is still unanswered. Stay on the same image. Ask the user only what they see. Do not accept skip commands.`
      )
    );

    log.warn('Visual input rejected', {
      sessionId: this.sessionId,
      imageIndex: this.currentImageIndex,
      reason,
      attempts: currentAttempts,
    });
  }

  _lockAnswerForRecording(answerText, answerKind) {
    const imageConfig = this.testImages[this.currentImageIndex];
    this.pendingAnswerCandidate = null;
    this.readyToRecordAnswer = {
      imageIndex: this.currentImageIndex,
      imageId: `image_${this.currentImageIndex}`,
      userAnswer: answerText,
      correctAnswer: imageConfig.localizedCorrectAnswer,
      answerKind,
    };
    this.state = VT_STATE.READY_TO_RECORD;

    this.sendTextToLive(
      pickText(
        this.language,
        `VISUAL_TEST_RECORD_READY: Gorsel ${this.currentImageIndex + 1}/${this.testImages.length} icin kilitlenmis cevap "${answerText}". Simdi hemen record_visual_answer cagir. sessionId: "${this.sessionId}", imageIndex: ${this.currentImageIndex}, userAnswer: "${answerText}". Bu tool cagrisi olmadan sonraki gorsele veya submit_visual_recognition adimina gecme.`,
        `VISUAL_TEST_RECORD_READY: The locked answer for image ${this.currentImageIndex + 1}/${this.testImages.length} is "${answerText}". Call record_visual_answer immediately with sessionId: "${this.sessionId}", imageIndex: ${this.currentImageIndex}, userAnswer: "${answerText}". Do not move to the next image or submit_visual_recognition before this tool call.`
      )
    );
  }

  async recordAnswer(imageIndex, userAnswer) {
    const numericImageIndex = Number.isInteger(imageIndex)
      ? imageIndex
      : Number.parseInt(imageIndex, 10);
    const effectiveImageIndex = Number.isInteger(numericImageIndex)
      ? numericImageIndex
      : this.currentImageIndex;

    log.info('Visual record attempt', {
      sessionId: this.sessionId,
      state: this.state,
      currentImageIndex: this.currentImageIndex,
      effectiveImageIndex,
      llmUserAnswer: userAnswer,
      hasReadyAnswer: !!this.readyToRecordAnswer,
    });

    const existingAnswer = this.answers.find((answer) => answer.imageIndex === effectiveImageIndex);
    if (existingAnswer && effectiveImageIndex < this.currentImageIndex) {
      return this._buildDuplicateRecordResult(existingAnswer);
    }

    if (!this.isActive && !this.readyToRecordAnswer) {
      return {
        success: false,
        blocked: true,
        reason: 'VISUAL_TEST_INACTIVE',
        message: pickText(
          this.language,
          'Gorsel tanima testi aktif degil.',
          'Visual recognition test is not active.'
        ),
      };
    }

    if (effectiveImageIndex !== this.currentImageIndex) {
      return {
        success: false,
        blocked: true,
        reason: 'VISUAL_WRONG_IMAGE_ORDER',
        message: pickText(
          this.language,
          `Su anda gorsel ${this.currentImageIndex + 1}/${this.testImages.length} aktif. Baska bir gorselin cevabi kaydedilemez.`,
          `Image ${this.currentImageIndex + 1}/${this.testImages.length} is currently active. A different image cannot be recorded now.`
        ),
        currentImage: this.currentImageIndex + 1,
      };
    }

    if (!this.readyToRecordAnswer) {
      const reason =
        this.state === VT_STATE.AWAITING_CONFIRMATION
          ? 'AWAITING_VISUAL_CONFIRMATION'
          : 'NO_CONFIRMED_VISUAL_ANSWER';
      return {
        success: false,
        blocked: true,
        reason,
        message: pickText(
          this.language,
          this.state === VT_STATE.AWAITING_CONFIRMATION
            ? 'Cevap kilitlenmeden once net sesli onay alinmali.'
            : 'Bu gorsel icin henuz onaylanmis bir cevap yok. Once kullanicidan net cevap veya "bilmiyorum" alin.',
          this.state === VT_STATE.AWAITING_CONFIRMATION
            ? 'A clear spoken confirmation is required before recording this answer.'
            : 'There is no confirmed answer for this image yet. Get a clear answer or "I do not know" first.'
        ),
      };
    }

    const lockedAnswer = this.readyToRecordAnswer;
    if (lockedAnswer.imageIndex !== this.currentImageIndex) {
      return {
        success: false,
        blocked: true,
        reason: 'VISUAL_WRONG_IMAGE_ORDER',
        message: pickText(
          this.language,
          'Kilitli cevap aktif gorselle eslesmiyor. Ayni gorselde kalip tekrar dene.',
          'The locked answer does not match the active image. Stay on the same image and try again.'
        ),
      };
    }

    this._clearBufferedInput();
    this.answers.push({ ...lockedAnswer });
    this.readyToRecordAnswer = null;
    this.pendingAnswerCandidate = null;
    this.retryCountByImage.delete(this.currentImageIndex);

    this.sendToClient({
      type: 'visual_test_answer_recorded',
      imageIndex: lockedAnswer.imageIndex,
      answeredCount: this.answers.length,
      totalImages: this.testImages.length,
      answerKind: lockedAnswer.answerKind,
    });

    if (this.currentImageIndex + 1 < this.testImages.length) {
      await this._generateAndShowNextImage();
      return {
        success: true,
        message: pickText(
          this.language,
          `Gorsel ${lockedAnswer.imageIndex + 1} cevabi kaydedildi. Simdi gorsel ${this.currentImageIndex + 1}/${this.testImages.length} ekranda.`,
          `The answer for image ${lockedAnswer.imageIndex + 1} is recorded. Image ${this.currentImageIndex + 1}/${this.testImages.length} is now on screen.`
        ),
        currentImage: this.currentImageIndex + 1,
        totalImages: this.testImages.length,
        remainingImages: this.testImages.length - this.answers.length,
        recordedAnswer: lockedAnswer.userAnswer,
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
        `All ${this.testImages.length} images are answered. Now call submit_visual_recognition with sessionId: "${this.sessionId}", answers: ${JSON.stringify(answersForSubmit)}.`
      ),
      answers: answersForSubmit,
    };
  }

  _buildDuplicateRecordResult(existingAnswer) {
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
        answerKind: answer.answerKind || 'confirmed',
      }));
  }

  forceFinalize() {
    if (this.inputBufferTimeout) {
      clearTimeout(this.inputBufferTimeout);
      this._finalizeBufferedUserInput().catch((error) => {
        log.error('Visual forceFinalize hatasi', {
          sessionId: this.sessionId,
          error: error.message,
        });
      });
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
      hasPendingCandidate: !!this.pendingAnswerCandidate,
      hasReadyToRecordAnswer: !!this.readyToRecordAnswer,
    };
  }

  getSelectedKeywords() {
    return this.testImages;
  }

  destroy() {
    this._clearBufferedInput();
    this.isActive = false;
    this.pendingAnswerCandidate = null;
    this.readyToRecordAnswer = null;
    log.info('VisualTestAgent temizlendi', { sessionId: this.sessionId });
  }

  _clearBufferedInput() {
    if (this.inputBufferTimeout) {
      clearTimeout(this.inputBufferTimeout);
      this.inputBufferTimeout = null;
    }
    this.userInputBuffer = '';
  }
}

module.exports = { VisualTestAgent, VT_STATE };
