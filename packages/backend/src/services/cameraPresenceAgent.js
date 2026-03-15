/**
 * CameraPresenceAgent
 *
 * Test 4 sirasinda kullanicinin kamera kadrajinda olup olmadigini izler.
 * Ayrik bir ajan olarak calisir ve VideoAnalysisAgent'in sonucunu dinler.
 *
 * Gorevleri:
 * - Yuz kadrajdan kayboldugunda frontend'e uyari gondermek
 * - Live ajani nazik sekilde devreye sokmak
 * - Kadraja geri donus bilgisini paylasmak
 */

const { createLogger } = require('../lib/logger');
const { normalizeLanguage, pickText } = require('../lib/language');

const log = createLogger('CameraPresenceAgent');

class CameraPresenceAgent {
  constructor(sessionId, sendToClient, sendTextToLive, language = 'tr') {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.language = normalizeLanguage(language);

    this.isActive = false;
    this.missingStreak = 0;
    this.presentStreak = 0;
    this.alertActive = false;
    this.lastInterventionAt = 0;
    this.alertCount = 0;
    this.recoveryCount = 0;

    this.MISSING_THRESHOLD = 2;
    this.RECOVERY_THRESHOLD = 2;
    this.INTERVENTION_COOLDOWN_MS = 15000;

    log.info('CameraPresenceAgent olusturuldu', { sessionId });
  }

  startMonitoring() {
    this.isActive = true;
    this.missingStreak = 0;
    this.presentStreak = 0;
    this.alertActive = false;
    this.lastInterventionAt = 0;

    this.sendToClient({
      type: 'camera_presence_status',
      status: 'monitoring',
      level: 'info',
      message: pickText(this.language, 'Kamera kadraj takibi aktif.', 'Camera framing monitor is active.'),
    });

    log.info('Kamera kadraj takibi baslatildi', { sessionId: this.sessionId });
    return { success: true, message: pickText(this.language, 'Kamera kadraj takibi aktif.', 'Camera framing monitor is active.') };
  }

  stopMonitoring() {
    const summary = {
      activeDuration: this.isActive ? 'running' : 'stopped',
      alertCount: this.alertCount,
      recoveryCount: this.recoveryCount,
    };

    this.isActive = false;
    this.missingStreak = 0;
    this.presentStreak = 0;
    this.alertActive = false;

    this.sendToClient({
      type: 'camera_presence_status',
      status: 'stopped',
      level: 'info',
      message: pickText(this.language, 'Kamera kadraj takibi durduruldu.', 'Camera framing monitor is stopped.'),
    });

    log.info('Kamera kadraj takibi durduruldu', {
      sessionId: this.sessionId,
      alertCount: this.alertCount,
      recoveryCount: this.recoveryCount,
    });

    return summary;
  }

  observeAnalysis(analysis) {
    if (!this.isActive || !analysis) return;

    const isMissing = this._isFaceMissing(analysis);

    if (isMissing) {
      this.missingStreak += 1;
      this.presentStreak = 0;

      if (this.missingStreak >= this.MISSING_THRESHOLD) {
        this._handleMissing();
      }
      return;
    }

    this.presentStreak += 1;
    this.missingStreak = 0;

    if (this.alertActive && this.presentStreak >= this.RECOVERY_THRESHOLD) {
      this._handleRecovered();
    }
  }

  _handleMissing() {
    const now = Date.now();
    if (this.alertActive) return;
    if (now - this.lastInterventionAt < this.INTERVENTION_COOLDOWN_MS) return;

    this.alertActive = true;
    this.lastInterventionAt = now;
    this.alertCount += 1;

    this.sendToClient({
      type: 'camera_presence_alert',
      level: 'warning',
      message: pickText(
        this.language,
        'Kadrajdan cikmis gorunuyorsunuz. Lutfen kameraya geri donun.',
        'You seem out of frame. Please move back into camera view.'
      ),
    });

    // Kamera goruntusunu toparlamak icin merkezleme komutu.
    this.sendToClient({
      type: 'camera_command',
      command: 'center',
      reason: 'presence_alert',
    });

    this.sendTextToLive(
      pickText(
        this.language,
        'VIDEO_ANALYSIS: Kullanici bir suredir kadrajda gorunmuyor. Lutfen nazikce kameraya geri donmesini iste ve Test 4 akisina ondan sonra devam et.',
        'VIDEO_ANALYSIS: The user has been out of frame for a while. Kindly ask them to return to frame, then continue Test 4.'
      )
    );

    log.warn('Kamera kadraj kaybi algilandi, mudahale tetiklendi', {
      sessionId: this.sessionId,
      alertCount: this.alertCount,
    });
  }

  _handleRecovered() {
    this.alertActive = false;
    this.recoveryCount += 1;

    this.sendToClient({
      type: 'camera_presence_recovered',
      level: 'info',
      message: pickText(this.language, 'Tekrar kadrajdasiniz. Teste devam edebiliriz.', 'You are back in frame. We can continue the test.'),
    });

    this.sendTextToLive(
      pickText(
        this.language,
        'VIDEO_ANALYSIS: Kullanici tekrar kadrajda. Test akisina devam edebilirsin.',
        'VIDEO_ANALYSIS: The user is back in frame. You can continue the test flow.'
      )
    );

    log.info('Kamera kadrajina geri donus algilandi', {
      sessionId: this.sessionId,
      recoveryCount: this.recoveryCount,
    });
  }

  _isFaceMissing(analysis) {
    const textBlob = [
      analysis.facialExpression || '',
      analysis.eyeContact || '',
      analysis.attentionLevel || '',
      analysis.summary || '',
      Array.isArray(analysis.observations) ? analysis.observations.join(' ') : '',
    ]
      .join(' ')
      .toLowerCase();

    const missingPatterns = [
      'yuz tespit edilemedi',
      'yüz tespit edilemedi',
      'face not detected',
      'kamera disinda',
      'kadraj disi',
      'kadraj dışı',
      'goruntu belirsiz',
      'görüntü belirsiz',
    ];

    if (missingPatterns.some((p) => textBlob.includes(p))) {
      return true;
    }

    const eyeUnknown =
      typeof analysis.eyeContact === 'string' &&
      (
        analysis.eyeContact.toLowerCase().includes('tespit edilemedi') ||
        analysis.eyeContact.toLowerCase().includes('not detected')
      );
    const expressionUnknown =
      ['belirsiz', 'unknown'].includes((analysis.facialExpression || '').toLowerCase());
    const attentionUnknown = ['belirsiz', 'unknown'].includes((analysis.attentionLevel || '').toLowerCase());
    const lowConfidence = Number(analysis.confidence || 0) <= 0.35;

    if (expressionUnknown && eyeUnknown) return true;
    if (attentionUnknown && eyeUnknown && lowConfidence) return true;
    if (expressionUnknown && lowConfidence && analysis.summary?.toLowerCase().includes('tespit')) return true;

    return false;
  }

  destroy() {
    this.isActive = false;
    log.info('CameraPresenceAgent temizlendi', {
      sessionId: this.sessionId,
      alertCount: this.alertCount,
      recoveryCount: this.recoveryCount,
    });
  }
}

module.exports = { CameraPresenceAgent };
