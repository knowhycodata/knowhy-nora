import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import BrandMark from '../components/BrandMark';
import LanguageSwitcher from '../components/LanguageSwitcher';
import api from '../lib/api';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { t, language, setLanguage, formatDateTime } = useLanguage();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionLanguagePicked, setSessionLanguagePicked] = useState(false);

  const statusConfig = useMemo(
    () => ({
      IN_PROGRESS: { label: t('dashboard.status.inProgress'), color: 'text-amber-600 bg-amber-50 border-amber-100' },
      COMPLETED: { label: t('dashboard.status.completed'), color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
      CANCELLED: { label: t('dashboard.status.cancelled'), color: 'text-red-600 bg-red-50 border-red-100' },
    }),
    [t]
  );

  const riskConfig = useMemo(
    () => ({
      LOW: { label: t('dashboard.risk.low'), color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
      MODERATE: { label: t('dashboard.risk.moderate'), color: 'text-amber-600 bg-amber-50 border-amber-100' },
      HIGH: { label: t('dashboard.risk.high'), color: 'text-red-600 bg-red-50 border-red-100' },
    }),
    [t]
  );

  useEffect(() => {
    api.get('/sessions')
      .then((res) => setSessions(res.data.sessions))
      .catch((err) => console.error('Sessions could not be loaded', err))
      .finally(() => setLoading(false));
  }, []);

  const handleLanguagePick = (nextLanguage) => {
    setLanguage(nextLanguage);
    setSessionLanguagePicked(true);
  };

  const handleStartSession = () => {
    if (!sessionLanguagePicked) return;
    sessionStorage.setItem('session_language_confirmed', '1');
    navigate('/session');
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="border-b border-gray-100">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <span className="text-lg font-semibold tracking-tight">{t('common.appName')}</span>
          </div>
          <div className="flex items-center gap-6">
            <LanguageSwitcher compact />
            <span className="text-sm text-gray-500">{user?.name}</span>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-red-500 transition"
            >
              {t('common.logout')}
            </button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-10 max-w-3xl">
        <div className="bg-gray-50 rounded-2xl p-8 text-center border border-gray-100">
          <div className="w-20 h-20 mx-auto rounded-full bg-gray-900 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">{t('dashboard.title')}</h1>
          <p className="mt-2 text-gray-500 text-sm">
            {t('dashboard.subtitle')}
          </p>

          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-left">
            <p className="text-sm font-semibold text-gray-900">{t('dashboard.languageCardTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('dashboard.languageCardDesc')}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleLanguagePick('tr')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  language === 'tr' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t('common.tr')}
              </button>
              <button
                type="button"
                onClick={() => handleLanguagePick('en')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  language === 'en' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t('common.en')}
              </button>
            </div>
            {!sessionLanguagePicked && (
              <p className="mt-2 text-xs text-amber-600">{t('language.sessionRequired')}</p>
            )}
          </div>

          <button
            onClick={handleStartSession}
            disabled={!sessionLanguagePicked}
            className="mt-6 inline-flex items-center gap-2 px-8 py-3 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            {t('dashboard.start')}
          </button>
        </div>

        <div className="mt-10">
          <h2 className="text-sm font-medium text-gray-400 mb-4">{t('dashboard.sessions')}</h2>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-gray-900 animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="text-sm text-gray-400">{t('dashboard.noSessions')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const status = statusConfig[session.status] || statusConfig.IN_PROGRESS;
                const risk = session.riskLevel ? riskConfig[session.riskLevel] : null;

                return (
                  <button
                    key={session.id}
                    onClick={async () => {
                      if (session.status === 'COMPLETED') {
                        navigate(`/results/${session.id}`);
                        return;
                      }
                      if (session.status === 'IN_PROGRESS') {
                        // Yarım kalan session — iptal et, geri dönülemez
                        try {
                          await api.patch(`/sessions/${session.id}/cancel`);
                        } catch (e) {
                          console.error('Session iptal hatası:', e);
                        }
                        // Listeyi güncelle
                        setSessions(prev => prev.map(s => s.id === session.id ? { ...s, status: 'CANCELLED' } : s));
                        return;
                      }
                      // CANCELLED — sadece görüntüleme, aksiyon yok
                    }}
                    className={`w-full flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 transition text-left ${
                      session.status === 'COMPLETED' ? 'hover:border-gray-200 cursor-pointer' : 
                      session.status === 'IN_PROGRESS' ? 'hover:border-red-200 cursor-pointer' : 'opacity-60 cursor-default'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-gray-700">
                        {formatDateTime(session.startedAt, {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${status.color}`}>
                          {status.label}
                        </span>
                        {risk && (
                          <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${risk.color}`}>
                            {risk.label}
                          </span>
                        )}
                      </div>
                    </div>
                    {session.totalScore !== null && (
                      <span className="text-lg font-semibold text-gray-900">
                        {Math.round(session.totalScore)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
