/**
 * Gemini Live WebSocket Hook
 * Backend WebSocket'ine bağlanarak Gemini Live API ile iletişim kurar.
 * Ref-based mimari: stale closure sorunlarını önler.
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import { createLogger } from '../lib/logger';

const log = createLogger('useGeminiLive');

function normalizeWsUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${trimmed}`;
  }

  const malformedPrefixMatch = trimmed.match(/^(wss?:\/\/)(https?:\/\/.+)$/i);
  const candidateUrl = malformedPrefixMatch ? malformedPrefixMatch[2] : trimmed;

  try {
    const parsed = new URL(candidateUrl, window.location.origin);

    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProtocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function resolveWsUrl() {
  const rawEnvWsUrl = import.meta.env.VITE_WS_URL;
  const envWsUrl = normalizeWsUrl(rawEnvWsUrl);
  if (envWsUrl) {
    return envWsUrl;
  }

  if (rawEnvWsUrl && rawEnvWsUrl.trim().length > 0) {
    log.warn('Invalid VITE_WS_URL ignored, falling back to auto URL', { rawEnvWsUrl });
  }

  const apiBase = import.meta.env.VITE_API_URL || '/api';
  try {
    const apiUrl = new URL(apiBase, window.location.origin);
    const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${apiUrl.host}/ws/live`;
  } catch (error) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/live`;
  }
}

const WS_URL = resolveWsUrl();
log.info('WebSocket URL', {
  url: WS_URL,
  envWsUrl: import.meta.env.VITE_WS_URL || null,
  apiBase: import.meta.env.VITE_API_URL || '/api',
});

function normalizeLanguage(input) {
  if (typeof input !== 'string') return 'tr';
  const normalized = input.trim().toLowerCase();
  return normalized === 'en' ? 'en' : 'tr';
}

function pickText(language, trText, enText) {
  return normalizeLanguage(language) === 'en' ? enText : trText;
}

export const SESSION_STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  READY: 'ready',
  ACTIVE: 'active',
  SPEAKING: 'speaking',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
};

export function useGeminiLive() {
  const [state, setState] = useState(SESSION_STATES.IDLE);
  const [sessionId, setSessionId] = useState(null);
  const [currentTest, setCurrentTest] = useState(null);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [cameraAccessError, setCameraAccessError] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  
  // Timer state
  const [timer, setTimer] = useState(null); // { duration, remaining, testType, active }
  const timerActiveRef = useRef(false); // BUG-009 FIX: race condition guard
  const [sessionLimit, setSessionLimit] = useState(null); // { durationSeconds, remainingSeconds, expiresAt, active }
  const [sessionTimeout, setSessionTimeout] = useState(null);
  
  // Camera / Video Analysis state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraCommand, setCameraCommand] = useState(null);
  const [videoAnalysisResult, setVideoAnalysisResult] = useState(null);
  const [cameraPresence, setCameraPresence] = useState(null);

  const wsRef = useRef(null);
  const stateRef = useRef(state);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const lastTokenRef = useRef(null);
  const lastOptionsRef = useRef({});
  const MAX_RECONNECT_ATTEMPTS = 3;
  const recorderCtxRef = useRef(null);
  const recorderNodeRef = useRef(null);
  const micSourceRef = useRef(null);
  const micSilentGainRef = useRef(null);
  const micStreamRef = useRef(null);
  const micFirstChunkLoggedRef = useRef(false);
  const playerCtxRef = useRef(null);
  const playerNodeRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const playerAnalyserRef = useRef(null);
  const micDataArrayRef = useRef(null);
  const playerDataArrayRef = useRef(null);
  const audioMeterFrameRef = useRef(null);
  const completionLockedRef = useRef(false);
  const sessionLanguageRef = useRef('tr');
  const terminalCloseReasonRef = useRef(null);

  // State ref'ini güncel tut
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const calculateLevel = useCallback((analyser, dataArray) => {
    if (!analyser || !dataArray) return 0;
    analyser.getByteTimeDomainData(dataArray);
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    return Math.min(1, rms * 3.2);
  }, []);

  useEffect(() => {
    const tick = () => {
      const micLevel = calculateLevel(micAnalyserRef.current, micDataArrayRef.current);
      const speakerLevel = calculateLevel(playerAnalyserRef.current, playerDataArrayRef.current);
      setInputLevel((prev) => prev * 0.68 + micLevel * 0.32);
      setOutputLevel((prev) => prev * 0.68 + speakerLevel * 0.32);
      audioMeterFrameRef.current = requestAnimationFrame(tick);
    };

    audioMeterFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (audioMeterFrameRef.current) cancelAnimationFrame(audioMeterFrameRef.current);
    };
  }, [calculateLevel]);

  // ─── Audio: Mikrofon ────────────────────────────────────────────
  const startMic = useCallback(async () => {
    try {
      if (recorderCtxRef.current && micStreamRef.current) {
        log.debug('Mikrofon zaten aktif, yeniden başlatma atlandı');
        return;
      }

      log.info('Mikrofon başlatılıyor...');
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule('/audio/pcm-recorder-processor.js');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const source = ctx.createMediaStreamSource(stream);
      const recorder = new AudioWorkletNode(ctx, 'pcm-recorder-processor');
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(recorder);
      source.connect(analyser);
      recorder.connect(silentGain);
      silentGain.connect(ctx.destination);

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      recorder.port.onmessage = (e) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          if (!micFirstChunkLoggedRef.current) {
            micFirstChunkLoggedRef.current = true;
            log.info('Ilk mikrofon chunk gonderildi', { byteLength: e.data?.byteLength ?? 0 });
          }
          ws.send(e.data);
        }
      };

      recorderCtxRef.current = ctx;
      recorderNodeRef.current = recorder;
      micSourceRef.current = source;
      micSilentGainRef.current = silentGain;
      micStreamRef.current = stream;
      micAnalyserRef.current = analyser;
      micDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      micFirstChunkLoggedRef.current = false;
      setIsRecording(true);
      log.info('Mikrofon aktif', {
        trackCount: stream.getAudioTracks().length,
        contextState: ctx.state,
      });
    } catch (err) {
      log.error('Mikrofon hatası', { error: err.message });
      setError(
        pickText(
          sessionLanguageRef.current,
          'Mikrofon izni alinamadi: ' + err.message,
          'Microphone permission could not be granted: ' + err.message
        )
      );
    }
  }, []);

  const stopMic = useCallback(() => {
    if (recorderNodeRef.current) {
      recorderNodeRef.current.port.onmessage = null;
      recorderNodeRef.current.disconnect();
      recorderNodeRef.current = null;
    }
    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }
    if (micSilentGainRef.current) {
      micSilentGainRef.current.disconnect();
      micSilentGainRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (recorderCtxRef.current) {
      recorderCtxRef.current.close().catch(() => {});
      recorderCtxRef.current = null;
    }
    micAnalyserRef.current = null;
    micDataArrayRef.current = null;
    micFirstChunkLoggedRef.current = false;
    setIsRecording(false);
    setInputLevel(0);
  }, []);

  // ─── Audio: Oynatıcı ───────────────────────────────────────────
  const initPlayer = useCallback(async () => {
    if (playerCtxRef.current) return;
    try {
      const ctx = new AudioContext({ sampleRate: 24000 });
      await ctx.audioWorklet.addModule('/audio/pcm-player-processor.js');
      const node = new AudioWorkletNode(ctx, 'pcm-player-processor');
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      node.connect(analyser);
      analyser.connect(ctx.destination);
      playerCtxRef.current = ctx;
      playerNodeRef.current = node;
      playerAnalyserRef.current = analyser;
      playerDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      log.info('Player hazır');
    } catch (err) {
      log.error('Player hatası', { error: err.message });
    }
  }, []);

  const playAudio = useCallback(async (base64Data) => {
    if (!playerNodeRef.current) await initPlayer();
    if (playerCtxRef.current?.state === 'suspended') {
      await playerCtxRef.current.resume();
    }
    const bin = atob(base64Data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    playerNodeRef.current.port.postMessage(bytes.buffer);
    setIsSpeaking(true);
  }, [initPlayer]);

  const clearAudioBuffer = useCallback(() => {
    if (playerNodeRef.current) playerNodeRef.current.port.postMessage('clear');
    setIsSpeaking(false);
    setOutputLevel(0);
  }, []);

  const markSessionCompleted = useCallback((source = 'unknown') => {
    if (completionLockedRef.current) return;

    completionLockedRef.current = true;
    terminalCloseReasonRef.current = 'completed';
    log.info('Session completed lock acquired', { source });

    setCurrentTest('all_done');
    setState(SESSION_STATES.COMPLETED);
    setIsSpeaking(false);
    setCameraActive(false);
    setCameraCommand(null);
    setVideoAnalysisResult(null);
    setCameraPresence(null);
    setCameraAccessError(null);
    setSessionTimeout(null);
    setSessionLimit((prev) => (
      prev
        ? { ...prev, active: false, remainingSeconds: Math.max(0, prev.remainingSeconds ?? 0) }
        : prev
    ));

    stopMic();
    clearAudioBuffer();

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
  }, [stopMic, clearAudioBuffer]);

  const markSessionExpired = useCallback((payload = {}) => {
    if (terminalCloseReasonRef.current === 'expired') return;

    terminalCloseReasonRef.current = 'expired';
    timerActiveRef.current = false;
    log.warn('Session expired lock acquired', payload);

    stopMic();
    clearAudioBuffer();

    setState(SESSION_STATES.ERROR);
    setError(null);
    setIsSpeaking(false);
    setCurrentTest(null);
    setGeneratedImage(null);
    setImageGenerating(false);
    setCameraActive(false);
    setCameraCommand(null);
    setVideoAnalysisResult(null);
    setCameraPresence(null);
    setCameraAccessError(null);
    setTimer((prev) => (prev ? { ...prev, active: false, remaining: 0 } : prev));
    setSessionLimit((prev) => {
      const durationSeconds = payload.durationSeconds || prev?.durationSeconds || 8 * 60;
      return {
        durationSeconds,
        remainingSeconds: 0,
        expiresAt: prev?.expiresAt || null,
        active: false,
      };
    });
    setSessionTimeout({
      reason: payload.reason || 'MAX_DURATION_REACHED',
      durationSeconds: payload.durationSeconds || 8 * 60,
      message: payload.message || pickText(
        sessionLanguageRef.current,
        'Bu tarama oturumu 8 dakikalik ust limite ulasti ve hard olarak sonlandirildi.',
        'This screening session reached the 8-minute hard limit and was terminated.'
      ),
      redirectTo: payload.redirectTo || '/dashboard',
    });
  }, [stopMic, clearAudioBuffer]);

  // ─── WebSocket Message Handler (ref-safe) ───────────────────────
  const handleMessageRef = useRef(null);
  handleMessageRef.current = (message) => {
    log.info('WS Message', { type: message.type, name: message.name || '' });

    switch (message.type) {
      case 'auth_success':
        log.info('Auth başarılı, session başlatılıyor...');
        setState(SESSION_STATES.READY);
        break;

      case 'auth_error':
        setError(
          pickText(
            sessionLanguageRef.current,
            'Kimlik dogrulama hatasi',
            'Authentication error'
          )
        );
        setState(SESSION_STATES.ERROR);
        break;

      case 'session_started':
        log.info('Session başladı', { sessionId: message.sessionId });
        setSessionId(message.sessionId);
        if (message.language) {
          sessionLanguageRef.current = normalizeLanguage(message.language);
        }
        if (message.sessionDurationSeconds) {
          const expiresAt = message.sessionExpiresAt
            ? Date.parse(message.sessionExpiresAt)
            : Date.now() + message.sessionDurationSeconds * 1000;
          setSessionLimit({
            durationSeconds: message.sessionDurationSeconds,
            remainingSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
            expiresAt,
            active: true,
          });
        }
        setSessionTimeout(null);
        setState(SESSION_STATES.ACTIVE);
        break;

      case 'connected':
        if (completionLockedRef.current) break;
        log.info('Gemini Live bağlandı');
        if (!micStreamRef.current || !recorderCtxRef.current) {
          log.warn('Connected event geldi ama mikrofon aktif degil, yeniden baslatiliyor');
          startMic();
        }
        setState(SESSION_STATES.LISTENING);
        break;

      case 'audio':
        if (completionLockedRef.current) break;
        playAudio(message.data);
        setState(SESSION_STATES.SPEAKING);
        break;

      case 'input_transcription':
        log.debug('User transcription', { text: message.text?.substring(0, 50) });
        break;

      case 'output_transcription':
        log.debug('Agent transcription', { text: message.text?.substring(0, 50) });
        break;

      case 'text':
        log.debug('Agent text', { text: message.text?.substring(0, 50) });
        break;

      case 'turn_complete':
        setIsSpeaking(false);
        if (!completionLockedRef.current) {
          setState(SESSION_STATES.LISTENING);
        }
        break;

      case 'interrupted':
        clearAudioBuffer();
        if (!completionLockedRef.current) {
          setState(SESSION_STATES.LISTENING);
        }
        break;

      case 'tool_call':
        log.info('Tool call', { name: message.name });
        if (message.name === 'start_timer') setCurrentTest('verbal_fluency');
        else if (message.name === 'stop_timer') { /* timer stopped - handled by timer_stopped event */ }
        else if (message.name === 'submit_verbal_fluency') { /* done state tool_result başarısında set edilir */ }
        else if (message.name === 'submit_story_recall') {
          setCurrentTest('story_recall_done');
        }
        else if (message.name === 'start_visual_test') {
          setImageGenerating(true);
          setGeneratedImage(null);
          setCurrentTest('visual_recognition');
        }
        else if (message.name === 'record_visual_answer') {
          // Cevap kaydediliyor, sonraki görsel gelecek
          log.info('record_visual_answer tool call', { args: message.args });
        }
        else if (message.name === 'generate_test_image') {
          // Legacy: eski akış — start_visual_test kullanılmalı
          setImageGenerating(true);
          setGeneratedImage(null);
          setCurrentTest('visual_recognition');
        }
        else if (message.name === 'submit_visual_recognition') {
          setGeneratedImage(null);
          setCurrentTest('visual_recognition_done');
          // Ajan kullanıcıdan onay alınca orientation'a doğal geçiş yapacak
        }
        else if (message.name === 'submit_orientation') setCurrentTest('orientation_done');
        else if (message.name === 'complete_session') {
          markSessionCompleted('tool_call.complete_session');
        }
        break;

      case 'tool_result':
        if (message.name === 'submit_verbal_fluency') {
          const success = message.result?.success === true;
          const blockedByTimer = message.result?.reason === 'TIMER_ACTIVE';
          log.info('submit_verbal_fluency result', { success, blockedByTimer, result: message.result });

          if (success) {
            setCurrentTest('verbal_fluency_done');
            setTimer((prev) => (prev ? { ...prev, active: false, remaining: prev.remaining ?? 0 } : prev));
          } else if (blockedByTimer) {
            setCurrentTest('verbal_fluency');
          }
        }
        else if (message.name === 'start_visual_test') {
          log.info('start_visual_test result', { success: message.result?.success });
          // Görsel VisualTestAgent'tan visual_test_image event'i ile gelecek
        }
        else if (message.name === 'record_visual_answer') {
          log.info('record_visual_answer result', { 
            success: message.result?.success,
            currentImage: message.result?.currentImage,
            allComplete: message.result?.allComplete,
          });
          // Sonraki görsel visual_test_image event'i ile gelecek
          if (message.result?.allComplete) {
            setImageGenerating(false);
          }
        }
        else if (message.name === 'generate_test_image') {
          // Legacy handler
          setImageGenerating(false);
          log.info('generate_test_image result (legacy)', { 
            success: message.result?.success, 
            hasImage: !!message.result?.imageBase64,
            imageIndex: message.result?.imageIndex,
          });
          if (message.result?.success && message.result?.imageBase64) {
            setGeneratedImage({
              data: message.result.imageBase64,
              mimeType: message.result.mimeType || 'image/png',
              imageIndex: message.result.imageIndex,
              generatedByAI: message.result.generatedByAI ?? true,
            });
          }
        }
        else if (message.name === 'complete_session' && message.result?.success) {
          markSessionCompleted('tool_result.complete_session');
        }
        break;

      // ── VisualTestAgent Event'leri ──────────────────────────────
      case 'visual_test_started':
        log.info('Visual test started', { totalImages: message.totalImages });
        setCurrentTest('visual_recognition');
        setImageGenerating(true);
        setGeneratedImage(null);
        break;

      case 'visual_test_generating':
        log.info('Visual test generating', { imageIndex: message.imageIndex });
        setImageGenerating(true);
        setGeneratedImage(null);
        break;

      case 'visual_test_image':
        log.info('Visual test image received', { 
          imageIndex: message.imageIndex, 
          hasImage: !!message.imageBase64,
          generatedByAI: message.generatedByAI,
        });
        setImageGenerating(false);
        if (message.imageBase64) {
          setGeneratedImage({
            data: message.imageBase64,
            mimeType: message.mimeType || 'image/jpeg',
            imageIndex: message.imageIndex,
            generatedByAI: message.generatedByAI ?? true,
            totalImages: message.totalImages,
          });
        } else {
          // Fallback
          setGeneratedImage({
            data: null,
            mimeType: null,
            imageIndex: message.imageIndex,
            generatedByAI: false,
            fallback: true,
            totalImages: message.totalImages,
          });
        }
        break;

      case 'visual_test_answer_recorded':
        log.info('Visual test answer recorded', { 
          imageIndex: message.imageIndex,
          answered: message.answeredCount,
          total: message.totalImages,
        });
        // Sonraki görsel üretimi başlayacak
        setImageGenerating(true);
        break;

      case 'visual_test_completed':
        log.info('Visual test completed', { 
          answered: message.answeredCount,
          total: message.totalImages,
        });
        setImageGenerating(false);
        setGeneratedImage(null);
        break;

      case 'session_closed':
        // Session kapandı — ama COMPLETED state'ine sadece complete_session ile geçilmeli
        // "Request contains an invalid argument" gibi beklenmedik kapanmalarda
        // kullanıcıya hata göster
        if (
          !completionLockedRef.current &&
          terminalCloseReasonRef.current !== 'expired' &&
          stateRef.current !== SESSION_STATES.COMPLETED
        ) {
          log.warn('Session closed unexpectedly');
          // Bağlantı hatası olarak işaretle ama mevcut verileri koru
        }
        break;
      case 'session_expired':
        if (message.sessionId && !sessionId) {
          setSessionId(message.sessionId);
        }
        markSessionExpired(message);
        break;
      case 'session_ended':
        markSessionCompleted('session_ended');
        break;
      case 'session_completed':
        if (message.sessionId && !sessionId) {
          setSessionId(message.sessionId);
        }
        markSessionCompleted('session_completed_event');
        break;
        
      case 'timer_started':
        log.info('Timer started', { timerId: message.timerId, duration: message.durationSeconds });
        timerActiveRef.current = true;
        setCurrentTest('verbal_fluency');
        setTimer({
          id: message.timerId,
          duration: message.durationSeconds,
          remaining: message.durationSeconds,
          testType: message.testType,
          active: true,
        });
        break;
        
      case 'timer_complete':
        log.info('Timer complete', { timerId: message.timerId });
        timerActiveRef.current = false;
        setTimer(prev => prev ? { ...prev, active: false, remaining: 0 } : null);
        break;
        
      case 'timer_stopped':
        log.info('Timer stopped by user', { timerId: message.timerId, remaining: message.remaining });
        timerActiveRef.current = false;
        setTimer(prev => prev ? { ...prev, active: false, remaining: message.remaining || 0 } : null);
        break;

      // ── Camera / Video Analysis Event'leri ─────────────
      case 'camera_command':
        log.info('Camera command received', { command: message.command, zoom: message.zoom });
        setCameraCommand({ 
          command: message.command, 
          zoom: message.zoom,
          params: message.params,
          timestamp: Date.now(),
        });
        if (message.command === 'start') {
          setCameraActive(true);
        } else if (message.command === 'stop') {
          setCameraActive(false);
          setVideoAnalysisResult(null);
          setCameraPresence(null);
        }
        break;

      case 'camera_permission_required':
        setCameraAccessError(
          message.message ||
          pickText(
            sessionLanguageRef.current,
            'Kamera izni olmadan Test 4 devam edemez.',
            'Test 4 cannot continue without camera access.'
          )
        );
        break;

      case 'camera_permission_restored':
        setCameraAccessError(null);
        break;

      case 'video_analysis_result':
        log.info('Video analysis result', { 
          expression: message.analysis?.facialExpression,
          attention: message.analysis?.attentionLevel,
        });
        setVideoAnalysisResult(message.analysis);
        break;

      case 'camera_presence_status':
        setCameraPresence({
          status: message.status || 'monitoring',
          level: message.level || 'info',
          message: message.message || 'Kamera takibi aktif.',
          timestamp: Date.now(),
        });
        break;

      case 'camera_presence_alert':
        setCameraPresence({
          status: 'alert',
          level: message.level || 'warning',
          message: message.message || 'Yüzünüz kamerada görünmüyor, lütfen kadraja geri dönün.',
          timestamp: Date.now(),
        });
        break;

      case 'camera_presence_recovered':
        setCameraPresence({
          status: 'recovered',
          level: message.level || 'info',
          message: message.message || 'Tekrar kadrajdasınız, teşekkürler.',
          timestamp: Date.now(),
        });
        break;

      case 'error':
        if (completionLockedRef.current) {
          log.warn('Server error after completion ignored', { message: message.message });
          break;
        }
        log.error('Server error', { message: message.message });
        setError(message.message);
        setState(SESSION_STATES.ERROR);
        break;
    }
  };

  // ─── Connect + Start (tek akış) ────────────────────────────────
  const connectAndStart = useCallback(async (token, options = {}) => {
    log.info('connectAndStart called', { hasToken: !!token, wsExists: !!wsRef.current });
    completionLockedRef.current = false;
    terminalCloseReasonRef.current = null;
    sessionLanguageRef.current = normalizeLanguage(options.language);
    lastTokenRef.current = token;
    lastOptionsRef.current = options;
    
    if (wsRef.current) {
      log.warn('Already connected, skipping');
      return;
    }

    if (!token) {
      log.error('No token provided!');
      setError(
        pickText(
          sessionLanguageRef.current,
          'Token gerekli',
          'Token is required'
        )
      );
      setState(SESSION_STATES.ERROR);
      return;
    }

    setError(null);
    setCameraAccessError(null);
    setSessionTimeout(null);
    setSessionLimit(null);
    setState(SESSION_STATES.CONNECTING);

    // 1. Player'ı başlat (user gesture içinde olmalı)
    log.info('Initializing audio player...');
    await initPlayer();

    // 1.5 Mikrofonu user gesture akışında başlat (autoplay/policy sorunları için)
    log.info('Initializing microphone...');
    await startMic();

    // 2. WebSocket aç
    log.info('Opening WebSocket connection...', { url: WS_URL });
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      log.info('WebSocket opened, sending auth...');
      setState(SESSION_STATES.AUTHENTICATING);
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        log.debug('Binary data received (audio)');
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        log.info('Message received', { type: msg.type });
        handleMessageRef.current(msg);
      } catch (err) {
        log.error('Parse error', { error: err.message });
      }
    };

    ws.onclose = (event) => {
      log.info('WebSocket closed', { code: event.code, reason: event.reason });
      wsRef.current = null;
      const terminalCloseReason = terminalCloseReasonRef.current;
      const isTerminalClose =
        terminalCloseReason === 'completed' ||
        terminalCloseReason === 'manual' ||
        terminalCloseReason === 'expired';

      const isActiveSession = !completionLockedRef.current &&
        !isTerminalClose &&
        stateRef.current !== SESSION_STATES.COMPLETED &&
        stateRef.current !== SESSION_STATES.IDLE &&
        stateRef.current !== SESSION_STATES.ERROR;

      // Normal kapanma (1000) veya kullanıcı tarafından kapatma reconnect tetiklemez
      const isAbnormal = event.code !== 1000 && event.code !== 1005;

      if (isActiveSession && isAbnormal && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 8000);
        log.warn('Beklenmedik WS kapanması, yeniden bağlanılıyor...', {
          attempt: reconnectAttemptsRef.current,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          delayMs: delay,
          code: event.code,
        });
        setError(pickText(
          sessionLanguageRef.current,
          `Bağlantı koptu, yeniden bağlanılıyor... (Deneme ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`,
          `Connection lost, reconnecting... (Attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
        ));
        setState(SESSION_STATES.CONNECTING);

        reconnectTimerRef.current = setTimeout(() => {
          if (lastTokenRef.current) {
            connectAndStart(lastTokenRef.current, lastOptionsRef.current);
          }
        }, delay);
      } else if (terminalCloseReason === 'expired') {
        setState(SESSION_STATES.ERROR);
      } else if (!completionLockedRef.current && stateRef.current !== SESSION_STATES.COMPLETED) {
        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          log.error('Maksimum reconnect denemesi aşıldı');
          setError(pickText(
            sessionLanguageRef.current,
            'Bağlantı kurulamadı. Lütfen sayfayı yenileyip tekrar deneyin.',
            'Connection could not be established. Please refresh the page and try again.'
          ));
          setState(SESSION_STATES.ERROR);
        } else {
          setState(SESSION_STATES.IDLE);
        }
      }
    };

    ws.onerror = (err) => {
      if (completionLockedRef.current || terminalCloseReasonRef.current === 'expired' || terminalCloseReasonRef.current === 'manual') {
        log.warn('WebSocket error after completion ignored');
        return;
      }
      log.error('WebSocket error', { error: err });
      // Hata mesajını sadece reconnect denemesi yoksa göster
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError('WebSocket bağlantı hatası');
        setState(SESSION_STATES.ERROR);
      }
    };
  }, [initPlayer, startMic]);

  // state READY olunca otomatik session başlat + mikrofon aç
  useEffect(() => {
    log.info('State effect triggered', { state, wsReady: wsRef.current?.readyState });
    
      if (state === SESSION_STATES.READY) {
      if (completionLockedRef.current) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        log.info('READY state: sending start_session');
        ws.send(JSON.stringify({
          type: 'start_session',
          language: sessionLanguageRef.current,
        }));
        setState(SESSION_STATES.ACTIVE);
      } else {
        log.warn('READY state but WebSocket not open', { readyState: ws?.readyState });
      }
    }
  }, [state]);

  const sendText = useCallback((text) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text }));
    }
  }, []);

  const endSession = useCallback(() => {
    terminalCloseReasonRef.current = 'manual';
    stopMic();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
  }, [stopMic]);

  // Video frame gönder
  const sendVideoFrame = useCallback((frameBase64) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'video_frame', frameData: frameBase64 }));
    }
  }, []);

  const reportCameraPermissionStatus = useCallback((payload) => {
    const status = typeof payload?.status === 'string' ? payload.status : 'error';
    const message = typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message
      : (
        status === 'granted'
          ? pickText(sessionLanguageRef.current, 'Kamera izni verildi.', 'Camera permission granted.')
          : pickText(
              sessionLanguageRef.current,
              'Kamera izni olmadan Test 4 devam edemez.',
              'Test 4 cannot continue without camera access.'
            )
      );

    if (status === 'granted') {
      setCameraAccessError(null);
    } else {
      setCameraAccessError(message);
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'camera_permission_status',
        status,
        message,
        error: payload?.error || null,
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    completionLockedRef.current = false;
    terminalCloseReasonRef.current = 'manual';
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    lastTokenRef.current = null;
    lastOptionsRef.current = {};
    stopMic();
    clearAudioBuffer();
    if (playerNodeRef.current) {
      playerNodeRef.current.disconnect();
      playerNodeRef.current = null;
    }
    if (playerCtxRef.current) {
      playerCtxRef.current.close().catch(() => {});
      playerCtxRef.current = null;
    }
    playerAnalyserRef.current = null;
    playerDataArrayRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(SESSION_STATES.IDLE);
    setSessionId(null);
    setCurrentTest(null);
    setGeneratedImage(null);
    setImageGenerating(false);
    setError(null);
    setCameraAccessError(null);
    setTimer(null);
    setSessionLimit(null);
    setSessionTimeout(null);
    setInputLevel(0);
    setOutputLevel(0);
    setCameraActive(false);
    setCameraCommand(null);
    setVideoAnalysisResult(null);
    setCameraPresence(null);
  }, [stopMic, clearAudioBuffer]);
  
  // Timer countdown efekti — BUG-009 FIX: timerActiveRef ile race condition engelleniyor
  useEffect(() => {
    if (!timer || !timer.active) return;
    
    const interval = setInterval(() => {
      if (!timerActiveRef.current) {
        clearInterval(interval);
        return;
      }
      setTimer(prev => {
        if (!prev || !prev.active || !timerActiveRef.current) return prev;
        const newRemaining = prev.remaining - 1;
        if (newRemaining <= 0) {
          timerActiveRef.current = false;
          return { ...prev, remaining: 0, active: false };
        }
        return { ...prev, remaining: newRemaining };
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [timer?.active]);

  useEffect(() => {
    if (!sessionLimit?.active || !sessionLimit.expiresAt) return;

    const interval = setInterval(() => {
      setSessionLimit((prev) => {
        if (!prev?.active || !prev.expiresAt) return prev;
        const remainingSeconds = Math.max(0, Math.ceil((prev.expiresAt - Date.now()) / 1000));
        if (remainingSeconds === prev.remainingSeconds) return prev;
        return {
          ...prev,
          remainingSeconds,
          active: remainingSeconds > 0,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionLimit?.active, sessionLimit?.expiresAt]);

  useEffect(() => {
    return () => {
      stopMic();
      if (playerCtxRef.current) playerCtxRef.current.close().catch(() => {});
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return {
    state,
    sessionId,
    currentTest,
    generatedImage,
    imageGenerating,
    error: error || cameraAccessError,
    sessionLimit,
    sessionTimeout,
    isRecording,
    isSpeaking,
    inputLevel,
    outputLevel,
    timer,
    cameraActive,
    cameraCommand,
    videoAnalysisResult,
    cameraPresence,
    connectAndStart,
    sendText,
    sendVideoFrame,
    reportCameraPermissionStatus,
    endSession,
    disconnect,
  };
}
