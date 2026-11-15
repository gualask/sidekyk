import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import type { Settings } from './settings.types';

/**
 * How the panels show what they show until the stored settings are read: the backend's defaults
 * (`Settings::default()` in `src-tauri/crates/core/src/modules/settings/contracts.rs`). The view a
 * diff opens in is not among them: until read it is unknown, so the first diff asks for the right
 * one.
 */
export const DEFAULT_VIEW_SETTINGS: Pick<
    Settings,
    'fileView' | 'diffScrollbar' | 'codeLines' | 'copyTemplate' | 'commitsPlace' | 'noteLines'
> = {
    fileView: 'preview',
    diffScrollbar: 'narrow',
    codeLines: 'scroll',
    copyTemplate: DEFAULT_COPY_TEMPLATE,
    commitsPlace: 'sidebar',
    noteLines: 'wrap',
};
