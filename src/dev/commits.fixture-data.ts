import type {
    Commit,
    CommitFileDiffRequest,
    CommitFiles,
    CommitRequest,
    FileChange,
    RecentCommits,
    UnifiedDiff,
} from '@/modules/repository';

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
): FileChange & { diff: string } {
    return { path, origPath, kind, binary: false, ...counts, diff };
}

const REVIEW_COMMITS: FixtureCommit[] = [
    {
        sha: sha(6),
        parent: sha(5),
        merge: false,
        author: 'Claude',
        time: NOW - 25 * 60,
        subject: 'Apply coupons to the cart total',
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
        sha: sha(5),
        parent: sha(4),
        merge: false,
        author: 'Claude',
        time: NOW - 3 * HOUR,
        subject: 'Move formatMoney to utils',
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
        parent: sha(2),
        merge: true,
        author: 'Ada Lovelace',
        time: NOW - 26 * HOUR,
        subject: "Merge branch 'feature/logo'",
        files: [
            file(
                'public/logo.png',
                'added',
                `diff --git a/public/logo.png b/public/logo.png
new file mode 100644
Binary files /dev/null and b/public/logo.png differ
`,
                { additions: null, deletions: null, binary: true },
            ),
        ],
    },
    {
        sha: sha(2),
        parent: sha(1),
        merge: false,
        author: 'Ada Lovelace',
        time: NOW - 4 * 24 * HOUR,
        subject: 'Remove the legacy discounts, superseded by the coupons that the checkout applies',
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
        parent: null,
        merge: false,
        author: 'Ada Lovelace',
        time: NOW - 40 * 24 * HOUR,
        subject: 'Initial commit',
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

/** Enough commits for older ones to remain, and one so large its list is cut. */
const LARGE_COMMIT_COUNT = 50;
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
        parent: sha(999 - n),
        merge: false,
        author: 'Claude',
        time: NOW - n * 5 * HOUR,
        subject: n === 0 ? 'Regenerate every module' : `Refactor module ${n}`,
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

export function recentCommits(large: boolean): RecentCommits {
    const commits = fixtureCommits(large).map(({ files: _files, ...commit }) => commit);
    return { commits, more: large };
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
