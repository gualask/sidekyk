import { type UseQueryResult, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { MAX_IMAGE_BYTES } from '../../model/preview/preview';
import type {
    Diagram,
    DiagramColors,
    Directory,
    FileDiffRequest,
    ImageSource,
} from '../../model/repository.types';
import { foldersToRead } from '../../model/tree/file-tree';
import { type RepositoryPort, useRepositoryPort } from '../repository.port';
import { repositoryKeys } from './repository-keys';

export function useFileDiff(folderId: string, request: FileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request
            ? repositoryKeys.diff(folderId, request)
            : [...repositoryKeys.of(folderId), 'none'],
        queryFn: () => (request ? port.getFileDiff(folderId, request) : null),
        enabled: request !== null,
    });
}

/** The data of each directory query, kept the same while none changed. */
function directoriesRead(results: readonly UseQueryResult<Directory>[]) {
    return {
        data: results.map((result) => result.data),
        error: results.find((result) => result.isError)?.error ?? null,
    };
}

/**
 * What the open folders of the tree hold, those that show: the root, and each open folder inside
 * an open folder, once that one is read. Each folder is read on its own, so opening one reads only
 * it. The backend keeps the list of files: a change on disk asks again, and only a file added or
 * removed makes it read the list again.
 */
export function useTreeDirectories(folderId: string, open: ReadonlySet<string>) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    // the folders read so far say which open folders show: one read brings the next
    const paths = foldersToRead(open, (path) =>
        queryClient.getQueryData<Directory>(repositoryKeys.directory(folderId, path)),
    );
    const { data, error } = useQueries({
        queries: paths.map((path) => ({
            queryKey: repositoryKeys.directory(folderId, path),
            queryFn: () => port.getDirectory(folderId, path),
        })),
        combine: directoriesRead,
    });
    const key = paths.join('\0');
    const read = useMemo(() => {
        const byPath = new Map(key.split('\0').map((path, index) => [path, data[index]]));
        return (path: string) => byPath.get(path);
    }, [key, data]);
    return { read, error };
}

/**
 * The tree's files by their last change, newest first, while `enabled` (Recent shows): any change
 * on disk reads them again, and so does the window shown after one.
 */
export function useRecentFiles(folderId: string, enabled: boolean) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.recent(folderId),
        queryFn: () => port.getRecentFiles(folderId),
        enabled,
    });
}

/** A file of the tree that did not change, as the Files panel shows it. */
export function useFileContent(folderId: string, path: string | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: path
            ? repositoryKeys.file(folderId, path)
            : [...repositoryKeys.of(folderId), 'none'],
        queryFn: () => (path ? port.getFileContent(folderId, path) : null),
        enabled: path !== null,
    });
}

/**
 * An image's URL and size: of the tree's file at `path`, from its stamp, read again, and so loaded
 * again, once the file changed; or of the git object `blob` (a side of the image's diff), which
 * never changes.
 */
export function useImageSource(folderId: string, path: string, blob: string | null = null) {
    const port = useRepositoryPort();
    const { data, isPending, isError, error } = useQuery({
        queryKey:
            blob === null
                ? repositoryKeys.stamp(folderId, path)
                : repositoryKeys.blob(folderId, blob),
        queryFn: async (): Promise<{ size: number; source: ImageSource }> => {
            if (blob !== null) {
                const size = await port.getBlobSize(folderId, blob);
                return { size, source: { kind: 'blob', blob } };
            }
            const stamp = await port.getFileStamp(folderId, path);
            return { size: stamp.size, source: { kind: 'file', stamp } };
        },
        staleTime: blob === null ? 0 : Number.POSITIVE_INFINITY,
    });
    return {
        size: data?.size,
        isPending,
        isError,
        error,
        tooLarge: data !== undefined && data.size > MAX_IMAGE_BYTES,
        url: data ? port.projectFileUrl(folderId, path, data.source) : null,
    };
}

/** A Markdown file of the tree as its preview shows it. */
export function useMarkdownPreview(folderId: string, path: string) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.preview(folderId, path),
        queryFn: () => port.getMarkdownPreview(folderId, path),
    });
}

/**
 * What a Mermaid diagram's source shows, drawn in `colors`: the diagram, else the last one drawn
 * while the source does not read (an agent halfway through writing it), with why it does not.
 * Outside the repositories' keys: the same source and colors draw the same diagram, so it is never
 * drawn again, and a change on disk changes the source instead.
 */
export function useShownDiagram(source: string, colors: DiagramColors) {
    const port = useRepositoryPort();
    const query = useQuery({
        queryKey: ['diagram', colors, source],
        queryFn: () => port.renderDiagram({ source, colors }),
        staleTime: Number.POSITIVE_INFINITY,
    });
    const drawn = query.data?.kind === 'drawn' ? query.data : null;
    const [kept, setKept] = useState<DrawnDiagram | null>(null);
    if (drawn !== null && drawn !== kept) setKept(drawn);
    return {
        drawn: drawn ?? kept,
        invalid: query.data?.kind === 'invalid' ? query.data : null,
        error: query.isError ? query.error : null,
    };
}

type DrawnDiagram = Extract<Diagram, { kind: 'drawn' }>;

/** Which folders of a project hold a file, `first` alone when it does (`foldersHolding`). */
export function useFoldersHolding(): RepositoryPort['foldersHolding'] {
    return useRepositoryPort().foldersHolding;
}

/** Opens a web or mail address in the browser; a failure says so in a toast. */
export function useOpenUrl(): (url: string) => void {
    const port = useRepositoryPort();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useCallback(
        (url: string) => {
            port.openUrl(url).catch((error: unknown) =>
                showToast(errorToast(i18n.t('common.openFailed', { name: url }), error, i18n)),
            );
        },
        [port, showToast, i18n],
    );
}
