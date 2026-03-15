/**
 * DateTime Agent - Deterministic date/time provider for orientation test.
 *
 * This agent never uses LLM. It provides:
 * - Current date/time facts
 * - Verification of user orientation answers
 * - Language-aware labels (Turkish / English)
 */

const { createLogger } = require('../lib/logger');
const { normalizeLanguage, isEnglish } = require('../lib/language');

const log = createLogger('DateTimeAgent');

const LOCALE_PACKS = {
  tr: {
    months: [
      'Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran',
      'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik',
    ],
    days: ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'],
    seasons: {
      0: 'Kis', 1: 'Kis', 2: 'Ilkbahar',
      3: 'Ilkbahar', 4: 'Ilkbahar', 5: 'Yaz',
      6: 'Yaz', 7: 'Yaz', 8: 'Sonbahar',
      9: 'Sonbahar', 10: 'Sonbahar', 11: 'Kis',
    },
    defaultCountry: 'Turkiye',
    timeRanges: {
      sabah: [6, 11],
      ogle: [11, 14],
      'ogleden sonra': [12, 17],
      aksam: [17, 21],
      gece: [21, 6],
    },
  },
  en: {
    months: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    seasons: {
      0: 'Winter', 1: 'Winter', 2: 'Spring',
      3: 'Spring', 4: 'Spring', 5: 'Summer',
      6: 'Summer', 7: 'Summer', 8: 'Autumn',
      9: 'Autumn', 10: 'Autumn', 11: 'Winter',
    },
    defaultCountry: 'Turkey',
    timeRanges: {
      morning: [6, 11],
      noon: [11, 14],
      afternoon: [12, 17],
      evening: [17, 21],
      night: [21, 6],
    },
  },
};

function getLocalePack(language) {
  return isEnglish(language) ? LOCALE_PACKS.en : LOCALE_PACKS.tr;
}

function inRange(hour, start, end) {
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;
}

class DateTimeAgent {
  constructor(sessionId, language = 'tr') {
    this.sessionId = sessionId;
    this.language = normalizeLanguage(language);
    this.timezone = 'Europe/Istanbul';
    this.verificationResults = [];

    log.info('DateTimeAgent created', { sessionId, language: this.language });
  }

  getCurrentDateTime() {
    const now = new Date();
    const localDate = new Date(now.toLocaleString('en-US', { timeZone: this.timezone }));
    const locale = getLocalePack(this.language);
    const monthIndex = localDate.getMonth();

    const result = {
      year: localDate.getFullYear(),
      month: monthIndex + 1,
      monthName: locale.months[monthIndex],
      day: localDate.getDate(),
      dayOfWeek: locale.days[localDate.getDay()],
      hour: localDate.getHours(),
      minute: localDate.getMinutes(),
      season: locale.seasons[monthIndex],
      formattedDate: `${localDate.getDate()} ${locale.months[monthIndex]} ${localDate.getFullYear()}`,
      formattedTime: `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`,
      timestamp: now.toISOString(),
      timezone: this.timezone,
      language: this.language,
    };

    log.info('Current datetime', {
      sessionId: this.sessionId,
      language: this.language,
      date: result.formattedDate,
      time: result.formattedTime,
    });

    return result;
  }

  verifyOrientationAnswer(questionType, userAnswer, context = {}) {
    const dt = this.getCurrentDateTime();
    const locale = getLocalePack(this.language);
    const normalizedAnswer = (userAnswer || '').toLowerCase().trim();

    let correctAnswer = '';
    let isCorrectAnswer = false;
    let tolerance = '';

    switch (questionType) {
      case 'day': {
        correctAnswer = dt.dayOfWeek;
        const answer = correctAnswer.toLowerCase();
        isCorrectAnswer = normalizedAnswer.includes(answer) || answer.includes(normalizedAnswer);
        break;
      }
      case 'month': {
        correctAnswer = dt.monthName;
        const answer = correctAnswer.toLowerCase();
        isCorrectAnswer = normalizedAnswer.includes(answer) || answer.includes(normalizedAnswer);
        if (!isCorrectAnswer && normalizedAnswer.includes(String(dt.month))) {
          isCorrectAnswer = true;
        }
        break;
      }
      case 'year': {
        correctAnswer = String(dt.year);
        isCorrectAnswer = normalizedAnswer.includes(correctAnswer);
        break;
      }
      case 'season': {
        correctAnswer = dt.season;
        const answer = correctAnswer.toLowerCase();
        isCorrectAnswer = normalizedAnswer.includes(answer) || answer.includes(normalizedAnswer);
        const transitionMonths = [2, 5, 8, 11];
        const monthIndex = dt.month - 1;
        if (!isCorrectAnswer && transitionMonths.includes(monthIndex)) {
          const prevSeason = locale.seasons[(monthIndex + 11) % 12].toLowerCase();
          if (normalizedAnswer.includes(prevSeason)) {
            isCorrectAnswer = true;
            tolerance = isEnglish(this.language)
              ? 'Season transition tolerance'
              : 'Mevsim gecis toleransi';
          }
        }
        break;
      }
      case 'time': {
        correctAnswer = dt.formattedTime;
        const hourMatch = normalizedAnswer.match(/(\d{1,2})/);
        if (hourMatch) {
          const userHour = parseInt(hourMatch[1], 10);
          isCorrectAnswer = Math.abs(userHour - dt.hour) <= 1;
          tolerance = isEnglish(this.language) ? '±1 hour tolerance' : '±1 saat tolerans';
        }
        if (!isCorrectAnswer) {
          for (const [label, range] of Object.entries(locale.timeRanges)) {
            if (normalizedAnswer.includes(label) && inRange(dt.hour, range[0], range[1])) {
              isCorrectAnswer = true;
              tolerance = isEnglish(this.language)
                ? `Approximate time range accepted (${label})`
                : `Yaklasik zaman dilimi kabul edildi (${label})`;
              break;
            }
          }
        }
        break;
      }
      case 'city': {
        correctAnswer = context.city || 'unknown';
        if (correctAnswer !== 'unknown') {
          const answer = correctAnswer.toLowerCase();
          isCorrectAnswer = normalizedAnswer.includes(answer) || answer.includes(normalizedAnswer);
        } else {
          isCorrectAnswer = normalizedAnswer.length > 1;
          correctAnswer = userAnswer;
          tolerance = isEnglish(this.language)
            ? 'City could not be verified, answer accepted'
            : 'Sehir dogrulanamadi, cevap kabul edildi';
        }
        break;
      }
      case 'country': {
        correctAnswer = context.country || locale.defaultCountry;
        const answer = correctAnswer.toLowerCase();
        isCorrectAnswer =
          normalizedAnswer.includes(answer) ||
          normalizedAnswer.includes('turkiye') ||
          normalizedAnswer.includes('turkey') ||
          answer.includes(normalizedAnswer);
        break;
      }
      default: {
        correctAnswer = isEnglish(this.language) ? 'unknown' : 'bilinmeyen';
        isCorrectAnswer = false;
      }
    }

    const verification = {
      questionType,
      userAnswer,
      correctAnswer,
      isCorrect: isCorrectAnswer,
      tolerance: tolerance || null,
      timestamp: new Date().toISOString(),
    };

    this.verificationResults.push(verification);
    log.info('Orientation answer verified', {
      sessionId: this.sessionId,
      language: this.language,
      questionType,
      isCorrect: isCorrectAnswer,
    });

    return verification;
  }

  generateCorrectAnswers(context = {}) {
    const dt = this.getCurrentDateTime();
    const locale = getLocalePack(this.language);
    return {
      day: dt.dayOfWeek,
      month: dt.monthName,
      year: String(dt.year),
      season: dt.season,
      time: dt.formattedTime,
      city: context.city || (isEnglish(this.language) ? 'unknown' : 'bilinmeyen'),
      country: context.country || locale.defaultCountry,
      generatedAt: dt.timestamp,
    };
  }

  getVerificationResults() {
    return {
      results: this.verificationResults,
      totalQuestions: this.verificationResults.length,
      correctCount: this.verificationResults.filter((entry) => entry.isCorrect).length,
    };
  }

  destroy() {
    log.info('DateTimeAgent destroyed', {
      sessionId: this.sessionId,
      language: this.language,
    });
  }
}

module.exports = { DateTimeAgent };
