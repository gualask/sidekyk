import { type PointerEvent, useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { Mark, MarkPoint } from '../../model/notes.types';
import { useMarksDrawing } from './drawing/use-marks-drawing';
import { MarkField } from './MarkField';
import { markUnder, pressMarks } from './mark-press';
import { useFontReady } from './use-font-ready';
import type { MarkSession } from './use-mark-session';
import { useRoom } from './use-room';

/**
 * An image fitted (never scaled up) with the marks of `session` over it: a click places the next
 * letter (after those of `taken` too, the note's other images), a drag from a spot places it at
 * the release with its tail pointing back; a mark drags, the handle of the one selected moves its
 * tail's tip (dropped on the label, the tail goes); a double click writes its text. `onFieldEnd`
 * when the text's field closes, for the focus to go back.
 */
export function MarkStage({
    session,
    src,
    taken,
    disabled,
    onFieldEnd,
}: {
    session: MarkSession;
    /** The image under the marks. */
    src: string;
    taken: readonly Mark[];
    disabled: boolean;
    onFieldEnd: () => void;
}) {
    const { t } = useTranslation();
    const { image, ink, size, marks, selected, editing } = session;
    const { width, height } = image;
    const stage = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const room = useRoom(stage);
    const fontReady = useFontReady(size, ink.family);
    // fitted, never scaled up
    const scale = room ? Math.min(1, room.width / width, room.height / height) : 0;
    const shown = { width: Math.floor(width * scale), height: Math.floor(height * scale) };

    // drawn in the font the PNG will have, once it is there
    useMarksDrawing(canvas, fontReady ? scale : 0, shown, image, ink, {
        marks,
        selected,
        editing,
    });

    /** A pointer's place in the image's pixels. */
    const toImage = (event: { clientX: number; clientY: number }): MarkPoint => {
        const rect = canvas.current?.getBoundingClientRect();
        return {
            x: (event.clientX - (rect?.left ?? 0)) / scale,
            y: (event.clientY - (rect?.top ?? 0)) / scale,
        };
    };

    const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || disabled) return;
        pressMarks(event, session.settled(), {
            image,
            scale,
            selected,
            taken,
            toImage,
            shapesOf: session.shapesOf,
            commit: session.commit,
            setDraft: session.setDraft,
            setSelected: session.setSelected,
        });
    };

    const onDoubleClick = (event: { clientX: number; clientY: number }) => {
        const hit = markUnder(session.shapesOf(session.present), toImage(event), scale);
        if (hit >= 0) session.edit(hit);
    };

    const field = editing ? marks[editing.index] : undefined;

    return (
        <div ref={stage} className="grid min-h-0 flex-1 place-items-center overflow-hidden">
            {scale > 0 ? (
                <div className="relative" style={shown}>
                    <img
                        src={src}
                        alt={t('notes.image')}
                        width={shown.width}
                        height={shown.height}
                        className="block"
                        decoding="async"
                        draggable={false}
                    />
                    <canvas
                        ref={canvas}
                        aria-label={t('notes.marks')}
                        className="absolute inset-0 cursor-crosshair touch-none"
                        style={shown}
                        onPointerDown={onPointerDown}
                        onDoubleClick={onDoubleClick}
                    />
                    {editing && field ? (
                        <MarkField
                            key={editing.index}
                            mark={field}
                            text={editing.text}
                            size={size}
                            scale={scale}
                            ink={ink}
                            onChange={(text) => session.setEditing({ index: editing.index, text })}
                            onBlur={() => void session.settled()}
                            onKeep={() => {
                                session.settled();
                                onFieldEnd();
                            }}
                            onDrop={() => {
                                session.setEditing(null);
                                onFieldEnd();
                            }}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
