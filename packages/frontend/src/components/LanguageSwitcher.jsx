import { useLanguage } from '../context/LanguageContext';

export default function LanguageSwitcher({ compact = false, className = '' }) {
  const { language, setLanguage, t } = useLanguage();

  const baseClass = compact
    ? 'rounded-md px-2.5 py-1 text-[11px] font-semibold'
    : 'rounded-lg px-3 py-1.5 text-xs font-semibold';

  return (
    <div className={`inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setLanguage('tr')}
        className={`${baseClass} transition ${language === 'tr' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
      >
        TR
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`${baseClass} transition ${language === 'en' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
      >
        EN
      </button>
      {!compact && <span className="ml-1 pr-1 text-[11px] text-gray-400">{t('language.label')}</span>}
    </div>
  );
}

