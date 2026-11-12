import { errorMessage } from '@/shared/errors/app-error';
import type { Translator } from '@/shared/i18n';
import { type ContentResults, MIN_CONTENT_QUERY } from '../application/content-search';
import type { PaletteMode } from './PaletteField';

/** What the empty field asks for: names or a text, and where it looks, or why it cannot. */
export function fieldPlaceholder(
    mode: PaletteMode,
    projectId: string | null,
    hasFiles: boolean,
    stoppedDistro: string | null,
    projectName: string | null,
    { t }: Translator,
): string {
    if (mode === 'names') {
        if (!projectId) return t('palette.placeholder.namesNoProject');
        return t(hasFiles ? 'palette.placeholder.names' : 'palette.placeholder.namesNotes');
    }
    if (!projectId) return t('palette.placeholder.contentsNoProject');
    if (stoppedDistro) {
        return t('palette.placeholder.contentsStopped', { distro: stoppedDistro });
    }
    if (!hasFiles) return t('palette.placeholder.contentsNoFolder');
    return projectName
        ? t('palette.placeholder.contents', { name: projectName })
        : t('palette.placeholder.contentsUnnamed');
}

/** What the list says instead of lines found: why there are none yet, or none at all. */
export function contentsNotice(
    folderId: string | null,
    query: string,
    found: ContentResults | null,
    i18n: Translator,
): string | null {
    if (!folderId || !query.trim()) return null;
    if (query.trim().length < MIN_CONTENT_QUERY) {
        return i18n.t('palette.typeMore', { count: MIN_CONTENT_QUERY });
    }
    if (!found || found.files.length > 0) return null;
    if (found.status === 'failed') return errorMessage(found.error, i18n);
    return found.status === 'done' && found.query === query ? i18n.t('common.nothingFound') : null;
}

/** How far the search went: still reading, or what it found. */
export function contentsStatus(
    found: ContentResults | null,
    query: string,
    { t, tp, formatTag }: Translator,
): string {
    if (!found || found.status === 'searching' || found.query !== query) {
        return t('palette.searching');
    }
    if (found.status === 'failed') return '';
    const lines = found.files.reduce((sum, file) => sum + file.lines.length, 0);
    const files = found.files.length;
    const count = lines.toLocaleString(formatTag);
    const linesFound = found.more
        ? t('palette.linesMore', { count })
        : tp('palette.lines', lines, { count });
    return tp('palette.inFiles', files, { lines: linesFound });
}
