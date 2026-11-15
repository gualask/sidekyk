/**
 * A file of a project by its path from the root, `/` between its parts (as git and the backend
 * write it): its name, and the folder it is in (`''` at the root).
 */
export function splitPath(path: string): { name: string; dir: string } {
    const slash = path.lastIndexOf('/');
    return slash < 0
        ? { name: path, dir: '' }
        : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}
