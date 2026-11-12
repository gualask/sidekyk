import { useEffect, useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import { MAX_MARK_TEXT, markShape } from '../../model/marks';
import type { Mark } from '../../model/notes.types';
import { type MarkInk, textMeasure } from './draw-marks';

/**
 * The field writing a mark's text, over its label and as wide as its text. It takes the focus,
 * its text selected: typing replaces the letter. `Enter` keeps the text, `Esc` drops it.
 */
export function MarkField({
    mark,
    text,
    size,
    scale,
    ink,
    onChange,
    onBlur,
    onKeep,
    onDrop,
}: {
    mark: Mark;
    text: string;
    size: number;
    scale: number;
    ink: MarkInk;
    onChange: (text: string) => void;
    onBlur: () => void;
    onKeep: () => void;
    onDrop: () => void;
}) {
    const { t } = useTranslation();
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, []);
    const { label } = markShape({ ...mark, text: text || ' ' }, size, textMeasure(size, ink));
    return (
        <input
            ref={input}
            aria-label={t('notes.markText')}
            value={text}
            maxLength={MAX_MARK_TEXT}
            className="absolute rounded-full bg-ui-mark px-0 text-center font-bold text-ui-mark-text outline-none ring-2 ring-ui-mark-text"
            style={{
                left: label.x * scale,
                top: label.y * scale,
                width: label.width * scale,
                height: label.height * scale,
                fontSize: size * scale,
            }}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    onKeep();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    onDrop();
                }
            }}
        />
    );
}
