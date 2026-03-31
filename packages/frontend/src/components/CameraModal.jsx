import CameraPanel from './CameraPanel';
import { useLanguage } from '../context/LanguageContext';

export default function CameraModal({
  isOpen,
  cameraCommand,
  analysisResult,
  onSendFrame,
  onPermissionChange = null,
  presenceAlert,
  onClose = null,
}) {
  const { t } = useLanguage();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6 animate-fade-in">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" />

      <div className="relative z-10 w-full max-w-3xl">
        <div className="mb-3 flex items-center justify-between rounded-xl bg-white/95 border border-slate-200 px-4 py-3 shadow-lg">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t('camera.modalTitle')}</p>
            <p className="text-xs text-slate-500">{t('camera.modalSubtitle')}</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title={t('common.close')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" x2="6" y1="6" y2="18" />
                <line x1="6" x2="18" y1="6" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <CameraPanel
          isActive={isOpen}
          cameraCommand={cameraCommand}
          analysisResult={analysisResult}
          onSendFrame={onSendFrame}
          onPermissionChange={onPermissionChange}
          onClose={onClose}
          variant="modal"
          presenceAlert={presenceAlert}
        />
      </div>
    </div>
  );
}
