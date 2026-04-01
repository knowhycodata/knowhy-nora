import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import BrandMark from '../components/BrandMark';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { getApiErrorMessage } from '../lib/apiErrors';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(name, email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.registerFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <div className="lift-in relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center">
            <LanguageSwitcher compact />
          </div>
          <Link to="/" className="inline-flex items-center gap-3">
            <BrandMark size="md" />
            <span className="text-lg font-semibold tracking-tight text-[#14211d]">{t('common.appName')}</span>
          </Link>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-[#14211d]">{t('auth.registerTitle')}</h1>
          <p className="mt-2 text-sm leading-6 text-[#5b6c64]">{t('auth.registerSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="surface-card rounded-[28px] p-7 space-y-5">
          {error && (
            <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-[#6d7d76]">
              {t('auth.name')}
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="surface-input w-full rounded-2xl px-4 py-3 text-sm text-[#14211d] placeholder:text-[#90a098] outline-none transition"
              placeholder={t('auth.sampleName')}
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-[#6d7d76]">
              {t('auth.email')}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="surface-input w-full rounded-2xl px-4 py-3 text-sm text-[#14211d] placeholder:text-[#90a098] outline-none transition"
              placeholder={t('auth.sampleEmail')}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[#6d7d76]">
              {t('auth.password')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="surface-input w-full rounded-2xl px-4 py-3 pr-10 text-sm text-[#14211d] placeholder:text-[#90a098] outline-none transition"
                placeholder={t('auth.minPassword')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8ea097] transition hover:text-[#5f7068]"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-[#14211d] py-3 text-sm font-semibold text-white transition-all hover:bg-[#22322c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t('auth.registerLoading') : t('common.register')}
          </button>

          <p className="text-center text-sm text-[#6c7c75]">
            {t('auth.alreadyAccount')}{' '}
            <Link to="/login" className="font-medium text-[#14211d] transition hover:text-[#3f5b4d]">
              {t('common.login')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
