const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const { createLogger } = require('./lib/logger');
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const testRoutes = require('./routes/tests');
const { GeminiLiveSession } = require('./services/geminiLive');
const { handleToolCall, registerGeminiSession, unregisterGeminiSession, registerVisualTestAgent, unregisterVisualTestAgent, registerVideoAnalysisAgent, unregisterVideoAnalysisAgent, getVideoAnalysisAgent, registerCameraPresenceAgent, unregisterCameraPresenceAgent, getCameraPresenceAgent, registerBrainAgent, unregisterBrainAgent, registerDateTimeAgent, unregisterDateTimeAgent, registerSessionLanguage, unregisterSessionLanguage, markCameraPermissionStatus, markCameraFrameReceived, unregisterCameraAccessState } = require('./services/toolHandler');
const { BrainAgent } = require('./services/brainAgent');
const { VisualTestAgent } = require('./services/visualTestAgent');
const { VideoAnalysisAgent } = require('./services/videoAnalysisAgent');
const { CameraPresenceAgent } = require('./services/cameraPresenceAgent');
const { DateTimeAgent } = require('./services/dateTimeAgent');
const { prefetchStory, clearPrefetchCache } = require('./services/storyPrefetchAgent');
const prisma = require('./lib/prisma');
const { normalizeLanguage, pickText } = require('./lib/language');

const log = createLogger('Server');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const SESSION_MAX_DURATION_MS = (() => {
  const parsed = Number.parseInt(process.env.SESSION_MAX_DURATION_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8 * 60 * 1000;
})();
const SESSION_MAX_DURATION_SECONDS = Math.ceil(SESSION_MAX_DURATION_MS / 1000);

function normalizeOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const trimmed = origin.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return trimmed.replace(/\/+$/, '');
  }
}

function resolveAllowedOrigins() {
  const configuredOrigins = [process.env.CORS_ALLOWED_ORIGINS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map(normalizeOrigin)
    .filter(Boolean);

  return Array.from(new Set(['http://localhost:5173', ...configuredOrigins].map(normalizeOrigin).filter(Boolean)));
}

const allowedOrigins = resolveAllowedOrigins();

// Güvenlik middleware'leri
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    log.warn('Blocked CORS origin', { origin, normalizedOrigin });
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
log.info('CORS allowlist configured', { allowedOrigins });

// Rate limiting — IP bazlı genel limit
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

// Sorun 13 FIX: Authenticated kullanıcılar için daha esnek rate limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // JWT token varsa kullanıcı ID'sine göre, yoksa IP'ye göre
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return `user_${decoded.userId}`;
      }
    } catch (_) { /* token geçersizse IP'ye düş */ }
    return req.ip;
  },
});
app.use('/api/sessions', authLimiter);
app.use('/api/tests', authLimiter);

// Sağlık kontrolü
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rotalar
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/tests', testRoutes);

// Frontend log endpoint
const frontendLog = createLogger('Frontend');
app.post('/api/logs', (req, res) => {
  const { level, module, message, data, timestamp } = req.body;
  
  // Frontend loglarını backend logger ile yaz
  const logFn = frontendLog[level.toLowerCase()] || frontendLog.info;
  logFn(`[${module}] ${message}`, data);
  
  res.status(204).send();
});

// ─── WebSocket Server (Gemini Live Proxy) ─────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/live' });
const activeSessions = new Map();

wss.on('connection', async (ws, req) => {
  const clientId = Date.now().toString(36);
  log.info('New WebSocket connection', { clientId });

  let geminiSession = null;
  let userId = null;
  let testSessionId = null;
  let sessionLanguage = 'tr';
  let sessionTimeoutId = null;
  let sessionCleanupDone = false;
  let sessionExpired = false;

  function clearSessionTimeoutTimer() {
    if (sessionTimeoutId) {
      clearTimeout(sessionTimeoutId);
      sessionTimeoutId = null;
    }
  }

  function cleanupSessionResources() {
    if (sessionCleanupDone) return;
    sessionCleanupDone = true;
    clearSessionTimeoutTimer();

    if (geminiSession) {
      geminiSession.close();
      geminiSession = null;
    }

    if (!testSessionId) {
      return;
    }

    activeSessions.delete(testSessionId);
    unregisterGeminiSession(testSessionId);
    unregisterVisualTestAgent(testSessionId);
    unregisterVideoAnalysisAgent(testSessionId);
    unregisterCameraPresenceAgent(testSessionId);
    unregisterBrainAgent(testSessionId);
    unregisterDateTimeAgent(testSessionId);
    unregisterSessionLanguage(testSessionId);
    unregisterCameraAccessState(testSessionId);
    clearPrefetchCache(testSessionId);
  }

  async function cancelSessionIfInProgress(reason = 'unknown') {
    if (!testSessionId) return;

    try {
      const session = await prisma.testSession.findUnique({
        where: { id: testSessionId },
        select: { status: true },
      });

      if (session && session.status === 'IN_PROGRESS') {
        await prisma.testSession.update({
          where: { id: testSessionId },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        log.info('Session marked as CANCELLED', { clientId, testSessionId, reason });
      }
    } catch (err) {
      log.error('Session CANCELLED guncelleme hatasi', {
        clientId,
        testSessionId,
        reason,
        error: err.message,
      });
    }
  }

  async function handleSessionTimeout() {
    if (sessionExpired || !testSessionId) {
      return;
    }

    sessionExpired = true;
    clearSessionTimeoutTimer();

    log.warn('Session hard timeout reached', {
      clientId,
      testSessionId,
      durationSeconds: SESSION_MAX_DURATION_SECONDS,
    });

    await cancelSessionIfInProgress('MAX_DURATION_REACHED');

    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'interrupted' }));
      ws.send(JSON.stringify({
        type: 'session_expired',
        sessionId: testSessionId,
        reason: 'MAX_DURATION_REACHED',
        durationSeconds: SESSION_MAX_DURATION_SECONDS,
        redirectTo: '/dashboard',
        message: pickText(
          sessionLanguage,
          'Bu tarama oturumu en fazla 8 dakika surebilir. Sure doldugu icin oturum guvenlik ve maliyet kontrolu amaciyla sonlandirildi.',
          'This screening session can last at most 8 minutes. The session was hard-stopped for safety and cost control because the time limit was reached.'
        ),
      }));
    }

    cleanupSessionResources();

    if (ws.readyState === 1 || ws.readyState === 0) {
      setTimeout(() => {
        try {
          if (ws.readyState === 1 || ws.readyState === 0) {
            ws.close(4000, 'SESSION_EXPIRED');
          }
        } catch (error) {
          log.warn('Session timeout socket close warning', {
            clientId,
            testSessionId,
            error: error.message,
          });
        }
      }, 120);
    }
  }

  function scheduleSessionTimeout() {
    clearSessionTimeoutTimer();
    const expiresAt = new Date(Date.now() + SESSION_MAX_DURATION_MS);
    sessionTimeoutId = setTimeout(() => {
      handleSessionTimeout().catch((error) => {
        log.error('Session timeout handling failed', {
          clientId,
          testSessionId,
          error: error.message,
        });
      });
    }, SESSION_MAX_DURATION_MS);
    return expiresAt;
  }

  ws.on('message', async (rawData) => {
    try {
      // Önce JSON olarak parse etmeyi dene
      let message = null;
      try {
        const str = rawData.toString();
        message = JSON.parse(str);
      } catch {
        // JSON değilse binary audio'dur
        message = null;
      }

      if (message) {
        // JSON mesaj
        log.info('WS JSON message received', { clientId, type: message.type });
        
        switch (message.type) {
          case 'auth': {
            try {
              const decoded = jwt.verify(message.token, process.env.JWT_SECRET);
              userId = decoded.userId;
              log.info('Auth successful', { clientId, userId });
              ws.send(JSON.stringify({ type: 'auth_success', userId }));
            } catch (err) {
              log.error('Auth failed', { clientId, error: err.message });
              ws.send(JSON.stringify({ type: 'auth_error', message: 'Geçersiz token' }));
              ws.close();
            }
            break;
          }

          case 'start_session': {
            if (!userId) {
              log.warn('start_session without auth', { clientId });
              ws.send(JSON.stringify({ type: 'error', message: 'Önce kimlik doğrulaması gerekli' }));
              return;
            }

            sessionLanguage = normalizeLanguage(message.language);
            log.info('Creating test session', { clientId, userId, language: sessionLanguage });

            // Yeni test oturumu oluştur
            const session = await prisma.testSession.create({
              data: { userId },
            });
            testSessionId = session.id;
            log.info('Test session created', { clientId, testSessionId });
            registerSessionLanguage(testSessionId, sessionLanguage);

            // Gemini Live oturumu başlat
            geminiSession = new GeminiLiveSession(ws, testSessionId, (toolName, args) => {
              return handleToolCall(toolName, { ...args, sessionId: testSessionId }, ws, testSessionId);
            }, { language: sessionLanguage });
            
            // Brain Agent oluştur - transkript analiz ve timer yönetimi
            const brainAgent = new BrainAgent(
              testSessionId,
              // sendToClient - frontend'e mesaj gönder
              (data) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(data));
                }
              },
              // sendTextToLive - Live ajan'a text mesaj gönder
              (text) => {
                if (geminiSession) {
                  geminiSession.sendText(text);
                }
              },
              sessionLanguage
            );
            geminiSession.brainAgent = brainAgent;
            registerBrainAgent(testSessionId, brainAgent);
            
            // VisualTestAgent oluştur - Test 3 koordinasyonu
            const visualTestAgent = new VisualTestAgent(
              testSessionId,
              // sendToClient - frontend'e mesaj gönder
              (data) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(data));
                }
              },
              // sendTextToLive - Live ajan'a text mesaj gönder
              (text) => {
                if (geminiSession) {
                  geminiSession.sendText(text);
                }
              },
              sessionLanguage
            );
            registerVisualTestAgent(testSessionId, visualTestAgent);
            
            // Brain Agent'a VisualTestAgent referansını ver
            brainAgent.visualTestAgent = visualTestAgent;
            
            // VideoAnalysisAgent oluştur - Test 4 mimik/göz hareketi analizi
            const videoAnalysisAgent = new VideoAnalysisAgent(
              testSessionId,
              // sendToClient - frontend'e mesaj gönder
              (data) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(data));
                }
              },
              // sendTextToLive - Live ajan'a text mesaj gönder
              (text) => {
                if (geminiSession) {
                  geminiSession.sendText(text);
                }
              },
              sessionLanguage
            );
            registerVideoAnalysisAgent(testSessionId, videoAnalysisAgent);

            // CameraPresenceAgent oluştur - Test 4 kadraj takibi / müdahale
            const cameraPresenceAgent = new CameraPresenceAgent(
              testSessionId,
              (data) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(data));
                }
              },
              (text) => {
                if (geminiSession) {
                  geminiSession.sendText(text);
                }
              },
              sessionLanguage
            );
            registerCameraPresenceAgent(testSessionId, cameraPresenceAgent);
            
            // DateTimeAgent oluştur - Test 4 tarih/saat doğrulama
            const dateTimeAgent = new DateTimeAgent(testSessionId, sessionLanguage);
            registerDateTimeAgent(testSessionId, dateTimeAgent);
            
            // Brain Agent'a VideoAnalysisAgent referansını ver
            brainAgent.videoAnalysisAgent = videoAnalysisAgent;
            
            // Timer için Gemini session'ı register et
            registerGeminiSession(testSessionId, geminiSession);

            // BUG-011 FIX: Hikaye ön-üretimini asenkron başlat (kullanıcıyı bekletmez)
            prefetchStory(testSessionId, sessionLanguage).catch((err) => {
              log.warn('Hikaye ön-üretim başlatılamadı (kritik değil)', { testSessionId, error: err.message });
            });

            log.info('Connecting to Gemini Live...', { clientId, testSessionId });
            const connected = await geminiSession.connect();
            if (connected) {
              const sessionExpiresAt = scheduleSessionTimeout();
              activeSessions.set(testSessionId, geminiSession);
              log.info('Gemini Live connected, session started', { clientId, testSessionId });
              ws.send(JSON.stringify({
                type: 'session_started',
                sessionId: testSessionId,
                language: sessionLanguage,
                sessionDurationSeconds: SESSION_MAX_DURATION_SECONDS,
                sessionExpiresAt: sessionExpiresAt.toISOString(),
              }));
            } else {
              log.error('Gemini Live connection failed', { clientId, testSessionId });
              ws.send(JSON.stringify({ type: 'error', message: 'Gemini Live bağlantısı kurulamadı' }));
            }
            break;
          }

          case 'text': {
            if (geminiSession) {
              geminiSession.sendUserText(message.text);
            }
            break;
          }

          case 'video_frame': {
            // Frontend'den gelen kamera frame'i → VideoAnalysisAgent'a ilet
            if (testSessionId && message.frameData) {
              markCameraFrameReceived(testSessionId);
              const videoAgent = getVideoAnalysisAgent(testSessionId);
              if (videoAgent && videoAgent.isActive) {
                videoAgent.analyzeFrame(message.frameData)
                  .then((analysis) => {
                    if (!analysis) return;
                    const presenceAgent = getCameraPresenceAgent(testSessionId);
                    if (presenceAgent && presenceAgent.isActive) {
                      presenceAgent.observeAnalysis(analysis);
                    }
                  })
                  .catch(err => {
                    log.error('Video frame analiz hatası', { clientId, error: err.message });
                  });
              }
            }
            break;
          }

          case 'camera_permission_status': {
            if (!testSessionId) {
              break;
            }

            const status = typeof message.status === 'string' ? message.status : 'error';
            const cameraMessage = pickText(
              sessionLanguage,
              status === 'denied'
                ? 'Kamera izni reddedildi. Test 4 ve oturum tamamlama icin kamera zorunludur. Lutfen tarayici ayarlarindan izin verip tekrar deneyin.'
                : status === 'granted'
                ? 'Kamera izni verildi. Test 4 devam edebilir.'
                : 'Kamera acilamadi. Test 4 icin calisir durumda bir kamera gereklidir.',
              status === 'denied'
                ? 'Camera permission was denied. Camera access is mandatory for Test 4 and session completion. Please allow it from browser settings and try again.'
                : status === 'granted'
                ? 'Camera permission granted. Test 4 can continue.'
                : 'The camera could not be opened. A working camera is required for Test 4.'
            );

            markCameraPermissionStatus(testSessionId, status, message.error || message.message || null);
            log.info('Camera permission status received', {
              clientId,
              testSessionId,
              status,
              error: message.error || null,
            });

            if (status === 'granted') {
              ws.send(JSON.stringify({
                type: 'camera_permission_restored',
                status,
                message: cameraMessage,
              }));
              if (geminiSession) {
                geminiSession.resumeCameraPermissionGate();
              }
              break;
            }

            ws.send(JSON.stringify({
              type: 'camera_permission_required',
              status,
              message: cameraMessage,
            }));
            break;
          }

          case 'end_session': {
            clearSessionTimeoutTimer();
            await cancelSessionIfInProgress('USER_ENDED_SESSION');
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'session_ended' }));
            }
            cleanupSessionResources();
            break;
          }

          default:
            log.warn('Unknown message type', { clientId, type: message.type });
        }
      } else {
        // Binary audio
        const base64Audio = Buffer.from(rawData).toString('base64');
        if (geminiSession) {
          if (!ws._audioChunkCount) ws._audioChunkCount = 0;
          ws._audioChunkCount++;
          if (ws._audioChunkCount === 1 || ws._audioChunkCount % 200 === 0) {
            log.debug('Audio chunk received', { clientId, chunkCount: ws._audioChunkCount, dataSize: rawData.byteLength });
          }
          geminiSession.sendAudio(base64Audio);
        } else {
          log.warn('Audio received but no Gemini session', { clientId });
        }
      }
    } catch (error) {
      log.error('Message handling error', { clientId, error: error.message, stack: error.stack });
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    log.info('WebSocket closed', { clientId, testSessionId });
    cleanupSessionResources();
    // FIX: WebSocket kapatıldığında DB'de session durumunu CANCELLED yap
    // AMA sadece session IN_PROGRESS ise (COMPLETED olanları değiştirme)
    if (testSessionId && !sessionExpired) {
      cancelSessionIfInProgress('WS_CLOSED').catch((err) => {
        log.error('Session CANCELLED guncelleme hatasi (ws.close)', {
          testSessionId,
          error: err.message,
        });
      });
    }
  });

  ws.on('error', (error) => {
    log.error('WebSocket error', { clientId, error: error.message });
    cleanupSessionResources();
  });
});

// Genel hata yakalama
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Sunucu hatası oluştu',
    ...(process.env.NODE_ENV === 'development' && { details: err.message }),
  });
});

server.listen(PORT, () => {
  log.info(`🧠 Nöra Backend running on port ${PORT}`);
  log.info(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws/live`);
});

module.exports = app;
