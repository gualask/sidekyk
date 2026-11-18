// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import { ToastsProvider } from '@/shared/ui/toasts';
import { type SettingsPort, SettingsProvider } from './settings.port';
import { useAvailableUpdate, useInstallUpdate } from './updates';

describe('an update whose install fails', () => {
    it('is checked for again at once, so the next install takes the newer release', async () => {
        // a broken 0.2.0, replaced by 0.2.1 while the app shows the first
        const checkUpdate = vi
            .fn<SettingsPort['checkUpdate']>()
            .mockResolvedValueOnce('0.2.0')
            .mockResolvedValue('0.2.1');
        const installUpdate = vi
            .fn<SettingsPort['installUpdate']>()
            .mockRejectedValue(new Error('signature mismatch'));
        const showToast = vi.fn();
        const port = { checkUpdate, installUpdate } as Partial<SettingsPort> as SettingsPort;
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <SettingsProvider value={port}>
                    <ToastsProvider value={showToast}>{children}</ToastsProvider>
                </SettingsProvider>
            </QueryClientProvider>
        );

        const { result } = renderHook(
            () => ({ version: useAvailableUpdate().data, install: useInstallUpdate() }),
            { wrapper },
        );
        await vi.waitFor(() => expect(result.current.version).toBe('0.2.0'));

        act(() => result.current.install.mutate());

        await vi.waitFor(() => expect(result.current.version).toBe('0.2.1'));
        expect(checkUpdate).toHaveBeenCalledTimes(2);
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    });
});
