import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { Settings } from '../model/settings.types';

/** The settings' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface SettingsPort {
    getSettings(): Promise<Settings>;
    /** Applies the settings at once (the window's theme) and stores them. */
    setSettings(settings: Settings): Promise<Settings>;
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
