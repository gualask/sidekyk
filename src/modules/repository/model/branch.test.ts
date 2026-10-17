import { describe, expect, it } from 'vitest';
import { branchLabel } from './branch';

const branch = { head: null, commit: null, upstream: null, ahead: 0, behind: 0 };

describe('branchLabel', () => {
    it('names the branch, or the commit HEAD is detached at', () => {
        expect(branchLabel({ ...branch, head: 'main', commit: 'abc1234' })).toBe('main');
        expect(branchLabel({ ...branch, commit: 'abc1234' })).toBe('detached at abc1234');
        expect(branchLabel(branch)).toBe('detached');
    });
});
