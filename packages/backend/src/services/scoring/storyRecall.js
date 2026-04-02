const stringSimilarity = require('string-similarity');
const { normalizeLanguage } = require('../../lib/language');

function getLocale(language) {
  return normalizeLanguage(language) === 'en' ? 'en-US' : 'tr-TR';
}

const STOP_WORDS = {
  tr: ['ve', 'bir', 'bu', 'da', 'de', 'ile', 'için', 'çok', 'daha', 'olan', 'den', 'dan', 'sonra', 'gibi'],
  en: ['the', 'and', 'was', 'she', 'her', 'his', 'they', 'them', 'with', 'from', 'that', 'this', 'then', 'also', 'were', 'had', 'for', 'but', 'not'],
};

/**
 * Hikaye Hatırlama Testi Skorlama
 * Orijinal hikaye ile kullanıcının tekrarladığı metin arasındaki benzerliği ölçer.
 */
function scoreStoryRecall(originalStory, recalledText, language = 'tr') {
  const locale = getLocale(language);
  const lang = normalizeLanguage(language);
  const maxScore = 25;

  if (!recalledText || recalledText.trim().length === 0) {
    return {
      score: 0,
      maxScore,
      details: { similarity: 0, keywordsFound: [], keywordsMissed: [], recalledLength: 0 },
    };
  }

  const normalizedOriginal = originalStory.toLocaleLowerCase(locale).trim();
  const normalizedRecalled = recalledText.toLocaleLowerCase(locale).trim();

  // Genel metin benzerliği (Dice coefficient)
  const similarity = stringSimilarity.compareTwoStrings(normalizedOriginal, normalizedRecalled);

  // Anahtar kelime analizi - hikayedeki önemli kelimeleri çıkar (4+ karakter)
  const stopWords = STOP_WORDS[lang] || STOP_WORDS.tr;
  const originalWords = normalizedOriginal
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.includes(w));

  const uniqueKeywords = [...new Set(originalWords)];

  const keywordsFound = uniqueKeywords.filter((kw) => normalizedRecalled.includes(kw));
  const keywordsMissed = uniqueKeywords.filter((kw) => !normalizedRecalled.includes(kw));

  const keywordRatio = uniqueKeywords.length > 0 ? keywordsFound.length / uniqueKeywords.length : 0;

  // Ağırlıklı skor: %60 benzerlik + %40 anahtar kelime eşleşmesi
  const weightedScore = similarity * 0.6 + keywordRatio * 0.4;
  const score = Math.round(weightedScore * maxScore * 100) / 100;

  return {
    score: Math.min(score, maxScore),
    maxScore,
    details: {
      similarity: Math.round(similarity * 100) / 100,
      keywordRatio: Math.round(keywordRatio * 100) / 100,
      keywordsFound,
      keywordsMissed,
      totalKeywords: uniqueKeywords.length,
      recalledLength: recalledText.trim().length,
    },
  };
}

module.exports = { scoreStoryRecall };
