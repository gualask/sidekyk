import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Settings } from '../model/settings.types';
import { useSettingsPort } from './settings.port';

const settingsKey = ['settings'] as const;
const shortcutStatusKey = ['settings', 'global-shortcut'] as const;

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
 * Where the global shortcut stands: read at startup, for the top bar's problems, and again after
 * each change of the settings. The backend answers from memory.
 */
export function useGlobalShortcutStatus() {
    const port = useSettingsPort();
    return useQuery({
        queryKey: shortcutStatusKey,
        queryFn: () => port.getGlobalShortcutStatus(),
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
            await queryClient.cancelQueries({ queryKey: settingsKey, exact: true });
            queryClient.setQueryData(settingsKey, settings);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: shortcutStatusKey });
        },
        onError: () => {
            void queryClient.invalidateQueries({ queryKey: settingsKey, exact: true });
        },
    });
}

/** Tells the backend a new shortcut is being typed, or no longer is. */
export function useShortcutRecording() {
    const port = useSettingsPort();
    return useCallback(
        (recording: boolean) => {
            void port.setShortcutRecording(recording).catch(() => undefined);
        },
        [port],
    );
}
