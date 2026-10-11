import { useEffect, useRef } from 'react';
import { fileKey, groupFiles, KIND_BADGE, splitPath } from '../model/file-groups';
import type { ChangedFile, ChangeKind } from '../model/repository.types';
import { LineCounts } from './LineCounts';

const BADGE_TONE: Record<ChangeKind, string> = {
    added: 'bg-ui-success-soft text-ui-success-soft-text',
    untracked: 'bg-ui-success-soft text-ui-success-soft-text',
    deleted: 'bg-ui-danger-soft text-ui-danger-soft-text',
    conflicted: 'bg-ui-warning-soft text-ui-warning-soft-text',
    modified: 'bg-ui-accent-soft text-ui-accent-on-soft',
    renamed: 'bg-ui-accent-soft text-ui-accent-on-soft',
    copied: 'bg-ui-accent-soft text-ui-accent-on-soft',
    'type-changed': 'bg-ui-accent-soft text-ui-accent-on-soft',
};

export function FileList({
    files,
    selectedKey,
    onSelect,
}: {
    files: readonly ChangedFile[];
    selectedKey: string | null;
    onSelect: (file: ChangedFile) => void;
}) {
    const selectedRef = useRef<HTMLButtonElement>(null);

    // keyboard navigation can move the selection out of view
    useEffect(() => {
        if (selectedKey) selectedRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selectedKey]);

    return (
        <nav aria-label="Changed files" className="py-2">
            {groupFiles(files).map((group) => (
                <section key={group.area} className="mb-2">
                    <h2 className="flex items-center justify-between px-4 py-1.5 text-[11px] font-semibold tracking-wide text-ui-text-muted uppercase">
                        {group.label}
                        <span className="font-mono tabular-nums">{group.files.length}</span>
                    </h2>
                    <ul>
                        {group.files.map((file) => {
                            const key = fileKey(file);
                            const selected = key === selectedKey;
                            const { name, dir } = splitPath(file.path);
                            return (
                                <li key={key}>
                                    <button
                                        ref={selected ? selectedRef : undefined}
                                        type="button"
                                        aria-current={selected ? 'true' : undefined}
                                        title={
                                            file.origPath
                                                ? `${file.origPath} → ${file.path}`
                                                : file.path
                                        }
                                        onClick={() => onSelect(file)}
                                        className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors ${
                                            selected
                                                ? 'bg-ui-accent-soft text-ui-accent-on-soft'
                                                : 'hover:bg-ui-surface-hover'
                                        }`}
                                    >
                                        <span
                                            className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${BADGE_TONE[file.kind]}`}
                                        >
                                            {KIND_BADGE[file.kind]}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">
                                            <span className="font-medium">{name}</span>
                                            {dir ? (
                                                <span className="ml-1.5 text-xs text-ui-text-muted">
                                                    {dir}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="shrink-0 text-[11px]">
                                            <LineCounts
                                                additions={file.additions}
                                                deletions={file.deletions}
                                                binary={file.binary}
                                            />
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </nav>
    );
}
