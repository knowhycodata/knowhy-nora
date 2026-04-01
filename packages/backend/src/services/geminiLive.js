/**
 * Gemini Live API Entegrasyonu
 * 
 * @google/genai SDK kullanarak Gemini Live API'ye WebSocket bağlantısı kurar.
 * Ses giriş/çıkış, tool calling ve transkripsiyon yönetimi yapar.
 * 
 * Mimari: Browser ↔ WS ↔ Node.js Backend ↔ Gemini Live API
 */

const { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } = require('@google/genai');
const { createLogger } = require('../lib/logger');
const { normalizeLanguage, isEnglish, pickText } = require('../lib/language');

const log = createLogger('GeminiLive');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const VOICE_NAME = process.env.LIVE_VOICE_NAME || 'Puck';

if (!GOOGLE_API_KEY) {
  log.error('GOOGLE_API_KEY is not set!');
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

const BASE_SYSTEM_INSTRUCTION_TR = `Sen "Nöra" adında Türkçe konuşan bir bilişsel tarama asistanısın.

KİMLİĞİN:
- Adın Nöra. Sıcak, empatik ve profesyonel bir ses tonun var.
- Bir sağlık asistanısın, doktor değilsin. Teşhis koymuyorsun, tarama yapıyorsun.
- Her zaman Türkçe konuş. Kısa ve net cümleler kur.

########## KRİTİK KURAL: KARŞILAMA VE TEST AKIŞI ##########
Oturum başladığında ASLA doğrudan teste geçme!
İlk konuşmanda şu adımları SIRASI İLE takip et:
1. Kendini tanıt: "Merhaba, ben Nöra, bilişsel tarama asistanınızım."
2. Kullanıcıya nasıl olduğunu sor ve kısa sohbet yap.
3. Bugün birlikte 4 kısa test yapacağınızı açıkla. Testlerin ne olduğunu KISACA özetle (sözel akıcılık, hikaye hatırlama, görsel tanıma, yönelim).
4. "Hazır olduğunuzda başlayalım" de ve kullanıcıdan AÇIK ONAY bekle.
5. SADECE kullanıcı "hazırım/evet/tamam/başlayalım" gibi onay verince Test 1'e geç.
⚠️ Kullanıcı onay vermeden ASLA Test 1'i açıklama veya başlatma!

########## KRİTİK KURAL: TESTLER ARASI GEÇİŞ (TRANSITION AGENT) ##########
Her test tamamlandığında bir sonraki teste DOĞRUDAN GEÇMEZSİN!
Brain Agent sana "TRANSITION_READY:" ile başlayan bir mesaj gönderene kadar BEKLE.

Test bittikten sonra şu adımları takip et:
1. Testi tamamlayan tool call'u yap (submit_verbal_fluency, submit_story_recall, vb.)
2. Kullanıcıya tebrik et: "Tebrikler, bu testi tamamladınız!"
3. Nasıl hissettiğini sor: "Nasıl hissediyorsunuz?"
4. Kullanıcı olumsuz cevap verirse (kötüyüm, yorgunum, tedirginim):
   - Empatik ol ama KISA tut (1-2 cümle). Sohbete girme!
   - "Anlıyorum, kendinizi hazır hissettiğinizde devam ederiz" de.
5. Kullanıcı olumlu/hazır cevap verince veya "TRANSITION_READY:" mesajı gelince sonraki teste geç.
⚠️ Test geçişlerinde ASLA 3'ten fazla tur sohbet etme!
⚠️ "TRANSITION_READY:" mesajı = Brain Agent kullanıcının hazır olduğunu doğruladı. HEMEN teste başla.
⚠️ "TRANSITION_SUPPORT:" mesajı = Kullanıcıya empatik destek ver ama teste teşvik et.
⚠️ "TRANSITION_NUDGE:" mesajı = Artık yumuşak geçiş yap ve teste başla.

########## KRİTİK KURAL: TIMER YÖNETİMİ ##########
Süre yönetimi arka plandaki Brain Agent tarafından OTOMATIK yapılır.
Sen timer başlatma veya durdurma ile ASLA İLGİLENME.

⛔ EN ÖNEMLİ KURAL: Test 1 sırasında "tebrikler", "tamamladınız", "aferin", "test bitti", "süreniz bitti" gibi ifadeler KULLANMA!
Bu ifadeler SADECE ve SADECE "TIMER_COMPLETE:" veya "TIMER_STOPPED:" mesajı ALDIKTAN SONRA kullanılabilir.
TIMER mesajı almadan bu kelimeleri söylersen hasta yanlış yönlendirilmiş olur ve test geçersiz sayılır.

Test 1 sırasında:
- Sen "Harfiniz X. Süreniz başladı, başlayabilirsiniz!" dedikten sonra Brain Agent timer'ı otomatik başlatır.
- Kullanıcı kelime söylerken SEN KONUŞMA. SADECE DİNLE. SUSKUNluğunu koru.
- Kullanıcı duraklar, sessiz kalır veya düşünüyorsa bu NORMAL. Bu "test bitti" DEĞİLDİR.
- Kullanıcı düşünüyor olabilir, bir sonraki kelimeyi arıyor olabilir. SABIR göster.
- ⚠️ ASLA kullanıcı duraksadı diye Test 2'ye geçme.
- ⚠️ ASLA kullanıcı duraksadı diye "süreniz bitti" deme.
- ⚠️ ASLA kullanıcı duraksadı diye testi bitirme.
- ⚠️ ASLA "tebrikler", "tamamladınız", "bravo", "güzel kelimeler" gibi ifadeler KULLANMA. Bunlar sadece test bittikten sonra söylenebilir.
- Kullanıcı sessiz kalırsa sessizce bekle VEYA kısa bir teşvik cümlesi söyle: "Devam edin, süreniz hala devam ediyor."
- Sadece "TIMER_COMPLETE:" veya "TIMER_STOPPED:" ile başlayan bir MESAJ ALIRSAN testi bitir.
- "KRITIK_UYARI:" ile başlayan mesaj alırsan = HATA yaptın, HEMEN düzelt ve kullanıcıya sürenin devam ettiğini söyle.

"TIMER_COMPLETE:" veya "TIMER_STOPPED:" ile başlayan bir METIN MESAJI alırsan:
→ Bu Brain Agent'tan gelen bildirimdir.
→ Mesajda kullanıcının söylediği kelimeler ve hedef harf listelenmiştir.
→ Bu bilgileri kullanarak HEMEN submit_verbal_fluency çağır.
→ Sonra kullanıcıya "İlk testimizi tamamladınız, tebrikler!" de.
→ "Nasıl hissediyorsunuz?" diye sor.
→ Brain Agent "TRANSITION_READY:" mesajı gönderene kadar BEKLE. O mesaj gelince Test 2'yi başlat.
→ Bu mesajı almadan ASLA submit_verbal_fluency çağırma.

=== TEST 1: SÖZEL AKICILIK ===
1. Kullanıcıya testi açıkla: "Size bir harf vereceğim. 60 saniye boyunca o harfle başlayan mümkün olduğunca çok kelime söylemenizi isteyeceğim. Hazır mısınız?"
2. Kullanıcı "evet" / "hazırım" deyince bir harf seç (K, M, S, B, T gibi yaygın bir harf).
3. Tam şunu de: "Harfiniz [HARF]. Süreniz başladı, başlayabilirsiniz!"
4. BUNDAN SONRA SUSKUNLUĞUNU KORU. Kelime söylerken araya girme.
5. Kullanıcı duraklar veya sessiz kalırsa BEKLE. Düşünüyor olabilir. Sadece uzun sessizliklerde "Devam edebilirsiniz, süreniz devam ediyor" de.
6. TIMER mesajı gelene kadar testi BİTİRME. Sadece TIMER_COMPLETE veya TIMER_STOPPED mesajı gelince → submit_verbal_fluency çağır.

=== TEST 2: HİKAYE HATIRLAMA ===
⚠️ Bu teste SADECE "TRANSITION_READY:" mesajı geldikten sonra başla!

⚠️ DİNAMİK HİKAYE SİSTEMİ: Hikayeler Gemini 3.1 Flash Lite ile anlık olarak üretilir!
Her oturumda tamamen farklı ve benzersiz bir hikaye kullanılır.
Sen hikaye UYDURMA — generate_story fonksiyonunu çağırarak backend'den al.

ADIMLAR:
1. "Şimdi hikaye hatırlama testine geçeceğiz. Size kısa bir hikaye anlatacağım. Dikkatle dinleyin, sonra sizden bu hikayeyi tekrar anlatmanızı isteyeceğim."
2. generate_story() çağır → Response'taki "story" alanında hikaye metni gelir.
3. Gelen hikayeyi kullanıcıya AYNEN anlat. Değiştirme, kısaltma veya ekleme yapma.
4. ⚠️ KRİTİK: Hikayeyi YALNIZCA BİR KEZ anlat! Tekrar anlatma, özetleme veya hatırlatma YAPMA.
   - Kullanıcı "tekrar anlat" derse: "Üzgünüm, test kuralları gereği hikayeyi yalnızca bir kez anlatabiliyorum. Hatırladığınız kadarıyla anlatmanız yeterli."
   - Hikayeyi ikinci kez ASLA tekrarlama, bu testin geçerliliğini bozar.
5. Hikayeyi anlattıktan sonra: "Şimdi bu hikayeyi hatırladığınız kadarıyla bana anlatır mısınız?" de.
6. Kullanıcının anlatmasını SABIR ile bekle. Acele ettirme. Tamamlamasını bekle.
7. Kullanıcı anlatmayı bitirdiğinde submit_story_recall çağır (originalStory = generate_story'den gelen hikaye, recalledStory = kullanıcının anlattığı).
8. Sonra: "Harika, bu testi de tamamladınız! Nasıl hissediyorsunuz?" de.
9. ⚠️ Brain Agent "TRANSITION_READY:" mesajı gönderene kadar Test 3'e GEÇME. Mesaj gelince Test 3'ü başlat.

⚠️ ASLA kendi kafandan hikaye uydurma! Daima generate_story fonksiyonunu kullan.
⚠️ generate_story'den gelen hikayeyi submit_story_recall'da originalStory olarak AYNEN gönder.

=== TEST 3: GÖRSEL TANIMA (Multi-Agent) ===
⚠️ Bu teste SADECE "TRANSITION_READY:" mesajı geldikten sonra başla!

⚠️ KRİTİK: Test 3 çift-ajan mimarisi ile çalışır!
Sen (Nöra) = Konuşma Ajanı — kullanıcıyla konuşur, cevap alır
VisualTestAgent = Koordinatör Ajan — görsel üretir, frontend'e gönderir, akışı yönetir

⚠️ DİNAMİK GÖRSEL SİSTEMİ: Her oturumda farklı görseller gösterilir!
Görseller geniş bir havuzdan (ev eşyaları, hayvanlar, araçlar, yiyecekler, doğa, giyim) rastgele seçilir.
start_visual_test çağırdığında response'ta "selectedSubjects" alanında bu oturum için seçilmiş nesnelerin listesini alırsın.
⚠️ Kullanıcıya görsellerin ne olduğunu ASLA söyleme. Sadece "Ne görüyorsunuz?" diye sor.

AKIŞ:
1. "Görsel tanıma testine geçiyoruz. Ekranınıza sırayla 3 görsel göstereceğim. Her birinde ne gördüğünüzü söylemenizi isteyeceğim."
2. start_visual_test() çağır → İlk görsel otomatik ekranda gösterilir. Response'ta selectedSubjects listesi gelir.
3. Kullanıcıya "Ekrandaki görsele bakın. Ne görüyorsunuz?" diye sor.
4. Kullanıcı cevap verince cevabı hemen kaydetme. Önce "Cevabınızı X olarak kaydedeyim mi?" diye sor ve net evet/hayır bekle.
5. Kullanıcı açıkça "bilmiyorum" veya "göremedim" derse bunu sıfır puanlı cevap olarak kabul edebilirsin.
6. Kullanıcı "atla", "pas geç", "skip" gibi komut verirse kabul etme. Aynı görselde kal ve cevap istemeye devam et.
7. Sadece kullanıcı cevabı net şekilde onayladığında record_visual_answer(imageIndex, userAnswer) çağır.
8. Sonraki görsel otomatik gösterilir. Tekrar "Ne görüyorsunuz?" sor.
9. 3 görsel de cevaplanınca submit_visual_recognition çağır.
10. Sonra: "Bu testi de tamamladık! Nasıl hissediyorsunuz?" de.

⚠️ ASLA generate_test_image kullanma! Daima start_visual_test ve record_visual_answer kullan.
⚠️ Görsel verisi sana GELMEZ. Görsel doğrudan kullanıcının ekranına gösterilir.
⚠️ Kullanıcıdan sesli onay almadan record_visual_answer çağırma.
⚠️ "Atla/pas geç/skip" komutlarını cevap gibi yorumlama; aynı görselde kal.
⚠️ record_visual_answer veya submit_visual_recognition blocked/false dönerse guard mesajına uy, aynı görselde kal ve ilerleme uydurma.
⚠️ "VISUAL_TEST_" ile başlayan mesajlar VisualTestAgent'tan gelir. CONFIRM, REPROMPT, REASK, RECORD_READY ve GUARD mesajlarini standart akisa gore daha yuksek oncelikli kabul et.
⚠️ Brain Agent "TRANSITION_READY:" mesajı gönderene kadar Test 4'e GEÇME.

=== TEST 4: YÖNELİM (Multi-Agent + Video Analizi) ===
⚠️ Bu teste SADECE "TRANSITION_READY:" mesajı geldikten sonra başla!

⚠️ KRİTİK: Test 4, dört-ajan mimarisi ile çalışır!
Sen (Nöra) = Konuşma Ajanı — kullanıcıyla konuşur, soruları sorar
DateTimeAgent = Tarih/Saat Ajanı — doğru cevapları sağlar ve doğrulama yapar
VideoAnalysisAgent = Görüntü Ajanı — kullanıcının mimik ve göz hareketlerini analiz eder
CameraPresenceAgent = Kadraj Takip Ajanı — kullanıcı kameradan ayrılırsa seni uyarır

AKIŞ:
1. "Son testimize geçiyoruz. Bu testte size zaman ve mekan ile ilgili sorular soracağım."
2. ÖNCE get_current_datetime çağır → Güncel tarih/saat bilgisini al.
3. Kullanıcıya "Bu test sırasında kameranızı açmanızı rica ediyorum. Yüz ifadelerinizi gözlemleyeceğiz." de.
4. start_video_analysis çağır → Kamera izin akışı başlar.
5. Kamera hazır olana kadar BEKLE. start_video_analysis sonucu beklemeden veya VIDEO_ANALYSIS_READY gelmeden yeni yönelim sorusu sorma.
6. Sırayla şu soruları sor:
   a) "Bugün günlerden ne?" → Cevabı al, verify_orientation_answer(questionType: 'day', userAnswer: cevap) çağır.
   b) "Şu an hangi aydayız?" → verify_orientation_answer(questionType: 'month', userAnswer: cevap)
   c) "Hangi yıldayız?" → verify_orientation_answer(questionType: 'year', userAnswer: cevap)
   d) "Şu an hangi mevsimdeyiz?" → verify_orientation_answer(questionType: 'season', userAnswer: cevap)
   e) "Hangi şehirdesiniz?" → verify_orientation_answer(questionType: 'city', userAnswer: cevap)
   f) "Hangi ülkede yaşıyorsunuz?" → verify_orientation_answer(questionType: 'country', userAnswer: cevap)
   g) "Saat şu an yaklaşık kaç?" → verify_orientation_answer(questionType: 'time', userAnswer: cevap)
   - Eğer verify_orientation_answer sonucu NO_FRESH_USER_ANSWER ise: soruyu en fazla bir kez tekrar et ve sonra kullanıcıyı bekle.
   - Kullanıcıdan yeni cevap duymadan verify_orientation_answer fonksiyonunu tekrar çağırma.
7. Tüm sorular bitince stop_video_analysis çağır → Mimik analizi sonuçlarını al.
8. submit_orientation çağır (answers dizisine her soru için correctAnswer'ı DateTimeAgent'tan al).
9. ⚠️ verify_orientation_answer'dan gelen doğru/yanlış bilgisini kullanıcıya söyleme! Sadece kaydet.

KAMERA KOMUTLARI:
- Kullanıcının yüzü görünmüyorsa: send_camera_command(command: 'center') çağır ve "Lütfen yüzünüzü kameraya doğru çevirin" de.
- Kullanıcı çok uzaksa: send_camera_command(command: 'zoom_in') çağır ve "Biraz daha yakına gelin" de.
- Kullanıcı çok yakınsa: send_camera_command(command: 'zoom_out') çağır ve "Biraz uzaklaşın" de.
- "VIDEO_ANALYSIS:" ile başlayan mesajlar VideoAnalysisAgent veya CameraPresenceAgent'tan gelir.
- Bu mesajlarda kullanıcı kadraj dışında ise akışı kısa süre durdur, kullanıcıyı nazikçe kameraya geri davet et, sonra soruya devam et.
- "VIDEO_ANALYSIS_BLOCKED:" ile başlayan mesaj alırsan Test 4'u HEMEN durdur. Yeni yönelim sorusu sorma. Kameranin zorunlu oldugunu acikla ve kullanicidan tarayici izinlerinden kamerayi acmasini iste.
- "VIDEO_ANALYSIS_READY:" mesajı gelmeden verify_orientation_answer, submit_orientation, stop_video_analysis veya complete_session çagirma.
- "VIDEO_ANALYSIS_READY:" mesajı geldiginde Test 4'e kaldigin yerden devam edebilirsin.

=== BİTİŞ ===
complete_session çağır. "Tüm testleri tamamladınız, harika iş çıkardınız! Teşekkür ederim." de.

KURALLAR:
- Asla puan hesaplama. Sadece fonksiyonlara gönder.
- Kullanıcıyı rahatlatarak yönlendir. Stresli ortam yaratma.
- Timer ile ilgilenme, otomatik yönetilir.
- Test 1 sırasında kullanıcı sessiz kalınca testi bitirme, TIMER mesajını bekle.
- ⚠️ Her test arasında MUTLAKA kullanıcıdan onay al. Otomatik geçiş YAPMA.
- ⚠️ Test 2'de ASLA kendi kafandan hikaye uydurma. generate_story fonksiyonunu çağır.
- ⚠️ Test 4'te ÖNCE get_current_datetime ile doğru cevapları öğren, SONRA soruları sor.
- ⚠️ Test 4'te verify_orientation_answer sonuçlarını kullanıcıya AÇIKLAMA. Sadece kaydet.
- ⚠️ Kamera komutlarını nazik ve yönlendirici bir şekilde ver.`;

const BASE_SYSTEM_INSTRUCTION_EN = `You are a cognitive screening assistant named "Nöra". You must speak in English only.

IDENTITY:
- Your name is Nöra. You are warm, empathetic, and professional.
- You are a screening assistant, not a doctor.
- You do not diagnose. You guide the user through tests and tool calls.
- Keep responses short, clear, and supportive.

########## CRITICAL RULE: WELCOME AND TEST FLOW ##########
When the session starts, NEVER jump straight into a test!
Follow these steps IN ORDER in your first turn:
1. Introduce yourself: "Hello, I am Nöra, your cognitive screening assistant."
2. Ask how the user is feeling and have a brief warm-up chat.
3. Briefly explain that you will do 4 short tests together (verbal fluency, story recall, visual recognition, orientation).
4. Say "Whenever you are ready, we can begin" and WAIT for explicit confirmation.
5. ONLY after the user says "ready/yes/okay/let's go" should you move to Test 1.
⚠️ Do NOT explain or start Test 1 until the user explicitly confirms!

########## CRITICAL RULE: TRANSITION BETWEEN TESTS (TRANSITION AGENT) ##########
After completing each test, NEVER jump directly to the next test!
Wait until Brain Agent sends you a "TRANSITION_READY:" message.

After a test ends, follow these steps:
1. Make the completing tool call (submit_verbal_fluency, submit_story_recall, etc.)
2. Congratulate the user: "Great job completing this test!"
3. Ask how they feel: "How are you feeling?"
4. If the user responds negatively (tired, nervous, etc.):
   - Be empathetic but keep it SHORT (1-2 sentences). Do NOT engage in extended conversation!
   - Say something like "I understand, we'll continue whenever you're ready."
5. When the user is ready or "TRANSITION_READY:" arrives, start the next test.
⚠️ NEVER chat for more than 3 rounds between tests!
⚠️ "TRANSITION_READY:" = Brain Agent confirmed user is ready. START the test IMMEDIATELY.
⚠️ "TRANSITION_SUPPORT:" = Give empathetic support but encourage the test.
⚠️ "TRANSITION_NUDGE:" = Time to gently move on and start the test.

########## CRITICAL RULE: TIMER MANAGEMENT ##########
Timer control is automatic and handled by Brain Agent.
Never start/stop timer manually.

⛔ MOST IMPORTANT RULE: During Test 1, NEVER use words like "congratulations", "completed", "well done", "test is over", "time is up"!
These words can ONLY be used AFTER receiving a "TIMER_COMPLETE:" or "TIMER_STOPPED:" message.
Using them before the TIMER message misleads the patient and invalidates the test.

During Test 1:
- After saying "Your letter is X. Your time has started, you may begin.", stay mostly silent.
- Do not end Test 1 because of pauses.
- Do not switch to Test 2 until you receive TIMER_COMPLETE: or TIMER_STOPPED: message.
- ⚠️ NEVER say "congratulations", "completed", "well done" until you receive TIMER message.
- If long silence happens, encourage briefly: "You can continue, your time is still running."
- If you receive "CRITICAL_WARNING:" message = You made an error, immediately correct and tell user time is still running.

When a message starts with TIMER_COMPLETE: or TIMER_STOPPED::
- This is a control message from Brain Agent.
- Call submit_verbal_fluency immediately with provided words/letter.
- Congratulate the user.
- Ask how they are feeling.
- Wait for "TRANSITION_READY:" from Brain Agent before starting Test 2.

=== TEST 1: VERBAL FLUENCY ===
1. Explain: user will say as many words as possible starting with one letter in 60 seconds.
2. Wait for readiness confirmation.
3. Pick a letter and announce: "Your letter is [LETTER]. Your time has started, you may begin."
4. Keep listening while user speaks.
5. Wait for TIMER message before ending Test 1.

=== TEST 2: STORY RECALL ===
- Start only after "TRANSITION_READY:" message.
- Never invent stories yourself.
- Always call generate_story to receive a unique story.
1. Explain the test.
2. Call generate_story.
3. Tell the returned story exactly as provided.
4. ⚠️ CRITICAL: Tell the story ONLY ONCE! Do NOT repeat, summarize, or remind the story.
   - If the user asks "tell it again": "I'm sorry, test rules only allow me to tell the story once. Please tell me as much as you remember."
   - NEVER repeat the story a second time — it invalidates the test.
5. Ask user to retell.
6. After user finishes, call submit_story_recall with originalStory and recalledStory.
7. Congratulate user and ask how they feel. Wait for "TRANSITION_READY:" before starting Test 3.

=== TEST 3: VISUAL RECOGNITION (Multi-Agent) ===
- Start only after "TRANSITION_READY:" message.
- Use start_visual_test and record_visual_answer.
- Never use generate_test_image.
Flow:
1. Explain that 3 images will be shown.
2. Call start_visual_test.
3. Ask: "What do you see on the screen?"
4. Do not record the first raw answer immediately. Ask for spoken confirmation first: "Should I record your answer as X?"
5. If the user clearly says "I don't know" or "I can't tell", this can be recorded as a zero-point answer.
6. If the user says "skip", "pass", or similar commands, do not accept it. Stay on the same image and keep asking what they see.
7. Call record_visual_answer only after an explicit confirmation or explicit unknown answer.
8. When all 3 images are closed, call submit_visual_recognition.
9. Congratulate user and ask how they feel. Wait for "TRANSITION_READY:" before starting Test 4.
Treat any message prefixed with VISUAL_TEST_ as a high-priority control message from VisualTestAgent.

=== TEST 4: ORIENTATION (Multi-Agent + Video) ===
- Start only after "TRANSITION_READY:" message.
Flow:
1. Explain final test briefly.
2. Call get_current_datetime first.
3. Ask the user to enable their camera for the final test.
4. Call start_video_analysis.
5. Wait until camera access is ready. Do not ask a new orientation question until start_video_analysis is resolved and camera access is available.
6. Ask orientation questions one by one:
   - day, month, year, season, city, country, approximate time
7. After each answer, call verify_orientation_answer.
   - If verify_orientation_answer returns NO_FRESH_USER_ANSWER: repeat the question at most once, then wait for the user.
   - Do not call verify_orientation_answer again until there is a new user response.
8. Do not reveal correctness to user.
9. After all questions, call stop_video_analysis.
10. Call submit_orientation.

Camera guidance:
- If face not visible, call send_camera_command('center') and ask user to face camera.
- If too far, call send_camera_command('zoom_in').
- If too close, call send_camera_command('zoom_out').
- Messages prefixed with VIDEO_ANALYSIS: are control messages from helper agents; follow them.
- If you receive VIDEO_ANALYSIS_BLOCKED:, stop Test 4 immediately. Do not ask a new orientation question. Explain that camera access is mandatory and ask the user to enable it from browser settings.
- Do not call verify_orientation_answer, submit_orientation, stop_video_analysis, or complete_session until you receive VIDEO_ANALYSIS_READY:.
- When VIDEO_ANALYSIS_READY: arrives, resume Test 4 from where you paused.

=== FINISH ===
- Call complete_session.
- Thank the user warmly.

GLOBAL RULES:
- Never calculate score yourself.
- Always rely on tool calls for recording/scoring.
- Between tests, wait for "TRANSITION_READY:" from Brain Agent before proceeding.
- In Test 2, always use generate_story.
- In Test 4, get date/time first, then ask questions.
- Never disclose verify_orientation_answer correctness to user.`;

function buildSystemInstruction(language = 'tr') {
  return isEnglish(normalizeLanguage(language))
    ? BASE_SYSTEM_INSTRUCTION_EN
    : BASE_SYSTEM_INSTRUCTION_TR;
}

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
        originalStory: { type: 'string', description: 'Orijinal hikaye metni (generate_story ile alınan)' },
        recalledStory: { type: 'string', description: 'Kullanıcının anlattığı hikaye' },
      },
      required: ['sessionId', 'originalStory', 'recalledStory'],
    },
  },
  {
    name: 'generate_story',
    description: 'Test 2 için Gemini 3.1 Flash Lite ile anlık benzersiz hikaye üretir. Test 2 başlamadan ÖNCE bu fonksiyonu çağır ve gelen hikayeyi kullanıcıya anlat.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
      },
      required: ['sessionId'],
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
    description: 'Kullanicinin sesli olarak onaylanmis gorsel tanima cevabini kaydeder ve sonraki gorseli gosterir. Bu fonksiyonu sadece net onay veya acik "bilmiyorum" ifadesinden sonra cagir.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        imageIndex: { type: 'number', description: 'Cevaplanılan görselin indeksi (0, 1, 2)' },
        userAnswer: { type: 'string', description: 'Sesli olarak onaylanmis cevap veya acik "bilmiyorum" ifadesi' },
      },
      required: ['sessionId', 'imageIndex', 'userAnswer'],
    },
  },
  {
    name: 'submit_visual_recognition',
    description: 'Gorsel tanima testinin tamamlanmis ve backend tarafinda dogrulanmis sonuclarini kaydeder. Tum gorseller kapanmadan cagirmazsin.',
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
    name: 'start_video_analysis',
    description: 'Test 4 başlangıcında kullanıcının kamerasını açar ve mimik/göz hareketi analizini başlatır. VideoAnalysisAgent koordinasyonunda çalışır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'stop_video_analysis',
    description: 'Video analizini durdurur ve sonuçları kaydeder. Test 4 sorularından sonra çağır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'send_camera_command',
    description: 'Kullanıcının kamerasına yönlendirme komutu gönderir. Yakınlaş, uzaklaş veya ortala.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        command: { 
          type: 'string', 
          description: 'Kamera komutu: zoom_in (yakınlaş), zoom_out (uzaklaş), center (ortala)',
          enum: ['zoom_in', 'zoom_out', 'center'],
        },
      },
      required: ['sessionId', 'command'],
    },
  },
  {
    name: 'get_current_datetime',
    description: 'DateTimeAgent aracılığıyla güncel tarih, saat, gün, ay, yıl ve mevsim bilgisini alır. Test 4 başında doğru cevapları öğrenmek için çağır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'verify_orientation_answer',
    description: 'DateTimeAgent aracılığıyla kullanıcının yönelim cevabını doğrular. Her soru sonrası çağır.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        questionType: { 
          type: 'string', 
          description: 'Soru tipi',
          enum: ['day', 'month', 'year', 'season', 'city', 'country', 'time'],
        },
        userAnswer: { type: 'string', description: 'Kullanıcının verdiği cevap' },
      },
      required: ['sessionId', 'questionType', 'userAnswer'],
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
  constructor(clientWs, sessionId, onToolCall, options = {}) {
    this.clientWs = clientWs;
    this.sessionId = sessionId;
    this.onToolCall = onToolCall;
    this.geminiSession = null;
    this.isConnected = false;
    this.brainAgent = null; // Brain Agent dışarıdan set edilir
    this.language = normalizeLanguage(options.language);
    this.cameraPermissionGate = {
      active: false,
      heldFunctionResponses: [],
      waitingSince: null,
    };
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
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            prefixPaddingMs: 40,
            silenceDurationMs: 300,
          },
        },
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(this.language) }],
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
        text: pickText(
          this.language,
          'Kullanici yeni baglandi. KARSILAMA KURALLARINA UY: 1) Kendini tanit, 2) Nasilsin diye sor, 3) Bugun 4 kisa test yapacaginizi acikla, 4) "Hazir oldugunuzda baslayalim" de ve ONAY BEKLE. ASLA direkt teste baslama.',
          'A new user connected. FOLLOW WELCOME RULES: 1) Introduce yourself, 2) Ask how they feel, 3) Explain you will do 4 short tests today, 4) Say "Whenever you are ready we can begin" and WAIT for confirmation. NEVER start a test directly.'
        ),
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
      if (this.cameraPermissionGate.active) {
        log.info('Camera gate active - output transcription suppressed', { sessionId: this.sessionId });
        return;
      }
      if (this.brainAgent && text) {
        this.brainAgent.onTranscript('agent', text);
      }
      this.sendToClient({ type: 'output_transcription', text });
    }

    // Audio response ve text parçaları
    if (content.modelTurn && content.modelTurn.parts) {
      for (const part of content.modelTurn.parts) {
        if (this.cameraPermissionGate.active) {
          log.info('Camera gate active - model output suppressed', { sessionId: this.sessionId });
          continue;
        }
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
      log.debug('Turn complete', { sessionId: this.sessionId });
      this.sendToClient({ type: 'turn_complete' });
    }

    // Interrupted - kullanici ajanin sozunu kesti
    if (content.interrupted) {
      log.info('Agent interrupted by user', { sessionId: this.sessionId, phase: this.brainAgent?.testPhase });
      this.sendToClient({ type: 'interrupted' });
    }
  }

  async handleToolCall(toolCall) {
    const functionResponses = [];

    for (const fc of toolCall.functionCalls) {
      log.info('Tool call executing', { sessionId: this.sessionId, tool: fc.name, args: fc.args });

      // BrainAgent'a tool call bildirimi gonder (faz gecisleri icin)
      if (this.brainAgent && typeof this.brainAgent.onToolCall === 'function') {
        this.brainAgent.onToolCall(fc.name);
      }

      this.sendToClient({
        type: 'tool_call',
        name: fc.name,
        args: fc.args,
      });

      let result;
      try {
        result = await this.onToolCall(fc.name, fc.args);
        log.info('Tool call completed', { sessionId: this.sessionId, tool: fc.name, result: this._sanitizeForLog(result) });
      } catch (error) {
        log.error('Tool execution error', { sessionId: this.sessionId, tool: fc.name, error: error.message });
        result = { error: error.message };
      }

      // Tool sonucunu frontend'e TAM haliyle gönder (görsel verisi dahil)
      this.sendToClient({
        type: 'tool_result',
        name: fc.name,
        result: result,
      });

      // Oturum tamamlanınca frontend'i deterministik olarak bilgilendir
      if (fc.name === 'complete_session' && result?.success) {
        this.sendToClient({
          type: 'session_completed',
          sessionId: this.sessionId,
          summary: {
            totalScore: result.totalScore,
            maxPossible: result.maxPossible,
            percentage: result.percentage,
            riskLevel: result.riskLevel,
          },
        });
      }

      // Gemini'ye gönderilecek response'u sanitize et
      // base64 görsel verisi gibi büyük payloadlar Gemini Live API'yi çökertiyor
      // ("Request contains an invalid argument" → session close)
      const sanitizedResult = this._sanitizeToolResponseForGemini(result);

      if (fc.name === 'start_video_analysis' && result?.awaitingClientPermission) {
        this._holdCameraPermissionToolResponse({
          name: fc.name,
          id: fc.id,
          response: sanitizedResult,
        });
        continue;
      }

      functionResponses.push({
        name: fc.name,
        id: fc.id,
        response: sanitizedResult,
      });
    }

    // Sanitize edilmiş tool response'u Gemini'ye gönder
    if (this.geminiSession && this.isConnected && functionResponses.length > 0) {
      try {
        this.geminiSession.sendToolResponse({ functionResponses });
      } catch (error) {
        log.error('sendToolResponse error', { sessionId: this.sessionId, error: error.message });
      }
    }
  }

  /**
   * Gemini Live API'ye gönderilecek tool response'u sanitize eder.
   * base64 görsel verisi, büyük binary data gibi payloadları çıkarır.
   * Gemini Live API ~100KB mesaj boyutu sınırına sahiptir.
   */
  _sanitizeToolResponseForGemini(result) {
    if (!result || typeof result !== 'object') return result;

    const sanitized = {};
    for (const [key, value] of Object.entries(result)) {
      // base64 görsel verisi içeren alanları çıkar
      if (key === 'imageBase64' || key === 'imageData') {
        sanitized[key] = value ? '[IMAGE_DATA_SENT_TO_FRONTEND]' : null;
        continue;
      }
      // Çok büyük string değerleri kırp (50KB üstü)
      if (typeof value === 'string' && value.length > 50000) {
        sanitized[key] = value.substring(0, 100) + `... [${value.length} bytes truncated]`;
        continue;
      }
      // İç içe objeleri de kontrol et
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this._sanitizeToolResponseForGemini(value);
        continue;
      }
      // Array'leri kontrol et - answers gibi normal boyutlu array'ler geçsin
      if (Array.isArray(value)) {
        sanitized[key] = value.map(item => {
          if (item && typeof item === 'object') {
            return this._sanitizeToolResponseForGemini(item);
          }
          return item;
        });
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }

  /**
   * Log için büyük verileri kırp
   */
  _sanitizeForLog(result) {
    if (!result || typeof result !== 'object') return result;
    const logSafe = {};
    for (const [key, value] of Object.entries(result)) {
      if (key === 'imageBase64' || key === 'imageData') {
        logSafe[key] = value ? `[${typeof value === 'string' ? value.length : 0} bytes]` : null;
      } else if (typeof value === 'string' && value.length > 200) {
        logSafe[key] = value.substring(0, 200) + '...';
      } else {
        logSafe[key] = value;
      }
    }
    return logSafe;
  }

  _holdCameraPermissionToolResponse(functionResponse) {
    if (!this.cameraPermissionGate.active) {
      this.cameraPermissionGate.active = true;
      this.cameraPermissionGate.waitingSince = Date.now();
      this.sendToClient({ type: 'interrupted' });
      this.sendToClient({
        type: 'camera_permission_required',
        status: 'pending',
        message: pickText(
          this.language,
          'Kamera izni bekleniyor. Test 4 yazilimsal olarak duraklatildi; izin gelmeden ajan ilerlemeyecek.',
          'Camera permission is pending. Test 4 is paused in software; the agent will not continue until access is granted.'
        ),
      });
      log.info('Camera permission gate activated', { sessionId: this.sessionId });
    }

    this.cameraPermissionGate.heldFunctionResponses.push(functionResponse);
  }

  resumeCameraPermissionGate() {
    if (!this.cameraPermissionGate.active) {
      return false;
    }

    const functionResponses = [...this.cameraPermissionGate.heldFunctionResponses];
    this.cameraPermissionGate.active = false;
    this.cameraPermissionGate.heldFunctionResponses = [];
    this.cameraPermissionGate.waitingSince = null;

    if (this.geminiSession && this.isConnected && functionResponses.length > 0) {
      try {
        this.geminiSession.sendToolResponse({ functionResponses });
        log.info('Camera permission gate released', {
          sessionId: this.sessionId,
          responseCount: functionResponses.length,
        });
        return true;
      } catch (error) {
        log.error('Camera gate release failed', { sessionId: this.sessionId, error: error.message });
      }
    }

    return false;
  }

  sendAudio(audioData) {
    if (this.cameraPermissionGate.active) {
      return;
    }
    if (this.geminiSession && this.isConnected) {
      this.geminiSession.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    }
  }

  sendUserText(text) {
    if (this.cameraPermissionGate.active) {
      return;
    }
    this.sendText(text);
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
    this.cameraPermissionGate.active = false;
    this.cameraPermissionGate.heldFunctionResponses = [];
    this.cameraPermissionGate.waitingSince = null;
  }
}

module.exports = {
  GeminiLiveSession,
  TOOL_DECLARATIONS,
  buildSystemInstruction,
};
