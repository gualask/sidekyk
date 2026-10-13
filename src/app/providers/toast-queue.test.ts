import { describe, expect, it } from 'vitest';
import { createToastQueue } from './toast-queue';

describe('createToastQueue', () => {
    it('keeps the toasts until the toaster drains them, then hands them on at once', () => {
        const queue = createToastQueue();
        const shown: string[] = [];
        queue.push({ title: 'first' });
        queue.push({ title: 'second' });

        const detach = queue.drain((toast) => shown.push(toast.title));
        queue.push({ title: 'third' });
        expect(shown).toEqual(['first', 'second', 'third']);

        detach();
        queue.push({ title: 'fourth' });
        expect(shown).toEqual(['first', 'second', 'third']);

        queue.drain((toast) => shown.push(toast.title));
        expect(shown).toEqual(['first', 'second', 'third', 'fourth']);
    });

    it('lets a stale detacher leave the current toaster attached', () => {
        const queue = createToastQueue();
        const shown: string[] = [];
        const detachOld = queue.drain(() => shown.push('old'));
        queue.drain((toast) => shown.push(toast.title));
        detachOld();

        queue.push({ title: 'new' });
        expect(shown).toEqual(['new']);
    });
});
