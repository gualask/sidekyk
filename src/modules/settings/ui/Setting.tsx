import { IconAlertTriangle } from '@tabler/icons-react';
import { type ReactNode, useId } from 'react';

/** A setting's row: what it is, and its control, named by the label's id. */
export function Setting({
    label,
    description,
    children,
}: {
    label: string;
    description: string;
    children: (labelId: string) => ReactNode;
}) {
    const id = useId();
    return (
        <div className="flex items-center gap-4 py-2">
            <SettingHead id={id} label={label} description={description} />
            {children(id)}
        </div>
    );
}

/** A setting's name, `id` for its control to point at, and what it does under it. */
export function SettingHead({
    id,
    label,
    description,
}: {
    id: string;
    label: string;
    description: string;
}) {
    return (
        <div className="min-w-0 flex-1">
            <div id={id} className="font-semibold">
                {label}
            </div>
            <div className="mt-0.5 text-xs text-ui-text-muted">{description}</div>
        </div>
    );
}

/** What is wrong with a setting, under it; `id` for the field it describes. */
export function SettingWarning({ id, children }: { id?: string; children: ReactNode }) {
    return (
        <p
            id={id}
            role="alert"
            className="mt-2 flex items-start gap-1.5 text-xs text-ui-warning-soft-text"
        >
            <IconAlertTriangle size={14} className="mt-px shrink-0 text-ui-warning" />
            <span>{children}</span>
        </p>
    );
}
