import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mic, MicOff, Brain, Volume2, Play, Loader2, Image, CheckCircle } from 'lucide-react';
import api from '../lib/api';
import { useGeminiLive, SESSION_STATES } from '../hooks/useGeminiLive';
import CameraPanel from '../components/CameraPanel';
import GeneratedImagePanel from '../components/GeneratedImagePanel';

const TEST_STEPS = [
  { id: 1, name: 'Sözel Akıcılık', key: 'verbal_fluency', description: 'Belirli bir harfle başlayan kelimeleri 60 saniye içinde söyleyin.' },
  { id: 2, name: 'Hikaye Hatırlama', key: 'story_recall', description: 'Anlatılan hikayeyi mümkün olduğunca hatırlayıp tekrarlayın.' },
  { id: 3, name: 'Görsel Tanıma', key: 'visual_recognition', description: 'Ekranda gösterilen görselleri tanımlayın.' },
  { id: 4, name: 'Yönelim', key: 'orientation', description: 'Zaman ve mekan ile ilgili soruları cevaplayın.' },
];

export default function Session() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);

  // Gemini Live Hook
  const {
    state,
    sessionId: liveSessionId,
    transcripts,
    currentTest,
    generatedImage,
    imageGenerating,
    error,
    isRecording,
    isSpeaking,
    cameraActive,
    cameraCommand,
    videoAnalysisResult,
    sendVideoFrame,
    connectAndStart,
    endSession,
    disconnect,
  } = useGeminiLive();

  // Test adımını belirle
  const getCurrentStepIndex = useCallback(() => {
    if (!currentTest) return 0;
    if (currentTest === 'verbal_fluency_done') return 1;
    if (currentTest === 'story_recall_done') return 2;
    if (currentTest === 'visual_recognition_done') return 3;
    if (currentTest === 'orientation_done' || currentTest === 'all_done') return 4;
    if (currentTest === 'visual_recognition') return 2;
    return 0;
  }, [currentTest]);

  const currentStep = getCurrentStepIndex();

  // Session yükle
  useEffect(() => {
    api.get(`/sessions/${id}`)
      .then((res) => {
        setSession(res.data.session);
        if (res.data.session.status === 'COMPLETED') {
          navigate(`/results/${id}`);
        }
      })
      .catch(() => navigate('/dashboard'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Test tamamlandığında results'a yönlendir
  useEffect(() => {
    if (state === SESSION_STATES.COMPLETED && liveSessionId) {
      setTimeout(() => {
        navigate(`/results/${liveSessionId}`);
      }, 2000);
    }
  }, [state, liveSessionId, navigate]);

  // Başla butonu - tek adımda bağlan + session başlat + mikrofon aç
  const handleStart = async () => {
    setHasStarted(true);
    const token = localStorage.getItem('token');
    if (token) {
      await connectAndStart(token);
    } else {
      navigate('/login');
    }
  };

  // Mikrofon toggle (session başladıktan sonra)
  const toggleMic = () => {
    // Mikrofon zaten startSession ile başlıyor, burada sadece durumu gösteriyoruz
  };

  // Çıkış
  const handleExit = () => {
    disconnect();
    navigate('/dashboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between max-w-4xl">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary-600" />
            <span className="text-base font-bold text-primary-900">Bilişsel Tarama</span>
          </div>
          <button
            onClick={handleExit}
            className="text-sm text-gray-500 hover:text-gray-700 transition"
          >
            Çıkış
          </button>
        </div>
      </header>

      {/* İlerleme Çubuğu */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="container mx-auto max-w-4xl">
          <div className="flex items-center gap-2">
            {TEST_STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center gap-2 flex-1">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition ${
                    index < currentStep
                      ? 'bg-green-500 text-white'
                      : index === currentStep
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {index < currentStep ? <CheckCircle className="w-4 h-4" /> : step.id}
                </div>
                <span
                  className={`text-xs font-medium hidden sm:block ${
                    index === currentStep ? 'text-primary-700' : 'text-gray-400'
                  }`}
                >
                  {step.name}
                </span>
                {index < TEST_STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 ${
                      index < currentStep ? 'bg-green-400' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ana Alan */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="max-w-2xl w-full text-center">
          {/* Hata Mesajı */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Mevcut Test Bilgisi */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900">
              {state === SESSION_STATES.COMPLETED
                ? 'Tarama Tamamlandı!'
                : currentStep < TEST_STEPS.length
                ? `Test ${TEST_STEPS[currentStep]?.id}: ${TEST_STEPS[currentStep]?.name}`
                : 'Testler Tamamlandı'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {state === SESSION_STATES.COMPLETED
                ? 'Sonuçlar hazırlanıyor, yönlendiriliyorsunuz...'
                : currentStep < TEST_STEPS.length
                ? TEST_STEPS[currentStep]?.description
                : 'Tüm testler başarıyla tamamlandı.'}
            </p>
          </div>

          {/* Görsel Tanıma Testi - Fullscreen modal olarak gösteriliyor (sayfa sonunda render ediliyor) */}

          {/* Kamera paneli - Test 4 sırasında */}
          {cameraActive && (
            <div className="mb-8 max-w-sm mx-auto">
              <CameraPanel
                isActive={cameraActive}
                cameraCommand={cameraCommand}
                analysisResult={videoAnalysisResult}
                onSendFrame={sendVideoFrame}
                onClose={null}
              />
            </div>
          )}

          {/* Ajan Görseli / Konuşma Animasyonu */}
          <div className="relative mb-10">
            <div
              className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center transition-all duration-500 ${
                isSpeaking
                  ? 'bg-primary-100 ring-4 ring-primary-300 ring-opacity-50 animate-pulse'
                  : state === SESSION_STATES.LISTENING
                  ? 'bg-green-50 ring-2 ring-green-300'
                  : 'bg-gray-100'
              }`}
            >
              <Brain className={`w-16 h-16 ${isSpeaking ? 'text-primary-600' : isRecording ? 'text-green-500' : 'text-gray-400'}`} />
            </div>
            {isSpeaking && (
              <div className="flex items-center justify-center gap-1 mt-3">
                <Volume2 className="w-4 h-4 text-primary-500" />
                <span className="text-xs text-primary-600 font-medium">Nöra konuşuyor...</span>
              </div>
            )}
            {isRecording && !isSpeaking && (
              <div className="flex items-center justify-center gap-1 mt-3">
                <Mic className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-600 font-medium">Dinliyorum...</span>
              </div>
            )}
          </div>

          {/* Transkript Alanı */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-8 min-h-[120px] max-h-[200px] overflow-y-auto text-left">
            {transcripts.length > 0 ? (
              <div className="space-y-2">
                {transcripts.map((t, idx) => (
                  <p
                    key={idx}
                    className={`text-sm leading-relaxed ${
                      t.role === 'user' ? 'text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    <span className="font-medium">{t.role === 'user' ? 'Siz: ' : 'Nöra: '}</span>
                    {t.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">
                {!hasStarted
                  ? 'Başla butonuna basarak taramayı başlatın...'
                  : 'Nöra ile konuşmaya başlayın...'}
              </p>
            )}
          </div>

          {/* Başla / Mikrofon Butonu */}
          {!hasStarted ? (
            <button
              onClick={handleStart}
              disabled={state === SESSION_STATES.CONNECTING || state === SESSION_STATES.AUTHENTICATING}
              className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                state === SESSION_STATES.CONNECTING || state === SESSION_STATES.AUTHENTICATING
                  ? 'bg-gray-400 cursor-wait'
                  : 'bg-green-500 hover:bg-green-600 shadow-green-200'
              }`}
            >
              {state === SESSION_STATES.CONNECTING || state === SESSION_STATES.AUTHENTICATING ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : (
                <Play className="w-8 h-8 text-white" />
              )}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                  isRecording
                    ? 'bg-red-500 shadow-red-200 animate-pulse'
                    : 'bg-primary-600 hover:bg-primary-700 shadow-primary-200'
                }`}
              >
                {isRecording ? (
                  <Mic className="w-8 h-8 text-white" />
                ) : (
                  <MicOff className="w-8 h-8 text-white opacity-50" />
                )}
              </div>
              <p className="text-xs text-gray-500">
                {isRecording ? 'Mikrofon aktif - konuşabilirsiniz' : 'Bağlantı kuruluyor...'}
              </p>
            </div>
          )}

          {/* Durum Göstergesi */}
          {hasStarted && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  state === SESSION_STATES.ERROR
                    ? 'bg-red-500'
                    : state === SESSION_STATES.COMPLETED
                    ? 'bg-green-500'
                    : state === SESSION_STATES.ACTIVE || state === SESSION_STATES.LISTENING
                    ? 'bg-green-500 animate-pulse'
                    : 'bg-yellow-500'
                }`}
              />
              <span className="text-xs text-gray-500">
                {state === SESSION_STATES.CONNECTING && 'Bağlanıyor...'}
                {state === SESSION_STATES.AUTHENTICATING && 'Kimlik doğrulanıyor...'}
                {state === SESSION_STATES.READY && 'Hazır'}
                {state === SESSION_STATES.ACTIVE && 'Aktif'}
                {state === SESSION_STATES.LISTENING && 'Dinliyor'}
                {state === SESSION_STATES.SPEAKING && 'Konuşuyor'}
                {state === SESSION_STATES.COMPLETED && 'Tamamlandı'}
                {state === SESSION_STATES.ERROR && 'Hata'}
              </span>
            </div>
          )}
        </div>
      </main>

      {/* ─── Görsel Tanıma Modal (Fullscreen Overlay) ─── */}
      {(generatedImage || imageGenerating) && (
        <GeneratedImagePanel
          image={generatedImage}
          isGenerating={imageGenerating}
          onClose={() => {}}
        />
      )}
    </div>
  );
}
