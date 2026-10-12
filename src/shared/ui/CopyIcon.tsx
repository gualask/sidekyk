import { IconCheck, IconCopy, IconCopyOff } from '@tabler/icons-react';
import type { CopyState } from './hooks/use-copy-to-clipboard';

/** Copy's icon everywhere: a check for a moment once done, crossed out when it failed. */
export function CopyIcon({ copied }: { copied: CopyState }) {
    if (!copied) return <IconCopy size={14} />;
    return copied.ok ? <IconCheck size={14} /> : <IconCopyOff size={14} />;
}
