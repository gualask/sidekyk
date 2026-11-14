import { IconPlus, IconX } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import type { DraftImage } from '../../model/capture-draft';

/** A thumbnail's height in the strip, in CSS pixels. */
const THUMB_HEIGHT = 48;

/**
 * The draft's images as thumbnails, the selected one lit, then the + tile that captures another
 * area into the draft. A click selects; on hover a crop that may go shows its ×.
 */
export function ImageStrip({
    images,
    selected,
    thumbUrl,
    removable,
    onSelect,
    onRemove,
    onCapture,
}: {
    images: readonly DraftImage[];
    selected: number;
    thumbUrl: (image: DraftImage) => string;
    removable: (index: number) => boolean;
    onSelect: (index: number) => void;
    onRemove: (index: number) => void;
    onCapture: () => void;
}) {
    const { t } = useTranslation();
    return (
        <ul
            className="flex shrink-0 items-center gap-1.5 overflow-x-auto"
            aria-label={t('notes.images')}
        >
            {images.length > 1
                ? images.map((image, index) => (
                      <li
                          key={image.kind === 'crop' ? image.crop : image.image.id}
                          className="group/image relative shrink-0"
                      >
                          <button
                              type="button"
                              tabIndex={-1}
                              className={`block overflow-hidden rounded-md border-2 ${
                                  index === selected ? 'border-ui-accent' : 'border-transparent'
                              }`}
                              title={t('notes.image')}
                              onClick={() => onSelect(index)}
                          >
                              <img
                                  src={thumbUrl(image)}
                                  alt={t('notes.image')}
                                  style={{ height: THUMB_HEIGHT }}
                                  className="block w-auto"
                                  decoding="async"
                                  draggable={false}
                              />
                          </button>
                          {removable(index) ? (
                              <button
                                  type="button"
                                  tabIndex={-1}
                                  className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-ui-surface text-ui-text-secondary opacity-0 group-hover/image:opacity-100 hover:text-ui-danger"
                                  title={t('notes.removeImage')}
                                  aria-label={t('notes.removeImage')}
                                  onClick={() => onRemove(index)}
                              >
                                  <IconX size={12} stroke={2.5} />
                              </button>
                          ) : null}
                      </li>
                  ))
                : null}
            <li className="shrink-0">
                <button
                    type="button"
                    tabIndex={-1}
                    className="grid place-items-center rounded-md bg-ui-surface-subtle text-ui-text-secondary hover:bg-ui-surface-hover hover:text-ui-text"
                    style={{ height: THUMB_HEIGHT + 4, width: THUMB_HEIGHT + 4 }}
                    title={t('notes.captureAnother')}
                    aria-label={t('notes.captureAnother')}
                    onClick={onCapture}
                >
                    <IconPlus size={18} />
                </button>
            </li>
        </ul>
    );
}
