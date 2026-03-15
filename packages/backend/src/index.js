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
const { handleToolCall, registerGeminiSession, unregisterGeminiSession, registerVisualTestAgent, unregisterVisualTestAgent, registerVideoAnalysisAgent, unregisterVideoAnalysisAgent, getVideoAnalysisAgent, registerCameraPresenceAgent, unregisterCameraPresenceAgent, getCameraPresenceAgent, registerBrainAgent, unregisterBrainAgent, registerDateTimeAgent, unregisterDateTimeAgent, registerSessionLanguage, unregisterSessionLanguage } = require('./services/toolHandler');
const { BrainAgent } = require('./services/brainAgent');
const { VisualTestAgent } = require('./services/visualTestAgent');
const { VideoAnalysisAgent } = require('./services/videoAnalysisAgent');
const { CameraPresenceAgent } = require('./services/cameraPresenceAgent');
const { DateTimeAgent } = require('./services/dateTimeAgent');
const prisma = require('./lib/prisma');
const { normalizeLanguage } = require('./lib/language');

const log = createLogger('Server');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Güvenlik middleware'leri
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

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

            log.info('Connecting to Gemini Live...', { clientId, testSessionId });
            const connected = await geminiSession.connect();
            if (connected) {
              activeSessions.set(testSessionId, geminiSession);
              log.info('Gemini Live connected, session started', { clientId, testSessionId });
              ws.send(JSON.stringify({
                type: 'session_started',
                sessionId: testSessionId,
                language: sessionLanguage,
              }));
            } else {
              log.error('Gemini Live connection failed', { clientId, testSessionId });
              ws.send(JSON.stringify({ type: 'error', message: 'Gemini Live bağlantısı kurulamadı' }));
            }
            break;
          }

          case 'text': {
            if (geminiSession) {
              geminiSession.sendText(message.text);
            }
            break;
          }

          case 'video_frame': {
            // Frontend'den gelen kamera frame'i → VideoAnalysisAgent'a ilet
            if (testSessionId && message.frameData) {
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

          case 'end_session': {
            if (geminiSession) {
              geminiSession.close();
              activeSessions.delete(testSessionId);
              unregisterGeminiSession(testSessionId);
              unregisterVisualTestAgent(testSessionId);
              unregisterVideoAnalysisAgent(testSessionId);
              unregisterCameraPresenceAgent(testSessionId);
              unregisterBrainAgent(testSessionId);
              unregisterDateTimeAgent(testSessionId);
              unregisterSessionLanguage(testSessionId);
              geminiSession = null;
            }
            ws.send(JSON.stringify({ type: 'session_ended' }));
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
    if (geminiSession) {
      geminiSession.close();
      activeSessions.delete(testSessionId);
      unregisterVisualTestAgent(testSessionId);
      unregisterVideoAnalysisAgent(testSessionId);
      unregisterCameraPresenceAgent(testSessionId);
      unregisterBrainAgent(testSessionId);
      unregisterDateTimeAgent(testSessionId);
      unregisterSessionLanguage(testSessionId);
    }
  });

  ws.on('error', (error) => {
    log.error('WebSocket error', { clientId, error: error.message });
    if (geminiSession) {
      geminiSession.close();
      activeSessions.delete(testSessionId);
      unregisterVisualTestAgent(testSessionId);
      unregisterVideoAnalysisAgent(testSessionId);
      unregisterCameraPresenceAgent(testSessionId);
      unregisterBrainAgent(testSessionId);
      unregisterDateTimeAgent(testSessionId);
      unregisterSessionLanguage(testSessionId);
    }
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
