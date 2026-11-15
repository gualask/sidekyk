/**
 * The local midnight of the day `days` days after the day of `from` (before it when negative):
 * by the calendar, so a day the clocks change on is still one day.
 */
export function localMidnight(from: Date, days: number): Date {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
}
