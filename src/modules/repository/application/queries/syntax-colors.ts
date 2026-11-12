import { useQueries } from '@tanstack/react-query';
import type { DiffLine } from '../../model/diff/diff-parser';
import type { DiffSides } from '../../model/diff/sides';
import type { SyntaxColors } from '../../model/repository.types';
import {
    blockKey,
    COLOR_BLOCK,
    type ColorBlock,
    type LineSpans,
    lineColors,
} from '../../model/text/syntax';
import { useRepositoryPort } from '../repository.port';
import { commitKeys, repositoryKeys } from './repository-keys';

/** The viewer's colors: a line's, or none; and whether a version was too large to color. */
export interface ShownColors {
    colorsOf: (line: DiffLine) => LineSpans | undefined;
    tooLarge: boolean;
}

const NO_COLORS: ShownColors = { colorsOf: () => undefined, tooLarge: false };

/**
 * The colors of the blocks of lines on screen, each block read once per version of its file:
 * the working tree's again when a change on disk comes, the index's and HEAD's when git's own
 * files changed, a commit's never. A line takes its colors only while its text is the one colored,
 * so colors read before a change never land on other text while the next read comes.
 */
export function useSyntaxColors(
    folderId: string,
    sides: DiffSides,
    blocks: readonly ColorBlock[],
): ShownColors {
    const port = useRepositoryPort();
    const shown = blocks.flatMap((block) => {
        const source = sides[block.side];
        return source ? [{ ...block, source }] : [];
    });
    return useQueries({
        queries: shown.map(({ source, first }) => ({
            queryKey:
                source.version.kind === 'commit'
                    ? commitKeys.colors(folderId, source.version.sha, source.path, first)
                    : repositoryKeys.colors(folderId, source, first),
            queryFn: () =>
                port.getSyntaxColors(folderId, {
                    path: source.path,
                    version: source.version,
                    first,
                    count: COLOR_BLOCK,
                }),
            staleTime: source.version.kind === 'commit' ? Number.POSITIVE_INFINITY : 0,
        })),
        combine: (results) => {
            const read = new Map<string, SyntaxColors>();
            results.forEach((result, index) => {
                const block = shown[index];
                if (block && result.data) read.set(blockKey(block), result.data);
            });
            if (read.size === 0) return NO_COLORS;
            return {
                colorsOf: (line: DiffLine) => lineColors(read, line),
                tooLarge: [...read.values()].some((colors) => colors.tooLarge),
            };
        },
    });
}
