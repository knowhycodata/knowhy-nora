/**
 * CameraPanel - Kamera Görüntüsü ve Analiz Sonuçları Bileşeni
 * 
 * Test 4 (Yönelim) sırasında kullanıcının kamerasını açar,
 * video frame'lerini backend'e gönderir ve analiz sonuçlarını gösterir.
 * 
 * Özellikler:
 * - Kamera açma/kapama
 * - Zoom in/out/center kontrolleri
 * - Mimik analiz sonucu overlay
 * - Frame capture ve WS üzerinden gönderim
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';

const FRAME_CAPTURE_INTERVAL = 5000; // 5 saniyede bir frame gönder
const FRAME_QUALITY = 0.6; // JPEG kalitesi (0-1)
const FRAME_MAX_WIDTH = 640; // Maksimum genişlik

export default function CameraPanel({ 
  isActive, 
  cameraCommand, 
  analysisResult, 
  onSendFrame,
  onPermissionChange = null,
  onClose,
  variant = 'inline',
  presenceAlert = null,
}) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const startCameraPromiseRef = useRef(null);
  
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [zoom, setZoom] = useState(1.0);
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const isModal = variant === 'modal';

  // Kamera aç
  const startCamera = useCallback(async () => {
    if (startCameraPromiseRef.current) {
      return startCameraPromiseRef.current;
    }

    if (streamRef.current && cameraReady) {
      return Promise.resolve();
    }

    startCameraPromiseRef.current = (async () => {
    try {
      setCameraError(null);
      setPermissionAsked(true);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          // React effect race durumunda ikinci srcObject set'i play() promise'ini iptal edebilir.
          if (playErr?.name !== 'AbortError') {
            throw playErr;
          }
          console.warn('Kamera play() AbortError - yeni kaynak yukleniyor, yeniden denenecek.');
        }
        setCameraReady(true);
        onPermissionChange?.({
          status: 'granted',
          message: t('camera.active'),
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      console.error('Kamera hatası:', err);
      const nextCameraError =
        err.name === 'NotAllowedError' 
          ? t('camera.permissionDenied')
          : t('camera.openError', { error: err.message });
      setCameraError(nextCameraError);
      onPermissionChange?.({
        status: err.name === 'NotAllowedError' ? 'denied' : 'error',
        error: err.name || 'CameraError',
        message: nextCameraError,
      });
    }
    })().finally(() => {
      startCameraPromiseRef.current = null;
    });

    return startCameraPromiseRef.current;
  }, [cameraReady, onPermissionChange, t]);

  // Kamera kapat
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    startCameraPromiseRef.current = null;
    setCameraReady(false);
  }, []);

  // Frame yakala ve gönder
  const captureAndSendFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Video boyutlarını al
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) return;
    
    // Orantılı boyutlandırma
    const scale = Math.min(1, FRAME_MAX_WIDTH / videoWidth);
    canvas.width = videoWidth * scale;
    canvas.height = videoHeight * scale;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Base64 JPEG olarak çıkar (data:image/jpeg;base64, prefix'ini kaldır)
    const dataUrl = canvas.toDataURL('image/jpeg', FRAME_QUALITY);
    const base64Data = dataUrl.split(',')[1];
    
    if (base64Data && onSendFrame) {
      onSendFrame(base64Data);
    }
  }, [cameraReady, onSendFrame]);

  // isActive değiştiğinde kamera aç/kapat
  useEffect(() => {
    if (isActive && !cameraReady && !cameraError) {
      startCamera();
    } else if (!isActive && cameraReady) {
      stopCamera();
    }
  }, [isActive, cameraReady, cameraError, startCamera, stopCamera]);

  // Periyodik frame gönderimi
  useEffect(() => {
    if (cameraReady && isActive) {
      intervalRef.current = setInterval(captureAndSendFrame, FRAME_CAPTURE_INTERVAL);
      // İlk frame'i hemen gönder
      setTimeout(captureAndSendFrame, 1000);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cameraReady, isActive, captureAndSendFrame]);

  // Kamera komutlarını işle
  useEffect(() => {
    if (!cameraCommand) return;
    
    switch (cameraCommand.command) {
      case 'start':
        if (!cameraReady) startCamera();
        break;
      case 'stop':
        stopCamera();
        break;
      case 'zoom_in':
        setZoom(prev => Math.min(3.0, prev + 0.5));
        break;
      case 'zoom_out':
        setZoom(prev => Math.max(1.0, prev - 0.5));
        break;
      case 'center':
        setZoom(1.0);
        break;
    }
  }, [cameraCommand, cameraReady, startCamera, stopCamera]);

  // Analiz sonuçlarını güncelle
  useEffect(() => {
    if (analysisResult) {
      setLastAnalysis(analysisResult);
    }
  }, [analysisResult]);

  // Temizlik
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Dikkat seviyesi rengi
  const getAttentionColor = (level) => {
    switch (level) {
      case 'yüksek':
      case 'high':
        return 'text-emerald-500';
      case 'orta':
      case 'medium':
        return 'text-amber-500';
      case 'düşük':
      case 'low':
        return 'text-red-500';
      default: return 'text-gray-400';
    }
  };

  const getAttentionLabel = (level) => {
    switch (level) {
      case 'yüksek':
      case 'high':
        return t('camera.attentionLevels.high');
      case 'orta':
      case 'medium':
        return t('camera.attentionLevels.medium');
      case 'düşük':
      case 'low':
        return t('camera.attentionLevels.low');
      default:
        return t('camera.attentionLevels.unknown');
    }
  };

  const getAttentionDotClass = (level) => {
    const normalized = String(level || '').toLowerCase();
    if (normalized.includes('yüksek') || normalized.includes('yuksek') || normalized === 'high') return 'bg-emerald-400';
    if (normalized.includes('orta') || normalized === 'medium') return 'bg-amber-400';
    if (normalized.includes('düşük') || normalized.includes('dusuk') || normalized === 'low') return 'bg-red-400';
    return 'bg-gray-400';
  };

  if (!isActive) return null;

  return (
    <div className={`animate-slide-up ${isModal ? 'w-full' : ''}`}>
      <div
        className={`overflow-hidden ${
          isModal
            ? 'bg-white rounded-2xl border border-slate-200 shadow-[0_26px_90px_rgba(15,23,42,0.28)]'
            : 'bg-white/95 backdrop-blur rounded-2xl border border-gray-100 shadow-lg'
        }`}
      >
        {/* Başlık */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${cameraReady ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            <span className="text-xs font-medium text-gray-600">
              {cameraReady ? t('camera.active') : cameraError ? t('camera.error') : t('camera.starting')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Zoom kontrolleri */}
            {cameraReady && (
              <>
                <button
                  onClick={() => setZoom(prev => Math.max(1.0, prev - 0.5))}
                  className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                  title={t('camera.zoomOut')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>
                  </svg>
                </button>
                <span className="text-[10px] text-gray-400 min-w-[28px] text-center">{zoom.toFixed(1)}x</span>
                <button
                  onClick={() => setZoom(prev => Math.min(3.0, prev + 0.5))}
                  className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                  title={t('camera.zoomIn')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>
                  </svg>
                </button>
                <div className="w-px h-4 bg-gray-200 mx-1" />
              </>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                title={t('common.close')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Kadraj takip uyarısı */}
        {presenceAlert?.message && (
          <div
            className={`px-4 py-2 border-b text-xs ${
              presenceAlert.status === 'alert'
                ? 'bg-red-50 border-red-100 text-red-700'
                : presenceAlert.status === 'recovered'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : 'bg-slate-50 border-slate-100 text-slate-600'
            }`}
          >
            {presenceAlert.message}
          </div>
        )}

        {/* Video alanı */}
        <div className={`relative bg-gray-900 aspect-video overflow-hidden ${isModal ? 'max-h-[60vh]' : 'max-h-48'}`}>
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m16 16 2 2M2 11.5V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3.5"/><path d="M19.4 19.4 4.6 4.6"/>
                <path d="M22 8s-1.5-2-5-2"/><path d="M2 2l20 20"/>
              </svg>
                <p className="text-xs text-gray-400 text-center">{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="mt-1 px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded-md hover:bg-gray-800 transition"
                >
                  {t('camera.retry')}
                </button>
              </div>
            ) : !cameraReady ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
            </div>
          ) : null}
          
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ 
              transform: `scale(${zoom}) scaleX(-1)`,
              display: cameraReady ? 'block' : 'none',
            }}
          />
          
          {/* Analiz overlay */}
          {lastAnalysis && cameraReady && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${getAttentionDotClass(lastAnalysis.attentionLevel)}`} />
                <span className="text-[10px] text-white/80">{lastAnalysis.summary}</span>
              </div>
            </div>
          )}
        </div>

        {/* Analiz detayları */}
        {lastAnalysis && cameraReady && (
          <div className="px-4 py-2.5 border-t border-gray-50">
            <div className="flex items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1">
                <span className="text-gray-400">{t('camera.expression')}:</span>
                <span className="font-medium text-gray-700">{lastAnalysis.facialExpression}</span>
              </div>
              <div className="w-px h-3 bg-gray-200" />
              <div className="flex items-center gap-1">
                <span className="text-gray-400">{t('camera.eye')}:</span>
                <span className="font-medium text-gray-700">{lastAnalysis.eyeContact}</span>
              </div>
              <div className="w-px h-3 bg-gray-200" />
              <div className="flex items-center gap-1">
                <span className="text-gray-400">{t('camera.attention')}:</span>
                <span className={`font-medium ${getAttentionColor(lastAnalysis.attentionLevel)}`}>
                  {getAttentionLabel(lastAnalysis.attentionLevel)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Gizli canvas - frame capture için */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
