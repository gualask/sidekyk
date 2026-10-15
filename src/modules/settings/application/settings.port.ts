import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { GlobalShortcutStatus, Settings } from '../model/settings.types';

/** The settings' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface SettingsPort {
    getSettings(): Promise<Settings>;
    /**
     * Applies the settings at once (the window's theme, the global shortcut) and stores them. A
     * shortcut the system turns down fails with `shortcut_taken` or `shortcut_not_allowed`, and
     * leaves every setting as it was.
     */
    setSettings(settings: Settings): Promise<Settings>;
    getGlobalShortcutStatus(): Promise<GlobalShortcutStatus>;
    /**
     * While a new shortcut is typed, pressing the current one does nothing: it neither hides the
     * window nor reaches the field.
     */
    setShortcutRecording(recording: boolean): Promise<void>;
}

const SettingsPortContext = createContext<SettingsPort | null>(null);

export function SettingsProvider({
    value,
    children,
}: {
    value: SettingsPort;
    children: ReactNode;
}) {
    return createElement(SettingsPortContext.Provider, { value }, children);
}

export function useSettingsPort(): SettingsPort {
    const port = useContext(SettingsPortContext);
    if (!port) {
        throw new Error('useSettingsPort must be used within SettingsProvider');
    }
    return port;
}
