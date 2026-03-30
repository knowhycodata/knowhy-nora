/**
 * Story Prefetch Agent - Asenkron Hikaye Ön-Üretim Ajanı
 * 
 * BUG-011 FIX: Her session başladığında arka planda çalışarak
 * Test 2 için benzersiz bir hikaye hazırlar. Kullanıcı beklemez.
 * 
 * 2-aşamalı mimari:
 *   Aşama 1 (Meta-Prompt Ajanı): Gemini Flash Lite'a "Alzheimer taraması
 *            için benzersiz bir hikaye konusu/sahne öner" diye sorar.
 *   Aşama 2 (Hikaye Ajanı): Aşama 1'den gelen konuyu kullanarak
 *            tam hikaye üretir.
 * 
 * Sonuç session bazlı cache'lenir.
 * generate_story tool call geldiğinde cache'ten anında döner.
 */

const { GoogleGenAI } = require('@google/genai');
const { createLogger } = require('../lib/logger');
const { normalizeLanguage, isEnglish } = require('../lib/language');
const { generateStory } = require('./storyGenerator');

const log = createLogger('StoryPrefetchAgent');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const META_PROMPT_MODEL = process.env.GEMINI_META_PROMPT_MODEL || 'gemini-3.1-flash-lite-preview';
const STORY_MODEL = process.env.GEMINI_STORY_MODEL || 'gemini-3.1-flash-lite-preview';

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

// Session bazlı hikaye cache'i
const storyCache = new Map(); // sessionId -> { story, source, model, language, ready: boolean }

const META_PROMPT_TR = `Sen yaratici bir senaryo yazarisin.

GOREV: Alzheimer / bilissel tarama testi icin kullanilacak KISA bir hikaye icin KONU ve AKIS oner.

KURALLAR:
- Turkce yaz.
- Gunluk yasamdan SOMUT bir sahne sec (market, park, okul, hastane, ciftlik, sahil, kutuphane, atölye, restoran vb.).
- En az 2 FARKLI Turk ismi sec (ornegin: Ayse, Kemal, Elif, Murat, Zehra vb. — her seferinde FARKLI isimler kullan).
- En az 1 mekan belirt.
- En az 3 somut nesne veya eylem listele (yemek, alisveris, yuruyus, bahce isleri vb.).
- Zaman akisi oner (sabah -> ogle -> aksam gibi).
- Sadece konu ve akisi yaz, hikayeyi YAZMA. Kisa ve oz tut (3-5 satir).
- Her seferinde TAMAMEN FARKLI ve BENZERSIZ bir konu sec. Tekrar etme.

ORNEK FORMAT (bunu kopyalama, yeni konu uret):
"Konu: Balikci kasabasinda bir gun. Karakterler: Tuncay ve Ferhat. Mekan: Liman ve balik pazari. Eylemler: Sabah teknesiyle denize acilma, ogle balik tutma, aksam limanda balik satma. Nesneler: tekne, ag, balik, cay."

Simdi tamamen yeni ve benzersiz bir konu oner:`;

const META_PROMPT_EN = `You are a creative scenario writer.

TASK: Suggest a TOPIC and FLOW for a SHORT story to be used in Alzheimer/cognitive screening tests.

RULES:
- Write in English.
- Choose a CONCRETE everyday scene (grocery, park, school, hospital, farm, beach, library, workshop, restaurant, etc.).
- Pick at least 2 DIFFERENT person names (e.g., Emma, James, Sophie, Lucas — use DIFFERENT names each time).
- Mention at least 1 place.
- List at least 3 concrete objects or actions.
- Suggest a timeline (morning -> noon -> evening).
- Write ONLY the topic and flow, do NOT write the actual story. Keep it brief (3-5 lines).
- Choose a COMPLETELY DIFFERENT and UNIQUE topic every time. Do not repeat.

Now suggest a brand-new unique topic:`;

function getMetaPrompt(language) {
  return isEnglish(language) ? META_PROMPT_EN : META_PROMPT_TR;
}

function buildStoryPromptFromMeta(metaResult, language) {
  const isEn = isEnglish(language);
  if (isEn) {
    return `You are a story writer for a cognitive screening system.

TASK: Write a SHORT story (5-7 sentences) based on the following topic and flow. The story will be used in an Alzheimer screening recall test.

TOPIC/FLOW:
${metaResult}

RULES:
- Write in English.
- 5-7 sentences, not too short or too long.
- Use the characters, place, objects and timeline from the topic above.
- Simple and clear sentences. Warm and positive tone.
- Return ONLY the story text. No commentary. No quotes.

Write the story now:`;
  }
  return `Sen bir bilissel tarama sistemi icin hikaye ureten bir asistansin.

GOREV: Asagidaki konu ve akisa dayanarak KISA bir hikaye yaz (5-7 cumle). Bu hikaye Alzheimer tarama testinde kullanilacak.

KONU/AKIS:
${metaResult}

KURALLAR:
- Turkce yaz.
- 5-7 cumle uzunlugunda olmali.
- Yukaridaki konudaki karakterleri, mekani, nesneleri ve zaman akisini kullan.
- Basit ve anlasilir cumleler. Sicak ve pozitif ton.
- Sadece hikaye metnini dondur. Aciklama ekleme. Tirnak isareti kullanma.

Simdi hikayeyi yaz:`;
}

/**
 * Session başladığında çağrılır — ASENKRON, await edilmez.
 * Arka planda 2 aşamalı hikaye üretimi yapar ve cache'ler.
 */
async function prefetchStory(sessionId, language = 'tr') {
  const lang = normalizeLanguage(language);
  
  // Cache'te zaten varsa veya üretim devam ediyorsa tekrar başlatma
  if (storyCache.has(sessionId)) {
    log.info('Prefetch zaten mevcut/devam ediyor, atlanıyor', { sessionId });
    return;
  }

  // Placeholder koy — üretim devam ediyor
  storyCache.set(sessionId, { story: null, source: null, model: null, language: lang, ready: false });

  log.info('Hikaye ön-üretim başlıyor (2 aşamalı)', { sessionId, language: lang });

  try {
    // ── AŞAMA 1: Meta-Prompt Ajanı ──
    const metaPrompt = getMetaPrompt(lang);
    log.info('Aşama 1: Meta-prompt ajanı çalışıyor', { sessionId, model: META_PROMPT_MODEL });

    const metaResponse = await ai.models.generateContent({
      model: META_PROMPT_MODEL,
      contents: metaPrompt,
      config: {
        temperature: 1.2,
        topP: 0.95,
        topK: 50,
        maxOutputTokens: 256,
      },
    });

    const metaText = metaResponse?.text?.trim();

    if (!metaText || metaText.length < 20) {
      log.warn('Meta-prompt ajanı geçersiz çıktı, doğrudan hikaye üretimine geçiliyor', { sessionId });
      await _fallbackGenerate(sessionId, lang);
      return;
    }

    log.info('Aşama 1 tamamlandı — konu alındı', {
      sessionId,
      preview: metaText.substring(0, 100),
    });

    // ── AŞAMA 2: Hikaye Ajanı ──
    const storyPrompt = buildStoryPromptFromMeta(metaText, lang);
    log.info('Aşama 2: Hikaye ajanı çalışıyor', { sessionId, model: STORY_MODEL });

    const storyResponse = await ai.models.generateContent({
      model: STORY_MODEL,
      contents: storyPrompt,
      config: {
        temperature: 1.0,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 512,
      },
    });

    const storyText = storyResponse?.text?.trim();

    if (storyText && storyText.length > 50 && storyText.length < 1000) {
      const cleanStory = storyText.replace(/^["'"""]+|["'"""]+$/g, '').trim();

      storyCache.set(sessionId, {
        story: cleanStory,
        source: 'ai_prefetch',
        model: `${META_PROMPT_MODEL}+${STORY_MODEL}`,
        language: lang,
        ready: true,
      });

      log.info('Hikaye ön-üretim tamamlandı (2 aşamalı)', {
        sessionId,
        length: cleanStory.length,
        preview: cleanStory.substring(0, 80),
      });
      return;
    }

    log.warn('Aşama 2 geçersiz çıktı, fallback kullanılıyor', { sessionId });
    await _fallbackGenerate(sessionId, lang);
  } catch (error) {
    log.error('Hikaye ön-üretim hatası, fallback kullanılıyor', {
      sessionId,
      error: error.message,
    });
    await _fallbackGenerate(sessionId, lang);
  }
}

/**
 * 2-aşamalı üretim başarısız olursa mevcut generateStory'yi kullan
 */
async function _fallbackGenerate(sessionId, language) {
  try {
    const result = await generateStory(language);
    storyCache.set(sessionId, {
      story: result.story,
      source: result.source === 'ai' ? 'ai_prefetch_fallback' : 'fallback_prefetch',
      model: result.model || 'fallback',
      language,
      ready: true,
    });
    log.info('Fallback hikaye ön-üretim tamamlandı', {
      sessionId,
      source: result.source,
      length: result.story.length,
    });
  } catch (err) {
    log.error('Fallback hikaye ön-üretim de başarısız', { sessionId, error: err.message });
    // Cache'i temizle — generate_story normal akışa devam edecek
    storyCache.delete(sessionId);
  }
}

/**
 * Cache'ten hikaye al. Hazırsa döner, değilse null.
 */
function consumePrefetchedStory(sessionId) {
  const cached = storyCache.get(sessionId);
  if (!cached) return null;
  if (!cached.ready || !cached.story) return null;

  // Cache'ten al ve temizle (tek kullanımlık)
  storyCache.delete(sessionId);
  log.info('Ön-üretilmiş hikaye cache\'ten alındı', {
    sessionId,
    source: cached.source,
    length: cached.story.length,
  });
  return cached;
}

/**
 * Session sonlandığında cache'i temizle
 */
function clearPrefetchCache(sessionId) {
  if (storyCache.has(sessionId)) {
    storyCache.delete(sessionId);
    log.info('Prefetch cache temizlendi', { sessionId });
  }
}

module.exports = {
  prefetchStory,
  consumePrefetchedStory,
  clearPrefetchCache,
};
