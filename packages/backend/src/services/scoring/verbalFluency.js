/**
 * Sözel Akıcılık Testi Skorlama
 * Kullanıcıdan belirli bir harfle başlayan kelimeleri 60 saniye içinde saymasını ister.
 * Skor: Geçerli benzersiz kelime sayısı
 */
const { normalizeLanguage } = require('../../lib/language');

function getLocale(language) {
  return normalizeLanguage(language) === 'en' ? 'en-US' : 'tr-TR';
}

function scoreVerbalFluency(words, targetLetter, durationSeconds, language = 'tr') {
  const locale = getLocale(language);
  const normalizedLetter = String(targetLetter || '').trim().toLocaleLowerCase(locale);
  const safeWords = Array.isArray(words) ? words : [];

  // Kelimeleri normalize et ve filtrele
  const normalizedWords = safeWords
    .map((w) => String(w || '').trim().toLocaleLowerCase(locale))
    .filter((w) => w.length > 0);

  // Benzersiz kelimeler
  const uniqueWords = [...new Set(normalizedWords)];

  // Hedef harfle başlayan geçerli kelimeler
  const validWords = uniqueWords.filter(
    (w) => w.length > 0 && w.startsWith(normalizedLetter)
  );

  // Geçersiz kelimeler (hedef harfle başlamayan)
  const invalidWords = uniqueWords.filter(
    (w) => w.length > 0 && !w.startsWith(normalizedLetter)
  );

  // Tekrar eden kelimeler
  const duplicates = normalizedWords.length - uniqueWords.length;

  // Skor: Geçerli kelime sayısı, max 25
  const maxScore = 25;
  const score = Math.min(validWords.length, maxScore);

  return {
    score,
    maxScore,
    details: {
      totalWordsSpoken: safeWords.length,
      uniqueWords: uniqueWords.length,
      validWords,
      invalidWords,
      duplicateCount: duplicates,
      targetLetter: normalizedLetter,
      durationSeconds,
    },
  };
}

module.exports = { scoreVerbalFluency };
