import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { useSettingsPort } from '../application/settings.port';
import { useAppVersion } from '../application/settings.queries';

/** The app's version, and its log to show for a bug report. */
export function AboutSetting() {
    const port = useSettingsPort();
    const version = useAppVersion().data;
    const showToast = useShowToast();
    const i18n = useTranslation();
    const reveal = () => {
        port.revealLog().catch((error: unknown) =>
            showToast(errorToast(i18n.t('settings.log.revealFailed'), error, i18n)),
        );
    };
    return (
        <div className="flex items-center gap-4 py-2">
            <div className="min-w-0 flex-1">
                <div className="font-semibold">
                    {version ? i18n.t('settings.version', { version }) : 'Sidekyk'}
                </div>
                <div className="mt-0.5 text-xs text-ui-text-muted">
                    {i18n.t('settings.log.description')}
                </div>
            </div>
            <button type="button" className="btn-ghost-sm" onClick={reveal}>
                {i18n.t('settings.log.reveal')}
            </button>
        </div>
    );
}
