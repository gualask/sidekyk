import type { ReactNode } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { MarkdownTarget } from '../../../../model/repository.types';
import { follow } from './follow';
import { usePreview } from './preview-context';

const LINK_CLASS = 'text-ui-accent-text underline-offset-2 hover:underline';

/**
 * A link, by where it leads: only to a heading, a file of the project or a web or mail address,
 * through the app.
 */
export function PreviewLink({
    target,
    title,
    children,
}: {
    target: MarkdownTarget | null;
    title: string | null;
    children: ReactNode;
}) {
    const { actions, goTo } = usePreview();
    const i18n = useTranslation();
    switch (target?.kind) {
        case 'anchor':
            return (
                <AppLink
                    href={`#${target.id}`}
                    title={title ?? undefined}
                    onFollow={() => goTo(target.id)}
                >
                    {children}
                </AppLink>
            );
        case 'file':
            return (
                <AppLink
                    href={target.path}
                    title={title ?? target.path}
                    onFollow={() => actions.openFile(target.path, target.anchor)}
                >
                    {children}
                </AppLink>
            );
        case 'web':
            return (
                <AppLink
                    href={target.url}
                    title={title ?? target.url}
                    onFollow={() => actions.openUrl(target.url)}
                >
                    {children}
                </AppLink>
            );
        case 'missing':
            return (
                <span
                    title={i18n.t('preview.notInProject', { path: target.path })}
                    className="text-ui-text-muted underline decoration-dotted underline-offset-2"
                >
                    {children}
                </span>
            );
        default:
            return <span title={title ?? undefined}>{children}</span>;
    }
}

/** A link the app follows (`onFollow`) on a click; a middle click does nothing. */
function AppLink({
    href,
    title,
    onFollow,
    children,
}: {
    href: string;
    title: string | undefined;
    onFollow: () => void;
    children: ReactNode;
}) {
    return (
        <a
            href={href}
            title={title}
            className={LINK_CLASS}
            onClick={(event) => follow(event, onFollow)}
            onAuxClick={(event) => event.preventDefault()}
        >
            {children}
        </a>
    );
}
