/**
 * Gemini Live API Entegrasyonu
 * 
 * @google/genai SDK kullanarak Gemini Live API'ye WebSocket bağlantısı kurar.
 * Ses giriş/çıkış, tool calling ve transkripsiyon yönetimi yapar.
 * 
 * Mimari: Browser ↔ WS ↔ Node.js Backend ↔ Gemini Live API
 */

const { GoogleGenAI, Modality } = require('@google/genai');
const { createLogger } = require('../lib/logger');

const log = createLogger('GeminiLive');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const VOICE_NAME = process.env.LIVE_VOICE_NAME || 'Puck';

if (!GOOGLE_API_KEY) {
  log.error('GOOGLE_API_KEY is not set!');
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

const SYSTEM_INSTRUCTION = `Sen "Nöra" adında Türkçe konuşan bir bilişsel tarama asistanısın.

KİMLİĞİN:
- Adın Nöra. Sıcak, empatik ve profesyonel bir ses tonun var.
- Bir sağlık asistanısın, doktor değilsin. Teşhis koymuyorsun, tarama yapıyorsun.
- Her zaman Türkçe konuş. Kısa ve net cümleler kur.

KARŞILAMA:
- Kullanıcıyı sıcak karşıla, nasıl olduğunu sor.
- Kendini kısaca tanıt.
- Kullanıcı hazır olana kadar sohbet et. Acele etme.
- Kullanıcı hazır olduğunda testlere başla.

########## KRİTİK KURAL: TIMER YÖNETİMİ ##########
Süre yönetimi arka plandaki Brain Agent tarafından OTOMATIK yapılır.
Sen timer başlatma veya durdurma ile ASLA İLGİLENME.

Test 1 sırasında:
- Sen "Harfiniz X. Süreniz başladı, başlayabilirsiniz!" dedikten sonra Brain Agent timer'ı otomatik başlatır.
- Kullanıcı kelime söylerken SEN KONUŞMA. SADECE DİNLE. SUSKUNluğunu koru.
- Kullanıcı duraklar, sessiz kalır veya düşünüyorsa bu NORMAL. Bu "test bitti" DEĞİLDİR.
- Kullanıcı düşünüyor olabilir, bir sonraki kelimeyi arıyor olabilir. SABIR göster.
- ⚠️ ASLA kullanıcı duraksadı diye Test 2'ye geçme.
- ⚠️ ASLA kullanıcı duraksadı diye "süreniz bitti" deme.
- ⚠️ ASLA kullanıcı duraksadı diye testi bitirme.
- Kullanıcı sessiz kalırsa sessizce bekle VEYA kısa bir teşvik cümlesi söyle: "Devam edin, süreniz hala devam ediyor."
- Sadece "TIMER_COMPLETE:" veya "TIMER_STOPPED:" ile başlayan bir MESAJ ALIRSAN testi bitir.

"TIMER_COMPLETE:" veya "TIMER_STOPPED:" ile başlayan bir METIN MESAJI alırsan:
→ Bu Brain Agent'tan gelen bildirimdir.
→ Mesajda kullanıcının söylediği kelimeler ve hedef harf listelenmiştir.
→ Bu bilgileri kullanarak HEMEN submit_verbal_fluency çağır.
→ Sonra kullanıcıya "İlk testimizi tamamladınız, tebrikler!" de.
→ ⚠️ HEMEN Test 2'ye GEÇME! Önce kullanıcıya "Nasıl hissediyorsunuz? İkinci teste geçmeye hazır mısınız?" diye sor.
→ Kullanıcı "evet/hazırım/tamam/olur" gibi onay verene kadar BEKLE.
→ Bu mesajı almadan ASLA submit_verbal_fluency çağırma.

=== TEST 1: SÖZEL AKICILIK ===
1. Kullanıcıya testi açıkla: "Size bir harf vereceğim. 60 saniye boyunca o harfle başlayan mümkün olduğunca çok kelime söylemenizi isteyeceğim. Hazır mısınız?"
2. Kullanıcı "evet" / "hazırım" deyince bir harf seç (K, M, S, B, T gibi yaygın bir harf).
3. Tam şunu de: "Harfiniz [HARF]. Süreniz başladı, başlayabilirsiniz!"
4. BUNDAN SONRA SUSKUNLUĞUNU KORU. Kelime söylerken araya girme.
5. Kullanıcı duraklar veya sessiz kalırsa BEKLE. Düşünüyor olabilir. Sadece uzun sessizliklerde "Devam edebilirsiniz, süreniz devam ediyor" de.
6. TIMER mesajı gelene kadar testi BİTİRME. Sadece TIMER_COMPLETE veya TIMER_STOPPED mesajı gelince → submit_verbal_fluency çağır.

=== TEST 2: HİKAYE HATIRLAMA ===
⚠️ Bu teste SADECE kullanıcı "hazırım/evet/tamam" gibi onay verdikten sonra başla!

HİKAYE HAVUZU - Aşağıdaki hikayelerden rastgele BİRİNİ seç. Her oturumda FARKLI bir hikaye kullan. Seçtiğini submit_story_recall'da originalStory olarak göndereceksin.

Hikaye A: "Mehmet sabah erkenden uyandı ve bahçeye çıktı. Bahçedeki çiçekleri suladı ve domates topladı. Sonra mutfağa gidip kahvaltı hazırladı. Komşusu Ali geldi, birlikte çay içtiler. Öğleden sonra Mehmet pazara gitti ve taze balık aldı. Akşam balığı pişirip ailesiyle yedi."

Hikaye B: "Zeynep otobüsle hastaneye gitti. Hastanede hemşire arkadaşı Fatma ile karşılaştı. Birlikte kantinde çorba içtiler. Sonra Zeynep doktorla görüştü ve ilaçlarını aldı. Eczaneden çıkınca yağmur başladı. Bir taksi çevirip eve döndü ve sıcak bir süt içti."

Hikaye C: "Küçük Emre okuldan eve geldi ve çantasını bıraktı. Annesi ona sıcak bir çorba hazırlamıştı. Çorbayı içtikten sonra kedisiyle oynadı. Sonra ödevlerini yaptı ve resim çizdi. Akşam babası marketten dondurma getirdi. Hep birlikte televizyon izleyip uyudular."

Hikaye D: "Ayşe sabah erkenden kalktı ve kahvaltıda çay içti. Sonra otobüse binip markete gitti. Marketten meyve ve sebze aldı. Eve dönünce komşusu Elif'i ziyarete geldi. Birlikte pasta yaptılar ve çay içtiler. Akşam Ayşe kitabını okuyup erken yattı."

Hikaye E: "Hasan amca her sabah parkta yürüyüş yapar. O gün parkta eski arkadaşı Mustafa ile karşılaştı. Birlikte bankta oturup eski günleri konuştular. Sonra kahvaltıya gittiler ve börek yediler. Öğleden sonra Hasan eve döndü ve torununu okuldan aldı. Akşam birlikte puzzle yaptılar."

Hikaye F: "Deniz öğretmen sabah okula erken geldi ve sınıfı hazırladı. Tahtaya soruları yazdı. Öğrenciler gelince birlikte matematik çalıştılar. Teneffüste bahçede futbol oynadılar. Öğleden sonra resim dersi yaptılar. Okul çıkışı Deniz kütüphaneye uğrayıp yeni bir roman aldı."

ADIMLAR:
1. "Şimdi hikaye hatırlama testine geçeceğiz. Size kısa bir hikaye anlatacağım. Dikkatle dinleyin, sonra sizden bu hikayeyi tekrar anlatmanızı isteyeceğim."
2. Yukarıdaki hikayelerden birini RASTGELE seç ve anlat.
3. Hikayeyi anlattıktan sonra: "Şimdi bu hikayeyi hatırladığınız kadarıyla bana anlatır mısınız?" de.
4. Kullanıcının anlatmasını SABIR ile bekle. Acele ettirme. Tamamlamasını bekle.
5. Kullanıcı anlatmayı bitirdiğinde submit_story_recall çağır (originalStory = seçtiğin hikaye, recalledStory = kullanıcının anlattığı).
6. Sonra: "Harika, bu testi de tamamladınız! Bir sonraki teste geçmeye hazır mısınız?" de.
7. ⚠️ Kullanıcı onay verene kadar Test 3'e GEÇME.

=== TEST 3: GÖRSEL TANIMA (Multi-Agent) ===
⚠️ Bu teste SADECE kullanıcı onay verdikten sonra başla!

⚠️ KRİTİK: Test 3 çift-ajan mimarisi ile çalışır!
Sen (Nöra) = Konuşma Ajanı — kullanıcıyla konuşur, cevap alır
VisualTestAgent = Koordinatör Ajan — görsel üretir, frontend'e gönderir, akışı yönetir

AKIŞ:
1. "Görsel tanıma testine geçiyoruz. Ekranınıza sırayla 3 görsel göstereceğim. Her birinde ne gördüğünüzü söylemenizi isteyeceğim."
2. start_visual_test() çağır → İlk görsel otomatik ekranda gösterilir.
3. Kullanıcıya "Ekrandaki görsele bakın. Ne görüyorsunuz?" diye sor.
4. Kullanıcı cevap verince record_visual_answer(imageIndex, userAnswer) çağır.
5. Sonraki görsel otomatik gösterilir. Tekrar "Ne görüyorsunuz?" sor.
6. 3 görsel de cevaplanınca record_visual_answer son görselin cevabında tüm cevapları döner.
7. submit_visual_recognition çağır.
8. Sonra: "Bu testi de tamamladık! Son testimize geçmeye hazır mısınız?" de.

⚠️ ASLA generate_test_image kullanma! Daima start_visual_test ve record_visual_answer kullan.
⚠️ Görsel verisi sana GELMEZ. Görsel doğrudan kullanıcının ekranına gösterilir.
⚠️ Her cevaptan sonra record_visual_answer çağırmayı UNUTMA. Cevapsız sonraki görsele geçme.
⚠️ "VISUAL_TEST_NEXT:" ile başlayan mesajlar VisualTestAgent'tan gelir. Talimatlarına uy.
⚠️ Kullanıcı onay verene kadar Test 4'e GEÇME.

=== TEST 4: YÖNELİM ===
⚠️ Bu teste SADECE kullanıcı onay verdikten sonra başla!
1. "Son testimize geçiyoruz. Size 7 kısa soru soracağım, bildiğiniz kadarıyla cevaplayın."
2. Sırayla sor: Gün? Ay? Yıl? Mevsim? Şehir? Ülke? Saat yaklaşık kaç?
3. submit_orientation çağır.

=== BİTİŞ ===
complete_session çağır. "Tüm testleri tamamladınız, harika iş çıkardınız! Teşekkür ederim." de.

KURALLAR:
- Asla puan hesaplama. Sadece fonksiyonlara gönder.
- Kullanıcıyı rahatlatarak yönlendir. Stresli ortam yaratma.
- Timer ile ilgilenme, otomatik yönetilir.
- Test 1 sırasında kullanıcı sessiz kalınca testi bitirme, TIMER mesajını bekle.
- ⚠️ Her test arasında MUTLAKA kullanıcıdan onay al. Otomatik geçiş YAPMA.
- ⚠️ Test 2'de her seferinde FARKLI bir hikaye seç. Aynı hikayeyi tekrarlama.`;

const TOOL_DECLARATIONS = [
  {
    name: 'submit_verbal_fluency',
    description: 'Sözel akıcılık testinin sonuçlarını kaydeder. 60 saniye içinde söylenen kelimeleri gönderir.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        words: {
          type: 'array',
          items: { type: 'string' },
          description: 'Kullanıcının söylediği kelimeler listesi',
        },
        targetLetter: { type: 'string', description: 'Hedef harf (örn: P)' },
        durationSeconds: { type: 'number', description: 'Test süresi (saniye)' },
      },
      required: ['sessionId', 'words', 'targetLetter'],
    },
  },
  {
    name: 'submit_story_recall',
    description: 'Hikaye hatırlama testinin sonuçlarını kaydeder.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        originalStory: { type: 'string', description: 'Orijinal hikaye metni' },
        recalledStory: { type: 'string', description: 'Kullanıcının anlattığı hikaye' },
      },
      required: ['sessionId', 'originalStory', 'recalledStory'],
    },
  },
  {
    name: 'start_visual_test',
    description: 'Görsel tanıma testini başlatır. VisualTestAgent koordinasyonunda çalışır. İlk görseli otomatik üretir ve ekranda gösterir. Bu fonksiyonu Test 3 başlangıcında bir kez çağır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'record_visual_answer',
    description: 'Kullanıcının görsel tanıma cevabını kaydeder ve sonraki görseli gösterir. Her görsel için kullanıcı cevap verdikten sonra bu fonksiyonu çağır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        imageIndex: { type: 'number', description: 'Cevaplanılan görselin indeksi (0, 1, 2)' },
        userAnswer: { type: 'string', description: 'Kullanıcının verdiği cevap (ne gördüğü)' },
      },
      required: ['sessionId', 'imageIndex', 'userAnswer'],
    },
  },
  {
    name: 'submit_visual_recognition',
    description: 'Görsel tanıma testinin sonuçlarını kaydeder.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              imageIndex: { type: 'number' },
              userAnswer: { type: 'string' },
              correctAnswer: { type: 'string' },
            },
          },
          description: 'Her görsel için kullanıcı cevabı ve doğru cevap',
        },
      },
      required: ['sessionId', 'answers'],
    },
  },
  {
    name: 'submit_orientation',
    description: 'Yönelim testinin sonuçlarını kaydeder.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              userAnswer: { type: 'string' },
              correctAnswer: { type: 'string' },
            },
          },
          description: 'Her soru için kullanıcı cevabı ve doğru cevap',
        },
      },
      required: ['sessionId', 'answers'],
    },
  },
  {
    name: 'complete_session',
    description: 'Tüm testler tamamlandıktan sonra oturumu sonlandırır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
      },
      required: ['sessionId'],
    },
  },
];

/**
 * Gemini Live oturumu oluşturur ve yönetir
 */
class GeminiLiveSession {
  constructor(clientWs, sessionId, onToolCall) {
    this.clientWs = clientWs;
    this.sessionId = sessionId;
    this.onToolCall = onToolCall;
    this.geminiSession = null;
    this.isConnected = false;
    this.brainAgent = null; // Brain Agent dışarıdan set edilir
  }

  async connect() {
    try {
      log.info('Connecting to Gemini Live API...', { 
        sessionId: this.sessionId, 
        model: LIVE_MODEL,
        voice: VOICE_NAME 
      });

      const config = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: VOICE_NAME,
            },
          },
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: { thinkingBudget: 0 },
      };

      this.geminiSession = await ai.live.connect({
        model: LIVE_MODEL,
        config: config,
        callbacks: {
          onopen: () => {
            log.info('Gemini Live connected', { sessionId: this.sessionId });
            this.isConnected = true;
            this.sendToClient({ type: 'connected', sessionId: this.sessionId });
          },
          onmessage: (message) => {
            this.handleGeminiMessage(message);
          },
          onerror: (error) => {
            log.error('Gemini Live error', { sessionId: this.sessionId, error: error.message });
            this.sendToClient({ type: 'error', message: error.message });
          },
          onclose: (event) => {
            log.info('Gemini Live closed', { sessionId: this.sessionId, reason: event.reason });
            this.isConnected = false;
            this.sendToClient({ type: 'session_closed' });
          },
        },
      });

      // Session kurulduktan sonra başlangıç mesajı gönder
      log.info('Gemini Live session established', { sessionId: this.sessionId });
      
      // Otomatik başlangıç - Nöra sıcak bir şekilde karşılasın
      log.info('Sending initial greeting', { sessionId: this.sessionId });
      this.geminiSession.sendRealtimeInput({
        text: 'Kullanıcı yeni bağlandı. Kendini tanıt ve nasıl olduğunu sor. Henüz teste başlama, önce sohbet et ve kullanıcıyı rahatlat.',
      });
      
      return true;
    } catch (error) {
      log.error('Gemini Live connection failed', { 
        sessionId: this.sessionId, 
        error: error.message,
        stack: error.stack 
      });
      this.sendToClient({ type: 'error', message: 'Gemini Live bağlantısı kurulamadı: ' + error.message });
      return false;
    }
  }

  handleGeminiMessage(message) {
    // Tool call handling
    if (message.toolCall) {
      log.debug('Tool call received', { sessionId: this.sessionId });
      this.handleToolCall(message.toolCall);
      return;
    }

    const content = message.serverContent;
    if (!content) {
      // GoAway, sessionResumptionUpdate vs. olabilir - logla
      if (message.goAway) {
        log.warn('GoAway received - session will close soon', { sessionId: this.sessionId, timeLeft: message.goAway.timeLeft });
      }
      return;
    }

    // Input transcription (kullanıcının söylediği)
    if (content.inputTranscription) {
      const text = content.inputTranscription.text;
      log.debug('Input transcription', { sessionId: this.sessionId, text: text?.substring(0, 80) });
      this.sendToClient({ type: 'input_transcription', text });
      if (this.brainAgent && text) {
        this.brainAgent.onTranscript('user', text);
      }
    }

    // Output transcription (modelin söylediği)
    if (content.outputTranscription) {
      const text = content.outputTranscription.text;
      log.debug('Output transcription', { sessionId: this.sessionId, text: text?.substring(0, 80) });
      if (this.brainAgent && text) {
        this.brainAgent.onTranscript('agent', text);
      }
      this.sendToClient({ type: 'output_transcription', text });
    }

    // Audio response ve text parçaları
    if (content.modelTurn && content.modelTurn.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData) {
          this.sendToClient({
            type: 'audio',
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        }
        if (part.text) {
          // Thinking/reasoning output'larını filtrele (İngilizce ** ile başlayan)
          if (part.text.startsWith('**') || part.text.startsWith('\n**')) {
            log.debug('Thinking output filtered', { sessionId: this.sessionId, text: part.text.substring(0, 60) });
            // Thinking text'i Brain Agent'a ve frontend'e iletme
            continue;
          }
          log.debug('Model text part', { sessionId: this.sessionId, text: part.text.substring(0, 80) });
          if (this.brainAgent) {
            this.brainAgent.onTranscript('agent', part.text);
          }
          this.sendToClient({ type: 'text', text: part.text });
        }
      }
    }

    // Turn complete
    if (content.turnComplete) {
      this.sendToClient({ type: 'turn_complete' });
    }

    // Interrupted
    if (content.interrupted) {
      this.sendToClient({ type: 'interrupted' });
    }
  }

  async handleToolCall(toolCall) {
    const functionResponses = [];

    for (const fc of toolCall.functionCalls) {
      log.info('Tool call executing', { sessionId: this.sessionId, tool: fc.name, args: fc.args });

      this.sendToClient({
        type: 'tool_call',
        name: fc.name,
        args: fc.args,
      });

      let result;
      try {
        result = await this.onToolCall(fc.name, fc.args);
        log.info('Tool call completed', { sessionId: this.sessionId, tool: fc.name, result });
      } catch (error) {
        log.error('Tool execution error', { sessionId: this.sessionId, tool: fc.name, error: error.message });
        result = { error: error.message };
      }

      // Tool sonucunu frontend'e de gönder (görsel üretme vb. için)
      this.sendToClient({
        type: 'tool_result',
        name: fc.name,
        result: result,
      });

      functionResponses.push({
        name: fc.name,
        id: fc.id,
        response: result,
      });
    }

    // Tool response'u Gemini'ye gönder
    if (this.geminiSession && this.isConnected) {
      this.geminiSession.sendToolResponse({ functionResponses });
    }
  }

  sendAudio(audioData) {
    if (this.geminiSession && this.isConnected) {
      this.geminiSession.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    }
  }

  sendText(text) {
    if (this.geminiSession && this.isConnected) {
      log.info('Sending text to Gemini', { sessionId: this.sessionId, text: text.substring(0, 80) });
      this.geminiSession.sendRealtimeInput({ text });
    }
  }

  sendToClient(data) {
    if (this.clientWs && this.clientWs.readyState === 1) {
      this.clientWs.send(JSON.stringify(data));
    }
  }

  close() {
    if (this.brainAgent) {
      this.brainAgent.destroy();
      this.brainAgent = null;
    }
    if (this.geminiSession) {
      this.geminiSession.close();
      this.geminiSession = null;
    }
    this.isConnected = false;
  }
}

module.exports = {
  GeminiLiveSession,
  TOOL_DECLARATIONS,
  SYSTEM_INSTRUCTION,
};
