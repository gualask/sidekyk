import { Tooltip } from '@base-ui/react/tooltip';
import { useTranslation } from '@/shared/i18n';
import { commitDate, shortSha } from '../../../model/history/commits';
import type { Commit } from '../../../model/repository.types';
import { RefLabels } from './RefLabel';

/** A tooltip shared by every row, opened with the row's commit (Base UI's detached triggers). */
export type CommitTooltip = ReturnType<typeof Tooltip.createHandle<Commit>>;

/** How long the pointer rests on a row before its tooltip shows; the next row's shows at once. */
export const TOOLTIP_DELAY_MS = 500;

/**
 * The rows' tooltip, one for the list: beside it, over the diff, when the list holds the commits;
 * above them when they are under the whole panel.
 */
export function CommitTooltipPopup({
    tooltip,
    footer,
}: {
    tooltip: CommitTooltip;
    footer: boolean;
}) {
    return (
        <Tooltip.Root handle={tooltip}>
            {({ payload }) =>
                payload ? (
                    <Tooltip.Portal>
                        <Tooltip.Positioner
                            side={footer ? 'top' : 'right'}
                            align="start"
                            sideOffset={8}
                            className="z-30"
                        >
                            <Tooltip.Popup className="menu-popup max-w-[340px] px-3 py-2.5 text-xs">
                                <CommitTip commit={payload} />
                            </Tooltip.Popup>
                        </Tooltip.Positioner>
                    </Tooltip.Portal>
                ) : null
            }
        </Tooltip.Root>
    );
}

/**
 * What a row's tooltip says, to read it whole: the subject on as many lines as it takes, its hash,
 * author and date (in the order of the card a click shows), the refs pointing at it. The details
 * are a click away, in the list.
 */
function CommitTip({ commit }: { commit: Commit }) {
    const i18n = useTranslation();
    return (
        <>
            <p className="text-[13px] break-words text-ui-text">{commit.subject}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 text-ui-text-muted">
                <span className="font-mono text-[11px]">{shortSha(commit.sha)}</span>
                <span>{commit.author}</span>
                <span>{commitDate(commit, i18n)}</span>
            </p>
            {commit.refs.length > 0 ? (
                <p className="mt-2 flex flex-wrap gap-1">
                    <RefLabels refs={commit.refs} viewed={false} />
                </p>
            ) : null}
        </>
    );
}
