/**
 * Video Analysis Agent - Kamera Görüntüsü Analiz Ajanı
 * 
 * Test 4 (Yönelim) sırasında kullanıcının kamera görüntüsünü analiz eder:
 * - Mimik analizi (yüz ifadeleri)
 * - Göz hareketi takibi
 * - Genel davranış gözlemi (dikkat, odaklanma, kararsızlık)
 * - Kamera yönlendirme komutları (yakınlaş, uzaklaş, ortala)
 * 
 * Mimari:
 *   Frontend (kamera) → WS → Backend → Gemini Vision API → Analiz sonucu
 *   Ajan → send_camera_command → Frontend (kamera kontrolü)
 * 
 * NOT: Analiz sonuçları LLM'e gönderilmez, backend'de kaydedilir.
 * Sadece özet metinler Nöra'ya iletilir.
 */

const { GoogleGenAI } = require('@google/genai');
const { createLogger } = require('../lib/logger');
const { normalizeLanguage, pickText, isEnglish } = require('../lib/language');

const log = createLogger('VideoAnalysisAgent');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

/**
 * Video frame analiz prompt'u
 */
const ANALYSIS_PROMPT_TR = `Sen bir bilişsel tarama asistanının görüntü analiz modülüsün.
Kullanıcının kamera görüntüsünden aşağıdakileri analiz et:

1. YÜZ İFADESİ: Kullanıcının genel yüz ifadesi (rahat, gergin, endişeli, kararsız, düşünceli, mutlu, şaşkın vb.)
2. GÖZ HAREKETLERİ: Göz teması durumu (kameraya bakıyor mu, başka yere mi bakıyor, gözler kayıyor mu)
3. DİKKAT DÜZEYİ: Kullanıcı odaklanmış mı, dağınık mı, yorgun mu görünüyor
4. GENEL GÖZLEM: Başka dikkat çekici bir davranış var mı (baş eğme, el hareketleri vb.)

SADECE JSON formatında yanıt ver:
{
  "facialExpression": "ifade_türü",
  "eyeContact": "durum",
  "attentionLevel": "yüksek|orta|düşük",
  "confidence": 0.0-1.0,
  "observations": ["gözlem1", "gözlem2"],
  "summary": "Tek cümlelik özet"
}

Eğer yüz görünmüyorsa veya görüntü belirsizse:
{
  "facialExpression": "belirsiz",
  "eyeContact": "tespit edilemedi",
  "attentionLevel": "belirsiz",
  "confidence": 0.0,
  "observations": ["Yüz tespit edilemedi"],
  "summary": "Görüntüde yüz tespit edilemedi",
  "cameraCommand": "center"
}`;

const ANALYSIS_PROMPT_EN = `You are a visual analysis module for a cognitive screening assistant.
Analyze the user's camera frame and provide:

1. FACIAL_EXPRESSION: overall expression (relaxed, stressed, anxious, indecisive, thoughtful, happy, surprised, etc.)
2. EYE_CONTACT: whether user is looking at the camera or away
3. ATTENTION_LEVEL: high | medium | low | unknown
4. OBSERVATIONS: notable behavior cues (head tilt, hand movement, uncertainty)

Respond strictly as JSON:
{
  "facialExpression": "expression_type",
  "eyeContact": "status",
  "attentionLevel": "high|medium|low|unknown",
  "confidence": 0.0-1.0,
  "observations": ["obs1", "obs2"],
  "summary": "One-sentence summary"
}

If face is not visible or frame is unclear:
{
  "facialExpression": "unknown",
  "eyeContact": "not detected",
  "attentionLevel": "unknown",
  "confidence": 0.0,
  "observations": ["Face not detected"],
  "summary": "No face detected in the frame",
  "cameraCommand": "center"
}`;

class VideoAnalysisAgent {
  constructor(sessionId, sendToClient, sendTextToLive, language = 'tr') {
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.sendTextToLive = sendTextToLive;
    this.language = normalizeLanguage(language);
    
    // Analiz state
    this.isActive = false;
    this.analysisResults = [];
    this.frameCount = 0;
    this.lastAnalysisTime = 0;
    this.ANALYSIS_INTERVAL_MS = 5000; // Her 5 saniyede bir analiz
    this.MAX_ANALYSES = 20; // Maksimum analiz sayısı
    
    // Kamera durumu
    this.cameraActive = false;
    this.currentZoom = 1.0;
    
    log.info('VideoAnalysisAgent oluşturuldu', { sessionId, language: this.language });
  }

  /**
   * Video analizi başlat (Test 4 başlangıcında)
   */
  startAnalysis() {
    this.isActive = true;
    this.analysisResults = [];
    this.frameCount = 0;
    this.lastAnalysisTime = 0;
    
    log.info('Video analizi başlatıldı', { sessionId: this.sessionId });
    
    // Frontend'e kamera açma komutu gönder
    this.sendToClient({
      type: 'camera_command',
      command: 'start',
      message: pickText(
        this.language,
        'Kameranizi acmaniz gerekiyor. Lutfen izin verin.',
        'Please enable your camera and grant permission.'
      ),
    });
    
    return {
      success: true,
      message: pickText(
        this.language,
        'Video analizi baslatildi. Kullanicinin kamerasi aciliyor.',
        'Video analysis started. User camera is opening.'
      ),
    };
  }

  /**
   * Video analizi durdur
   */
  stopAnalysis() {
    this.isActive = false;
    
    log.info('Video analizi durduruldu', { 
      sessionId: this.sessionId, 
      totalAnalyses: this.analysisResults.length 
    });
    
    // Frontend'e kamera kapatma komutu gönder
    this.sendToClient({
      type: 'camera_command',
      command: 'stop',
    });
    
    // Özet oluştur
    const summary = this._generateSummary();
    
    return {
      success: true,
      totalAnalyses: this.analysisResults.length,
      summary,
      analyses: this.analysisResults,
    };
  }

  /**
   * Frontend'den gelen video frame'i analiz et
   * @param {string} frameBase64 - Base64 encoded JPEG frame
   */
  async analyzeFrame(frameBase64) {
    if (!this.isActive) return null;
    
    const now = Date.now();
    if (now - this.lastAnalysisTime < this.ANALYSIS_INTERVAL_MS) {
      return null; // Çok sık analiz yapma
    }
    
    if (this.analysisResults.length >= this.MAX_ANALYSES) {
      log.info('Maksimum analiz sayısına ulaşıldı', { sessionId: this.sessionId });
      return null;
    }
    
    this.lastAnalysisTime = now;
    this.frameCount++;
    
    try {
      log.info('Frame analiz ediliyor', { 
        sessionId: this.sessionId, 
        frameNum: this.frameCount,
        dataSize: frameBase64.length 
      });

      const result = await ai.models.generateContent({
        model: VISION_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: isEnglish(this.language) ? ANALYSIS_PROMPT_EN : ANALYSIS_PROMPT_TR },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: frameBase64,
                },
              },
            ],
          },
        ],
        config: {
          temperature: 0.1,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const responseText = result.text || '';
      let analysis;
      
      try {
        // JSON parse et
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('JSON bulunamadı');
        }
      } catch (parseError) {
        log.warn('Analiz JSON parse hatası', { 
          sessionId: this.sessionId, 
          response: responseText.substring(0, 200) 
        });
        analysis = {
          facialExpression: pickText(this.language, 'belirsiz', 'unknown'),
          eyeContact: pickText(this.language, 'tespit edilemedi', 'not detected'),
          attentionLevel: pickText(this.language, 'belirsiz', 'unknown'),
          confidence: 0,
          observations: [pickText(this.language, 'Analiz sonucu parse edilemedi', 'Analysis response could not be parsed')],
          summary: pickText(this.language, 'Goruntu analizi tamamlanamadi', 'Image analysis could not be completed'),
        };
      }

      // Timestamp ekle
      analysis.timestamp = now;
      analysis.frameNumber = this.frameCount;
      
      this.analysisResults.push(analysis);
      
      log.info('Frame analiz tamamlandı', { 
        sessionId: this.sessionId, 
        expression: analysis.facialExpression,
        attention: analysis.attentionLevel,
        confidence: analysis.confidence 
      });

      // Frontend'e analiz sonucunu gönder (görsel overlay için)
      this.sendToClient({
        type: 'video_analysis_result',
        analysis: {
          facialExpression: analysis.facialExpression,
          eyeContact: analysis.eyeContact,
          attentionLevel: analysis.attentionLevel,
          confidence: analysis.confidence,
          summary: analysis.summary,
        },
      });

      // Kamera komutu varsa frontend'e gönder
      if (analysis.cameraCommand) {
        this.sendCameraCommand(analysis.cameraCommand);
      }

      // Dikkat düşükse Nöra'ya bildir
      const normalizedAttention = this._normalizeAttentionLevel(analysis.attentionLevel);
      if (normalizedAttention === 'low' && analysis.confidence > 0.6) {
        this.sendTextToLive(
          pickText(
            this.language,
            `VIDEO_ANALYSIS: Kullanicinin dikkati dusuk gorunuyor. Gozlem: ${analysis.summary}. Kullaniciyi nazikce tesvik et veya dikkatini toplamak icin kisa bir mola oner.`,
            `VIDEO_ANALYSIS: The user's attention appears low. Observation: ${analysis.summary}. Encourage the user gently or suggest a short refocus break.`
          )
        );
      }

      return analysis;
    } catch (error) {
      log.error('Frame analiz hatası', { 
        sessionId: this.sessionId, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Kamera yönlendirme komutu gönder
   * @param {string} command - 'zoom_in' | 'zoom_out' | 'center' | 'start' | 'stop'
   * @param {object} params - Ek parametreler (zoom level vb.)
   */
  sendCameraCommand(command, params = {}) {
    const validCommands = ['zoom_in', 'zoom_out', 'center', 'start', 'stop'];
    
    if (!validCommands.includes(command)) {
      log.warn('Geçersiz kamera komutu', { command, sessionId: this.sessionId });
      return {
        success: false,
        message: pickText(
          this.language,
          `Gecersiz kamera komutu: ${command}`,
          `Invalid camera command: ${command}`
        ),
      };
    }

    // Zoom seviyesini güncelle
    if (command === 'zoom_in') {
      this.currentZoom = Math.min(3.0, this.currentZoom + (params.step || 0.5));
    } else if (command === 'zoom_out') {
      this.currentZoom = Math.max(1.0, this.currentZoom - (params.step || 0.5));
    } else if (command === 'center') {
      this.currentZoom = 1.0;
    }

    log.info('Kamera komutu gönderiliyor', { 
      sessionId: this.sessionId, 
      command, 
      zoom: this.currentZoom 
    });

    this.sendToClient({
      type: 'camera_command',
      command,
      zoom: this.currentZoom,
      params,
    });

    return { 
      success: true, 
      command, 
      currentZoom: this.currentZoom,
      message: pickText(
        this.language,
        `Kamera komutu uygulandi: ${command}`,
        `Camera command applied: ${command}`
      ),
    };
  }

  /**
   * Analiz sonuçlarından özet rapor oluştur
   */
  _generateSummary() {
    if (this.analysisResults.length === 0) {
      return {
        overallAttention: pickText(this.language, 'veri yok', 'no data'),
        dominantExpression: pickText(this.language, 'veri yok', 'no data'),
        eyeContactRate: 0,
        observations: [],
        riskIndicators: [],
      };
    }

    // Dikkat seviyeleri
    const attentionCounts = { high: 0, medium: 0, low: 0, unknown: 0 };
    const expressions = {};
    let eyeContactPositive = 0;
    const allObservations = [];

    for (const r of this.analysisResults) {
      // Dikkat
      const attn = this._normalizeAttentionLevel(r.attentionLevel);
      attentionCounts[attn] = (attentionCounts[attn] || 0) + 1;

      // Yüz ifadesi
      const expr = (r.facialExpression || pickText(this.language, 'belirsiz', 'unknown')).toLowerCase();
      expressions[expr] = (expressions[expr] || 0) + 1;

      // Göz teması
      const eyeText = (r.eyeContact || '').toLowerCase();
      if (eyeText.includes('bakıyor') || eyeText.includes('bakiyor') || eyeText.includes('looking') || eyeText.includes('camera')) {
        eyeContactPositive++;
      }

      // Gözlemler
      if (r.observations) {
        allObservations.push(...r.observations);
      }
    }

    const total = this.analysisResults.length;
    
    // Baskın dikkat seviyesi
    const overallAttention = Object.entries(attentionCounts)
      .sort(([,a], [,b]) => b - a)[0][0];

    // Baskın ifade
    const dominantExpression = Object.entries(expressions)
      .sort(([,a], [,b]) => b - a)[0][0];

    // Göz teması oranı
    const eyeContactRate = Math.round((eyeContactPositive / total) * 100);

    // Risk göstergeleri
    const riskIndicators = [];
    if (attentionCounts.low / total > 0.4) {
      riskIndicators.push(
        pickText(this.language, 'Sik dikkat dagilmasi gozlemlendi', 'Frequent attention drop observed')
      );
    }
    if (eyeContactRate < 30) {
      riskIndicators.push(
        pickText(this.language, 'Dusuk goz temasi orani', 'Low eye contact rate')
      );
    }
    if (expressions['kararsız'] && expressions['kararsız'] / total > 0.3) {
      riskIndicators.push(
        pickText(this.language, 'Sik kararsizlik ifadesi', 'Frequent indecisive expression')
      );
    }
    if ((expressions['endişeli'] && expressions['endişeli'] / total > 0.3) || (expressions.anxious && expressions.anxious / total > 0.3)) {
      riskIndicators.push(
        pickText(this.language, 'Endiseli gorunum', 'Anxious appearance')
      );
    }

    return {
      overallAttention,
      dominantExpression,
      eyeContactRate,
      attentionBreakdown: attentionCounts,
      expressionBreakdown: expressions,
      totalFramesAnalyzed: total,
      observations: [...new Set(allObservations)].slice(0, 10),
      riskIndicators,
    };
  }

  _normalizeAttentionLevel(value) {
    const text = String(value || '').toLowerCase();
    if (text.includes('yüksek') || text.includes('yuksek') || text === 'high') return 'high';
    if (text.includes('orta') || text === 'medium') return 'medium';
    if (text.includes('düşük') || text.includes('dusuk') || text === 'low') return 'low';
    return 'unknown';
  }

  /**
   * Temizlik
   */
  destroy() {
    this.isActive = false;
    log.info('VideoAnalysisAgent temizlendi', { 
      sessionId: this.sessionId,
      totalAnalyses: this.analysisResults.length 
    });
  }
}

module.exports = { VideoAnalysisAgent };
