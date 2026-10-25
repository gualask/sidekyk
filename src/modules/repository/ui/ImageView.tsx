import { IconFileOff, IconPhotoOff } from '@tabler/icons-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { useImageSource } from '../application/repository.queries';
import { fileSize, MAX_IMAGE_BYTES } from '../model/preview';
import { Notice } from './Pane';

/**
 * An image of the project in place of the binary notice: centered, scaled down to fit, never up,
 * its pixel size and file size below it. The WebView loads it from the app (`project-file:`), so
 * an SVG runs nothing; loaded again once the file changes.
 */
export function ImageView({ projectId, path }: { projectId: string; path: string }) {
    const i18n = useTranslation();
    const image = useImageSource(projectId, path);
    const [shown, setShown] = useState<{ url: string; width: number; height: number } | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    if (image.isPending) return <Notice>{i18n.t('view.loadingFile')}</Notice>;
    if (image.isError) {
        return (
            <Notice>
                <span className="text-ui-danger">{errorMessage(image.error, i18n)}</span>
            </Notice>
        );
    }
    if (image.tooLarge) {
        return (
            <Notice>
                <IconPhotoOff size={28} stroke={1.5} />
                {i18n.t('view.imageTooLarge', { size: fileSize(MAX_IMAGE_BYTES, i18n.formatTag) })}
            </Notice>
        );
    }
    if (!image.url || failed === image.url) {
        return (
            <Notice>
                <IconFileOff size={28} stroke={1.5} />
                {i18n.t('view.binary')}
            </Notice>
        );
    }
    const url = image.url;
    const size = shown?.url === url ? shown : null;
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 overflow-auto p-6">
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
                <p className="shrink-0 text-xs text-ui-text-muted">
                    {i18n.t('view.imageSize', {
                        width: String(size.width),
                        height: String(size.height),
                        size: fileSize(image.data?.size ?? 0, i18n.formatTag),
                    })}
                </p>
            ) : null}
        </div>
    );
}
