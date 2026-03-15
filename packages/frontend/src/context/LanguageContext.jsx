import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { translations } from '../i18n/translations';

const DEFAULT_LANGUAGE = 'tr';
const SUPPORTED_LANGUAGES = ['tr', 'en'];
const LANGUAGE_STORAGE_KEY = 'app_language';

const LanguageContext = createContext(null);

function normalizeLanguage(input) {
  if (typeof input !== 'string') return DEFAULT_LANGUAGE;
  const normalized = input.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : DEFAULT_LANGUAGE;
}

function getNestedValue(object, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return acc[key];
    }
    return undefined;
  }, object);
}

function replaceVars(template, vars = {}) {
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) => {
    if (vars[key] === undefined || vars[key] === null) return '';
    return String(vars[key]);
  });
}

function detectInitialLanguage() {
  const storedRaw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (storedRaw) {
    return normalizeLanguage(storedRaw);
  }

  const browserLang = (navigator.language || '').toLowerCase();
  if (browserLang.startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => detectInitialLanguage());

  const setLanguage = useCallback((nextLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    setLanguageState(normalized);
  }, []);

  const t = useCallback(
    (key, vars) => {
      const activePack = translations[language] || translations[DEFAULT_LANGUAGE];
      const fallbackPack = translations[DEFAULT_LANGUAGE];

      const rawValue = getNestedValue(activePack, key) ?? getNestedValue(fallbackPack, key);
      if (typeof rawValue !== 'string') {
        return rawValue ?? key;
      }

      return replaceVars(rawValue, vars);
    },
    [language]
  );

  const dateLocale = language === 'en' ? 'en-US' : 'tr-TR';

  const formatDate = useCallback(
    (value, options = {}) => {
      const date = value instanceof Date ? value : new Date(value);
      return date.toLocaleDateString(dateLocale, options);
    },
    [dateLocale]
  );

  const formatDateTime = useCallback(
    (value, options = {}) => {
      const date = value instanceof Date ? value : new Date(value);
      return date.toLocaleDateString(dateLocale, options);
    },
    [dateLocale]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      formatDate,
      formatDateTime,
      isEnglish: language === 'en',
    }),
    [formatDate, formatDateTime, language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}

