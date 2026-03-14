/**
 * GeneratedImagePanel - Test 3 Görsel Tanıma Modal/Popup
 * 
 * Fullscreen overlay olarak açılır.
 * Görsel ortada büyük gösterilir, test ilerleme barı ve talimat içerir.
 * Imagen 4 Fast ile üretilen veya fallback SVG görselleri gösterir.
 */
import { useState, useEffect } from 'react';

export default function GeneratedImagePanel({ image, isGenerating, onClose }) {
  const [animateIn, setAnimateIn] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const hasFallback = image && image.fallback && !image.data;
  const totalImages = image?.totalImages || 3;
  const currentIndex = (image?.imageIndex ?? 0) + 1;

  useEffect(() => {
    if (image || isGenerating) {
      requestAnimationFrame(() => setAnimateIn(true));
    } else {
      setAnimateIn(false);
    }
  }, [image, isGenerating]);

  if (!image && !isGenerating) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
        animateIn ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal Container */}
      <div
        className={`relative z-10 w-full max-w-md mx-4 transition-all duration-500 ${
          animateIn ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
      >
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Görsel Tanıma Testi</h3>
                  <p className="text-[11px] text-gray-400">Ekrandaki görseli inceleyin</p>
                </div>
              </div>

              {/* İlerleme badge */}
              {image && (
                <div className="flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1.5">
                  <span className="text-xs font-semibold text-gray-700">{currentIndex}</span>
                  <span className="text-[10px] text-gray-400">/</span>
                  <span className="text-xs text-gray-500">{totalImages}</span>
                </div>
              )}
            </div>

            {/* İlerleme barı */}
            {image && (
              <div className="mt-3 flex gap-1.5">
                {Array.from({ length: totalImages }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                      i < currentIndex
                        ? 'bg-gray-900'
                        : i === currentIndex
                          ? 'bg-gray-300'
                          : 'bg-gray-100'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Görsel Alanı */}
          <div className="px-5 pb-4">
            {/* Yükleniyor */}
            {isGenerating && !image && (
              <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-gray-50 border border-gray-100">
                <div className="relative">
                  <div
                    className="w-16 h-16 rounded-full border-[3px] border-gray-200 animate-spin"
                    style={{ borderTopColor: '#f59e0b' }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400/30 to-orange-500/30 animate-pulse" />
                  </div>
                </div>
                <p className="text-gray-500 text-sm font-medium mt-5 animate-pulse">
                  Görsel hazırlanıyor...
                </p>
                <p className="text-gray-300 text-[11px] mt-1">
                  Imagen 4 ile üretiliyor
                </p>
              </div>
            )}

            {/* Fallback: Görsel üretilemedi */}
            {hasFallback && (
              <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-gray-50 border border-gray-100">
                <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                </div>
                <p className="text-base font-semibold text-gray-700">Görsel {currentIndex}</p>
                <p className="text-xs text-gray-400 mt-1.5">Bu görseli hayal edin ve tanımlayın</p>
              </div>
            )}

            {/* Üretilen Görsel */}
            {image && !hasFallback && (
              <div
                className={`relative rounded-2xl overflow-hidden cursor-pointer group transition-all duration-300 ${
                  zoomed ? 'ring-2 ring-amber-400/50' : ''
                }`}
                onClick={() => setZoomed(!zoomed)}
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={`Test Görseli ${currentIndex}`}
                  className={`w-full object-contain rounded-2xl transition-all duration-500 bg-gray-50 ${
                    zoomed ? 'max-h-[70vh] scale-105' : 'max-h-72'
                  }`}
                />

                {/* Zoom indicator */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-black/50 backdrop-blur-sm rounded-lg p-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {zoomed ? (
                        <>
                          <polyline points="4 14 10 14 10 20"/>
                          <polyline points="20 10 14 10 14 4"/>
                          <line x1="14" x2="21" y1="10" y2="3"/>
                          <line x1="3" x2="10" y1="21" y2="14"/>
                        </>
                      ) : (
                        <>
                          <polyline points="15 3 21 3 21 9"/>
                          <polyline points="9 21 3 21 3 15"/>
                          <line x1="21" x2="14" y1="3" y2="10"/>
                          <line x1="3" x2="10" y1="21" y2="14"/>
                        </>
                      )}
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer - Talimat */}
          {image && (
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" x2="12" y1="19" y2="22"/>
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700">Bu görselde ne görüyorsunuz?</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Sesli olarak cevaplayın</p>
                </div>
              </div>

              {/* AI badge */}
              <div className="flex items-center justify-center mt-3">
                <span className="text-[10px] text-gray-300 flex items-center gap-1">
                  {image.generatedByAI ? 'Imagen 4 ile' : 'Statik'} görsel
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
