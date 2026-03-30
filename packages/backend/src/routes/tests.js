const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { scoreVerbalFluency } = require('../services/scoring/verbalFluency');
const { scoreStoryRecall } = require('../services/scoring/storyRecall');
const { scoreVisualRecognition } = require('../services/scoring/visualRecognition');
const { scoreOrientation } = require('../services/scoring/orientation');

const router = express.Router();

/**
 * @deprecated Bu endpoint'ler artık Gemini Live tool calling üzerinden çağrılmaktadır.
 * Bkz: services/toolHandler.js — handleVerbalFluency, handleStoryRecall, vb.
 * 
 * Bu dosya yalnızca geriye dönük uyumluluk ve olası harici entegrasyon için korunmaktadır.
 * Yeni özellikler toolHandler.js üzerinden eklenmelidir (single source of truth).
 */

// Test 1: Sözel Akıcılık - Ajan 60 sn'de söylenen kelimeleri gönderir
router.post('/verbal-fluency', authenticate, async (req, res) => {
  try {
    const { sessionId, words, targetLetter, durationSeconds } = req.body;

    // Oturumun kullanıcıya ait olduğunu doğrula
    const session = await prisma.testSession.findFirst({
      where: { id: sessionId, userId: req.userId, status: 'IN_PROGRESS' },
    });
    if (!session) {
      return res.status(404).json({ error: 'Aktif oturum bulunamadı' });
    }

    const { score, maxScore, details } = scoreVerbalFluency(words, targetLetter, durationSeconds);

    const result = await prisma.testResult.upsert({
      where: { sessionId_testType: { sessionId, testType: 'VERBAL_FLUENCY' } },
      update: { rawData: { words, targetLetter, durationSeconds }, score, maxScore, details },
      create: {
        sessionId,
        testType: 'VERBAL_FLUENCY',
        rawData: { words, targetLetter, durationSeconds },
        score,
        maxScore,
        details,
      },
    });

    res.json({ result });
  } catch (err) {
    console.error('Verbal fluency error:', err);
    res.status(500).json({ error: 'Sözel akıcılık testi kaydedilirken hata oluştu' });
  }
});

// Test 2: Hikaye Hatırlama - Ajan kullanıcının tekrarladığı metni gönderir
router.post('/story-recall', authenticate, async (req, res) => {
  try {
    const { sessionId, originalStory, recalledStory, recalledText } = req.body;
    const recalled = recalledStory || recalledText; // Geriye dönük uyumluluk

    const session = await prisma.testSession.findFirst({
      where: { id: sessionId, userId: req.userId, status: 'IN_PROGRESS' },
    });
    if (!session) {
      return res.status(404).json({ error: 'Aktif oturum bulunamadı' });
    }

    const { score, maxScore, details } = scoreStoryRecall(originalStory, recalled);

    const result = await prisma.testResult.upsert({
      where: { sessionId_testType: { sessionId, testType: 'STORY_RECALL' } },
      update: { rawData: { originalStory, recalledStory: recalled }, score, maxScore, details },
      create: {
        sessionId,
        testType: 'STORY_RECALL',
        rawData: { originalStory, recalledStory: recalled },
        score,
        maxScore,
        details,
      },
    });

    res.json({ result });
  } catch (err) {
    console.error('Story recall error:', err);
    res.status(500).json({ error: 'Hikaye hatırlama testi kaydedilirken hata oluştu' });
  }
});

// Test 3: Görsel Tanıma - Ajan kullanıcının cevaplarını gönderir
router.post('/visual-recognition', authenticate, async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    // answers: [{ imageId, correctAnswer, userAnswer }, ...]

    const session = await prisma.testSession.findFirst({
      where: { id: sessionId, userId: req.userId, status: 'IN_PROGRESS' },
    });
    if (!session) {
      return res.status(404).json({ error: 'Aktif oturum bulunamadı' });
    }

    const { score, maxScore, details } = scoreVisualRecognition(answers);

    const result = await prisma.testResult.upsert({
      where: { sessionId_testType: { sessionId, testType: 'VISUAL_RECOGNITION' } },
      update: { rawData: { answers }, score, maxScore, details },
      create: {
        sessionId,
        testType: 'VISUAL_RECOGNITION',
        rawData: { answers },
        score,
        maxScore,
        details,
      },
    });

    res.json({ result });
  } catch (err) {
    console.error('Visual recognition error:', err);
    res.status(500).json({ error: 'Görsel tanıma testi kaydedilirken hata oluştu' });
  }
});

// Test 4: Yönelim - Ajan kullanıcının cevaplarını gönderir
router.post('/orientation', authenticate, async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    // answers: [{ question, correctAnswer, userAnswer }, ...]

    const session = await prisma.testSession.findFirst({
      where: { id: sessionId, userId: req.userId, status: 'IN_PROGRESS' },
    });
    if (!session) {
      return res.status(404).json({ error: 'Aktif oturum bulunamadı' });
    }

    const { score, maxScore, details } = scoreOrientation(answers);

    const result = await prisma.testResult.upsert({
      where: { sessionId_testType: { sessionId, testType: 'ORIENTATION' } },
      update: { rawData: { answers }, score, maxScore, details },
      create: {
        sessionId,
        testType: 'ORIENTATION',
        rawData: { answers },
        score,
        maxScore,
        details,
      },
    });

    res.json({ result });
  } catch (err) {
    console.error('Orientation error:', err);
    res.status(500).json({ error: 'Yönelim testi kaydedilirken hata oluştu' });
  }
});

module.exports = router;
