import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { whenIdle } from '@/shared/ui/when-idle';
import { useSettingsPort } from './settings.port';

const updateKey = ['settings', 'update'] as const;
const installKey = ['settings', 'update', 'install'] as const;

/** A check older than this is made again when the window shows: no timer, while hidden or not. */
const CHECK_AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A version newer than this one, or null; `undefined` until checked. Checked once `enabled`, then
 * again when the window shows a day after the last check (the page's `visibilitychange`), or
 * when asked (`refetch`).
 */
export function useAvailableUpdate(enabled = true) {
    const port = useSettingsPort();
    return useQuery({
        queryKey: updateKey,
        queryFn: () => port.checkUpdate(),
        staleTime: CHECK_AGAIN_AFTER_MS,
        refetchOnWindowFocus: true,
        enabled,
    });
}

/**
 * Installs the version found and restarts the app. A failure is a toast and checks again at once:
 * the next install takes what the release server offers now, such as a release that replaced a
 * broken one, not the update that failed.
 */
export function useInstallUpdate() {
    const port = useSettingsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useMutation({
        mutationKey: installKey,
        mutationFn: () => port.installUpdate(),
        onError: (error) => {
            showToast(errorToast(i18n.t('settings.update.installFailed'), error, i18n));
            void queryClient.invalidateQueries({ queryKey: updateKey, exact: true });
        },
    });
}

/**
 * Whether an update installs, from a toast or the settings, and the percent downloaded so far;
 * null until the first, or when the size is unknown.
 */
export function useUpdateProgress(): { installing: boolean; percent: number | null } {
    const port = useSettingsPort();
    const installing = useIsMutating({ mutationKey: installKey }) > 0;
    const [percent, setPercent] = useState<number | null>(null);
    useEffect(() => {
        if (!installing) return;
        setPercent(null);
        return port.onUpdateProgress(setPercent);
    }, [installing, port]);
    return { installing, percent: installing ? percent : null };
}

/**
 * Checks for a newer version once the window is idle after startup, then as `useAvailableUpdate`
 * does, and tells each version found once, in a toast that offers to install it.
 */
export function useUpdateNotice() {
    const [idle, setIdle] = useState(false);
    useEffect(() => whenIdle(() => setIdle(true)), []);
    const version = useAvailableUpdate(idle).data;
    const { mutate: install } = useInstallUpdate();
    const showToast = useShowToast();
    const i18n = useTranslation();
    const told = useRef<string | null>(null);
    useEffect(() => {
        if (!version || told.current === version) return;
        told.current = version;
        showToast({
            title: i18n.t('settings.update.available', { version }),
            action: { label: i18n.t('settings.update.install'), run: () => install() },
        });
    }, [version, install, showToast, i18n]);
}
