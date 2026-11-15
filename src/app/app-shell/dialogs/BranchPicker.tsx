import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconCloud, IconGitBranch } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { type Branch, useBranches, useSwitchBranch } from '@/modules/repository';
import { useNameRanking } from '@/modules/search';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { folderName } from '@/shared/projects/project-place';
import { PickerDialog, PickerField, PickerKeys } from '@/shared/ui/PickerDialog';
import { errorToast, useShowToast } from '@/shared/ui/toasts';

/** A row's height: the virtualized list places every row without measuring it. */
const ROW_HEIGHT = 36;

const NO_BRANCHES: readonly Branch[] = [];

/**
 * The branch to switch a folder to, as VS Code's "Checkout to...": the local branches, the last
 * committed to first, then the remote ones no local branch tracks, which make the local branch
 * that tracks them. All of them, as VS Code and Zed list them, only those on screen rendered (as
 * the palette); typing narrows them, ranked as the palette ranks names. `↵` switches; git refuses
 * a switch that would overwrite changes, and the toast says why. Loaded when first asked.
 */
export function BranchPicker({ folder, onClose }: { folder: ProjectFolder; onClose: () => void }) {
    const i18n = useTranslation();
    const { t } = i18n;
    const input = useRef<HTMLInputElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState('');
    const branches = useBranches(folder.id);
    const all = branches.data ?? NO_BRANCHES;
    const names = useMemo(() => all.map((branch) => branch.name), [all]);
    const { order, pending } = useNameRanking(query, names);
    const shown = useMemo(
        () => (order ? order.flatMap((index) => all[index] ?? []) : all),
        [order, all],
    );
    const virtualizer = useVirtualizer({
        count: shown.length,
        getScrollElement: () => scroller.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
        paddingEnd: 6,
    });
    const switching = useSwitchBranch(folder.id);
    const showToast = useShowToast();
    const pick = (branch: Branch) => {
        if (branch.current) {
            onClose();
            return;
        }
        if (switching.isPending) return;
        switching.mutate(
            { name: branch.name, remote: branch.remote },
            {
                onSuccess: onClose,
                onError: (error) => {
                    onClose();
                    showToast(
                        errorToast(t('branch.switchFailed', { name: branch.name }), error, i18n),
                    );
                },
            },
        );
    };
    return (
        <PickerDialog
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title={t('branch.switch')}
            description={folderName(folder)}
            initialFocus={input}
            width="w-[min(520px,calc(100vw-32px))]"
        >
            <Autocomplete.Root
                open
                inline
                virtualized
                items={shown}
                filter={null}
                value={query}
                onValueChange={setQuery}
                itemToStringValue={(branch: Branch) => branch.name}
                autoHighlight="always"
                keepHighlight
                onItemHighlighted={(branch, { reason, index }) => {
                    if (branch && reason !== 'pointer') {
                        virtualizer.scrollToIndex(index, { align: 'auto' });
                    }
                }}
            >
                <PickerField
                    pending={pending || switching.isPending}
                    ref={input}
                    aria-label={t('branch.filter')}
                    placeholder={t('branch.filter')}
                />
                {branches.isError ? (
                    <div className="px-4 py-6 text-center text-[13px] text-ui-danger">
                        {errorMessage(branches.error, i18n)}
                    </div>
                ) : branches.isSuccess && shown.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-ui-text-muted">
                        {t('common.nothingFound')}
                    </div>
                ) : null}
                <Autocomplete.List
                    ref={scroller}
                    className="max-h-[50vh] min-h-0 overflow-auto overscroll-contain empty:hidden"
                >
                    {shown.length > 0 ? (
                        <div
                            role="presentation"
                            className="relative w-full"
                            style={{ height: virtualizer.getTotalSize() }}
                        >
                            {virtualizer.getVirtualItems().map(({ index, key, start }) => {
                                const branch = shown[index];
                                return branch ? (
                                    <BranchRow
                                        key={key}
                                        branch={branch}
                                        index={index}
                                        count={shown.length}
                                        start={start}
                                        onPick={pick}
                                    />
                                ) : null;
                            })}
                        </div>
                    ) : null}
                </Autocomplete.List>
                <PickerKeys enter={t('branch.enterSwitches')}>
                    {switching.isPending ? <span>{t('branch.switching')}</span> : null}
                </PickerKeys>
            </Autocomplete.Root>
        </PickerDialog>
    );
}

/** A branch, at its place in the virtualized list: its kind's icon, its name, what it is. */
function BranchRow({
    branch,
    index,
    count,
    start,
    onPick,
}: {
    branch: Branch;
    index: number;
    count: number;
    start: number;
    onPick: (branch: Branch) => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            role="presentation"
            className="absolute top-0 left-0 w-full px-1.5"
            style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
        >
            <Autocomplete.Item
                value={branch}
                index={index}
                aria-setsize={count}
                aria-posinset={index + 1}
                onClick={() => onPick(branch)}
                className="pick-row group flex h-full items-center gap-2 px-2.5"
            >
                {branch.remote ? (
                    <IconCloud size={14} className="shrink-0 text-ui-text-muted" />
                ) : (
                    <IconGitBranch size={14} className="shrink-0 text-ui-text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{branch.name}</span>
                {branch.current || branch.remote ? (
                    <span className="shrink-0 text-xs text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft">
                        {t(branch.current ? 'branch.current' : 'branch.remote')}
                    </span>
                ) : null}
            </Autocomplete.Item>
        </div>
    );
}
