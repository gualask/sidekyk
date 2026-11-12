import { IconFile } from '@tabler/icons-react';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/shared/i18n';
import { MatchedText } from '@/shared/ui/MatchedText';
import type { SuggestedFile } from '../../application/note-references';
import { entityParts, type NoteEntity, type Typing } from '../../model/entities';
import type { Matched } from '../../model/highlight-parts';

/** The menu's width, and its room from the field's text. */
const MENU_WIDTH = 380;
const MENU_GAP = 4;
/** The room kept from the window's edges. */
const EDGE = 8;

/** What the layer copies of the field's style, so that its text lies where the field's does. */
const MIRRORED = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'tabSize',
    'textIndent',
    'whiteSpace',
    'overflowWrap',
    'wordBreak',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
] as const;

/** Puts the layer's box over the field's text, and its text where the field has scrolled it. */
function follow(field: HTMLTextAreaElement, box: HTMLElement, content: HTMLElement) {
    box.style.left = `${field.offsetLeft + field.clientLeft}px`;
    box.style.top = `${field.offsetTop + field.clientTop}px`;
    box.style.width = `${field.clientWidth}px`;
    box.style.height = `${field.clientHeight}px`;
    content.style.width = `${field.clientWidth}px`;
    content.style.transform = `translate(${-field.scrollLeft}px, ${-field.scrollTop}px)`;
}

/**
 * The field's text again, transparent, over the field and taking no pointer: the entities tinted
 * where the field shows them, and a mark where the `@` being typed is, which the list hangs
 * from. It follows the field's box, style and scroll as they change. Nothing while the text has
 * no entity and no `@` is typed.
 */
export function ReferenceLayer({
    field,
    text,
    entities,
    anchor,
    children,
}: {
    field: RefObject<HTMLTextAreaElement | null>;
    text: string;
    entities: readonly NoteEntity[];
    anchor: Typing | null;
    children: (anchor: HTMLElement) => ReactNode;
}) {
    const box = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const [mark, setMark] = useState<HTMLElement | null>(null);
    const shown = entities.length > 0 || anchor !== null;
    useFollowField(field, box, content, shown);

    if (!shown) return null;
    return (
        <div ref={box} aria-hidden className="pointer-events-none absolute overflow-hidden">
            <div ref={content} className="text-transparent">
                {entityParts(text, entities, anchor?.start ?? null).map((part) => {
                    if (part.kind === 'anchor') return <span key="anchor" ref={setMark} />;
                    if (part.kind === 'text') return <span key={part.start}>{part.text}</span>;
                    return (
                        <mark
                            key={part.start}
                            className="rounded-[3px] bg-ui-accent/15 text-transparent"
                        >
                            {part.text}
                        </mark>
                    );
                })}
                {/* a last line left empty takes its room, as in the field */}
                {'\u200b'}
            </div>
            {anchor && mark ? children(mark) : null}
        </div>
    );
}

/**
 * Keeps the layer (`box`, its text in `content`) over the field's text: the field's style at
 * each render (the text, the wrapping setting), then its box; its box and scroll as they change,
 * while the layer is `shown`.
 */
function useFollowField(
    field: RefObject<HTMLTextAreaElement | null>,
    box: RefObject<HTMLDivElement | null>,
    content: RefObject<HTMLDivElement | null>,
    shown: boolean,
) {
    useLayoutEffect(() => {
        const element = field.current;
        if (!element || !box.current || !content.current) return;
        const style = getComputedStyle(element);
        for (const property of MIRRORED) content.current.style[property] = style[property];
        follow(element, box.current, content.current);
    });
    useLayoutEffect(() => {
        const element = field.current;
        const outer = box.current;
        const inner = content.current;
        if (!shown || !element || !outer || !inner) return;
        const sync = () => follow(element, outer, inner);
        const resized = new ResizeObserver(sync);
        resized.observe(element);
        element.addEventListener('scroll', sync);
        return () => {
            resized.disconnect();
            element.removeEventListener('scroll', sync);
        };
    }, [field, shown, box, content]);
}

/**
 * The files that match what follows `@`, under it (above, where there is no room below), in a
 * layer of the page: a card's list would cut it. The field keeps the focus: a click picks.
 */
export function FileMenu({
    id,
    optionId,
    anchor,
    files,
    active,
    onChoose,
    onPick,
}: {
    id: string;
    optionId: (index: number) => string;
    anchor: HTMLElement;
    files: readonly SuggestedFile[];
    active: number;
    onChoose: (index: number) => void;
    onPick: (path: string) => void;
}) {
    const { t, tp } = useTranslation();
    const menu = useRef<HTMLDivElement>(null);
    const place = useMenuPlace(anchor, menu);
    return createPortal(
        <>
            <div
                ref={menu}
                id={id}
                role="listbox"
                aria-label={t('notes.filesSuggested')}
                className="menu-popup fixed z-50"
                style={{
                    left: place?.left ?? 0,
                    top: place?.top ?? 0,
                    width: `min(${MENU_WIDTH}px, calc(100vw - ${2 * EDGE}px))`,
                    visibility: place ? 'visible' : 'hidden',
                }}
            >
                {files.map((file, index) => (
                    <FileOption
                        key={file.path}
                        id={optionId(index)}
                        file={file}
                        active={index === active}
                        onChoose={() => onChoose(index)}
                        onPick={() => onPick(file.path)}
                    />
                ))}
            </div>
            {/* the field keeps the focus and a textarea takes no combobox role: the list is said
            aloud here */}
            <span role="status" className="sr-only">
                {tp('notes.filesListed', files.length)}
            </span>
        </>,
        document.body,
    );
}

/** Where the menu goes: under the `@` (`anchor`), above where there is no room below. */
function useMenuPlace(anchor: HTMLElement, menu: RefObject<HTMLDivElement | null>) {
    const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
    // where the `@` is now, the list's height known
    useLayoutEffect(() => {
        const { left, top } = menuPlace(
            anchor.getBoundingClientRect(),
            menu.current?.offsetHeight ?? 0,
            window.innerWidth,
            window.innerHeight,
        );
        setPlace((current) =>
            current?.left === left && current.top === top ? current : { left, top },
        );
    });
    return place;
}

/** The menu's corner, its `height` known, by the `@` at `at` in a window of the size given. */
function menuPlace(at: DOMRect, height: number, innerWidth: number, innerHeight: number) {
    const width = Math.min(MENU_WIDTH, innerWidth - 2 * EDGE);
    const left = Math.max(EDGE, Math.min(at.left, innerWidth - width - EDGE));
    const below = at.bottom + MENU_GAP;
    const top =
        below + height + EDGE <= innerHeight ? below : Math.max(EDGE, at.top - MENU_GAP - height);
    return { left, top };
}

/** A file suggested: the pointer over it chooses it, a click picks it. */
function FileOption({
    id,
    file,
    active,
    onChoose,
    onPick,
}: {
    id: string;
    file: SuggestedFile;
    active: boolean;
    onChoose: () => void;
    onPick: () => void;
}) {
    return (
        <div
            id={id}
            role="option"
            tabIndex={-1}
            aria-selected={active}
            data-highlighted={active ? '' : undefined}
            className="menu-item gap-2"
            // the field keeps the focus, and its caret
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={onChoose}
            onClick={onPick}
        >
            <IconFile size={14} className="shrink-0 text-ui-text-muted" />
            <FilePath file={file} />
        </div>
    );
}

/** A file's name, then its folder muted, the letters typed in bold in both. */
function FilePath({ file }: { file: SuggestedFile }) {
    const cut = file.path.lastIndexOf('/') + 1;
    const name = file.path.slice(cut);
    const folder = file.path.slice(0, Math.max(0, cut - 1));
    return (
        <span className="flex min-w-0 items-baseline gap-2">
            <MatchedText
                text={name}
                highlights={shifted(file.highlights, cut, file.path.length)}
                className="shrink-0 font-mono text-[12.5px]"
            />
            {folder ? (
                <MatchedText
                    text={folder}
                    highlights={shifted(file.highlights, 0, folder.length)}
                    className="min-w-0 truncate text-xs text-ui-text-muted"
                />
            ) : null}
        </span>
    );
}

/** The highlights within `[from, to)` of a text, as offsets from `from`. */
function shifted(highlights: Matched, from: number, to: number): Matched {
    return highlights.flatMap(([start, end]) => {
        const first = Math.max(start, from);
        const last = Math.min(end, to);
        return first < last ? [[first - from, last - from] as const] : [];
    });
}
