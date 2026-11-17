import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { useAvailableUpdate, useInstallUpdate, useUpdateProgress } from '../application/updates';
import { Setting } from './Setting';

/** Whether a newer version is out: installed from here, or checked for again. */
export function UpdateSetting() {
    const i18n = useTranslation();
    const showToast = useShowToast();
    const update = useAvailableUpdate();
    const { mutate: install } = useInstallUpdate();
    const { installing, percent } = useUpdateProgress();
    const version = update.data;

    const check = () => {
        void update.refetch().then((result) => {
            if (result.error) {
                showToast(errorToast(i18n.t('settings.update.checkFailed'), result.error, i18n));
            }
        });
    };

    const description = installing
        ? i18n.t('settings.update.restarts', { version: version ?? '' })
        : update.isFetching
          ? i18n.t('settings.update.checking')
          : version
            ? i18n.t('settings.update.available', { version })
            : version === null
              ? i18n.t('settings.update.upToDate')
              : i18n.t('settings.update.description');

    return (
        <Setting label={i18n.t('settings.update.label')} description={description}>
            {() =>
                installing ? (
                    <button type="button" className="btn-ghost-sm" disabled>
                        {percent === null
                            ? i18n.t('settings.update.installing')
                            : i18n.t('settings.update.downloading', { percent })}
                    </button>
                ) : version ? (
                    <button type="button" className="btn-ghost-sm" onClick={() => install()}>
                        {i18n.t('settings.update.install')}
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn-ghost-sm"
                        disabled={update.isFetching}
                        onClick={check}
                    >
                        {i18n.t('settings.update.check')}
                    </button>
                )
            }
        </Setting>
    );
}
