import { useCallback, useState } from 'react';
import { type FolderChoice, useProjectsChangeSubscription } from '@/modules/projects';
import type { useProjectEntry } from '../project-entry';
import type { Navigation } from './navigation';

/**
 * What all projects is asked to do, each until it is done: the Inbox's field to take the focus
 * (`⌘N` at all projects), an Inbox note found to come into view in its column, and a folder given
 * on the command line. That folder's project, already on screen, shows its panels; a folder above
 * repositories opens the New project dialog on it, at all projects.
 */
export function useOverviewAsks({
    enter,
    nav,
}: {
    enter: ReturnType<typeof useProjectEntry>['enter'];
    nav: Navigation;
}) {
    const [focusInbox, setFocusInbox] = useState(false);
    const inboxFocused = useCallback(() => setFocusInbox(false), []);
    const [inboxNote, setInboxNote] = useState<string | null>(null);
    const inboxRevealed = useCallback(() => setInboxNote(null), []);
    const [asked, setAsked] = useState<FolderChoice | null>(null);
    const takeAsked = useCallback(() => setAsked(null), []);
    useProjectsChangeSubscription((opened) => {
        if (opened.kind === 'project') {
            enter(opened.id, nav.toPanels, opened.folderId);
            return;
        }
        setAsked(opened.choice);
        nav.zoom(0);
    });

    return {
        focusInbox,
        focusComposer: () => setFocusInbox(true),
        inboxFocused,
        inboxNote,
        revealInboxNote: setInboxNote,
        inboxRevealed,
        asked,
        takeAsked,
    };
}
