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
            <div className="min-w-0 flex-1">
                <div id={id} className="font-semibold">
                    {label}
                </div>
                <div className="mt-0.5 text-xs text-ui-text-muted">{description}</div>
            </div>
            {children(id)}
        </div>
    );
}
