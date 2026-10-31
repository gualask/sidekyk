/** Runs the hook under test and keeps what it returned: the same hook on every render. */
export function Probe<P, R>({
    hook,
    props,
    result,
}: {
    hook: (props: P) => R;
    props: P;
    result: { current: R };
}) {
    result.current = hook(props);
    return null;
}
