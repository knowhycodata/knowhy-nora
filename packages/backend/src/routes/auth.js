const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { isSafeEmail, normalizeEmailInput } = require('../lib/emailValidation');

const router = express.Router();
const INVALID_EMAIL_MESSAGE = 'Geçerli bir e-posta adresi girin';

function emailValidator() {
  return body('email')
    .customSanitizer(normalizeEmailInput)
    .custom((value) => {
      if (!isSafeEmail(value)) {
        throw new Error(INVALID_EMAIL_MESSAGE);
      }
      return true;
    });
}

// Kayıt
router.post(
  '/register',
  [
    emailValidator(),
    body('password')
      .isLength({ min: 6, max: 128 }).withMessage('Şifre 6-128 karakter arası olmalı')
      .custom((value) => {
        if (/^\s+$/.test(value)) {
          throw new Error('Şifre sadece boşluk karakterlerinden oluşamaz');
        }
        return true;
      }),
    body('name')
      .trim()
      .notEmpty().withMessage('İsim gerekli')
      .isLength({ max: 100 }).withMessage('İsim en fazla 100 karakter olabilir')
      .escape(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, name } = req.body;

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: { email, password: hashedPassword, name },
        select: { id: true, email: true, name: true, createdAt: true },
      });

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      });

      res.status(201).json({ user, token });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu' });
    }
  }
);

// Giriş
router.post(
  '/login',
  [
    emailValidator(),
    body('password').notEmpty().withMessage('Şifre gerekli').isLength({ max: 128 }).withMessage('Şifre çok uzun'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Geçersiz e-posta veya şifre' });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Geçersiz e-posta veya şifre' });
      }

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      });

      res.json({
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
    }
  }
);

// Profil
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Profil alınırken hata oluştu' });
  }
});

module.exports = router;
