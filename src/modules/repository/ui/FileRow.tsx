import { splitPath } from '../model/file-groups';
import type { FileChange } from '../model/repository.types';
import { KindBadge } from './KindBadge';
import { LineCounts } from './LineCounts';

/** A file row's height, which the virtualized lists lay their rows out with. */
export const FILE_ROW_HEIGHT = 32;

/** One file in a list: its change, its name and folder, its line counts. */
export function FileRow({
    file,
    selected,
    onSelect,
}: {
    file: FileChange;
    selected: boolean;
    onSelect: () => void;
}) {
    const { name, dir } = splitPath(file.path);
    return (
        <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
            onClick={onSelect}
            className={`flex h-8 w-full items-center gap-2 px-4 text-left text-sm transition-colors ${
                selected ? 'bg-ui-accent-soft text-ui-accent-on-soft' : 'hover:bg-ui-surface-hover'
            }`}
        >
            <KindBadge kind={file.kind} />
            <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{name}</span>
                {dir ? <span className="ml-1.5 text-xs text-ui-text-muted">{dir}</span> : null}
            </span>
            <span className="shrink-0 text-[11px]">
                <LineCounts
                    additions={file.additions}
                    deletions={file.deletions}
                    binary={file.binary}
                />
            </span>
        </button>
    );
}
