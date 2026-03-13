/**
 * Gemini Live WebSocket Hook
 * Backend WebSocket'ine bağlanarak Gemini Live API ile iletişim kurar.
 * Ref-based mimari: stale closure sorunlarını önler.
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import { createLogger } from '../lib/logger';

const log = createLogger('useGeminiLive');

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:3001/ws/live`;
log.info('WebSocket URL', { url: WS_URL });

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
  const [transcripts, setTranscripts] = useState([]);
  const [currentTest, setCurrentTest] = useState(null);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  
  // Timer state
  const [timer, setTimer] = useState(null); // { duration, remaining, testType, active }

  const wsRef = useRef(null);
  const stateRef = useRef(state);
  const recorderCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const playerCtxRef = useRef(null);
  const playerNodeRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const playerAnalyserRef = useRef(null);
  const micDataArrayRef = useRef(null);
  const playerDataArrayRef = useRef(null);
  const audioMeterFrameRef = useRef(null);

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
      log.info('Mikrofon başlatılıyor...');
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule('/audio/pcm-recorder-processor.js');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const source = ctx.createMediaStreamSource(stream);
      const recorder = new AudioWorkletNode(ctx, 'pcm-recorder-processor');
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(recorder);
      source.connect(analyser);

      recorder.port.onmessage = (e) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      recorderCtxRef.current = ctx;
      micStreamRef.current = stream;
      micAnalyserRef.current = analyser;
      micDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      setIsRecording(true);
      log.info('Mikrofon aktif');
    } catch (err) {
      log.error('Mikrofon hatası', { error: err.message });
      setError('Mikrofon izni alınamadı: ' + err.message);
    }
  }, []);

  const stopMic = useCallback(() => {
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

  // ─── Transcript helpers ─────────────────────────────────────────
  const addTranscript = useCallback((role, text) => {
    if (!text || text.trim() === '') return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.partial) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, text: last.text + text, partial: true };
        return updated;
      }
      const updated = [...prev];
      if (updated.length > 0 && updated[updated.length - 1].partial) {
        updated[updated.length - 1] = { ...updated[updated.length - 1], partial: false };
      }
      updated.push({ role, text, timestamp: Date.now(), partial: true });
      return updated;
    });
  }, []);

  const finalizeLastTranscript = useCallback(() => {
    setTranscripts((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], partial: false };
      return updated;
    });
  }, []);

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
        setError('Kimlik doğrulama hatası');
        setState(SESSION_STATES.ERROR);
        break;

      case 'session_started':
        log.info('Session başladı', { sessionId: message.sessionId });
        setSessionId(message.sessionId);
        setState(SESSION_STATES.ACTIVE);
        break;

      case 'connected':
        log.info('Gemini Live bağlandı');
        setState(SESSION_STATES.LISTENING);
        break;

      case 'audio':
        playAudio(message.data);
        setState(SESSION_STATES.SPEAKING);
        break;

      case 'input_transcription':
        addTranscript('user', message.text);
        break;

      case 'output_transcription':
        addTranscript('agent', message.text);
        break;

      case 'text':
        addTranscript('agent', message.text);
        break;

      case 'turn_complete':
        finalizeLastTranscript();
        setIsSpeaking(false);
        setState(SESSION_STATES.LISTENING);
        break;

      case 'interrupted':
        clearAudioBuffer();
        setState(SESSION_STATES.LISTENING);
        break;

      case 'tool_call':
        log.info('Tool call', { name: message.name });
        if (message.name === 'start_timer') setCurrentTest('verbal_fluency');
        else if (message.name === 'stop_timer') { /* timer stopped - handled by timer_stopped event */ }
        else if (message.name === 'submit_verbal_fluency') {
          setCurrentTest('verbal_fluency_done');
          // Ajan kullanıcıdan onay alınca story_recall tool call ile doğal geçiş yapacak
        }
        else if (message.name === 'submit_story_recall') {
          setCurrentTest('story_recall_done');
        }
        else if (message.name === 'generate_test_image') {
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
          setCurrentTest('all_done');
          setState(SESSION_STATES.COMPLETED);
        }
        break;

      case 'tool_result':
        if (message.name === 'generate_test_image') {
          setImageGenerating(false);
          log.info('generate_test_image result', { 
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
          } else if (message.result?.success) {
            // Fallback: görsel üretilemedi ama test devam ediyor
            setGeneratedImage({
              data: null,
              mimeType: null,
              imageIndex: message.result.imageIndex,
              generatedByAI: false,
              correctAnswer: message.result.correctAnswer,
              fallback: true,
            });
          }
        }
        break;

      case 'session_closed':
      case 'session_ended':
        setState(SESSION_STATES.COMPLETED);
        break;
        
      case 'timer_started':
        log.info('Timer started', { timerId: message.timerId, duration: message.durationSeconds });
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
        setTimer(prev => prev ? { ...prev, active: false, remaining: 0 } : null);
        break;
        
      case 'timer_stopped':
        log.info('Timer stopped by user', { timerId: message.timerId, remaining: message.remaining });
        setTimer(prev => prev ? { ...prev, active: false, remaining: message.remaining || 0 } : null);
        break;

      case 'error':
        log.error('Server error', { message: message.message });
        setError(message.message);
        setState(SESSION_STATES.ERROR);
        break;
    }
  };

  // ─── Connect + Start (tek akış) ────────────────────────────────
  const connectAndStart = useCallback(async (token) => {
    log.info('connectAndStart called', { hasToken: !!token, wsExists: !!wsRef.current });
    
    if (wsRef.current) {
      log.warn('Already connected, skipping');
      return;
    }

    if (!token) {
      log.error('No token provided!');
      setError('Token gerekli');
      setState(SESSION_STATES.ERROR);
      return;
    }

    setError(null);
    setState(SESSION_STATES.CONNECTING);

    // 1. Player'ı başlat (user gesture içinde olmalı)
    log.info('Initializing audio player...');
    await initPlayer();

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
      if (stateRef.current !== SESSION_STATES.COMPLETED) {
        setState(SESSION_STATES.IDLE);
      }
    };

    ws.onerror = (err) => {
      log.error('WebSocket error', { error: err });
      setError('WebSocket bağlantı hatası');
      setState(SESSION_STATES.ERROR);
    };
  }, [initPlayer]);

  // state READY olunca otomatik session başlat + mikrofon aç
  useEffect(() => {
    log.info('State effect triggered', { state, wsReady: wsRef.current?.readyState });
    
    if (state === SESSION_STATES.READY) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        log.info('READY state: sending start_session + starting mic');
        ws.send(JSON.stringify({ type: 'start_session' }));
        setState(SESSION_STATES.ACTIVE);
        startMic();
      } else {
        log.warn('READY state but WebSocket not open', { readyState: ws?.readyState });
      }
    }
  }, [state, startMic]);

  const sendText = useCallback((text) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text }));
    }
  }, []);

  const endSession = useCallback(() => {
    stopMic();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
  }, [stopMic]);

  const disconnect = useCallback(() => {
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
    setTranscripts([]);
    setCurrentTest(null);
    setGeneratedImage(null);
    setImageGenerating(false);
    setError(null);
    setTimer(null);
    setInputLevel(0);
    setOutputLevel(0);
  }, [stopMic, clearAudioBuffer]);
  
  // Timer countdown efekti
  useEffect(() => {
    if (!timer || !timer.active) return;
    
    const interval = setInterval(() => {
      setTimer(prev => {
        if (!prev || !prev.active) return prev;
        const newRemaining = prev.remaining - 1;
        if (newRemaining <= 0) {
          return { ...prev, remaining: 0, active: false };
        }
        return { ...prev, remaining: newRemaining };
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [timer?.active]);

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
    transcripts,
    currentTest,
    generatedImage,
    imageGenerating,
    error,
    isRecording,
    isSpeaking,
    inputLevel,
    outputLevel,
    timer,
    connectAndStart,
    sendText,
    endSession,
    disconnect,
  };
}
