/**
 * Video Analizi Skorlama
 * 
 * Test 4 sırasında VideoAnalysisAgent'ın topladığı mimik, göz teması
 * ve dikkat verilerini skorlar.
 * 
 * Skorlama kriterleri:
 *   - Dikkat seviyesi dağılımı (high/medium/low) → %40 ağırlık
 *   - Göz teması oranı → %30 ağırlık
 *   - Yüz ifadesi stabilitesi (tutarlılık) → %30 ağırlık
 * 
 * maxScore: 25 (diğer testlerle uyumlu)
 */

function scoreVideoAnalysis(summary) {
  const maxScore = 25;

  if (!summary || !summary.totalFramesAnalyzed || summary.totalFramesAnalyzed === 0) {
    return {
      score: 0,
      maxScore,
      details: {
        attentionScore: 0,
        eyeContactScore: 0,
        stabilityScore: 0,
        totalFramesAnalyzed: 0,
        note: 'No video analysis data available',
      },
    };
  }

  const total = summary.totalFramesAnalyzed;
  const breakdown = summary.attentionBreakdown || { high: 0, medium: 0, low: 0, unknown: 0 };

  // ── 1. Dikkat skoru (max 10 puan) ──
  // high → tam puan, medium → yarım, low/unknown → 0
  const attentionRaw =
    ((breakdown.high || 0) * 1.0 +
      (breakdown.medium || 0) * 0.5 +
      (breakdown.low || 0) * 0.0 +
      (breakdown.unknown || 0) * 0.25) /
    total;
  const attentionScore = Math.round(attentionRaw * 10 * 100) / 100;

  // ── 2. Göz teması skoru (max 7.5 puan) ──
  const eyeContactRate = (summary.eyeContactRate || 0) / 100; // 0-1
  const eyeContactScore = Math.round(eyeContactRate * 7.5 * 100) / 100;

  // ── 3. İfade stabilitesi skoru (max 7.5 puan) ──
  // Daha az farklı ifade → daha stabil → daha yüksek puan
  const expressionTypes = Object.keys(summary.expressionBreakdown || {}).length;
  let stabilityRatio;
  if (expressionTypes <= 2) stabilityRatio = 1.0;
  else if (expressionTypes <= 3) stabilityRatio = 0.75;
  else if (expressionTypes <= 4) stabilityRatio = 0.5;
  else stabilityRatio = 0.25;
  const stabilityScore = Math.round(stabilityRatio * 7.5 * 100) / 100;

  const score = Math.round(Math.min(attentionScore + eyeContactScore + stabilityScore, maxScore) * 100) / 100;

  return {
    score,
    maxScore,
    details: {
      attentionScore,
      eyeContactScore,
      stabilityScore,
      totalFramesAnalyzed: total,
      attentionBreakdown: breakdown,
      eyeContactRate: summary.eyeContactRate,
      dominantExpression: summary.dominantExpression,
      overallAttention: summary.overallAttention,
      riskIndicators: summary.riskIndicators || [],
    },
  };
}

module.exports = { scoreVideoAnalysis };
