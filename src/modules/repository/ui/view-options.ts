import type { DiffView } from '@/shared/git/diff-view';
import type { FileView } from '@/shared/git/file-view';
import type { MessageKey } from '@/shared/i18n';

/** One of the ways a file shows, in the header's switch. */
export interface ViewOption<V extends string> {
    value: V;
    label: MessageKey;
    title: MessageKey;
}

/** The header's switch among the ways a file shows. */
export interface ViewSwitch<V extends string = string> {
    value: V;
    options: readonly ViewOption<V>[];
    onChange(view: V): void;
}

export const DIFF_VIEWS: readonly ViewOption<DiffView>[] = [
    { value: 'changes', label: 'diffView.changes', title: 'fileHeader.changesTitle' },
    { value: 'file', label: 'diffView.file', title: 'fileHeader.fileTitle' },
];

export const PREVIEW_VIEW: ViewOption<'preview'> = {
    value: 'preview',
    label: 'fileView.preview',
    title: 'fileHeader.previewTitle',
};

export const FILE_VIEWS: readonly ViewOption<FileView>[] = [
    { value: 'code', label: 'fileView.code', title: 'fileHeader.codeTitle' },
    PREVIEW_VIEW,
];
