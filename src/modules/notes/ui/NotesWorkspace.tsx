import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import type { PanelProps } from '@/shared/panels/panel';
import { shortcutKey } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useNoteActions, useProjectNotes } from '../application/notes.queries';
import { notesShownBy } from '../model/targets';
import { ListSwitch } from './ListSwitch';
import { NoteCards } from './NoteCards';
import { NoteLists } from './NoteLists';
import { fittingListsWidth } from './notes-layout';
import { ReorderNotes } from './ReorderNotes';

/** The lists' width by default, the same in every project, and the least it takes. */
const LISTS_WIDTH = { initial: 200, min: 140 };

/**
 * The Notes panel: a project's notes, plain-text cards in lists by topic. Full screen the lists
 * are on the left; in a tile the header's list name opens them. The cards of the open one fill the
 * rest. `⌘N` writes a new note.
 */
export function NotesWorkspace({ project, header, target, place, selected: hasKeys }: PanelProps) {
    const root = project.root;
    const { data: notes, error } = useProjectNotes(root);
    const actions = useNoteActions(root);
    // the note picked in reorder mode, or null out of it
    const [reorder, setReorder] = useState<string | null>(null);
    // a list just made, whose field takes the focus once it shows
    const [writeIn, setWriteIn] = useState<string | null>(null);
    // a note to bring into view, as the palette asked
    const [reveal, setReveal] = useState<string | null>(null);
    const revealed = useCallback(() => setReveal(null), []);

    // a list, or a note of it, picked in the palette
    const showTarget = useEffectEvent((list: string, note: string | null) => {
        setReorder(null);
        actions.openList(list);
        setReveal(note);
    });
    // once the notes are read, as opening a list changes them
    const ready = notes !== undefined;
    useEffect(() => {
        const shown = ready && target ? notesShownBy(target) : null;
        if (shown) showTarget(shown.list, shown.note);
    }, [target, ready]);

    const width = useSidebarWidth('notes', LISTS_WIDTH);
    const listsBox = useRef<HTMLDivElement>(null);

    useWindowKeys(
        (event) => {
            if (!hasKeys || event.defaultPrevented || shortcutKey(event) !== 'n') return;
            event.preventDefault();
            // through the list's field taking the focus as it shows: out of reorder mode it is
            // not there yet
            setReorder(null);
            if (notes) setWriteIn(notes.openList);
        },
        { capture: true },
    );

    if (error) {
        return (
            <div className="px-3 py-2 font-sans text-sm text-ui-danger">{errorMessage(error)}</div>
        );
    }
    if (!notes) return null;
    const list = notes.lists.find((l) => l.id === notes.openList) ?? notes.lists[0];

    const cards =
        reorder !== null ? (
            <ReorderNotes
                notes={notes}
                list={list}
                actions={actions}
                selected={reorder}
                onSelect={setReorder}
                onDone={() => setReorder(null)}
                hasKeys={hasKeys}
            />
        ) : (
            <NoteCards
                // a list opens with its done notes folded and no card open
                key={list.id}
                notes={notes}
                list={list}
                actions={actions}
                focusComposer={writeIn === list.id}
                onComposerFocused={() => setWriteIn(null)}
                reveal={reveal}
                onRevealed={revealed}
                onReorder={setReorder}
            />
        );

    const onListOpened = (id: string, write: boolean) => {
        setReorder(null);
        setWriteIn(write ? id : null);
    };

    if (place === 'tile') {
        return (
            <div className="flex h-full bg-ui-surface font-sans">
                {header
                    ? createPortal(
                          <ListSwitch
                              notes={notes}
                              list={list}
                              actions={actions}
                              onOpen={onListOpened}
                          />,
                          header,
                      )
                    : null}
                {cards}
            </div>
        );
    }

    return (
        <div className="flex h-full bg-ui-surface font-sans">
            <div
                ref={listsBox}
                className="shrink-0 overflow-auto border-r border-ui-border"
                style={width.style}
            >
                <NoteLists notes={notes} actions={actions} onOpen={onListOpened} />
            </div>
            <SidebarSplitter
                width={width}
                box={listsBox}
                place="edge"
                fitting={(box) =>
                    fittingListsWidth(
                        notes.lists.map((l) => l.name),
                        box,
                    )
                }
                what="list"
            />
            {cards}
        </div>
    );
}
