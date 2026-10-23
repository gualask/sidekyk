/**
 * A project's folder, cut at its start when too long: its end tells two projects apart. The
 * isolate keeps the path's own order inside the right-to-left box that cuts it on the left. In a
 * row of a list (a `group`), it follows the row's highlight.
 */
export function FolderPath({ path }: { path: string }) {
    return (
        <span
            dir="rtl"
            title={path}
            className="truncate text-left text-[11.5px] text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft"
        >
            <bdi dir="ltr">{path}</bdi>
        </span>
    );
}
