import type {
    Branch,
    Commit,
    CommitActivity,
    CommitFileDiffRequest,
    CommitFiles,
    CommitRequest,
    FileChange,
    RecentCommits,
    UnifiedDiff,
} from '@/modules/repository';
import { LOGO_BLOB } from './fixture-files';
import { LARGE_BRANCH } from './large.fixture-data';
import { REVIEW_BRANCH, REVIEW_UPSTREAM } from './review.fixture-data';

/** The fixture's clock: commits are dated back from when the page loaded. */
const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

type FixtureCommit = Commit & { files: (FileChange & { diff: string })[] };

/** A full hash that looks like one: its first letters differ from commit to commit. */
function sha(n: number): string {
    return (Math.imul(n, 2_654_435_761) >>> 0).toString(16).padStart(8, '0').repeat(5);
}

function file(
    path: string,
    kind: FileChange['kind'],
    diff: string,
    counts: { additions: number | null; deletions: number | null; binary?: boolean },
    origPath: string | null = null,
    newBlob: string | null = null,
): FileChange & { diff: string } {
    return { path, origPath, kind, binary: false, oldBlob: null, newBlob, ...counts, diff };
}

/** The logo `feature/logo` added, which its merge brought in too. */
const LOGO_ADDED = file(
    'public/logo.png',
    'added',
    `diff --git a/public/logo.png b/public/logo.png
new file mode 100644
Binary files /dev/null and b/public/logo.png differ
`,
    { additions: null, deletions: null, binary: true },
    null,
    LOGO_BLOB,
);

const REVIEW_COMMITS: FixtureCommit[] = [
    {
        sha: sha(6),
        parents: [sha(5)],
        author: 'Claude',
        time: NOW - 25 * 60,
        subject: 'Apply coupons to the cart total',
        refs: [{ name: REVIEW_BRANCH, kind: 'head' }],
        files: [
            file(
                'src/cart/total.ts',
                'modified',
                `diff --git a/src/cart/total.ts b/src/cart/total.ts
--- a/src/cart/total.ts
+++ b/src/cart/total.ts
@@ -10,5 +10,6 @@ export function total(cart: Cart): number {
     const shipping = cart.items.length > 0 ? 4.9 : 0;
-    return subtotal(cart) + shipping;
+    const discount = cart.coupon ? cart.coupon.amount : 0;
+    return subtotal(cart) + shipping - discount;
 }
`,
                { additions: 2, deletions: 1 },
            ),
            file(
                'src/cart/cart.ts',
                'modified',
                `diff --git a/src/cart/cart.ts b/src/cart/cart.ts
--- a/src/cart/cart.ts
+++ b/src/cart/cart.ts
@@ -1,4 +1,5 @@
 export interface Cart {
     items: CartItem[];
+    coupon?: Coupon;
 }
`,
                { additions: 1, deletions: 0 },
            ),
        ],
    },
    {
        sha: sha(7),
        parents: [sha(4)],
        author: 'Grace Hopper',
        time: NOW - 90 * 60,
        subject: 'Round coupon amounts to cents',
        refs: [{ name: REVIEW_UPSTREAM, kind: 'upstream' }],
        files: [
            file(
                'src/cart/coupon.ts',
                'modified',
                `diff --git a/src/cart/coupon.ts b/src/cart/coupon.ts
--- a/src/cart/coupon.ts
+++ b/src/cart/coupon.ts
@@ -1,3 +1,3 @@
 export function couponAmount(coupon: Coupon): number {
-    return coupon.amount;
+    return Math.round(coupon.amount * 100) / 100;
 }
`,
                { additions: 1, deletions: 1 },
            ),
        ],
    },
    {
        sha: sha(5),
        parents: [sha(4)],
        author: 'Claude',
        time: NOW - 3 * HOUR,
        subject: 'Move formatMoney to utils',
        refs: [],
        files: [
            file(
                'src/utils/money.ts',
                'renamed',
                `diff --git a/src/money.ts b/src/utils/money.ts
similarity index 100%
rename from src/money.ts
rename to src/utils/money.ts
`,
                { additions: 0, deletions: 0 },
                'src/money.ts',
            ),
        ],
    },
    {
        sha: sha(4),
        parents: [sha(2), sha(3)],
        author: 'Ada Lovelace',
        time: NOW - 26 * HOUR,
        subject: "Merge branch 'feature/logo'",
        refs: [],
        files: [LOGO_ADDED],
    },
    {
        sha: sha(3),
        parents: [sha(2)],
        author: 'Ada Lovelace',
        time: NOW - 30 * HOUR,
        subject: 'Add the logo',
        refs: [],
        files: [LOGO_ADDED],
    },
    {
        sha: sha(2),
        parents: [sha(1)],
        author: 'Ada Lovelace',
        time: NOW - 4 * 24 * HOUR,
        subject: 'Remove the legacy discounts, superseded by the coupons that the checkout applies',
        refs: [{ name: 'v1.1.0', kind: 'tag' }],
        files: [
            file(
                'src/legacy/discounts.ts',
                'deleted',
                `diff --git a/src/legacy/discounts.ts b/src/legacy/discounts.ts
deleted file mode 100644
--- a/src/legacy/discounts.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function legacyDiscount(total: number): number {
-    return total > 100 ? 10 : 0;
-}
`,
                { additions: 0, deletions: 3 },
            ),
        ],
    },
    {
        sha: sha(1),
        parents: [],
        author: 'Ada Lovelace',
        time: NOW - 40 * 24 * HOUR,
        subject: 'Initial commit',
        refs: [{ name: 'v1.0.0', kind: 'tag' }],
        files: [
            file(
                'README.md',
                'added',
                `diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# shop
+A small shop.
`,
                { additions: 2, deletions: 0 },
            ),
        ],
    },
];

/** Pages of commits to scroll through, and one commit so large its list is cut. */
const LARGE_COMMIT_COUNT = 140;

/** As many as a page of the backend's graph. */
const PAGE = 50;
const LARGE_COMMIT_FILES = 10_000;

const LARGE_DIFF = `@@ -1,3 +1,3 @@
 export const generated = {
-    version: 1,
+    version: 2,
 };
`;

function largeCommit(n: number): FixtureCommit {
    const count = n === 0 ? LARGE_COMMIT_FILES : (n % 4) + 1;
    return {
        sha: sha(1000 - n),
        parents: n === LARGE_COMMIT_COUNT - 1 ? [] : [sha(999 - n)],
        author: 'Claude',
        time: NOW - n * 5 * HOUR,
        subject: n === 0 ? 'Regenerate every module' : `Refactor module ${n}`,
        refs: n === 0 ? [{ name: LARGE_BRANCH, kind: 'head' }] : [],
        files: Array.from({ length: count }, (_, i) =>
            file(
                `generated/module-${String(i % 50).padStart(2, '0')}/file-${i}.ts`,
                'modified',
                LARGE_DIFF,
                {
                    additions: 1,
                    deletions: 1,
                },
            ),
        ),
    };
}

let largeCommits: FixtureCommit[] | null = null;

function fixtureCommits(large: boolean): FixtureCommit[] {
    if (!large) return REVIEW_COMMITS;
    largeCommits ??= Array.from({ length: LARGE_COMMIT_COUNT }, (_, n) => largeCommit(n));
    return largeCommits;
}

function find(large: boolean, commit: CommitRequest): FixtureCommit | undefined {
    return fixtureCommits(large).find((c) => c.sha === commit.sha);
}

/** A page of the graph, after its first `skip` commits, as the backend reads it. */
export function recentCommits(large: boolean, skip: number): RecentCommits {
    const all = allCommits(large);
    return { commits: all.slice(skip, skip + PAGE), more: skip + PAGE < all.length };
}

/** Every commit of the graph, without their files, as the backend lists them. */
export function allCommits(large: boolean): Commit[] {
    return fixtureCommits(large).map(({ files: _files, ...commit }) => commit);
}

export function commitFiles(large: boolean, commit: CommitRequest): CommitFiles {
    const files = (find(large, commit)?.files ?? []).map(({ diff: _diff, ...f }) => f);
    // as the backend: a list past 10,000 files is cut, and says so
    return { files, truncated: files.length >= LARGE_COMMIT_FILES };
}

export function commitFileDiff(large: boolean, request: CommitFileDiffRequest): UnifiedDiff {
    const match = find(large, request.commit)?.files.find((f) => f.path === request.path);
    return { text: match?.diff ?? '', truncated: false };
}

/** A week of lines committed, oldest day first, `[added, removed]` per commit of the day. */
const WEEKS = {
    busy: [
        [[120, 30]],
        [],
        [
            [1800, 240],
            [600, 60],
        ],
        [[40, 900]],
        [],
        [[310, 80]],
        [[54, 27]],
    ],
    large: [
        [[24_000, 3_100]],
        [[9_200, 11_400]],
        [],
        [[48_000, 900]],
        [[1_200, 300]],
        [],
        [[700, 90]],
    ],
    quiet: [[], [[12, 3]], [], [], [[40, 8]], [], []],
} as const;

/**
 * The commits made since `since`, newest first, as the backend lists them: `busy` for the
 * scenario's repository, `large` for the large scenario's, `quiet` for a clean project; `none`
 * has made no commit this week.
 */
export function commitActivity(week: keyof typeof WEEKS | 'none', since: number): CommitActivity {
    if (week === 'none') return { commits: [], more: false };
    const commits = WEEKS[week].flatMap((day, index) =>
        day.map(([additions, deletions], n) => {
            const start = new Date(since * 1000);
            const noon = new Date(
                start.getFullYear(),
                start.getMonth(),
                start.getDate() + index,
                12 + n,
            );
            return { time: noon.getTime() / 1000, additions, deletions };
        }),
    );
    return { commits: commits.reverse(), more: false };
}

/** The branches to switch to: the review's, with remote ones no local branch tracks. */
export function fixtureBranches(large: boolean): Branch[] {
    if (large) {
        return [
            { name: LARGE_BRANCH, remote: false, current: true },
            { name: 'main', remote: false, current: false },
        ];
    }
    return [
        { name: REVIEW_BRANCH, remote: false, current: true },
        { name: 'main', remote: false, current: false },
        { name: 'feature/logo', remote: false, current: false },
        { name: 'origin/fix-login', remote: true, current: false },
        { name: 'origin/release/1.2', remote: true, current: false },
    ];
}
