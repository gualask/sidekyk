/**
 * Whether a change on disk to `changed` (the working tree's paths, relative to the root with `/`;
 * `null` when any may have changed) may touch `path`: the same path, a folder holding it, or a path
 * inside it (a submodule's files). Letter case is ignored: on a disk that ignores it the watcher
 * may spell a name otherwise than git, and one read too many costs less than a stale file.
 */
export function changeTouches(changed: readonly string[] | null, path: string): boolean {
    if (changed === null) return true;
    const own = path.toLowerCase();
    return changed.some((entry) => {
        const other = entry.toLowerCase();
        return other === own || own.startsWith(`${other}/`) || other.startsWith(`${own}/`);
    });
}
