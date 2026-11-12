import { useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useSessionState } from '@/shared/ui/session-state';
import { useRecentFiles } from '../../application/queries/file-reads';
import { recentRows } from '../../model/tree/recent-files';
import { timeFormats } from './recent-layout';

/**
 * Recent, a folder's files by their last change: read only while it shows (`shown`), grouped by
 * day as of the read, since no timer runs. Its row the keyboard is on is kept for the session,
 * apart from the tree's: a folder is never one.
 */
export function useRecentList(folderId: string, shown: boolean) {
    const { formatTag } = useTranslation();
    const [selected, select] = useSessionState<string | null>(`recent-selected:${folderId}`, null);
    const recent = useRecentFiles(folderId, shown);
    const listed = useMemo(() => {
        const now = Date.now();
        const { files: dated = [], more = 0 } = recent.data ?? {};
        return { rows: recentRows(dated, more, now), formats: timeFormats(formatTag, now) };
    }, [recent.data, formatTag]);
    return {
        listed,
        selected,
        select,
        error: recent.error,
        truncated: recent.data?.truncated ?? false,
        /** Read, and without a file. */
        empty: recent.data?.files.length === 0,
    };
}

export type RecentListState = ReturnType<typeof useRecentList>;
