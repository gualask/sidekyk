/** A file's size as people read it: bytes, kB or MB (decimal, as file managers show them). */
export function fileSize(bytes: number, locale: string): string {
    const [value, unit] =
        bytes < 1000
            ? [bytes, 'byte']
            : bytes < 1_000_000
              ? [bytes / 1000, 'kilobyte']
              : [bytes / 1_000_000, 'megabyte'];
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: unit === 'byte' ? 0 : 1,
    }).format(value);
}
