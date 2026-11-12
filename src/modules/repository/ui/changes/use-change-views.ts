import { useState } from 'react';
import type { DiffView } from '@/shared/git/diff-view';
import { hasPreview } from '../../model/preview/preview';
import { DIFF_VIEWS, IMAGE_VIEWS, PREVIEW_VIEW, type ViewSwitch } from '../viewer/view-options';
import type { DiffViewChoice } from './use-diff-view-choice';

/** How a file of the list shows, and the header's switches (see `useChangeViews`). */
export interface ChangeViews {
    /** The changed file shown shows as it reads, instead of its diff. */
    preview: boolean;
    /**
     * A diff's views, and for a changed file with a preview (`path`, null for none) that one too,
     * the diff's view staying as chosen; null until the settings say which view a diff opens in.
     */
    diffSwitch: (
        currentHunk: () => number,
        path?: string | null,
    ) => ViewSwitch<DiffView | 'preview'> | null;
    /** An image's: its sides or as it reads, with no whole file; the diff's view stays as chosen. */
    imageSwitch: ViewSwitch<'changes' | 'preview'>;
    /** Back from the file as it reads to its diff. */
    leavePreview: () => void;
}

/**
 * Whether a changed file with a preview shows as it reads instead of its diff, for the panel's
 * files while it is open (`previewable`: the file shown has one), and the header's switches
 * between that and the diff's views.
 */
export function useChangeViews(diffView: DiffViewChoice | null, previewable: boolean): ChangeViews {
    const [previewChanged, setPreviewChanged] = useState(false);
    const preview = previewable && previewChanged;
    return {
        preview,
        diffSwitch: (currentHunk, path = null) =>
            diffView
                ? {
                      value: preview ? 'preview' : diffView.view,
                      options:
                          path !== null && hasPreview(path)
                              ? [...DIFF_VIEWS, PREVIEW_VIEW]
                              : DIFF_VIEWS,
                      onChange: (next) => {
                          setPreviewChanged(next === 'preview');
                          if (next !== 'preview') diffView.onChange(next, currentHunk());
                      },
                  }
                : null,
        imageSwitch: {
            value: preview ? 'preview' : 'changes',
            options: IMAGE_VIEWS,
            onChange: (next) => setPreviewChanged(next === 'preview'),
        },
        leavePreview: () => setPreviewChanged(false),
    };
}
