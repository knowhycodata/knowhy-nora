const SAFE_EMAIL_LOCAL_PART_REGEX = /^(?=.{1,64}$)[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/i;
const SAFE_EMAIL_DOMAIN_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const DISALLOWED_EMAIL_TOKENS = ["--", "/*", "*/", "'", '"', '`', ';', '\\'];

function normalizeEmailInput(value) {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase();
}

function containsDisallowedToken(value) {
  return DISALLOWED_EMAIL_TOKENS.some((token) => value.includes(token));
}

function isSafeEmail(value) {
  const normalized = normalizeEmailInput(value);
  if (typeof normalized !== 'string' || !normalized || normalized.length > 254) {
    return false;
  }

  if (normalized.includes('..') || /\s/.test(normalized) || containsDisallowedToken(normalized)) {
    return false;
  }

  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const [localPart, domainPart] = parts;
  return SAFE_EMAIL_LOCAL_PART_REGEX.test(localPart) && SAFE_EMAIL_DOMAIN_REGEX.test(domainPart);
}

module.exports = {
  isSafeEmail,
  normalizeEmailInput,
};
