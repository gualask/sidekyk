import { IconPhoto } from '@tabler/icons-react';
import { useContext, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useImageSource } from '../../../../application/queries/file-reads';
import type { MarkdownTarget } from '../../../../model/repository.types';
import { follow } from './follow';
import { InLink, usePreview } from './preview-context';

/**
 * An image: a file of the project, loaded by the WebView from the app; one written into the file.
 * One on the web is never loaded: its description in place, a click opens it in the browser.
 */
export function PreviewImage({
    target,
    alt,
    title,
}: {
    target: MarkdownTarget | null;
    alt: string;
    title: string | null;
}) {
    if (target?.kind === 'data') {
        return (
            <img
                src={target.url}
                alt={alt}
                title={title ?? undefined}
                className="inline max-w-full"
            />
        );
    }
    if (target?.kind === 'file') {
        return <ProjectImage path={target.path} alt={alt} title={title} />;
    }
    return <ImagePlaceholder target={target} alt={alt} title={title} />;
}

/** An image of the project; too large, or not an image after all, its description instead. */
function ProjectImage({ path, alt, title }: { path: string; alt: string; title: string | null }) {
    const { folderId } = usePreview();
    const image = useImageSource(folderId, path);
    const [failed, setFailed] = useState<string | null>(null);
    if (image.isPending) return null;
    if (!image.url || image.tooLarge || failed === image.url) {
        return <ImagePlaceholder target={null} alt={alt} title={title} />;
    }
    const url = image.url;
    return (
        <img
            src={url}
            alt={alt}
            title={title ?? undefined}
            className="inline max-w-full"
            onError={() => setFailed(url)}
        />
    );
}

/** An image not shown: its description, and for one on the web a click opening it. */
function ImagePlaceholder({
    target,
    alt,
    title,
}: {
    target: MarkdownTarget | null;
    alt: string;
    title: string | null;
}) {
    const { actions } = usePreview();
    const inLink = useContext(InLink);
    const i18n = useTranslation();
    const placeholder = (
        <span className="inline-flex items-center gap-1 rounded-md bg-ui-surface-hover px-1.5 py-0.5 align-middle text-[0.85em] text-ui-text-muted">
            <IconPhoto size={14} />
            {alt || title || i18n.t('preview.image')}
        </span>
    );
    // a badge inside a link: the link's click, one link
    if (target?.kind === 'web' && !inLink) {
        return (
            <a
                href={target.url}
                title={i18n.t('preview.remoteImage', { url: target.url })}
                onClick={(event) => follow(event, () => actions.openUrl(target.url))}
                onAuxClick={(event) => event.preventDefault()}
            >
                {placeholder}
            </a>
        );
    }
    return placeholder;
}
