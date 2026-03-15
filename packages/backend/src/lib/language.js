const SUPPORTED_LANGUAGES = ['tr', 'en'];
const DEFAULT_LANGUAGE = 'tr';

function normalizeLanguage(input) {
  if (typeof input !== 'string') return DEFAULT_LANGUAGE;
  const normalized = input.trim().toLowerCase();
  if (SUPPORTED_LANGUAGES.includes(normalized)) {
    return normalized;
  }
  return DEFAULT_LANGUAGE;
}

function isEnglish(language) {
  return normalizeLanguage(language) === 'en';
}

function pickText(language, trText, enText) {
  return isEnglish(language) ? enText : trText;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  isEnglish,
  pickText,
};
