import { IconFileOff, IconPhotoOff } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { fileSize } from '@/shared/format/file-size';
import { useTranslation } from '@/shared/i18n';
import { useImageSource } from '../../../application/queries/file-reads';
import { MAX_IMAGE_BYTES } from '../../../model/preview/preview';
import { ErrorText, Notice } from '../pane/Pane';

/**
 * An image of the project in place of the binary notice: centered, scaled down to fit, never up,
 * its pixel size and file size below it. The WebView loads it from the app (`project-file:`), so
 * an SVG runs nothing: the tree's file, loaded again once it changes, or a git object (`blob`), a
 * side of the image's diff, its `name` right above it.
 */
export function ImageView({
    folderId,
    path,
    blob = null,
    name = null,
}: {
    folderId: string;
    path: string;
    blob?: string | null;
    name?: string | null;
}) {
    const i18n = useTranslation();
    const label = name ? (
        <h3 className="shrink-0 text-xs font-medium text-ui-text-muted">{name}</h3>
    ) : null;
    // what shows instead of the image, under its name
    const notice = (content: ReactNode) => (
        <Notice>
            {label}
            {content}
        </Notice>
    );
    const image = useImageSource(folderId, path, blob);
    const [shown, setShown] = useState<{ url: string; width: number; height: number } | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    if (image.isPending) return notice(i18n.t('view.loadingFile'));
    if (image.isError) {
        return notice(<ErrorText error={image.error} />);
    }
    if (image.tooLarge) {
        return notice(
            <>
                <IconPhotoOff size={28} stroke={1.5} />
                {i18n.t('view.imageTooLarge', { size: fileSize(MAX_IMAGE_BYTES, i18n.formatTag) })}
            </>,
        );
    }
    if (!image.url || failed === image.url) {
        return notice(
            <>
                <IconFileOff size={28} stroke={1.5} />
                {i18n.t('view.binary')}
            </>,
        );
    }
    const url = image.url;
    const size = shown?.url === url ? shown : null;
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 overflow-auto p-6">
            {label}
            <img
                src={url}
                alt={path}
                className="max-h-full max-w-full min-h-0 object-contain"
                onLoad={(event) =>
                    setShown({
                        url,
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                    })
                }
                onError={() => setFailed(url)}
            />
            {size ? (
                <SizeLine width={size.width} height={size.height} bytes={image.size ?? 0} />
            ) : null}
        </div>
    );
}

/** An image's pixel size and file size, below it. */
function SizeLine({ width, height, bytes }: { width: number; height: number; bytes: number }) {
    const i18n = useTranslation();
    return (
        <p className="shrink-0 text-xs text-ui-text-muted">
            {i18n.t('view.imageSize', {
                width: String(width),
                height: String(height),
                size: fileSize(bytes, i18n.formatTag),
            })}
        </p>
    );
}
