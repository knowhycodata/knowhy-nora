/**
 * TranscriptPanel - Sesli konuşma transkripti paneli
 * Sağ taraftan sürgülü olarak açılır
 */
import { useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function TranscriptPanel({ transcripts, onClose }) {
  const bottomRef = useRef(null);
  const latestTranscript = transcripts[transcripts.length - 1];
  const { t: translate } = useLanguage();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md z-50 animate-slide-in-right">
      <div className="h-full bg-white/96 backdrop-blur-xl shadow-2xl shadow-slate-200/50 border-l border-slate-100 flex flex-col">
        {/* Başlık */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/80">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">{translate('transcript.title')}</h3>
            <p className="text-[11px] text-slate-400 mt-1">{translate('transcript.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-slate-500 transition-colors p-1 rounded-lg hover:bg-slate-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Transkriptler */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5 space-y-5 bg-[linear-gradient(180deg,rgba(248,250,252,0.45),rgba(255,255,255,0))]">
          {transcripts.length === 0 && (
            <div className="text-center mt-10">
              <p className="text-slate-400 text-sm">{translate('transcript.emptyTitle')}</p>
              <p className="text-slate-300 text-xs mt-2">{translate('transcript.emptySubtitle')}</p>
            </div>
          )}
          {transcripts.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className={`flex items-end gap-3 ${entry.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            >
              {entry.role === 'agent' && (
                <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold shadow-[0_12px_28px_rgba(15,23,42,0.16)] shrink-0">
                  N
                </div>
              )}

              <div className={`max-w-[78%] ${entry.role === 'user' ? 'order-1' : ''}`}>
                <div className={`flex items-center gap-2 mb-1.5 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {entry.role === 'user' ? translate('transcript.user') : translate('transcript.agent')}
                  </span>
                  {entry.partial && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                      <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
                      {translate('transcript.flowing')}
                    </span>
                  )}
                </div>
                <p
                  className={`text-[15px] leading-7 break-words transition-all duration-300 ${
                    entry.role === 'user' ? 'text-right text-slate-800' : 'text-left text-slate-700'
                  } ${entry.partial ? 'opacity-100' : 'opacity-84'} ${latestTranscript && latestTranscript.timestamp === entry.timestamp && latestTranscript.role === entry.role ? 'translate-y-0' : ''}`}
                >
                  {entry.text}
                </p>
              </div>

              {entry.role === 'user' && (
                <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-semibold border border-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.06)] shrink-0 order-2">
                  S
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
