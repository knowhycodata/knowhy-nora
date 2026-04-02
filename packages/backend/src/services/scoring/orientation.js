const stringSimilarity = require('string-similarity');
const { normalizeLanguage } = require('../../lib/language');

function getLocale(language) {
  return normalizeLanguage(language) === 'en' ? 'en-US' : 'tr-TR';
}

/**
 * Yönelim Testi Skorlama
 * 7 yönelim sorusu (zaman, mekan) sorulur.
 * Her doğru cevap için puan verilir.
 */
function scoreOrientation(answers, language = 'tr') {
  const locale = getLocale(language);
  const maxScore = 25;
  const perQuestionMax = maxScore / 7; // Her soru ~3.57 puan

  let totalPoints = 0;
  const detailedResults = [];

  for (const answer of answers) {
    const correct = answer.correctAnswer.toLocaleLowerCase(locale).trim();
    const user = (answer.userAnswer || '').toLocaleLowerCase(locale).trim();

    if (!user) {
      detailedResults.push({
        question: answer.question,
        correct: answer.correctAnswer,
        userAnswer: answer.userAnswer,
        isCorrect: false,
        pointsEarned: 0,
      });
      continue;
    }

    // Tam eşleşme veya yüksek benzerlik
    const similarity = stringSimilarity.compareTwoStrings(correct, user);
    const isCorrect = similarity >= 0.7 || correct.includes(user) || user.includes(correct);
    const pointsEarned = isCorrect ? perQuestionMax : 0;

    totalPoints += pointsEarned;

    detailedResults.push({
      question: answer.question,
      correct: answer.correctAnswer,
      userAnswer: answer.userAnswer,
      isCorrect,
      similarity: Math.round(similarity * 100) / 100,
      pointsEarned: Math.round(pointsEarned * 100) / 100,
    });
  }

  return {
    score: Math.round(Math.min(totalPoints, maxScore) * 100) / 100,
    maxScore,
    details: {
      results: detailedResults,
      correctCount: detailedResults.filter((r) => r.isCorrect).length,
      totalQuestions: answers.length,
    },
  };
}

module.exports = { scoreOrientation };
