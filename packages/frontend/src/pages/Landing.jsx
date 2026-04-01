import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useLanguage } from '../context/LanguageContext';

export default function Landing() {
  const { t } = useLanguage();
  const metaItems = [
    t('landing.metaTests'),
    t('landing.metaLanguages'),
    t('landing.metaReport'),
  ];
  const previewSteps = [
    {
      number: '01',
      title: t('landing.previewStep1Title'),
      description: t('landing.previewStep1Desc'),
    },
    {
      number: '02',
      title: t('landing.previewStep2Title'),
      description: t('landing.previewStep2Desc'),
    },
    {
      number: '03',
      title: t('landing.previewStep3Title'),
      description: t('landing.previewStep3Desc'),
    },
  ];
  const flowSteps = [
    {
      number: '01',
      title: t('landing.flowStep1Title'),
      description: t('landing.flowStep1Desc'),
    },
    {
      number: '02',
      title: t('landing.flowStep2Title'),
      description: t('landing.flowStep2Desc'),
    },
    {
      number: '03',
      title: t('landing.flowStep3Title'),
      description: t('landing.flowStep3Desc'),
    },
  ];
  const benefits = [
    {
      title: t('landing.benefit1Title'),
      description: t('landing.benefit1Desc'),
    },
    {
      title: t('landing.benefit2Title'),
      description: t('landing.benefit2Desc'),
    },
    {
      title: t('landing.benefit3Title'),
      description: t('landing.benefit3Desc'),
    },
  ];

  return (
    <div className="page-shell relative min-h-screen overflow-hidden text-[#14211d]">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <header className="relative z-10 border-b border-[rgba(20,33,29,0.08)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <BrandMark size="md" />
            <span className="text-lg font-semibold tracking-tight">{t('common.appName')}</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <LanguageSwitcher compact />
            <Link to="/login" className="hidden text-sm text-[#61726a] transition hover:text-[#14211d] sm:inline-flex">
              {t('common.login')}
            </Link>
            <Link
              to="/register"
              className="rounded-full bg-[#14211d] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#22322c]"
            >
              {t('common.register')}
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-12 pt-10 sm:pb-16 sm:pt-14">
        <section className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
          <div className="lift-in max-w-2xl">
            <span className="section-kicker">{t('landing.badge')}</span>

            <h1 className="font-editorial mt-6 text-5xl leading-[0.95] tracking-tight text-[#14211d] sm:text-6xl lg:text-[4.35rem]">
              {t('landing.titleLine1')}
              <span className="mt-2 block text-[#577264]">{t('landing.titleLine2')}</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-7 text-[#5b6c64] sm:text-lg">
              {t('landing.description')}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="rounded-full bg-[#14211d] px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-[#22322c]"
              >
                {t('landing.startScan')}
              </Link>
              <Link
                to="/login"
                className="rounded-full border border-[rgba(20,33,29,0.12)] bg-white/70 px-7 py-3.5 text-sm font-semibold text-[#51615a] transition hover:bg-white"
              >
                {t('common.login')}
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {metaItems.map((item) => (
                <span key={item} className="hero-chip">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="lift-in lg:pl-4">
            <div className="surface-card relative overflow-hidden rounded-[30px] p-6 sm:p-7">
              <div className="absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(87,114,100,0.45)] to-transparent" />

              <div className="flex items-start justify-between gap-4">
                <div className="max-w-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7a8b84]">
                    {t('landing.previewEyebrow')}
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#14211d] sm:text-[2rem]">
                    {t('landing.previewTitle')}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[#5b6c64]">
                    {t('landing.previewSubtitle')}
                  </p>
                </div>
                <span className="hero-chip shrink-0">{t('landing.previewLive')}</span>
              </div>

              <div className="mt-6 space-y-3">
                {previewSteps.map((step) => (
                  <div
                    key={step.number}
                    className="rounded-[24px] border border-[rgba(20,33,29,0.08)] bg-white/72 p-4"
                  >
                    <div className="flex items-start gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#14211d] text-xs font-semibold text-white">
                        {step.number}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-[#14211d] sm:text-[0.95rem]">
                          {step.title}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-[#607169]">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[24px] border border-[rgba(20,33,29,0.08)] bg-[#f4efe6] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7c8e86]">
                  {t('landing.previewSummaryLabel')}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#4f6058]">
                  {t('landing.previewSummaryText')}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-[1.04fr_0.96fr]">
          <div className="surface-card-soft rounded-[30px] p-6 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7a8b84]">
              {t('landing.flowEyebrow')}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#14211d]">
              {t('landing.flowTitle')}
            </h2>

            <div className="mt-6 grid gap-3 md:grid-cols-3 lg:grid-cols-1">
              {flowSteps.map((step) => (
                <div
                  key={step.number}
                  className="rounded-[24px] border border-[rgba(20,33,29,0.08)] bg-white/72 p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8a9a92]">
                    {step.number}
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-[#14211d]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#607169]">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="surface-card-soft rounded-[30px] p-6 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7a8b84]">
              {t('landing.benefitsEyebrow')}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#14211d]">
              {t('landing.benefitsTitle')}
            </h2>

            <div className="mt-6 space-y-3">
              {benefits.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[24px] border border-[rgba(20,33,29,0.08)] bg-white/72 px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#6e8a7b]" />
                    <div>
                      <h3 className="text-base font-semibold text-[#14211d]">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[#607169]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 max-w-md text-sm leading-6 text-[#6a7a73]">
              {t('landing.medicalNote')}
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[rgba(20,33,29,0.08)] py-7 text-center text-xs tracking-[0.14em] text-[#7a8b84]">
        <span>{t('landing.footerLabel')}</span>
        <span className="mx-2 text-[#9aa8a2]">/</span>
        <a
          href="https://knowhy.co"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#5b6c64] transition hover:text-[#14211d]"
        >
          {t('landing.footerLink')}
        </a>
      </footer>
    </div>
  );
}
