import { IconCircleCheck } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { PanelProps } from '@/shared/panels/panel';
import { useRepositorySnapshot } from '../application/repository.queries';
import { fileKey, orderedFiles } from '../model/file-groups';
import { DiffView } from './DiffView';
import { FileList } from './FileList';

const NEXT_KEYS = new Set(['ArrowDown', 'j']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'k']);

/** Whether a key belongs to what has the focus: a field, or a dialog over the panel. */
function isTaken(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
            target.closest('[role="dialog"]') !== null)
    );
}

/** The Changes panel: what changed in the project's working tree, file by file. */
export function ChangesWorkspace({ project, header }: PanelProps) {
    const snapshot = useRepositorySnapshot(project.root);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const files = useMemo(() => orderedFiles(snapshot.data?.files ?? []), [snapshot.data]);
    // a file that left the list (committed, reverted) hands the selection to the first one
    const selected = files.find((file) => fileKey(file) === selectedKey) ?? files[0] ?? null;
    const selectedIndex = selected ? files.indexOf(selected) : -1;

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.metaKey || event.ctrlKey || event.altKey || isTaken(event.target)) return;
            const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
            const next = files[selectedIndex + step];
            if (step === 0 || !next) return;
            event.preventDefault();
            setSelectedKey(fileKey(next));
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [files, selectedIndex]);

    return (
        <div className="flex h-full flex-col">
            {snapshot.isError ? (
                <div className="border-b border-ui-border bg-ui-danger-soft px-4 py-2 text-sm text-ui-danger-soft-text">
                    {errorMessage(snapshot.error)}
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1">
                <aside className="w-72 shrink-0 border-r border-ui-border bg-ui-surface">
                    <FileList
                        files={snapshot.data?.files ?? []}
                        selectedKey={selected ? fileKey(selected) : null}
                        onSelect={(file) => setSelectedKey(fileKey(file))}
                    />
                </aside>
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">
                    {selected ? (
                        <DiffView
                            key={fileKey(selected)}
                            root={project.root}
                            file={selected}
                            header={header}
                        />
                    ) : snapshot.isSuccess ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-text-muted">
                            <IconCircleCheck size={32} stroke={1.5} />
                            <p className="text-sm">Nothing to review. The working tree is clean.</p>
                        </div>
                    ) : null}
                </main>
            </div>
        </div>
    );
}
