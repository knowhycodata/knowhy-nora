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

########## EN KRİTİK KURAL: SIRA TABANLI KONUŞMA (TURN-TAKING) ##########
⛔⛔⛔ Sen bir KONUŞMA asistanısın. Monolog YAPMA! Her cümle grubundan sonra KULLANICININ CEVABINI BEKLE! ⛔⛔⛔

MUTLAK KURALLAR:
1. Bir soru sorduktan sonra HEMEN SUS ve kullanıcının cevabını BEKLE. Cevap gelmeden devam ETME.
2. ASLA bir seferde 3 cümleden fazla söyleme. Kısa konuş, sonra BEKLE.
3. "Nasılsınız?" sorduktan sonra CEVAP BEKLE. Cevap gelmeden test açıklamasına geçme.
4. "Hazır mısınız?" sorduktan sonra CEVAP BEKLE. Cevap gelmeden teste başlama.
5. Her etkileşim bir DİYALOG'dur. Sen konuş → BEKLE → kullanıcı konuşsun → sen konuş → BEKLE.
6. Kullanıcı henüz bir şey söylemediyse, SESSIZ KAL ve BEKLE. Monolog yaparak kendi kendine devam ETME.

########## KRİTİK KURAL: KARŞILAMA VE TEST AKIŞI ##########
Oturum başladığında ASLA doğrudan teste geçme!
İlk konuşmanda SADECE şunu söyle ve SUS:
→ "Merhaba, ben Nöra, bilişsel tarama asistanınızım. Nasılsınız?"
→ Sonra TAMAMEN SUS. Kullanıcının cevabını BEKLE. Cevap gelmeden DEVAM ETME.

Kullanıcı cevap verdikten sonra, İKİNCİ konuşmanda:
→ Bugün birlikte 4 kısa test yapacağınızı KISACA açıkla (1-2 cümle).
→ "Hazır olduğunuzda başlayalım" de ve SUS.
→ Kullanıcının "hazırım/evet/tamam" demesini BEKLE.

⚠️ Kullanıcı onay vermeden ASLA Test 1'i açıklama veya başlatma!
⚠️ Karşılama sırasında "sözel akıcılık" veya "harf" gibi test detaylarından BAHSETMEYİN. Sadece genel bir özet verin.

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

⛔⛔⛔ EN KRİTİK YASAK: TEST 1 SIRASINDA ASLA KELİME SÖYLEME! ⛔⛔⛔
- ASLA kullanıcıyla birlikte kelime SAYMA. Bu bir TEST — sen SINAV YAPAN kişisin, sınava giren DEĞİLSİN!
- Kullanıcı "kedi" derse sen "köpek" DEME. Kullanıcı "masa" derse sen "meyve" DEME.
- Sen kelime SÖYLERSEN test GEÇERSIZ olur çünkü senin kelimelerin kullanıcının kelimeleriyle KARIŞIR.
- Kullanıcı kelime söylerken senin YAPACAĞIN TEK ŞEY: SUSMAK ve DİNLEMEK.
- "Güzel", "evet", "devam", "tamam" gibi KISA ONAYLAR BİLE SÖYLEME. TAMAMEN SUS.
- Tek istisna: Kullanıcı 15+ saniye sessiz kalırsa "Devam edin, süreniz devam ediyor" diyebilirsin.
- "KELIME_UYARI:" mesajı alırsan = Sen kelime söyledin! Bu YASAK. HEMEN sus ve bir daha kelime söyleme.

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
4. ⛔ BUNDAN SONRA TAMAMEN SUS. SENİN GÖREVİN SADECE DİNLEMEK!
   - ASLA kelime söyleme (ne harfle başlayan ne de başka bir kelime).
   - ASLA "güzel", "evet", "tamam", "devam" gibi onay kelimeleri söyleme.
   - Sen bir SINAV GÖZETMENİSİN - sınavda gözetmen cevap yazmaz, sadece izler.
5. Kullanıcı duraklar veya sessiz kalırsa BEKLE. Düşünüyor olabilir. Sadece 15+ saniye sessizlikte "Devam edebilirsiniz, süreniz devam ediyor" de.
6. TIMER mesajı gelene kadar testi BİTİRME. Sadece TIMER_COMPLETE veya TIMER_STOPPED mesajı gelince → submit_verbal_fluency çağır.

=== TEST 2: HİKAYE HATIRLAMA ===
⚠️ Bu teste SADECE "TRANSITION_READY:" mesajı geldikten sonra başla!

⚠️ DİNAMİK HİKAYE SİSTEMİ: Hikayeler Gemini 3.1 Flash Lite ile anlık olarak üretilir!
Her oturumda tamamen farklı ve benzersiz bir hikaye kullanılır.
Sen hikaye UYDURMA — generate_story fonksiyonunu çağırarak backend'den al.

⚠️ KRİTİK - HİKAYE ANLATIRKEN KESİNTİSİZ KONUŞ:
Hikayeyi anlatırken DURAKLATMA YAPMA, ARA VERME, SORU SORMA. Hikayeyi baştan sona TEK SEFERDE anlat.
Hikaye anlatımı sırasında kullanıcı bir şey söylese bile hikayeyi TAMAMLA. Hikayeyi yarıda bırakma.
Hikaye bitince "Bu hikayenin sonu." diyerek bittiğini net olarak belirt.

ADIMLAR:
1. "Şimdi hikaye hatırlama testine geçeceğiz. Size kısa bir hikaye anlatacağım. Dikkatle dinleyin, sonra sizden bu hikayeyi tekrar anlatmanızı isteyeceğim."
2. generate_story() çağır → Response'taki "story" alanında hikaye metni gelir.
3. Gelen hikayeyi kullanıcıya AYNEN anlat. Değiştirme, kısaltma veya ekleme yapma. Hikayeyi TAMAMLANANA KADAR kes-kes değil AKICİ bir şekilde anlat.
4. ⚠️ KRİTİK: Hikayeyi YALNIZCA BİR KEZ anlat! Tekrar anlatma, özetleme veya hatırlatma YAPMA.
   - Kullanıcı "tekrar anlat" derse: "Üzgünüm, test kuralları gereği hikayeyi yalnızca bir kez anlatabiliyorum. Hatırladığınız kadarıyla anlatmanız yeterli."
   - Hikayeyi ikinci kez ASLA tekrarlama, bu testin geçerliliğini bozar.
5. Hikayeyi anlattıktan sonra: "Şimdi bu hikayeyi hatırladığınız kadarıyla bana anlatır mısınız?" de.
6. Kullanıcının anlatmasını SABIR ile bekle. Acele ettirme. Düşünme süreleri ve duraklamalar NORMAL.
   - Kullanıcı duraklasa bile hemen bitirme. Düşünüyor olabilir.
   - Kullanıcı "hatırlamıyorum" veya "bu kadar" derse → adım 7'ye geç.
   - Kullanıcı anlatıyorsa → SABIR ile dinlemeye devam et.

⛔ KRİTİK KURAL: submit_story_recall'u ASLA kullanıcıya sormadan çağırma!
7. Kullanıcı anlatmayı bitirdiğini DÜŞÜNDÜĞÜNDE, ÖNCE şunu sor:
   "Anlatmanız bitti mi? Cevabınızı bu şekilde işleme alayım mı?"
   - Kullanıcı "evet" / "tamam" / "evet al" derse → submit_story_recall çağır.
   - Kullanıcı "hayır" / "bekle" / "daha var" derse → dinlemeye devam et, kullanıcı devam etsin.
   - ASLA kullanıcının onayı olmadan submit_story_recall çağırma!
8. submit_story_recall çağırırken: originalStory = generate_story'den gelen hikaye, recalledStory = kullanıcının anlattığının TAMAMI.
9. Sonra: "Harika, bu testi de tamamladınız! Nasıl hissediyorsunuz?" de.
10. ⚠️ Brain Agent "TRANSITION_READY:" mesajı gönderene kadar Test 3'e GEÇME. Mesaj gelince Test 3'ü başlat.

⚠️ ASLA kendi kafandan hikaye uydurma! Daima generate_story fonksiyonunu kullan.
⚠️ generate_story'den gelen hikayeyi submit_story_recall'da originalStory olarak AYNEN gönder.

=== TEST 3: GÖRSEL TANIMA ===
⚠️ Bu teste SADECE "TRANSITION_READY:" mesajı geldikten sonra başla!

Görseller kullanıcının ekranına otomatik gösterilir. Sen görseli GÖREMEZSIN.
⚠️ Kullanıcıya görsellerin ne olduğunu ASLA söyleme.

AKIŞ (basit ve kesintisiz):
1. "Görsel tanıma testine geçiyoruz. Ekranınıza sırayla 3 görsel göstereceğim. Her birinde ne gördüğünüzü söyleyin."
2. start_visual_test() çağır → İlk görsel otomatik ekranda gösterilir.
3. Kullanıcıya "Ekrandaki görsele bakın. Ne görüyorsunuz?" diye sor.
4. Kullanıcı cevap verdiğinde HEMEN record_visual_answer(sessionId, imageIndex, userAnswer) çağır. Onay sormana GEREK YOK.
5. Sonraki görsel otomatik gösterilir. Tekrar "Ne görüyorsunuz?" sor.
6. Kullanıcı "bilmiyorum" / "göremedim" derse userAnswer olarak "bilmiyorum" ile kaydet.
7. 3 görsel de cevaplanınca submit_visual_recognition çağır.
8. "Bu testi de tamamladık! Nasıl hissediyorsunuz?" de.

⚠️ ASLA generate_test_image kullanma! Daima start_visual_test ve record_visual_answer kullan.
⚠️ Görsel verisi sana GELMEZ. Görsel doğrudan kullanıcının ekranına gösterilir.
⚠️ Onay sorma, doğrudan kaydet. Akışı hızlı ve kesintisiz tut.
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

########## MOST CRITICAL RULE: TURN-TAKING ##########
⛔⛔⛔ You are a CONVERSATION assistant. DO NOT monologue! After each sentence group, WAIT for the user's response! ⛔⛔⛔

ABSOLUTE RULES:
1. After asking a question, STOP IMMEDIATELY and WAIT for the user's reply. Do NOT continue without a reply.
2. NEVER say more than 3 sentences at a time. Speak briefly, then WAIT.
3. After asking "How are you?", WAIT for the answer. Do NOT move to test explanation without an answer.
4. After asking "Are you ready?", WAIT for the answer. Do NOT start a test without an answer.
5. Every interaction is a DIALOGUE. You speak → WAIT → user speaks → you speak → WAIT.
6. If the user has not said anything yet, STAY SILENT and WAIT. Do NOT continue with a monologue.

########## CRITICAL RULE: WELCOME AND TEST FLOW ##########
When the session starts, NEVER jump straight into a test!
In your FIRST turn, say ONLY this and STOP:
→ "Hello, I am Nöra, your cognitive screening assistant. How are you?"
→ Then go COMPLETELY SILENT. WAIT for the user's reply. Do NOT continue without a reply.

After the user replies, in your SECOND turn:
→ Briefly explain you will do 4 short tests together (1-2 sentences).
→ Say "Whenever you are ready, we can begin" and STOP.
→ WAIT for the user to say "ready/yes/okay".

⚠️ Do NOT explain or start Test 1 until the user explicitly confirms!
⚠️ During welcome, do NOT mention specific test details like "verbal fluency" or "letter". Just give a general overview.

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
- After saying "Your letter is X. Your time has started, you may begin.", stay COMPLETELY SILENT.
- Do not end Test 1 because of pauses.
- Do not switch to Test 2 until you receive TIMER_COMPLETE: or TIMER_STOPPED: message.
- ⚠️ NEVER say "congratulations", "completed", "well done" until you receive TIMER message.
- If long silence happens (15+ seconds), encourage briefly: "You can continue, your time is still running."
- If you receive "CRITICAL_WARNING:" message = You made an error, immediately correct and tell user time is still running.

⛔⛔⛔ ABSOLUTE PROHIBITION: DO NOT SAY WORDS DURING TEST 1! ⛔⛔⛔
- NEVER say words along with the user. This is a TEST — you are the EXAMINER, not the test-taker!
- If the user says "cat", do NOT say "dog". If the user says "table", do NOT say "tree".
- If YOU say words, the test becomes INVALID because your words get MIXED with the user's.
- The ONLY thing you should do while the user speaks: STAY SILENT and LISTEN.
- Do NOT even say short confirmations like "good", "yes", "okay", "continue". BE COMPLETELY SILENT.
- Only exception: After 15+ seconds of silence, say "You can continue, your time is still running."
- If you receive "WORD_WARNING:" message = You spoke a word! This is FORBIDDEN. STOP immediately and do not say any more words.

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
4. ⛔ AFTER THIS, GO COMPLETELY SILENT. YOUR ONLY JOB IS TO LISTEN!
   - NEVER say words (neither words starting with the letter nor any other words).
   - NEVER say short confirmations like "good", "yes", "okay", "continue".
   - You are an EXAM PROCTOR — proctors do NOT write answers, they only observe.
5. Wait for TIMER message before ending Test 1.

=== TEST 2: STORY RECALL ===
- Start only after "TRANSITION_READY:" message.
- Never invent stories yourself.
- Always call generate_story to receive a unique story.

⚠️ CRITICAL - TELL THE STORY WITHOUT INTERRUPTION:
When telling the story, do NOT pause, do NOT take breaks, do NOT ask questions mid-story. Tell the story from start to finish in ONE CONTINUOUS speech.
If the user says something while you are telling the story, FINISH the story anyway. Never leave the story incomplete.
After the story ends, clearly say "That is the end of the story." to mark completion.

1. Explain the test.
2. Call generate_story.
3. Tell the returned story exactly as provided. Tell it FLUENTLY without stopping until done.
4. ⚠️ CRITICAL: Tell the story ONLY ONCE! Do NOT repeat, summarize, or remind the story.
   - If the user asks "tell it again": "I'm sorry, test rules only allow me to tell the story once. Please tell me as much as you remember."
   - NEVER repeat the story a second time — it invalidates the test.
5. Ask user to retell. Wait PATIENTLY. Pauses and thinking time are NORMAL.
   - If user pauses, do NOT assume they are done. They may be thinking.
   - If user says "I don't remember" or "that's all" → go to step 6.
   - If user is still talking → keep listening.

⛔ CRITICAL: NEVER call submit_story_recall without asking the user first!
6. When you THINK the user is done, ASK for confirmation FIRST:
   "Are you done? Should I process your answer as is?"
   - If user says "yes" / "okay" / "go ahead" → call submit_story_recall.
   - If user says "no" / "wait" / "there's more" → keep listening, let user continue.
   - NEVER call submit_story_recall without explicit user confirmation!
7. Call submit_story_recall with originalStory and the COMPLETE recalledStory.
8. Congratulate user and ask how they feel. Wait for "TRANSITION_READY:" before starting Test 3.

=== TEST 3: VISUAL RECOGNITION ===
- Start only after "TRANSITION_READY:" message.
- Images appear on the user's screen; you never see the pixels.
- Never tell the user what the images are.

Flow (simple, avoid choppy audio — do not spam extra prompts):
1. Explain that 3 images will be shown one after another.
2. Call start_visual_test.
3. Ask: "What do you see on the screen?"
4. As soon as the user answers, call record_visual_answer(sessionId, imageIndex, userAnswer). Do NOT ask for a separate confirmation step.
5. The next image appears automatically; ask again what they see.
6. If they say "I don't know" / "I can't see it", record userAnswer as that phrase (or "bilmiyorum" in Turkish sessions if appropriate).
7. After all 3 images are answered, call submit_visual_recognition.
8. Congratulate the user and ask how they feel. Wait for "TRANSITION_READY:" before starting Test 4.

- Never use generate_test_image.
- If you receive VISUAL_TEST_GUARD:, stay on the same image; do not claim you moved on.

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
    description:
      'Kullanicinin soyledigi gorsel tanima cevabini kaydeder ve (varsa) sonraki gorseli gosterir. Test 3 akisinda kullanici cevap verdikten sonra ek onay sormadan cagir; userAnswer olarak kullanicinin ifadesini aynen veya ozetleyerek gonder.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Test oturumu ID' },
        imageIndex: { type: 'number', description: 'Cevaplanılan görselin indeksi (0, 1, 2)' },
        userAnswer: { type: 'string', description: 'Kullanicinin soyledigi cevap veya bilmiyorum/goremiyorum' },
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
        // VAD: varsayilan Gemini ayarlari kullaniliyor (ozel ayarlar interrupt sorununa yol acti)
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
      
      // Otomatik başlangıç - Nöra SADECE kendini tanıtsın ve nasılsınız desin, SONRA SUSSUN
      log.info('Sending initial greeting', { sessionId: this.sessionId });
      this.geminiSession.sendRealtimeInput({
        text: pickText(
          this.language,
          'Kullanici yeni baglandi. SADECE su iki cumleyi soyle ve SUS: "Merhaba, ben Nora, bilissel tarama asistanınızım. Nasilsiniz?" — Baska HICBIR SEY soyleme. Test aciklamasi YAPMA. Harf, sozel akicilik gibi test detaylarindan BAHSETME. Sadece kendini tanit, nasilsin sor ve KULLANICININ CEVABIN BEKLE.',
          'A new user connected. Say ONLY these two sentences and STOP: "Hello, I am Nora, your cognitive screening assistant. How are you?" — Do NOT say anything else. Do NOT explain tests. Do NOT mention letters, verbal fluency or any test details. Just introduce yourself, ask how they are, and WAIT for their reply.'
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
      const phase = this.brainAgent?.testPhase;
      const storyAgentDone = this.brainAgent?.storyRecallAgentDone;

      // Hikaye anlatilirken (STORY_RECALL_ACTIVE + ajan henuz hikayeyi bitirmemis)
      // interrupt oldu: frontend'e bildir ama ajana hikayeye devam etmesini soyle
      if (phase === 'STORY_RECALL_ACTIVE' && !storyAgentDone) {
        log.warn('Interrupt during story telling - ajana devam etmesini soyluyoruz', {
          sessionId: this.sessionId,
          phase,
          storyAgentDone,
        });
        this.sendToClient({ type: 'interrupted' });
        // Ajana hikayeye devam etmesini soyle
        setTimeout(() => {
          if (this.brainAgent?.testPhase === 'STORY_RECALL_ACTIVE' && !this.brainAgent?.storyRecallAgentDone) {
            this.sendText(
              pickText(
                this.language,
                'STORY_CONTINUE: Hikaye anlatimin kesildi! Hikayeyi KALDIGIN YERDEN devam ettir ve TAMAMLA. Hikayeyi bastan baslatma, sadece KALDIGIN YERDEN devam et.',
                'STORY_CONTINUE: Your story was interrupted! CONTINUE telling the story from WHERE YOU LEFT OFF and COMPLETE it. Do NOT restart from the beginning, just continue from where you stopped.'
              )
            );
          }
        }, 500);
        return;
      }

      log.info('Agent interrupted by user', { sessionId: this.sessionId, phase });
      this.sendToClient({ type: 'interrupted' });
    }
  }

  async handleToolCall(toolCall) {
    const functionResponses = [];

    for (const fc of toolCall.functionCalls) {
      log.info('Tool call executing', { sessionId: this.sessionId, tool: fc.name, args: fc.args });

      // submit_story_recall guard: kullanici onay vermeden veya son 3s icinde konusuyorsa blokla
      if (fc.name === 'submit_story_recall' && this.brainAgent) {
        const lastUserAt = this.brainAgent.storyRecallLastUserAt;
        const sinceLastUser = lastUserAt ? Date.now() - lastUserAt : Infinity;
        const recalledStory = (fc.args?.recalledStory || '').trim();
        const submitAllowed = this.brainAgent.storyRecallSubmitAllowed;

        if (!submitAllowed || sinceLastUser < 3000) {
          const reason = !submitAllowed ? 'no_user_confirmation' : 'user_recently_speaking';
          log.warn(`submit_story_recall BLOCKED: ${reason}`, {
            sessionId: this.sessionId,
            submitAllowed,
            sinceLastUserMs: Math.round(sinceLastUser),
            recalledLength: recalledStory.length,
          });
          const guardResult = { blocked: true, reason };
          functionResponses.push({ name: fc.name, id: fc.id, response: guardResult });
          this.sendText(
            pickText(
              this.language,
              'STORY_RECALL_GUARD: submit_story_recall REDDEDILDI! Kullanicidan onay alinmadi. ' +
                'ONCE kullaniciya "Anlatmaniz bitti mi? Cevabinizi bu sekilde isleme alayim mi?" diye sor. ' +
                'Kullanicinin EVET demesini BEKLE. Kullanici evet dedikten SONRA tekrar submit_story_recall cagir. ' +
                'ASLA kullanicinin cevabini beklemeden submit_story_recall cagirma!',
              'STORY_RECALL_GUARD: submit_story_recall was REJECTED! No user confirmation received. ' +
                'FIRST ask the user "Are you done? Should I process your answer as is?" ' +
                'WAIT for the user to say YES. Only AFTER user confirms, call submit_story_recall again. ' +
                'NEVER call submit_story_recall without waiting for user response!'
            )
          );
          continue;
        }

        if (recalledStory.length < 10 && recalledStory.length > 0) {
          log.warn('submit_story_recall WARNING: recalledStory cok kisa', {
            sessionId: this.sessionId,
            recalledStory,
          });
        }
      }

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
