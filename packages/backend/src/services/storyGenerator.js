/**
 * Story Generator - Test 2 Dinamik Hikaye Üretimi
 * 
 * Gemini 3.1 Flash Lite kullanarak her session'da benzersiz hikayeler üretir.
 * API hatası durumunda geniş bir statik hikaye havuzundan fallback seçim yapar.
 * 
 * Mimari:
 *   generate_story tool call → storyGenerator.generateStory()
 *     → Gemini 3.1 Flash Lite API (birincil)
 *     → Statik hikaye havuzu (fallback)
 *     → Nöra'ya hikaye metni döner → Nöra kullanıcıya anlatır
 */

const { GoogleGenAI } = require('@google/genai');
const { createLogger } = require('../lib/logger');
const { normalizeLanguage, isEnglish } = require('../lib/language');

const log = createLogger('StoryGenerator');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const STORY_MODEL = process.env.GEMINI_STORY_MODEL || 'gemini-3.1-flash-lite-preview';

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

/**
 * Hikaye üretim prompt'u — bilişsel tarama için optimize edilmiş
 * Kısa, somut, günlük yaşam sahneleri, 5-7 cümle, isim/yer/eylem detayları
 */
const STORY_GENERATION_PROMPT_TR = `Sen bir bilişsel tarama sistemi için hikaye üreten bir asistansın.

GÖREV: Alzheimer / bilişsel tarama testi için kullanılacak KISA bir hikaye üret.

KURALLAR:
- Hikaye Türkçe olmalı.
- 5-7 cümle uzunluğunda olmalı (çok kısa veya çok uzun olmamalı).
- Günlük yaşamdan somut bir sahne anlat (market, park, okul, hastane, ev vb.).
- En az 2 farklı kişi adı kullan (Türk isimleri).
- En az 1 yer adı veya mekan belirt.
- En az 3 somut nesne veya eylem içer (yemek, alışveriş, yürüyüş vb.).
- Zaman sırası olsun (sabah → öğle → akşam gibi).
- Basit ve anlaşılır cümleler kur — karmaşık yapılar kullanma.
- Hikaye sıcak ve pozitif bir ton taşısın.
- Sadece hikaye metnini döndür, başka açıklama ekleme.
- Tırnak işareti kullanma, düz metin olarak yaz.

ÖRNEK UZUNLUK (referans - bunu kopyalama, benzersiz hikaye üret):
"Ali sabah erkenden kalktı ve parkta yürüyüş yaptı. Parkta komşusu Mehmet ile karşılaştı. Birlikte bankta oturup sohbet ettiler. Sonra fırına gidip taze ekmek aldılar. Eve dönünce Ali çay demleyip bahçede kahvaltı yaptı. Öğleden sonra torunları geldi ve birlikte bahçede oyun oynadılar."

Şimdi tamamen yeni ve benzersiz bir hikaye üret:`;

const STORY_GENERATION_PROMPT_EN = `You are a story writer for a cognitive screening system.

TASK: Generate a SHORT story suitable for Alzheimer/cognitive screening recall tests.

RULES:
- The story must be in English.
- Keep it 5-7 sentences (not too short or too long).
- Describe a concrete everyday scene (grocery, park, school, hospital, home, etc.).
- Use at least 2 different person names.
- Mention at least 1 place.
- Include at least 3 concrete objects or actions.
- Keep a clear timeline (morning to afternoon to evening, etc.).
- Use simple and clear sentences.
- Keep a warm and positive tone.
- Return only the story text. Do not add commentary.
- Do not wrap in quotes.

Now write a brand-new unique story:`;

/**
 * Geniş statik hikaye havuzu — API fallback
 * 30 benzersiz hikaye, farklı temalar ve karakterler
 */
const FALLBACK_STORIES_TR = [
  "Mehmet sabah erkenden uyandı ve bahçeye çıktı. Bahçedeki çiçekleri suladı ve domates topladı. Sonra mutfağa gidip kahvaltı hazırladı. Komşusu Ali geldi, birlikte çay içtiler. Öğleden sonra Mehmet pazara gitti ve taze balık aldı. Akşam balığı pişirip ailesiyle yedi.",
  "Zeynep otobüsle hastaneye gitti. Hastanede hemşire arkadaşı Fatma ile karşılaştı. Birlikte kantinde çorba içtiler. Sonra Zeynep doktorla görüştü ve ilaçlarını aldı. Eczaneden çıkınca yağmur başladı. Bir taksi çevirip eve döndü ve sıcak bir süt içti.",
  "Küçük Emre okuldan eve geldi ve çantasını bıraktı. Annesi ona sıcak bir çorba hazırlamıştı. Çorbayı içtikten sonra kedisiyle oynadı. Sonra ödevlerini yaptı ve resim çizdi. Akşam babası marketten dondurma getirdi. Hep birlikte televizyon izleyip uyudular.",
  "Ayşe sabah erkenden kalktı ve kahvaltıda çay içti. Sonra otobüse binip markete gitti. Marketten meyve ve sebze aldı. Eve dönünce komşusu Elif ziyarete geldi. Birlikte pasta yaptılar ve çay içtiler. Akşam Ayşe kitabını okuyup erken yattı.",
  "Hasan amca her sabah parkta yürüyüş yapar. O gün parkta eski arkadaşı Mustafa ile karşılaştı. Birlikte bankta oturup eski günleri konuştular. Sonra kahvaltıya gittiler ve börek yediler. Öğleden sonra Hasan eve döndü ve torununu okuldan aldı. Akşam birlikte puzzle yaptılar.",
  "Deniz öğretmen sabah okula erken geldi ve sınıfı hazırladı. Tahtaya soruları yazdı. Öğrenciler gelince birlikte matematik çalıştılar. Teneffüste bahçede futbol oynadılar. Öğleden sonra resim dersi yaptılar. Okul çıkışı Deniz kütüphaneye uğrayıp yeni bir roman aldı.",
  "Selin ve annesi Nurcan sabah pazara gittiler. Taze domates, biber ve patlıcan aldılar. Sonra balıkçıdan levrek aldılar. Eve dönüşte fırından sıcak pide aldılar. Öğle yemeğinde birlikte kızartma yaptılar. Akşam babası Kemal eve gelince hep birlikte çay içtiler.",
  "Kemal bey emekli olduktan sonra bahçeyle ilgilenmeye başladı. Sabah gül fidanlarını budadı ve çimleri biçti. Komşusu Ahmet gelip yardım etti. Birlikte limonata içip dinlendiler. Öğleden sonra Kemal bey tohumları ekti. Akşam karısı Hatice ile bahçede mangal yaptılar.",
  "Cemile teyze her cuma gün komşularıyla buluşur. O gün evinde börek pişirdi ve çay demledi. Komşusu Hacer ve Gülsüm geldi. Birlikte el işi yaptılar ve sohbet ettiler. Öğleden sonra birlikte düğün alışverişine çıktılar. Akşam Cemile teyze yorgun ama mutlu eve döndü.",
  "Oğuz sabah koşusuna çıktı ve sahil boyunca beş kilometre koştu. Dönüşte fırından poğaça aldı. Evde duş aldıktan sonra kahvaltı hazırladı. Arkadaşı Burak kahvaltıya geldi. Birlikte futbol maçı izlediler. Öğleden sonra ikisi birlikte bisiklete bindiler.",
  "Elif öğretmen sabah kütüphaneye gitti ve çocuklara masal okudu. Küçük Yusuf en ön sırada oturuyordu. Masal bitince çocuklar resim çizdi. Öğle yemeğinde Elif kantinde arkadaşı Merve ile buluştu. İkisi birlikte çay içip sohbet ettiler. Akşam Elif evde yeni bir kitap okumaya başladı.",
  "Murat ve eşi Esra hafta sonu pikniğe gittiler. Göl kenarında güzel bir yer buldular. Mangal yakıp köfte pişirdiler. Çocukları Efe ve Defne göl kenarında oynadı. Öğleden sonra hep birlikte yürüyüşe çıktılar. Eve dönüşte yolda dondurma yediler.",
  "Hatice nine her sabah caminin yanındaki çeşmeden su alır. O gün su alırken eski arkadaşı Emine ile karşılaştı. Birlikte çarşıya yürüdüler ve kumaş baktılar. Sonra lokantada mercimek çorbası içtiler. Eve dönünce Hatice nine kızı Fatma'yı aradı. Akşam birlikte yemek yaptılar.",
  "Ali usta sabah erken dükkanını açtı ve tezgahını hazırladı. İlk müşterisi Veli bey geldi ve ayakkabısını tamir ettirdi. Öğleye doğru çırak Hasan çay getirdi. Birlikte çay içip ekmek arası peynir yediler. Öğleden sonra üç müşteri daha geldi. Akşam Ali usta dükkanı kapatıp eve yürüdü.",
  "Leyla ve kızı Ceren sabah otobüsle şehir merkezine gittiler. Önce bankaya uğradılar sonra alışveriş merkezine girdiler. Ceren'e yeni bir çanta aldılar. Öğle yemeğinde pizzacıda pizza yediler. Sonra sinemaya gidip komedi filmi izlediler. Eve dönerken marketten süt ve ekmek aldılar.",
  "Rıza dede her öğlen cami avlusundaki bankta oturur. O gün yanına Süleyman dede geldi ve tavla kurdular. İki saat tavla oynadılar ve çay içtiler. Mahalleli çocuklar gelip onları seyretti. Küçük Berk tavla oynamayı öğrenmek istedi. Rıza dede ona sabırla öğretti ve akşam hep birlikte eve yürüdüler.",
  "Nurhan hemşire sabah hastanede nöbete başladı. İlk olarak hastaların tansiyonlarını ölçtü. Doktor Serkan bey ile vizite yaptılar. Öğle yemeğinde meslektaşı Dilek ile yemekhanede buluştu. Birlikte salata ve pilav yediler. Akşam nöbet bitince Nurhan evde sıcak bir duş alıp dinlendi.",
  "Tuncay kaptan her sabah balığa çıkar. O gün teknesiyle açığa gitti ve ağlarını attı. Yanında yardımcısı Ferhat da vardı. Öğleye kadar beş kilo levrek tuttular. Limana dönünce balıkları temizlediler. Akşam Tuncay kaptan balıkları komşularına dağıttı ve karısı Sevgi ile yemek yedi.",
  "Gülten teyze sabah erken kalktı ve hamur yoğurdu. Mantı yapmaya karar vermişti. Kızı Serap gelip yardım etti. Birlikte iki saat mantı açtılar ve pişirdiler. Öğle yemeğinde damadı Volkan da geldi. Hep birlikte mantı yediler ve çay içtiler.",
  "Barış sabah laboratuvara geldi ve deneylerini kontrol etti. Arkadaşı Cansu da aynı projede çalışıyordu. Birlikte verileri analiz ettiler. Öğle yemeğinde kampüsteki kafede tost yediler. Öğleden sonra profesör Yılmaz ile toplantı yaptılar. Akşam Barış kütüphanede makale okuyup eve döndü.",
  "Songül ve eşi Tayfun sabah erken yola çıktılar. Memleketleri Bolu'ya gidiyorlardı. Yolda molada çay ve simit aldılar. Bolu'ya varınca Songül'ün annesi Hayriye onları karşıladı. Birlikte bahçede oturup muhabbet ettiler. Akşam Hayriye nine su böreği yaptı ve hep birlikte yediler.",
  "Cem her cumartesi sabahı bisikletle sahile gider. O gün sahilde arkadaşı Tolga ile buluştu. Birlikte sahil boyunca on kilometre pedal çevirdiler. Dönüşte sahildeki kafede portakal suyu içtiler. Öğleden sonra Cem eve gidip duş aldı. Akşam ailesiyle birlikte balık restoranına gittiler.",
  "Pınar sabah atölyesine geldi ve boyalarını hazırladı. Yeni bir tablo yapmaya başlamıştı. Tuval üzerine mavi ve yeşil tonlarında bir deniz manzarası çizdi. Öğle yemeğinde arkadaşı Seda geldi ve birlikte sandviç yediler. Öğleden sonra Pınar tabloyu bitirdi. Akşam sergi için çerçeveletmeye götürdü.",
  "İbrahim amca sabah erkenden tarlaya gitti ve buğdayı kontrol etti. Traktörüyle tarlayı sürdü. Öğleye doğru eşi Nesrin yemek getirdi. Birlikte ağacın altında oturup yemek yediler. Öğleden sonra komşu çiftçi Osman da geldi ve hasat planını konuştular. Akşam İbrahim amca yorgun ama huzurlu eve döndü.",
  "Melike sabah yoga yaptıktan sonra mutfağa geçti. Smoothie hazırlayıp kahvaltı etti. Sonra otobüsle işe gitti. İş yerinde toplantıya katıldı ve sunum yaptı. Öğle yemeğinde meslektaşı Burcu ile sushi yediler. Akşam Melike sinemaya gidip romantik bir film izledi.",
  "Yusuf dede ve torunu Ela sabah kuş yemi almaya çıktılar. Parktaki kuşlara yem attılar ve güvercinleri beslediler. Sonra oyun parkına gittiler ve Ela salıncağa bindi. Öğle yemeğinde pideciye gittiler ve lahmacun yediler. Eve dönünce Yusuf dede Ela'ya masal anlattı. Akşam Ela'nın annesi Aslı gelip onu aldı.",
  "Derya hemşire sabah kliniği açtı ve randevuları kontrol etti. İlk hasta küçük Berat'tı, aşı olacaktı. Derya onu sakinleştirdi ve aşıyı yaptı. Öğleye kadar on beş hasta baktı. Yemekte arkadaşı Özlem ile hastane bahçesinde sandviç yediler. Akşam Derya eve gidip kızı Ada ile birlikte kurabiye pişirdi.",
  "Orhan öğretmen sabah müzik odasını hazırladı ve piyanonun başına oturdu. Öğrencileri gelince birlikte şarkı söylediler. Küçük Beren en güzel sesi çıkaran öğrenciydi. Teneffüste okul bahçesinde birlikte ip atladılar. Öğleden sonra Orhan öğretmen gitar dersi verdi. Akşam evde eşi Sibel ile birlikte müzik dinleyip çay içtiler.",
  "Fadime nine sabah erken kalktı ve tandır ekmeği pişirdi. Oğlu Recep marketten peynir ve zeytin getirdi. Birlikte avluda kahvaltı yaptılar. Öğleye doğru komşu Halime nine geldi ve birlikte yün eğirdiler. Öğleden sonra Fadime nine bahçedeki domatesleri topladı. Akşam torunları gelince hep birlikte tandır ekmeğiyle yemek yediler.",
  "Selim ve arkadaşı Kaan sabah erken buluştular ve dağa tırmanışa çıktılar. Yolda kestane topladılar ve manzaranın fotoğrafını çektiler. Zirveye öğleye doğru ulaştılar ve termoslarından çay içtiler. İnerken yağmura yakalandılar ve bir çobanın kulübesinde sığındılar. Çoban Dursun onlara peynir ekmek ikram etti. Akşam şehre döndüler ve sıcak bir çorba içtiler.",
];

const FALLBACK_STORIES_EN = [
  "Emma woke up early and walked to the neighborhood bakery. She met her friend Daniel on the way and they bought warm bread together. After breakfast, Emma went to the park and read a short novel on a bench. In the afternoon, Daniel called and invited her to the grocery store to buy fruit and milk. They returned home before sunset and prepared a simple pasta dinner.",
  "Michael took the bus to the hospital in the morning for a routine check. At the entrance he met nurse Sarah, and they talked for a few minutes. After his appointment, he stopped by the pharmacy to pick up his medicine. Around noon he had soup and tea at a small cafe near the square. In the evening he went home, watered his plants, and called his daughter.",
  "Lena and her brother Noah visited the city market on Saturday morning. They bought tomatoes, oranges, and a small bouquet of flowers for their mother. At noon they returned home and cooked vegetable soup in the kitchen. Later they cleaned the living room and organized old photo albums. In the evening the family sat together, drank tea, and watched a comedy show.",
  "James left home early and cycled along the seaside road. He stopped at a kiosk and bought a bottle of water and a sandwich. Around midday he met his coworker Olivia at the library to return two books. In the afternoon they walked to the station and discussed next week's plans. After sunset James went home, took a shower, and listened to music.",
  "Sophie started her day by feeding the cat and opening the windows. She then met her neighbor Mark in the garden and helped him carry flower pots. Around noon they visited a nearby cafe and shared a slice of cake. In the afternoon Sophie bought a notebook and pens from a stationery shop. In the evening she wrote in her journal and called her grandmother.",
  "Ryan and his wife Chloe drove to a small town for a family visit. On the way they stopped for coffee and fresh bagels. At noon they arrived at Chloe's aunt's house and helped set the table for lunch. In the afternoon the children played in the backyard with a red ball and a kite. Before returning, everyone took a group photo in front of the house.",
  "Ava arrived at school before the first bell and prepared the classroom. She wrote today's schedule on the board and placed books on each desk. During the break she spoke with teacher Liam near the playground. After lunch she helped students paint trees and birds in art class. In the evening Ava went home, made herbal tea, and reviewed tomorrow's lesson plan.",
  "Daniel spent the morning at his workshop repairing old chairs. His friend Ethan brought him a toolbox and a new brush. Around noon they ate sandwiches and apples under a large tree. In the afternoon Daniel delivered one repaired chair to Mrs. Grace across the street. At night he returned home, made soup, and read the newspaper.",
  "Mia took her daughter Ella to the museum on Sunday morning. They looked at paintings and a model ship in the history hall. At noon they bought orange juice and cookies from the museum cafe. In the afternoon they walked through the city center and picked up bread from a bakery. In the evening Ella drew pictures of what she saw and showed them to her father.",
  "Lucas woke up early to catch a train to the capital. He sat by the window and wrote a short to-do list in his notebook. After arriving, he met his colleague Nora near the station and they went to a meeting room. Around noon they ordered rice, salad, and lemonade for lunch. In the evening Lucas took the train back and relaxed at home with a cup of tea.",
];

// Kullanılan hikayelerin takibi (tekrarı önlemek)
const usedStoryIndicesByLanguage = {
  tr: new Set(),
  en: new Set(),
};

/**
 * Gemini 3.1 Flash Lite ile anlık hikaye üretir.
 * API hatası durumunda fallback havuzundan seçer.
 * 
 * @returns {Promise<{story: string, source: 'ai'|'fallback', model?: string}>}
 */
async function generateStory(language = 'tr') {
  const normalizedLanguage = normalizeLanguage(language);
  const isEn = isEnglish(normalizedLanguage);
  const prompt = isEn ? STORY_GENERATION_PROMPT_EN : STORY_GENERATION_PROMPT_TR;

  log.info('Hikaye üretimi başlıyor', { model: STORY_MODEL, language: normalizedLanguage });

  // Önce AI ile dene
  try {
    const response = await ai.models.generateContent({
      model: STORY_MODEL,
      contents: prompt,
      config: {
        temperature: 1.0,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 512,
      },
    });

    const text = response?.text?.trim();

    if (text && text.length > 50 && text.length < 1000) {
      // Tırnak işaretlerini temizle
      const cleanStory = text.replace(/^["'"""]+|["'"""]+$/g, '').trim();
      
      log.info('Hikaye AI ile üretildi', {
        model: STORY_MODEL,
        length: cleanStory.length,
        preview: cleanStory.substring(0, 80),
      });

      return {
        story: cleanStory,
        source: 'ai',
        model: STORY_MODEL,
        language: normalizedLanguage,
      };
    }

    log.warn('AI hikaye çıktısı geçersiz, fallback kullanılıyor', {
      textLength: text?.length || 0,
    });
  } catch (error) {
    log.error('Gemini hikaye üretim hatası, fallback kullanılıyor', {
      model: STORY_MODEL,
      error: error.message,
    });
  }

  // Fallback: Statik havuzdan seç
  return selectFallbackStory(normalizedLanguage);
}

/**
 * Statik havuzdan tekrar etmeyen rastgele hikaye seçer
 */
function selectFallbackStory(language = 'tr') {
  const normalizedLanguage = normalizeLanguage(language);
  const pool = isEnglish(normalizedLanguage) ? FALLBACK_STORIES_EN : FALLBACK_STORIES_TR;
  const usedStoryIndices = usedStoryIndicesByLanguage[normalizedLanguage] || usedStoryIndicesByLanguage.tr;

  // Tüm hikayeler kullanıldıysa sıfırla
  if (usedStoryIndices.size >= pool.length) {
    log.info('Tüm fallback hikayeler kullanıldı, sıfırlanıyor');
    usedStoryIndices.clear();
  }

  // Kullanılmamış indeksleri bul
  const available = [];
  for (let i = 0; i < pool.length; i++) {
    if (!usedStoryIndices.has(i)) available.push(i);
  }

  const randomIdx = available[Math.floor(Math.random() * available.length)];
  usedStoryIndices.add(randomIdx);

  const story = pool[randomIdx];

  log.info('Fallback hikaye seçildi', {
    index: randomIdx,
    language: normalizedLanguage,
    usedCount: usedStoryIndices.size,
    totalPool: pool.length,
    preview: story.substring(0, 80),
  });

  return {
    story,
    source: 'fallback',
    language: normalizedLanguage,
  };
}

module.exports = {
  generateStory,
  FALLBACK_STORIES: {
    tr: FALLBACK_STORIES_TR,
    en: FALLBACK_STORIES_EN,
  },
};
