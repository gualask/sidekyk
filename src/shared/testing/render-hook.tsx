import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Probe } from './probe';

// React then expects the updates of a test inside `act`, and warns of those outside it
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Renders a hook in a component of its own, for a test in a DOM (`// @vitest-environment
 * happy-dom` at the top of its file): what it returned last, and a render with other props. Each
 * render runs inside React's `act`, effects included; `vi.waitFor` waits for what comes later,
 * such as a query's answer. `wrapper` gives the providers the hook reads.
 */
export function renderHook<P, R>(
    hook: (props: P) => R,
    {
        props,
        wrapper: Wrapper = ({ children }) => children,
    }: { props?: NoInfer<P>; wrapper?: (props: { children: ReactNode }) => ReactNode } = {},
) {
    const result = { current: undefined as R };
    const root = createRoot(document.createElement('div'));
    const rerender = (next: NoInfer<P>) =>
        act(() =>
            root.render(
                <Wrapper>
                    <Probe hook={hook} props={next} result={result} />
                </Wrapper>,
            ),
        );
    rerender(props as P);
    return { result, rerender };
}
