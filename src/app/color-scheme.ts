/** Puts `.dark` on `<html>` while the system is in dark mode, and keeps it in sync. */
export function followSystemColorScheme(): void {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply);
}
