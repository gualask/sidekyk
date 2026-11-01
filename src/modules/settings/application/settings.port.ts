import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { GlobalShortcutStatuses, Settings } from '../model/settings.types';

/** The settings' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface SettingsPort {
    getSettings(): Promise<Settings>;
    /**
     * Applies the settings at once (the window's theme, the global shortcuts) and stores them. A
     * shortcut the system turns down fails with `shortcut_taken`, one with the other's keys with
     * `shortcut_in_use`; either leaves every setting as it was.
     */
    setSettings(settings: Settings): Promise<Settings>;
    getGlobalShortcutStatus(): Promise<GlobalShortcutStatuses>;
    /**
     * While a new shortcut is typed, pressing a current one does nothing: it neither acts nor
     * reaches the field.
     */
    setShortcutRecording(recording: boolean): Promise<void>;
    /** The app's version, as its bundle has it. */
    getVersion(): Promise<string>;
    /** This session's log selected in the system's file manager, the previous one beside it. */
    revealLog(): Promise<void>;
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
