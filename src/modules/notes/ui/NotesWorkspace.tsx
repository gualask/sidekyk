import { type ReactNode, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { type SidebarWidth, useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useNoteActions } from '../application/note-actions/note-actions';
import { useExportNotes, useNotes } from '../application/notes.queries';
import type { Moving } from '../model/destination';
import { openListOf } from '../model/notes';
import type { Note, NoteList, ProjectNotes } from '../model/notes.types';
import { type NotesShown, notesShownBy } from '../model/targets';
import { NoteCards } from './cards/NoteCards';
import { ListSwitch } from './lists/ListSwitch';
import { NoteLists } from './lists/NoteLists';
import { MoveHost } from './move/MoveHost';
import { NotesMenu } from './NotesMenu';
import { fittingListsWidth } from './notes-layout';
import { ReorderNotes } from './reorder-notes/ReorderNotes';

/** The lists' width by default, the same in every project, and the least it takes. */
const LISTS_WIDTH = { initial: 200, min: 140 };

/**
 * The Notes panel: a project's notes, plain-text cards in lists by topic. Full screen the lists
 * are on the left; in a tile the header's list name opens them. The cards of the open one fill the
 * rest. A new note (`⌘N`, the app's key) comes as a target.
 */
export function NotesWorkspace({
    project,
    header,
    target,
    targetTaken,
    place,
    selected: hasKeys,
}: PanelProps) {
    const book = project.id;
    const { data: notes, error } = useNotes(book);
    const actions = useNoteActions(book);
    const exportNotes = useExportNotes(project.id);
    // the note picked in reorder mode, or null out of it
    const [reorder, setReorder] = useState<string | null>(null);
    // a list whose field takes the focus once it shows: one just made, `⌘N`
    const [writeIn, setWriteIn] = useState<string | null>(null);
    // a note to bring into view, as the palette asked
    const [reveal, setReveal] = useState<string | null>(null);
    const revealed = useCallback(() => setReveal(null), []);
    // a note or a list in the Move dialog
    const [moving, setMoving] = useState<Moving | null>(null);
    const askMoveNote = (note: Note) => setMoving({ kind: 'note', book, note });
    const askMoveList = (list: NoteList) => setMoving({ kind: 'list', book, list });

    // a list, or a note of it, picked in the palette; or a new note (`⌘N`), its field taking the
    // focus as it shows (out of reorder mode it is not there yet); once the notes are read, as
    // opening a list changes them
    useTarget(notes !== undefined, target, targetTaken, (shown) => {
        if (!notes) return;
        setReorder(null);
        const list = shown.list ?? notes.openList;
        if (list !== notes.openList) actions.openList(list);
        setReveal(shown.note);
        if (shown.write) setWriteIn(list);
    });

    const width = useSidebarWidth('notes', LISTS_WIDTH);
    const i18n = useTranslation();

    if (error) {
        return (
            <div className="px-3 py-2 font-sans text-sm text-ui-danger">
                {errorMessage(error, i18n)}
            </div>
        );
    }
    if (!notes) return null;
    const list = openListOf(notes);

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
                book={book}
                notes={notes}
                list={list}
                actions={actions}
                focusComposer={writeIn === list.id}
                onComposerFocused={() => setWriteIn(null)}
                reveal={reveal}
                onRevealed={revealed}
                onReorder={setReorder}
                onMove={askMoveNote}
            />
        );

    const onListOpened = (id: string, write: boolean) => {
        setReorder(null);
        setWriteIn(write ? id : null);
    };

    const head = (
        <PanelHead header={header} exportNotes={exportNotes}>
            {place === 'tile' ? (
                <ListSwitch
                    notes={notes}
                    list={list}
                    actions={actions}
                    onOpen={onListOpened}
                    onMove={askMoveList}
                />
            ) : null}
        </PanelHead>
    );

    const mover = <MoveHost moving={moving} actions={actions} onClose={() => setMoving(null)} />;

    if (place === 'tile') {
        return (
            <div className="flex h-full bg-ui-surface font-sans">
                {head}
                {mover}
                {cards}
            </div>
        );
    }

    return (
        <div className="flex h-full bg-ui-surface font-sans">
            {head}
            {mover}
            <ListsSidebar width={width} notes={notes}>
                <NoteLists
                    notes={notes}
                    actions={actions}
                    onOpen={onListOpened}
                    onMove={askMoveList}
                />
            </ListsSidebar>
            {cards}
        </div>
    );
}

/**
 * A target the app hands the panel, shown (`show`) once `ready`, if it is one for notes; then
 * taken once: the app forgets it, so mounting again never applies it again.
 */
function useTarget(
    ready: boolean,
    target: PanelProps['target'],
    targetTaken: PanelProps['targetTaken'],
    show: (shown: NotesShown) => void,
) {
    const showTarget = useEffectEvent(show);
    const take = useEffectEvent(targetTaken);
    useEffect(() => {
        if (!ready || !target) return;
        const shown = notesShownBy(target);
        if (shown) showTarget(shown);
        take(target);
    }, [target, ready]);
}

/**
 * The panel's header: in a tile the open list's name (`children`), which opens the lists; the
 * panel's menu, right.
 */
function PanelHead({
    header,
    exportNotes,
    children,
}: {
    header: PanelProps['header'];
    exportNotes: ReturnType<typeof useExportNotes>;
    children: ReactNode;
}) {
    if (!header) return null;
    return createPortal(
        <>
            {children}
            <span className="flex-1" />
            <NotesMenu onExport={() => void exportNotes()} />
        </>,
        header,
    );
}

/** Full screen, the lists (`children`) on the left; their edge resizes them, as a sidebar's. */
function ListsSidebar({
    width,
    notes,
    children,
}: {
    width: SidebarWidth;
    notes: ProjectNotes;
    children: ReactNode;
}) {
    const listsBox = useRef<HTMLDivElement>(null);
    return (
        <>
            <div
                ref={listsBox}
                className="shrink-0 overflow-auto border-r border-ui-border"
                style={width.style}
            >
                {children}
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
        </>
    );
}
