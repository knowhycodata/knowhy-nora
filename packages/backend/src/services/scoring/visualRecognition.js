const stringSimilarity = require('string-similarity');

/**
 * Görsel Tanıma Testi Skorlama
 * 3 görsel gösterilir, kullanıcıdan ne olduğunu söylemesi istenir.
 * Her doğru cevap için puan verilir; yakın cevaplar kısmi puan alır.
 */
function scoreVisualRecognition(answers) {
  const maxScore = 25;
  const perImageMax = maxScore / 3; // Her görsel ~8.33 puan

  let totalImageScore = 0;
  const detailedResults = [];

  for (const answer of answers) {
    const correct = String(answer.correctAnswer || '').toLowerCase().trim();
    const user = String(answer.userAnswer || '').toLowerCase().trim();

    if (!user) {
      detailedResults.push({
        imageId: answer.imageId,
        correct: answer.correctAnswer,
        userAnswer: answer.userAnswer,
        similarity: 0,
        pointsEarned: 0,
      });
      continue;
    }

    // Tam eşleşme veya benzerlik skoru
    const similarity = stringSimilarity.compareTwoStrings(correct, user);
    let pointsEarned = 0;

    if (similarity >= 0.8) {
      pointsEarned = perImageMax; // Tam puan
    } else if (similarity >= 0.5) {
      pointsEarned = perImageMax * 0.5; // Kısmi puan
    } else if (correct.includes(user) || user.includes(correct)) {
      pointsEarned = perImageMax * 0.5;
    }

    totalImageScore += pointsEarned;

    detailedResults.push({
      imageId: answer.imageId,
      correct: answer.correctAnswer,
      userAnswer: answer.userAnswer,
      similarity: Math.round(similarity * 100) / 100,
      pointsEarned: Math.round(pointsEarned * 100) / 100,
    });
  }

  return {
    score: Math.round(Math.min(totalImageScore, maxScore) * 100) / 100,
    maxScore,
    details: {
      results: detailedResults,
      totalImages: answers.length,
    },
  };
}

module.exports = { scoreVisualRecognition };
