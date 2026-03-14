/**
 * Visual Test Keywords - Test 3 Dinamik Kelime Havuzu
 * 
 * Her session başladığında bu havuzdan rastgele 3 kelime seçilir.
 * Böylece her test oturumunda farklı görseller gösterilir.
 * Kelimeler bilişsel tarama için uygun, somut ve tanınabilir nesnelerdir.
 * 
 * Kategoriler:
 *   - Ev Eşyaları: Günlük hayatta sıkça karşılaşılan objeler
 *   - Hayvanlar: Yaygın bilinen hayvanlar
 *   - Araçlar: Ulaşım araçları
 *   - Yiyecekler: Tanınması kolay gıdalar
 *   - Doğa: Doğal objeler
 *   - Giyim: Kıyafet ve aksesuarlar
 */

const KEYWORD_POOL = [
  // Ev Eşyaları
  { subject: 'saat', correctAnswer: 'saat', category: 'ev' },
  { subject: 'anahtar', correctAnswer: 'anahtar', category: 'ev' },
  { subject: 'kalem', correctAnswer: 'kalem', category: 'ev' },
  { subject: 'masa', correctAnswer: 'masa', category: 'ev' },
  { subject: 'sandalye', correctAnswer: 'sandalye', category: 'ev' },
  { subject: 'bardak', correctAnswer: 'bardak', category: 'ev' },
  { subject: 'kitap', correctAnswer: 'kitap', category: 'ev' },
  { subject: 'lamba', correctAnswer: 'lamba', category: 'ev' },
  { subject: 'telefon', correctAnswer: 'telefon', category: 'ev' },
  { subject: 'çanta', correctAnswer: 'çanta', category: 'ev' },
  { subject: 'ayna', correctAnswer: 'ayna', category: 'ev' },
  { subject: 'tabak', correctAnswer: 'tabak', category: 'ev' },
  { subject: 'çatal', correctAnswer: 'çatal', category: 'ev' },
  { subject: 'makas', correctAnswer: 'makas', category: 'ev' },
  { subject: 'şemsiye', correctAnswer: 'şemsiye', category: 'ev' },

  // Hayvanlar
  { subject: 'kedi', correctAnswer: 'kedi', category: 'hayvan' },
  { subject: 'köpek', correctAnswer: 'köpek', category: 'hayvan' },
  { subject: 'kuş', correctAnswer: 'kuş', category: 'hayvan' },
  { subject: 'balık', correctAnswer: 'balık', category: 'hayvan' },
  { subject: 'kelebek', correctAnswer: 'kelebek', category: 'hayvan' },
  { subject: 'at', correctAnswer: 'at', category: 'hayvan' },
  { subject: 'tavşan', correctAnswer: 'tavşan', category: 'hayvan' },

  // Araçlar
  { subject: 'araba', correctAnswer: 'araba', category: 'araç' },
  { subject: 'bisiklet', correctAnswer: 'bisiklet', category: 'araç' },
  { subject: 'gemi', correctAnswer: 'gemi', category: 'araç' },
  { subject: 'uçak', correctAnswer: 'uçak', category: 'araç' },
  { subject: 'tren', correctAnswer: 'tren', category: 'araç' },

  // Yiyecekler
  { subject: 'elma', correctAnswer: 'elma', category: 'yiyecek' },
  { subject: 'ekmek', correctAnswer: 'ekmek', category: 'yiyecek' },
  { subject: 'muz', correctAnswer: 'muz', category: 'yiyecek' },
  { subject: 'portakal', correctAnswer: 'portakal', category: 'yiyecek' },
  { subject: 'çilek', correctAnswer: 'çilek', category: 'yiyecek' },

  // Doğa
  { subject: 'ağaç', correctAnswer: 'ağaç', category: 'doğa' },
  { subject: 'çiçek', correctAnswer: 'çiçek', category: 'doğa' },
  { subject: 'güneş', correctAnswer: 'güneş', category: 'doğa' },
  { subject: 'yıldız', correctAnswer: 'yıldız', category: 'doğa' },
  { subject: 'bulut', correctAnswer: 'bulut', category: 'doğa' },
  { subject: 'dağ', correctAnswer: 'dağ', category: 'doğa' },

  // Giyim & Aksesuar
  { subject: 'şapka', correctAnswer: 'şapka', category: 'giyim' },
  { subject: 'gözlük', correctAnswer: 'gözlük', category: 'giyim' },
  { subject: 'ayakkabı', correctAnswer: 'ayakkabı', category: 'giyim' },
  { subject: 'eldiven', correctAnswer: 'eldiven', category: 'giyim' },
];

/**
 * Havuzdan rastgele N adet benzersiz keyword seçer.
 * Farklı kategorilerden seçim yapmaya çalışır (çeşitlilik).
 * 
 * @param {number} count - Seçilecek keyword sayısı (default: 3)
 * @returns {Array<{index: number, subject: string, correctAnswer: string, category: string}>}
 */
function selectRandomKeywords(count = 3) {
  if (count > KEYWORD_POOL.length) {
    count = KEYWORD_POOL.length;
  }

  // Kategorilere göre grupla
  const categories = {};
  for (const kw of KEYWORD_POOL) {
    if (!categories[kw.category]) categories[kw.category] = [];
    categories[kw.category].push(kw);
  }

  const categoryNames = Object.keys(categories);
  const selected = [];
  const usedCategories = new Set();

  // İlk geçiş: Her kategoriden farklı birer tane seç
  const shuffledCategories = shuffleArray([...categoryNames]);
  for (const cat of shuffledCategories) {
    if (selected.length >= count) break;
    const pool = categories[cat];
    const randomItem = pool[Math.floor(Math.random() * pool.length)];
    selected.push(randomItem);
    usedCategories.add(cat);
  }

  // Eksik kaldıysa kalan havuzdan tamamla
  if (selected.length < count) {
    const remaining = KEYWORD_POOL.filter(
      kw => !selected.some(s => s.subject === kw.subject)
    );
    const shuffled = shuffleArray(remaining);
    for (const item of shuffled) {
      if (selected.length >= count) break;
      selected.push(item);
    }
  }

  // Index ata
  return selected.map((kw, idx) => ({
    index: idx,
    subject: kw.subject,
    correctAnswer: kw.correctAnswer,
    category: kw.category,
  }));
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { KEYWORD_POOL, selectRandomKeywords };
