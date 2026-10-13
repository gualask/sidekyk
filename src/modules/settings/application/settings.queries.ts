import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { Settings } from '../model/settings.types';
import { useSettingsPort } from './settings.port';

const settingsKey = ['settings'] as const;

/** The settings; the component waits for them (`Suspense`), read once per session. */
export function useSettings() {
    const port = useSettingsPort();
    return useSuspenseQuery({
        queryKey: settingsKey,
        queryFn: () => port.getSettings(),
        staleTime: Number.POSITIVE_INFINITY,
    });
}

/**
 * Changes a setting at once on screen; the backend applies and stores it. Changes run one at a
 * time, in the user's order, so the last one clicked is the one that stays. A failure puts the
 * settings back as the backend has them.
 */
export function useUpdateSettings() {
    const port = useSettingsPort();
    const queryClient = useQueryClient();
    return useMutation({
        mutationKey: settingsKey,
        scope: { id: 'settings' },
        mutationFn: (settings: Settings) => port.setSettings(settings),
        onMutate: async (settings) => {
            await queryClient.cancelQueries({ queryKey: settingsKey });
            queryClient.setQueryData(settingsKey, settings);
        },
        onError: () => {
            void queryClient.invalidateQueries({ queryKey: settingsKey });
        },
    });
}
