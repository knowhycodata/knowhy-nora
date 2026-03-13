/**
 * Image Generator Service - Imagen 4 API
 * 
 * Google Imagen 4 Fast ile görsel üretir.
 * generateImages() API'sini kullanır (generateContent değil!).
 * Ayrı API key ile kota ayrımı sağlar.
 * 
 * Multi-Agent Yapısı:
 *   Coordinator (Nöra Live) → PromptBuilder → ImageGenerator (Imagen 4) → ResultPresenter
 */

const { GoogleGenAI } = require('@google/genai');
const { createLogger } = require('../lib/logger');

const log = createLogger('ImageGenerator');

// Görsel üretim için ayrı istemci — farklı API key ile kota ayrımı
const IMAGE_API_KEY = process.env.GEMINI_IMAGE_API_KEY || process.env.GOOGLE_API_KEY;
const IMAGEN_MODEL = process.env.IMAGEN_MODEL || 'imagen-4.0-fast-generate-001';
const imageGenAI = new GoogleGenAI({ apiKey: IMAGE_API_KEY });

log.info('ImageGenerator initialized', { 
  model: IMAGEN_MODEL,
  usingDedicatedKey: !!process.env.GEMINI_IMAGE_API_KEY,
  keyPrefix: IMAGE_API_KEY?.substring(0, 12) + '...',
});

// Türkçe → İngilizce prompt mapping (kota tasarrufu — API çağrısı yok)
const SUBJECT_PROMPTS = {
  'saat': 'A simple, clean, highly recognizable analog clock face centered on a pure white background. Minimalist studio photography style, soft even lighting, no shadows, no text.',
  'anahtar': 'A single classic metal key, clean and simple, centered on a pure white background. Minimalist studio photography style, soft even lighting, sharp focus, no shadows, no text.',
  'kalem': 'A single wooden pencil, clean and simple, centered on a pure white background. Minimalist studio photography style, soft even lighting, sharp detail, no shadows, no text.',
  'kedi': 'A cute simple cat sitting, centered on a pure white background. Minimalist illustration style, clean lines, soft colors, no text.',
  'ağaç': 'A simple green tree, centered on a pure white background. Minimalist illustration style, clean shape, soft colors, no text.',
  'ev': 'A simple house with a door and windows, centered on a pure white background. Minimalist illustration style, clean lines, no text.',
  'araba': 'A simple car, side view, centered on a pure white background. Minimalist illustration style, clean lines, bright colors, no text.',
  'çiçek': 'A single colorful flower, centered on a pure white background. Minimalist illustration style, clean petals, no text.',
  'yıldız': 'A simple five-pointed star, centered on a pure white background. Minimalist design, clean edges, golden color, no text.',
  'kitap': 'A single closed book, centered on a pure white background. Minimalist studio photography style, soft lighting, no text.',
};

/**
 * Retry helper - exponential backoff ile yeniden deneme
 */
async function retryWithBackoff(fn, { maxRetries = 2, baseDelay = 2000, label = '' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      const isRetryable = error.status === 429 || error.status >= 500;
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      log.warn(`${label} Retry ${attempt + 1}/${maxRetries}`, { 
        status: error.status, 
        delay: Math.round(delay),
        error: error.message?.substring(0, 100),
      });
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Multi-Agent Orchestrator — Imagen 4 Pipeline
 *   Step 1: Prompt oluştur (sabit mapping, API çağrısı yok)
 *   Step 2: Imagen 4 generateImages() ile görsel üret
 *   Step 3: Sonucu formatla
 */
class ImageGenerationPipeline {
  constructor() {
    this.state = {};
  }

  /**
   * Sub-Agent 1: Prompt Builder (API çağrısı yapmaz, kota tüketmez)
   */
  buildPrompt(userRequest) {
    const lowerReq = userRequest.toLowerCase();
    for (const [key, prompt] of Object.entries(SUBJECT_PROMPTS)) {
      if (lowerReq.includes(key)) {
        log.info('PromptBuilder: matched subject', { subject: key });
        this.state.refinedPrompt = prompt;
        this.state.userRequest = userRequest;
        return prompt;
      }
    }
    
    const fallbackPrompt = `A simple, clean, highly recognizable image of "${userRequest}". Centered on a pure white background. Minimalist style, soft lighting, no text, no shadows.`;
    log.info('PromptBuilder: generic prompt', { prompt: fallbackPrompt.substring(0, 100) });
    this.state.refinedPrompt = fallbackPrompt;
    this.state.userRequest = userRequest;
    return fallbackPrompt;
  }

  /**
   * Sub-Agent 2: Image Generator — Imagen 4 generateImages API
   * generateContent() DEĞİL, generateImages() kullanır!
   */
  async generateImage(prompt, options = {}) {
    const aspectRatio = options.aspectRatio || '1:1';

    log.info('Imagen 4 generateImages starting', { model: IMAGEN_MODEL, aspectRatio });

    try {
      const result = await retryWithBackoff(
        async () => {
          const response = await imageGenAI.models.generateImages({
            model: IMAGEN_MODEL,
            prompt,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/jpeg',
              aspectRatio,
            },
          });

          log.info('Imagen response received', { 
            model: IMAGEN_MODEL,
            generatedImages: response.generatedImages?.length || 0,
          });

          if (!response.generatedImages || response.generatedImages.length === 0) {
            throw new Error('No images returned from Imagen API');
          }

          const generatedImage = response.generatedImages[0];
          const imageBytes = generatedImage.image.imageBytes;

          if (!imageBytes) {
            throw new Error('Image bytes empty in Imagen response');
          }

          const imageData = {
            data: imageBytes, // zaten base64 string
            mimeType: 'image/jpeg',
          };

          log.info('Imagen image data extracted', { 
            dataLength: imageBytes.length,
            mimeType: 'image/jpeg',
          });

          return { imageData, textResponse: null };
        },
        { maxRetries: 2, baseDelay: 3000, label: `[${IMAGEN_MODEL}]` }
      );

      this.state.imageData = result.imageData;
      this.state.textResponse = result.textResponse;
      log.info('Image generation SUCCESS', { model: IMAGEN_MODEL, dataLength: result.imageData?.data?.length || 0 });
      return result;
    } catch (error) {
      log.error('Imagen generation FAILED', { 
        model: IMAGEN_MODEL,
        status: error.status, 
        error: error.message?.substring(0, 200),
      });
      this.state.imageData = null;
      this.state.textResponse = null;
      return { imageData: null, textResponse: null };
    }
  }

  /**
   * Sub-Agent 3: Result Presenter
   */
  formatResult() {
    return {
      success: !!this.state.imageData,
      userRequest: this.state.userRequest,
      refinedPrompt: this.state.refinedPrompt,
      image: this.state.imageData,
      description: this.state.textResponse,
    };
  }

  /**
   * Pipeline'ı çalıştırır
   */
  async run(userRequest, options = {}) {
    this.state = {};
    const prompt = this.buildPrompt(userRequest);
    await this.generateImage(prompt, options);
    return this.formatResult();
  }
}

let pipelineInstance = null;

function getImagePipeline() {
  if (!pipelineInstance) {
    pipelineInstance = new ImageGenerationPipeline();
  }
  return pipelineInstance;
}

module.exports = {
  ImageGenerationPipeline,
  getImagePipeline,
};
