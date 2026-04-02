const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { generatePdfReport } = require('../services/pdfGenerator');

const router = express.Router();

// Yeni test oturumu başlat
router.post('/', authenticate, async (req, res) => {
  try {
    const session = await prisma.testSession.create({
      data: { userId: req.userId },
      include: { tests: true },
    });

    res.status(201).json({ session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Oturum oluşturulurken hata oluştu' });
  }
});

// Kullanıcının tüm oturumlarını getir
router.get('/', authenticate, async (req, res) => {
  try {
    const sessions = await prisma.testSession.findMany({
      where: { userId: req.userId },
      include: { tests: true },
      orderBy: { startedAt: 'desc' },
    });

    res.json({ sessions });
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: 'Oturumlar alınırken hata oluştu' });
  }
});

// Tek oturum detayı
router.get('/:id', authenticate, async (req, res) => {
  try {
    const session = await prisma.testSession.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { tests: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Oturum bulunamadı' });
    }

    res.json({ session });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ error: 'Oturum alınırken hata oluştu' });
  }
});

// Oturumu tamamla ve toplam skoru hesapla
// Fallback: Results sayfası yüklendiğinde session COMPLETED değilse bu endpoint çağrılır
router.patch('/:id/complete', authenticate, async (req, res) => {
  try {
    const session = await prisma.testSession.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { tests: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Oturum bulunamadı' });
    }

    // Zaten COMPLETED ise tekrar güncelleme — mevcut veriyi dön
    if (session.status === 'COMPLETED') {
      return res.json({ session });
    }

    // Minimum 4 ana test gerekli (VIDEO_ANALYSIS opsiyonel)
    const CORE_TEST_TYPES = ['VERBAL_FLUENCY', 'STORY_RECALL', 'VISUAL_RECOGNITION', 'ORIENTATION'];
    const completedTestTypes = new Set(session.tests.map((t) => t.testType));
    const missingCoreTests = CORE_TEST_TYPES.filter((t) => !completedTestTypes.has(t));

    if (missingCoreTests.length > 0) {
      return res.status(400).json({
        error: `Eksik testler var: ${missingCoreTests.join(', ')}`,
        missingTests: missingCoreTests,
      });
    }

    // Normalize edilmiş ortalama (handleCompleteSession ile tutarlı)
    const percentage = session.tests.length > 0
      ? session.tests.reduce((sum, t) => {
          return sum + (t.maxScore > 0 ? (t.score / t.maxScore) * 100 : 0);
        }, 0) / session.tests.length
      : 0;

    const totalScore = Math.round(percentage * 100) / 100;

    // Risk seviyesini belirle
    let riskLevel = 'LOW';
    if (percentage < 50) riskLevel = 'HIGH';
    else if (percentage < 75) riskLevel = 'MODERATE';

    const updatedSession = await prisma.testSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        totalScore,
        riskLevel,
        completedAt: new Date(),
      },
      include: { tests: true },
    });

    res.json({ session: updatedSession });
  } catch (err) {
    console.error('Complete session error:', err);
    res.status(500).json({ error: 'Oturum tamamlanırken hata oluştu' });
  }
});

// Oturumu iptal et (yarım kalan session'ları CANCELLED yap)
router.patch('/:id/cancel', authenticate, async (req, res) => {
  try {
    const session = await prisma.testSession.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });

    if (!session) {
      return res.status(404).json({ error: 'Oturum bulunamadı' });
    }

    if (session.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Tamamlanmış oturum iptal edilemez' });
    }

    if (session.status === 'CANCELLED') {
      return res.json({ session }); // Zaten iptal edilmiş
    }

    const updatedSession = await prisma.testSession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    res.json({ session: updatedSession });
  } catch (err) {
    console.error('Cancel session error:', err);
    res.status(500).json({ error: 'Oturum iptal edilirken hata oluştu' });
  }
});

// PDF raporu indir
router.get('/:id/pdf', authenticate, async (req, res) => {
  try {
    const session = await prisma.testSession.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { tests: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Oturum bulunamadı' });
    }

    if (session.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Sadece tamamlanmış oturumlar için rapor indirilebilir' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const language = req.query.lang || 'en';
    const pdfBuffer = await generatePdfReport(session, user, language);

    const filename = `nöra-report-${session.id.substring(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'PDF raporu oluşturulurken hata oluştu' });
  }
});

module.exports = router;
