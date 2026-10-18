import { describe, expect, it } from 'vitest';
import { projectErrorMessage } from './project-error';

describe('projectErrorMessage', () => {
    const noGit = { code: 'git_not_found', message: 'git_not_found' };

    it("names a WSL project's distro when git is missing there", () => {
        expect(projectErrorMessage(noGit, { kind: 'wsl', distro: 'Alpine', root: '/r' })).toBe(
            "git is not installed in Alpine: see the top bar's warning.",
        );
    });

    it('is the usual message otherwise', () => {
        expect(projectErrorMessage(noGit, { kind: 'local', root: '/r' })).toMatch(
            /^Git is not installed/,
        );
    });
});
