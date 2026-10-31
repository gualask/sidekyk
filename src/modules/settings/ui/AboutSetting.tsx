import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { useSettingsPort } from '../application/settings.port';
import { useAppVersion } from '../application/settings.queries';
import { Setting } from './Setting';

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
        <Setting
            label={i18n.t('settings.version', { version })}
            description={i18n.t('settings.log.description')}
        >
            {() => (
                <button type="button" className="btn-ghost-sm" onClick={reveal}>
                    {i18n.t('settings.log.reveal')}
                </button>
            )}
        </Setting>
    );
}
