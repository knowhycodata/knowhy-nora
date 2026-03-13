/**
 * AgentSession - Nöra ile tam otonom sesli etkileşim sayfası
 * Light tema, minimalist tasarım, test ilerleme barı
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGeminiLive, SESSION_STATES } from '../hooks/useGeminiLive';
import { createLogger } from '../lib/logger';
import TranscriptPanel from '../components/TranscriptPanel';
import GeneratedImagePanel from '../components/GeneratedImagePanel';

const log = createLogger('AgentSession');

// Test adımları tanımı
const TEST_STEPS = [
  { key: 'verbal_fluency', label: 'Sözel Akıcılık', icon: '🗣️' },
  { key: 'story_recall', label: 'Hikaye Hatırlama', icon: '📖' },
  { key: 'visual_recognition', label: 'Görsel Tanıma', icon: '👁️' },
  { key: 'orientation', label: 'Yönelim', icon: '🧭' },
];

function getTestIndex(currentTest) {
  if (!currentTest) return -1;
  const base = currentTest.replace('_done', '');
  return TEST_STEPS.findIndex(s => s.key === base);
}

function isTestDone(currentTest, stepKey) {
  if (!currentTest) return false;
  if (currentTest === 'all_done') return true;
  const currentIdx = getTestIndex(currentTest);
  const stepIdx = TEST_STEPS.findIndex(s => s.key === stepKey);
  if (currentTest.endsWith('_done')) return stepIdx <= currentIdx;
  return stepIdx < currentIdx;
}

function isTestActive(currentTest, stepKey) {
  if (!currentTest) return false;
  if (currentTest === 'all_done') return false;
  const base = currentTest.replace('_done', '');
  return base === stepKey && !currentTest.endsWith('_done');
}

export default function AgentSession() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const gemini = useGeminiLive();
  const [showTranscript, setShowTranscript] = useState(false);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    if (hasStarted.current) return;
    hasStarted.current = true;
    gemini.connectAndStart(token).catch((err) => {
      log.error('connectAndStart failed', { error: err.message });
    });
  }, [token]);

  useEffect(() => {
    if (gemini.state === SESSION_STATES.COMPLETED && gemini.sessionId) {
      const t = setTimeout(() => navigate(`/results/${gemini.sessionId}`), 3000);
      return () => clearTimeout(t);
    }
  }, [gemini.state, gemini.sessionId, navigate]);

  const handleEnd = useCallback(() => {
    gemini.endSession();
    navigate('/dashboard');
  }, [gemini, navigate]);

  const isConnecting = [SESSION_STATES.IDLE, SESSION_STATES.CONNECTING, SESSION_STATES.AUTHENTICATING].includes(gemini.state);
  const isActive = [SESSION_STATES.ACTIVE, SESSION_STATES.LISTENING, SESSION_STATES.SPEAKING, SESSION_STATES.PROCESSING, SESSION_STATES.READY].includes(gemini.state);
  const orbStateClass = gemini.isSpeaking
    ? 'voice-orb-shell-speaking'
    : gemini.isRecording
      ? 'voice-orb-shell-listening'
      : 'voice-orb-shell-idle';
  const activeLevel = gemini.isSpeaking
    ? gemini.outputLevel
    : gemini.isRecording
      ? gemini.inputLevel
      : Math.max(gemini.inputLevel, gemini.outputLevel) * 0.35;
  const shellScale = 0.92 + activeLevel * 0.22;
  const haloScale = 0.98 + activeLevel * 0.26;
  const ambientScale = 1 + activeLevel * 0.34;
  const coreScale = 1 + activeLevel * 0.12;
  const innerScale = 0.94 + activeLevel * 0.18;
  const shellOpacity = 0.26 + activeLevel * 0.5;
  const haloOpacity = 0.18 + activeLevel * 0.36;
  const ambientOpacity = 0.12 + activeLevel * 0.24;
  const speakingCoreInset = `${22 - activeLevel * 8}%`;
  const listeningCoreInset = `${26 - activeLevel * 7}%`;

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-slate-50 to-white flex flex-col overflow-hidden">
      
      {/* ─── Üst Bar ─── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">N</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Nöra</h1>
            <p className="text-[11px] text-gray-400">Bilişsel Tarama Asistanı</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
            title="Konuşma kaydı"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button
            onClick={handleEnd}
            className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 transition-all"
          >
            Bitir
          </button>
        </div>
      </header>

      {/* ─── Test İlerleme Barı (Stepper) ─── */}
      <div className="px-6 py-5 border-b border-gray-50 bg-white">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between relative">
            {/* Bağlantı çizgisi */}
            <div className="absolute top-5 left-[10%] right-[10%] h-0.5 bg-gray-100 z-0" />
            <div 
              className="absolute top-5 left-[10%] h-0.5 bg-gray-900 z-0 transition-all duration-700 ease-out"
              style={{
                width: gemini.currentTest === 'all_done' 
                  ? '80%' 
                  : `${Math.max(0, (getTestIndex(gemini.currentTest) + (gemini.currentTest?.endsWith('_done') ? 1 : 0.5)) / TEST_STEPS.length) * 80}%`
              }}
            />
            
            {TEST_STEPS.map((step, i) => {
              const done = isTestDone(gemini.currentTest, step.key);
              const active = isTestActive(gemini.currentTest, step.key);
              return (
                <div key={step.key} className="flex flex-col items-center relative z-10">
                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all duration-500 border-2
                    ${done 
                      ? 'bg-gray-900 border-gray-900 text-white' 
                      : active 
                        ? 'bg-white border-gray-900 text-gray-900' 
                        : 'bg-white border-gray-200 text-gray-300'
                    }
                  `}>
                    {done ? (
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="text-sm font-medium">{i + 1}</span>
                    )}
                  </div>
                  <span className={`mt-2 text-[11px] font-medium transition-colors duration-300 ${
                    done ? 'text-gray-900' : active ? 'text-gray-900' : 'text-gray-300'
                  }`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── Ana İçerik ─── */}
      <main className="flex-1 flex flex-col items-center px-4 relative overflow-y-auto">
        
        {/* Bağlantı durumu */}
        {isConnecting && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-fade-in">
            <div className="w-12 h-12 rounded-full border-2 border-gray-100 border-t-gray-900 animate-spin" />
            <p className="text-sm text-gray-400">Nöra'ya bağlanılıyor...</p>
          </div>
        )}

        {/* Aktif oturum */}
        {isActive && (
          <div className="flex-1 flex flex-col items-center justify-center w-full">
            <div className="flex flex-col items-center gap-4">
            <div className="relative h-44 w-44 flex items-center justify-center">
              <div
                className={`absolute inset-5 rounded-full ${orbStateClass}`}
                style={{ transform: `scale(${shellScale})`, opacity: shellOpacity }}
              />
              <div
                className={`absolute inset-2 rounded-full ${gemini.isSpeaking ? 'voice-orb-halo-speaking' : gemini.isRecording ? 'voice-orb-halo-listening' : 'voice-orb-halo-idle'}`}
                style={{ transform: `scale(${haloScale})`, opacity: haloOpacity }}
              />
              <div
                className={`absolute inset-0 rounded-full ${gemini.isSpeaking ? 'voice-orb-ambient-speaking' : gemini.isRecording ? 'voice-orb-ambient-listening' : 'voice-orb-ambient-idle'}`}
                style={{ transform: `scale(${ambientScale})`, opacity: ambientOpacity }}
              />
              <div className={`relative h-32 w-32 rounded-full overflow-hidden border transition-all duration-500 ${
                gemini.isSpeaking
                  ? 'bg-[#081226] border-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.22)] scale-105'
                  : gemini.isRecording
                    ? 'bg-white border-slate-300 shadow-[0_18px_48px_rgba(15,23,42,0.08)] scale-100'
                    : 'bg-gray-50 border-gray-200 shadow-[0_14px_36px_rgba(15,23,42,0.06)] scale-100'
              }`}>
                <div
                  className={`absolute inset-0 ${gemini.isSpeaking ? 'voice-orb-core-speaking' : gemini.isRecording ? 'voice-orb-core-listening' : 'voice-orb-core-idle'}`}
                  style={{ transform: `scale(${coreScale})` }}
                />
                <div
                  className={`absolute inset-[18%] rounded-full ${gemini.isSpeaking ? 'voice-orb-inner-speaking' : gemini.isRecording ? 'voice-orb-inner-listening' : 'voice-orb-inner-idle'}`}
                  style={{ transform: `scale(${innerScale})`, opacity: 0.45 + activeLevel * 0.45 }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  {gemini.isSpeaking ? (
                    <div className="relative h-14 w-14">
                      <div
                        className="absolute inset-0 rounded-full border border-white/16 voice-orb-spectrum-ring"
                        style={{ transform: `scale(${0.88 + activeLevel * 0.36})`, opacity: 0.2 + activeLevel * 0.7 }}
                      />
                      <div
                        className="absolute inset-[18%] rounded-full border border-white/22 voice-orb-spectrum-ring-delayed"
                        style={{ transform: `scale(${0.92 + activeLevel * 0.28})`, opacity: 0.24 + activeLevel * 0.62 }}
                      />
                      <div
                        className="absolute rounded-full bg-white/85 voice-orb-spectrum-core"
                        style={{ inset: speakingCoreInset, opacity: 0.72 + activeLevel * 0.28 }}
                      />
                    </div>
                  ) : gemini.isRecording ? (
                    <div className="relative h-12 w-12">
                      <div
                        className="absolute inset-0 rounded-full border border-slate-300/90 voice-orb-listen-ring"
                        style={{ transform: `scale(${0.94 + activeLevel * 0.26})`, opacity: 0.28 + activeLevel * 0.54 }}
                      />
                      <div
                        className="absolute rounded-full bg-slate-900 transition-all duration-75"
                        style={{ inset: listeningCoreInset, opacity: 0.78 + activeLevel * 0.22 }}
                      />
                    </div>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Durum etiketi */}
            <p className={`text-sm font-medium transition-colors ${
              gemini.isSpeaking ? 'text-gray-900' : gemini.isRecording ? 'text-gray-700' : 'text-gray-400'
            }`}>
              {gemini.isSpeaking ? 'Nöra konuşuyor...' : gemini.isRecording ? 'Dinliyorum...' : 'Hazır'}
            </p>
            {/* Timer */}
            {gemini.timer && gemini.timer.active && (
              <div className="animate-slide-up mt-4">
                <div className="bg-white/90 backdrop-blur rounded-xl px-5 py-3 border border-gray-100 flex items-center gap-3 shadow-sm">
                  <div className="relative w-10 h-10">
                    <svg className="w-10 h-10 transform -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#f3f4f6" strokeWidth="2" />
                      <circle
                        cx="18" cy="18" r="15" fill="none"
                        stroke="#111827" strokeWidth="2"
                        strokeDasharray={`${(gemini.timer.remaining / gemini.timer.duration) * 94.2} 94.2`}
                        strokeLinecap="round"
                        className="transition-all duration-1000"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-semibold text-gray-900">{gemini.timer.remaining}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-900">Süre devam ediyor</p>
                    <p className="text-[11px] text-gray-400">Kelimeler söyleyin...</p>
                  </div>
                </div>
              </div>
            )}

            {/* Timer bitti */}
            {gemini.timer && !gemini.timer.active && gemini.timer.remaining === 0 && (
              <div className="animate-slide-up mt-3">
                <div className="bg-white/90 backdrop-blur rounded-xl px-4 py-2.5 border border-gray-100 flex items-center gap-2 shadow-sm">
                  <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-xs font-medium text-gray-700">Süre tamamlandı</p>
                </div>
              </div>
            )}
            </div>

            {/* Görsel üretimi - isActive bloğunun içinde */}
            {(gemini.generatedImage || gemini.imageGenerating) && (
              <div className="mt-6 mb-4 w-full max-w-md mx-auto">
                <GeneratedImagePanel
                  image={gemini.generatedImage}
                  isGenerating={gemini.imageGenerating}
                  onClose={() => {}}
                />
              </div>
            )}
          </div>
        )}

        {/* Hata */}
        {gemini.error && (
          <div className="mt-4 animate-slide-up">
            <div className="bg-red-50 rounded-xl px-5 py-3 border border-red-100">
              <p className="text-sm text-red-600">{gemini.error}</p>
            </div>
          </div>
        )}

        {/* Tamamlandı */}
        {gemini.state === SESSION_STATES.COMPLETED && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-slide-up">
            <div className="w-14 h-14 rounded-full bg-gray-900 flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900">Testler Tamamlandı</p>
              <p className="text-sm text-gray-400 mt-1">Sonuç sayfasına yönlendiriliyorsunuz...</p>
            </div>
          </div>
        )}
      </main>

      {/* ─── Alt Bar ─── */}
      <footer className="flex items-center justify-center gap-4 px-6 py-4 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-colors ${
            gemini.isRecording ? 'bg-gray-900 animate-pulse' : 'bg-gray-300'
          }`} />
          <span className="text-xs text-gray-400">
            {gemini.isRecording ? 'Mikrofon aktif' : 'Mikrofon kapalı'}
          </span>
        </div>
        <div className="w-px h-4 bg-gray-200" />
        <span className="text-xs text-gray-300">
          {gemini.state === SESSION_STATES.ACTIVE || gemini.state === SESSION_STATES.LISTENING || gemini.state === SESSION_STATES.SPEAKING 
            ? 'Oturum devam ediyor' 
            : gemini.state === SESSION_STATES.COMPLETED 
              ? 'Oturum tamamlandı' 
              : 'Bağlantı kuruluyor'}
        </span>
      </footer>

      {/* ─── Transkript Paneli ─── */}
      {showTranscript && (
        <TranscriptPanel
          transcripts={gemini.transcripts}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </div>
  );
}
