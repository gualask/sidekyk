// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { FileView } from '@/shared/git/file-view';
import { renderHook } from '@/shared/testing/render-hook';
import { type RepositorySettings, RepositorySettingsProvider } from './repository-settings';
import { useFileViewChoice } from './view-choice';

function settings(fileView: FileView): RepositorySettings {
    return {
        diffView: 'changes',
        fileView,
        copyTemplate: '',
        scrollbar: 'narrow',
        codeLines: 'scroll',
    };
}

describe('how a file with a preview shows', () => {
    it('follows the setting, until the switch chooses, until the setting changes', () => {
        let value = settings('preview');
        const wrapper = ({ children }: { children: ReactNode }) => (
            <RepositorySettingsProvider value={value}>{children}</RepositorySettingsProvider>
        );
        const { result, rerender } = renderHook(() => useFileViewChoice(), { wrapper });
        expect(result.current.view).toBe('preview');

        act(() => result.current.choose('code'));
        expect(result.current.view).toBe('code');
        rerender(undefined);
        expect(result.current.view).toBe('code');

        // a choice holds over the setting it was made with
        value = settings('code');
        rerender(undefined);
        act(() => result.current.choose('preview'));
        expect(result.current.view).toBe('preview');
        value = settings('preview');
        rerender(undefined);
        expect(result.current.view).toBe('preview');
    });
});
