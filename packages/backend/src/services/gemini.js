const { GoogleGenAI } = require('@google/genai');

/**
 * Gemini Live API Tool Calling Yapılandırması
 * 
 * Ajan, kullanıcıyla sesli/görsel etkileşim kurar ve bilişsel testleri yönetir.
 * Test verilerini topladıktan sonra Tool Calling ile backend endpoint'lerine gönderir.
 * 
 * ÖNEMLİ: Hesaplamalar asla LLM tarafından yapılmaz.
 * Ajan sadece veri toplar, backend skorlama yapar.
 */

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
const VOICE_NAME = process.env.LIVE_VOICE_NAME || 'Puck';

// Gemini'ye tanıtılacak tool/function tanımları
const cognitiveTestTools = [
  {
    name: 'submit_verbal_fluency',
    description:
      'Sözel akıcılık testinin sonuçlarını backend\'e gönderir. Kullanıcının 60 saniye içinde belirli bir harfle başlayan kelimeleri saymasından sonra çağrılır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Aktif test oturumunun ID\'si',
        },
        words: {
          type: 'array',
          items: { type: 'string' },
          description: 'Kullanıcının söylediği kelimelerin listesi',
        },
        targetLetter: {
          type: 'string',
          description: 'Hedef harf (örn: P)',
        },
        durationSeconds: {
          type: 'number',
          description: 'Testin sürdüğü süre (saniye)',
        },
      },
      required: ['sessionId', 'words', 'targetLetter', 'durationSeconds'],
    },
  },
  {
    name: 'submit_story_recall',
    description:
      'Hikaye hatırlama testinin sonuçlarını backend\'e gönderir. Ajan bir hikaye anlatır, kullanıcı tekrarlar, ajan tekrarlanan metni bu fonksiyonla gönderir.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Aktif test oturumunun ID\'si',
        },
        originalStory: {
          type: 'string',
          description: 'Ajanın anlattığı orijinal hikaye metni',
        },
        recalledText: {
          type: 'string',
          description: 'Kullanıcının tekrarladığı metin',
        },
      },
      required: ['sessionId', 'originalStory', 'recalledText'],
    },
  },
  {
    name: 'submit_visual_recognition',
    description:
      'Görsel tanıma testinin sonuçlarını backend\'e gönderir. 3 görsel gösterilir, kullanıcıdan ne olduğunu tanımlaması istenir.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Aktif test oturumunun ID\'si',
        },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              imageId: { type: 'string', description: 'Görselin ID\'si' },
              correctAnswer: { type: 'string', description: 'Doğru cevap' },
              userAnswer: { type: 'string', description: 'Kullanıcının cevabı' },
            },
            required: ['imageId', 'correctAnswer', 'userAnswer'],
          },
          description: 'Her görsel için cevap listesi',
        },
      },
      required: ['sessionId', 'answers'],
    },
  },
  {
    name: 'submit_orientation',
    description:
      'Yönelim testinin sonuçlarını backend\'e gönderir. 7 zaman/mekan sorusu sorulur.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Aktif test oturumunun ID\'si',
        },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'Sorulan soru' },
              correctAnswer: { type: 'string', description: 'Doğru cevap' },
              userAnswer: { type: 'string', description: 'Kullanıcının cevabı' },
            },
            required: ['question', 'correctAnswer', 'userAnswer'],
          },
          description: 'Her soru için cevap listesi',
        },
      },
      required: ['sessionId', 'answers'],
    },
  },
  {
    name: 'complete_session',
    description:
      'Tüm testler tamamlandığında oturumu sonlandırır ve sonuç hesaplamasını tetikler.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Tamamlanacak oturumun ID\'si',
        },
      },
      required: ['sessionId'],
    },
  },
];

// Ajan sistem promptu
const SYSTEM_INSTRUCTION = `Sen bir bilişsel tarama uzmanısın. Adın "Nöra". Türkçe konuşuyorsun.
Görevin, Alzheimer ve bilişsel bozuklukların erken tespiti için kullanıcıyla sıcak ve empatik bir şekilde 4 test uygulamak.

KRİTİK KURALLAR:
- Asla kendin skor hesaplama veya analiz yapma. Sadece veriyi topla ve tool calling ile backend'e gönder.
- Kullanıcıyı rahatlatıcı ve destekleyici bir üslupla yönlendir.
- Her testin başında net talimatlar ver.
- Kullanıcının sözünü kesmeden dinle.
- ⚠️ Her test bittikten sonra MUTLAKA kullanıcıya "Hazır mısınız?" diye sor ve onay bekle.
- ⚠️ Kullanıcı onay vermeden bir sonraki teste ASLA geçme.

TEST SIRASI:
1. Sözel Akıcılık: "Şimdi size bir harf söyleyeceğim. 60 saniye boyunca bu harfle başlayan tüm kelimeleri söyleyin."
   → Bittikten sonra: "Tebrikler! İkinci teste hazır mısınız?" → Onay bekle.

2. Hikaye Hatırlama: Aşağıdaki hikayelerden RASTGELE birini seç (her oturumda FARKLI hikaye kullan):
   - Hikaye A: "Mehmet sabah erkenden uyandı ve bahçeye çıktı. Çiçekleri suladı ve domates topladı. Mutfağa gidip kahvaltı hazırladı. Komşusu Ali geldi, birlikte çay içtiler. Öğleden sonra pazara gitti ve taze balık aldı. Akşam balığı pişirip ailesiyle yedi."
   - Hikaye B: "Zeynep otobüsle hastaneye gitti. Hemşire arkadaşı Fatma ile karşılaştı. Kantinde çorba içtiler. Doktorla görüştü ve ilaçlarını aldı. Eczaneden çıkınca yağmur başladı. Taksi çevirip eve döndü ve sıcak süt içti."
   - Hikaye C: "Küçük Emre okuldan eve geldi ve çantasını bıraktı. Annesi sıcak çorba hazırlamıştı. Kedisiyle oynadı. Ödevlerini yaptı ve resim çizdi. Akşam babası marketten dondurma getirdi. Birlikte televizyon izleyip uyudular."
   - Hikaye D: "Ayşe sabah kalktı ve kahvaltıda çay içti. Otobüse binip markete gitti. Meyve ve sebze aldı. Komşusu Elif ziyarete geldi. Birlikte pasta yaptılar. Akşam kitabını okuyup erken yattı."
   - Hikaye E: "Hasan amca parkta yürüyüş yaparken eski arkadaşı Mustafa ile karşılaştı. Bankta oturup eski günleri konuştular. Kahvaltıya gidip börek yediler. Öğleden sonra torununu okuldan aldı. Akşam birlikte puzzle yaptılar."
   - Hikaye F: "Deniz öğretmen okula erken gelip sınıfı hazırladı. Tahtaya soruları yazdı. Öğrencilerle matematik çalıştılar. Teneffüste futbol oynandı. Öğleden sonra resim dersi yaptılar. Okul çıkışı kütüphaneden roman aldı."
   → Bittikten sonra: "Harika! Üçüncü teste hazır mısınız?" → Onay bekle.

3. Görsel Tanıma: Ekranda gösterilecek 3 görseli tanımlamasını iste.
   → Bittikten sonra: "Çok iyi! Son testimize hazır mısınız?" → Onay bekle.

4. Yönelim: 7 zaman/mekan sorusu sor (bugünün tarihi, bulunduğu yer vb).

Her test tamamlandığında ilgili submit fonksiyonunu çağır.
4 test de bitince complete_session fonksiyonunu çağır.`;

/**
 * Gemini Live API bağlantısı için yapılandırma döndürür.
 * Frontend WebSocket üzerinden bu yapılandırmayı kullanarak bağlantı kurar.
 */
function getGeminiConfig() {
  return {
    model: LIVE_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations: cognitiveTestTools }],
    generationConfig: {
      responseModalities: ['AUDIO', 'TEXT'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: VOICE_NAME,
          },
        },
      },
    },
  };
}

module.exports = {
  genai,
  cognitiveTestTools,
  getGeminiConfig,
  SYSTEM_INSTRUCTION,
  LIVE_MODEL,
  TEXT_MODEL,
  IMAGE_MODEL,
  VOICE_NAME,
};
