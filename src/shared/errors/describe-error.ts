/** An error as text: its name, message and stack, for a report or a copy. */
export function describeError(reason: unknown): string {
    if (reason instanceof Error) {
        // WebKit's `stack` lists the frames only, without the name and the message.
        const head = `${reason.name}: ${reason.message}`;
        return reason.stack ? `${head}\n${reason.stack}` : head;
    }
    return String(reason);
}
