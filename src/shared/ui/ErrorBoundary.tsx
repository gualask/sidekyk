import { Component, type ReactNode } from 'react';

interface Props {
    /** What shows instead of the children once they threw: the error, and a way to try again. */
    fallback: (caught: { error: unknown; retry: () => void }) => ReactNode;
    /** Changed, the children are tried again by themselves: another project or folder shows. */
    resetKey?: string;
    children: ReactNode;
}

interface State {
    caught: { error: unknown } | null;
    resetKey: string | undefined;
}

/**
 * Catches what its children throw while rendering, so that the rest of the window goes on:
 * `fallback` shows instead (`docs/features/workspace.md`). The error is reported as an
 * uncaught one is, through the window's `error` event, which the app sends to its log.
 */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { caught: null, resetKey: this.props.resetKey };

    static getDerivedStateFromError(error: unknown): Partial<State> {
        return { caught: { error } };
    }

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        return props.resetKey === state.resetKey
            ? null
            : { caught: null, resetKey: props.resetKey };
    }

    componentDidCatch(error: unknown) {
        // WebKit since 2022 (Safari 15.4), Chromium since 95; an older WebKitGTK gets the same event
        // from an error thrown out of a task
        if (typeof window.reportError === 'function') window.reportError(error);
        else
            setTimeout(() => {
                throw error;
            });
    }

    render() {
        const { caught } = this.state;
        if (!caught) return this.props.children;
        return this.props.fallback({
            error: caught.error,
            retry: () => this.setState({ caught: null }),
        });
    }
}
