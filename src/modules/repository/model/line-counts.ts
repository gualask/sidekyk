import type { Translator } from '@/shared/i18n';
import { compactCount } from './history/summary';
import type { FileChange } from './repository.types';

/**
 * A file's line counts as they read: `binary` for a binary file, a dash when the lines were not
 * counted, else its lines added and removed (`+12`, `−3`; `+1.2k` when `compact`).
 */
export type CountsText =
    | { kind: 'binary' | 'notCounted'; text: string }
    | { kind: 'lines'; added: string; removed: string };

export function countsText(
    { additions, deletions, binary }: Pick<FileChange, 'additions' | 'deletions' | 'binary'>,
    { t }: Translator,
    compact = false,
): CountsText {
    if (binary) return { kind: 'binary', text: t('lines.binary') };
    if (additions === null && deletions === null) return { kind: 'notCounted', text: '—' };
    const shown = compact ? compactCount : String;
    return {
        kind: 'lines',
        added: `+${shown(additions ?? 0)}`,
        removed: `−${shown(deletions ?? 0)}`,
    };
}
