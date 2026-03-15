import { Link } from 'react-router-dom';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useLanguage } from '../context/LanguageContext';

export default function Landing() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
              <span className="text-white text-sm font-semibold">N</span>
            </div>
            <span className="text-lg font-semibold tracking-tight">{t('common.appName')}</span>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher compact />
            <Link to="/login" className="text-sm text-gray-500 hover:text-gray-900 transition">
              {t('common.login')}
            </Link>
            <Link
              to="/register"
              className="px-5 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition"
            >
              {t('common.register')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="container mx-auto px-6 pt-20 pb-24">
        <div className="max-w-2xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 text-xs font-medium text-gray-600 bg-gray-50 rounded-full border border-gray-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            {t('landing.badge')}
          </div>

          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight text-gray-900">
            {t('landing.titleLine1')}
            <br />
            {t('landing.titleLine2')}
          </h1>

          <p className="mt-6 text-lg text-gray-500 leading-relaxed max-w-lg mx-auto">
            {t('landing.description')}
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              to="/register"
              className="px-8 py-3.5 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-all"
            >
              {t('landing.startScan')}
            </Link>
            <Link
              to="/login"
              className="px-8 py-3.5 text-sm font-semibold text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all border border-gray-200"
            >
              {t('common.login')}
            </Link>
          </div>
        </div>

        {/* Özellikler */}
        <div className="mt-24 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
            <div className="w-10 h-10 flex items-center justify-center bg-white rounded-lg mb-4 border border-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900">{t('landing.feature1Title')}</h3>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {t('landing.feature1Desc')}
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
            <div className="w-10 h-10 flex items-center justify-center bg-white rounded-lg mb-4 border border-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900">{t('landing.feature2Title')}</h3>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {t('landing.feature2Desc')}
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
            <div className="w-10 h-10 flex items-center justify-center bg-white rounded-lg mb-4 border border-gray-200">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900">{t('landing.feature3Title')}</h3>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {t('landing.feature3Desc')}
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 text-center text-xs text-gray-400">
        {t('landing.footer')}
      </footer>
    </div>
  );
}
