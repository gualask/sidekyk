import { useId } from 'react';
import { useTranslation } from '@/shared/i18n';
import { AVATAR_COLORS, avatarColor, avatarLetters } from '@/shared/projects/avatar';
import { ProjectAvatar } from '@/shared/projects/ProjectAvatar';

const COLORS = Array.from({ length: AVATAR_COLORS }, (_, i) => i + 1);

/**
 * A project's avatar as its dialog edits it: the avatar as it will show, the letters the user
 * writes (blank, the name's, shown in their place) and its color, one of the theme's.
 */
export function AvatarField({
    name,
    letters,
    written,
    color,
    onLetters,
    onColor,
}: {
    /** The name as written in the dialog, which gives the letters when none are written. */
    name: string;
    letters: string;
    /**
     * The letters as `writtenLetters` reads them: none (the name's), or false when they cannot
     * show (more than two, or not letters and digits).
     */
    written: string | null | false;
    color: number;
    onLetters: (letters: string) => void;
    onColor: (color: number) => void;
}) {
    const { t } = useTranslation();
    const id = useId();
    const invalid = written === false;
    const shown = written === false ? null : written;
    return (
        <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-xs font-semibold">{t('projects.avatar')}</legend>
            <div className="flex items-center gap-3">
                <ProjectAvatar
                    project={{ name, avatar: { color, letters: shown } }}
                    className="h-8 w-8 text-sm"
                />
                <input
                    value={letters}
                    placeholder={avatarLetters({ name, avatar: { color, letters: null } })}
                    aria-label={t('projects.letters')}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? `${id}-invalid` : undefined}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-14 rounded-lg border border-ui-border bg-ui-surface-subtle px-2.5 py-1.5 text-center text-[13px] uppercase outline-none placeholder:text-ui-text-muted focus:border-ui-accent aria-invalid:border-ui-danger"
                    onChange={(event) => onLetters(event.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                    {COLORS.map((number) => (
                        <input
                            key={number}
                            type="radio"
                            name={`${id}-color`}
                            checked={number === color}
                            aria-label={t('projects.color', { number })}
                            className="h-5 w-5 cursor-pointer appearance-none rounded-full ring-ui-text ring-offset-2 ring-offset-ui-surface outline-none checked:ring-2 focus-visible:ring-2 focus-visible:ring-ui-accent"
                            style={{ backgroundColor: avatarColor(number) }}
                            onChange={() => onColor(number)}
                        />
                    ))}
                </div>
            </div>
            {invalid ? (
                <p id={`${id}-invalid`} className="text-xs text-ui-danger">
                    {t('projects.lettersInvalid')}
                </p>
            ) : null}
        </fieldset>
    );
}
