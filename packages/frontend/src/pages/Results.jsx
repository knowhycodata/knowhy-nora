import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import api from '../lib/api';
import BrandMark from '../components/BrandMark';
import { getBlobApiErrorMessage } from '../lib/apiErrors';

export default function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, language, formatDate } = useLanguage();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const isPdfReady = session?.status === 'COMPLETED';
  const pdfPendingMessage = language === 'en'
    ? 'PDF report is available only after the session is completed.'
    : 'PDF raporu yalnızca oturum tamamlandıktan sonra indirilebilir.';

  const handlePdfDownload = useCallback(async () => {
    if (!id) return;
    if (!isPdfReady) {
      setPdfError(pdfPendingMessage);
      return;
    }

    setPdfLoading(true);
    setPdfError(null);
    try {
      const response = await api.get(`/sessions/${id}/pdf?lang=${language}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nöra-report-${id.substring(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      setPdfError(await getBlobApiErrorMessage(err, t('results.pdfError') || 'PDF indirme hatası'));
    } finally {
      setPdfLoading(false);
    }
  }, [id, isPdfReady, pdfPendingMessage, language, t]);

  const testTypeLabels = useMemo(
    () => ({
      VERBAL_FLUENCY: t('results.test.verbalFluency'),
      STORY_RECALL: t('results.test.storyRecall'),
      VISUAL_RECOGNITION: t('results.test.visualRecognition'),
      ORIENTATION: t('results.test.orientation'),
    }),
    [t]
  );

  const riskConfig = useMemo(
    () => ({
      LOW: {
        label: t('results.risk.low.label'),
        color: 'text-emerald-700',
        badge: 'text-emerald-700 bg-emerald-50 border-emerald-100',
        bg: 'bg-emerald-50 border-emerald-100',
        description: t('results.risk.low.description'),
      },
      MODERATE: {
        label: t('results.risk.moderate.label'),
        color: 'text-amber-700',
        badge: 'text-amber-700 bg-amber-50 border-amber-100',
        bg: 'bg-amber-50 border-amber-100',
        description: t('results.risk.moderate.description'),
      },
      HIGH: {
        label: t('results.risk.high.label'),
        color: 'text-red-700',
        badge: 'text-red-700 bg-red-50 border-red-100',
        bg: 'bg-red-50 border-red-100',
        description: t('results.risk.high.description'),
      },
    }),
    [t]
  );

  useEffect(() => {
    api.get(`/sessions/${id}`)
      .then((res) => setSession(res.data.session))
      .catch(() => navigate('/dashboard'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-10 h-10 rounded-full border-2 border-gray-200 border-t-gray-900 animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const risk = session.riskLevel ? riskConfig[session.riskLevel] : null;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-100 px-6 py-4 bg-white">
        <div className="container mx-auto flex items-center justify-between max-w-3xl">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <span className="text-lg font-semibold tracking-tight text-gray-900">{t('results.title')}</span>
          </div>
          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            {t('common.dashboard')}
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10 max-w-3xl">
        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-8 mb-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-[0.18em]">{t('results.summary')}</p>
              <h1 className="mt-2 text-2xl font-semibold text-gray-900">{t('results.reportTitle')}</h1>
              <p className="mt-2 text-sm text-gray-500">
                {formatDate(session.startedAt, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="min-w-[180px] rounded-2xl bg-white border border-gray-100 px-6 py-5 text-center shadow-sm">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.18em]">{t('results.totalScore')}</p>
              <p className="mt-2 text-5xl font-semibold text-gray-900">
                {session.totalScore !== null ? Math.round(session.totalScore) : '—'}
              </p>
              <p className="mt-2 text-xs text-gray-400">{t('results.totalScoreDesc')}</p>
            </div>
          </div>
        </div>

        {risk && (
          <div className={`rounded-2xl border p-5 mb-6 ${risk.bg}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-[0.18em]">{t('results.riskStatus')}</p>
                <h3 className={`mt-2 text-lg font-semibold ${risk.color}`}>{risk.label}</h3>
                <p className="mt-1 text-sm text-gray-600 leading-6">{risk.description}</p>
              </div>
              <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium ${risk.badge}`}>
                {risk.label}
              </span>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-400">{t('results.detailsTitle')}</h2>
          <span className="text-xs text-gray-400">{t('results.detailsSubtitle')}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {session.tests?.map((test) => {
            const pct = test.maxScore > 0 ? (test.score / test.maxScore) * 100 : 0;
            const barColor =
              pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';

            return (
              <div key={test.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">Test</p>
                    <h3 className="mt-2 text-base font-semibold text-gray-900">
                      {testTypeLabels[test.testType] || test.testType}
                    </h3>
                  </div>
                  <span className="text-lg font-semibold text-gray-900 whitespace-nowrap">
                    {Math.round(test.score)}<span className="text-gray-300">/{test.maxScore}</span>
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{t('results.successRate')}</span>
                  <span>%{Math.round(pct)}</span>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500 leading-6">
                    {pct >= 75
                      ? t('results.performance.strong')
                      : pct >= 50
                        ? t('results.performance.partial')
                        : t('results.performance.support')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <button
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handlePdfDownload}
            disabled={pdfLoading || !isPdfReady}
          >
            {pdfLoading ? (
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            )}
            {pdfLoading ? t('results.pdfPreparing') : t('results.pdfDownload')}
          </button>
          {pdfError && (
            <p className="mt-2 text-sm text-red-500">{pdfError}</p>
          )}
          {!pdfError && !isPdfReady && (
            <p className="mt-2 text-sm text-amber-600">{pdfPendingMessage}</p>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-gray-100 bg-gray-50 p-5">
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            <strong className="text-gray-700">{t('results.warningTitle')}:</strong> {t('results.warningText')}
          </p>
        </div>
      </main>
    </div>
  );
}
