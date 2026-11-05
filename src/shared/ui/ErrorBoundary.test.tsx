// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Probe } from '../testing/probe';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The child's hook throws while `broken.now` says so; it renders nothing otherwise. */
const broken = { now: true };
const result = { current: undefined };
const breaking = () => {
    if (broken.now) throw new Error('boom');
};

/** Renders the boundary with a reset key; the retry the fallback got, and the box shown. */
function setUp() {
    const box = document.createElement('div');
    // React reports a caught error itself too: not in the test's output
    const root = createRoot(box, { onCaughtError: () => undefined });
    const caught: { retry: () => void } = { retry: () => undefined };
    const render = (resetKey: string) =>
        act(() =>
            root.render(
                <ErrorBoundary
                    resetKey={resetKey}
                    fallback={({ error, retry }) => {
                        caught.retry = retry;
                        return <p>{error instanceof Error ? error.message : 'unknown'}</p>;
                    }}
                >
                    <Probe hook={breaking} props={null} result={result} />
                </ErrorBoundary>,
            ),
        );
    return { box, caught, render };
}

describe('ErrorBoundary', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('shows the fallback in place of what threw, and reports the error', () => {
        const reportError = vi.fn();
        vi.stubGlobal('reportError', reportError);
        broken.now = true;
        const { box, render } = setUp();
        render('a');
        expect(box.textContent).toBe('boom');
        expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    });

    it('tries the children again on retry, or once its reset key changes', () => {
        vi.stubGlobal('reportError', vi.fn());
        broken.now = true;
        const { box, caught, render } = setUp();
        render('a');
        broken.now = false;
        act(() => caught.retry());
        expect(box.textContent).toBe('');

        broken.now = true;
        render('b');
        expect(box.textContent).toBe('boom');
        broken.now = false;
        render('c');
        expect(box.textContent).toBe('');
    });
});
