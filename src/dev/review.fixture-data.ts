import type {
    ChangedFile,
    ChangesIgnoringWhitespace,
    RepositorySnapshot,
    UnifiedDiff,
} from '@/modules/repository';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { fixtureSummary } from './fixture-summary';
import { CHECKOUT_TS, type LongFile, ORDERS_TS } from './long.fixture-data';
import { localProject } from './projects.fixture';
import { wholeFileDiff } from './whole-file.fixture';

export const FIXTURE_REPOSITORY: ProjectInfo = localProject('/Users/dev/Projects/shop', 'shop');

/** A Markdown file changed: its diff, and its preview from the working tree's text. */
const README_MD = `diff --git a/README.md b/README.md
index 5c1d2e3..8a9b0c4 100644
--- a/README.md
+++ b/README.md
@@ -2,6 +2,10 @@
 
 A small shop, for the fixtures.
 
+> [!TIP]
+> Coupons apply at checkout: see \`src/cart/coupon.ts\`.
+
 ## Run
 
     pnpm dev
`;

const TOTAL_TS = `diff --git a/src/cart/total.ts b/src/cart/total.ts
index 3f2a1c0..9b7e4d2 100644
--- a/src/cart/total.ts
+++ b/src/cart/total.ts
@@ -1,6 +1,7 @@
 import type { Cart } from './cart';
+import { applyCoupon } from './coupon';

 export function subtotal(cart: Cart): number {
     return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
 }

@@ -12,4 +13,5 @@ export function total(cart: Cart): number {
     const shipping = cart.items.length > 0 ? 4.9 : 0;
-    const discount = cart.coupon ? cart.coupon.amount : 0;
+    const discount = applyCoupon(cart);
+    // coupons never make the total negative
     return Math.max(0, subtotal(cart) + shipping - discount);
`;

const DISCOUNTS_TS = `diff --git a/src/legacy/discounts.ts b/src/legacy/discounts.ts
deleted file mode 100644
index 7c1d2e3..0000000
--- a/src/legacy/discounts.ts
+++ /dev/null
@@ -1,4 +0,0 @@
-// Superseded by coupon.ts
-export function legacyDiscount(total: number): number {
-    return total > 100 ? 10 : 0;
-}
`;

const COUPON_TS = `diff --git a/src/cart/coupon.ts b/src/cart/coupon.ts
new file mode 100644
index 0000000..5d3c9a1
--- /dev/null
+++ b/src/cart/coupon.ts
@@ -0,0 +1,6 @@
+import type { Cart } from './cart';
+
+export function applyCoupon(cart: Cart): number {
+    if (!cart.coupon || cart.coupon.expiresAt < Date.now()) return 0;
+    return cart.coupon.amount;
+}
`;

const MONEY_TS = `diff --git a/src/money.ts b/src/utils/money.ts
similarity index 80%
rename from src/money.ts
rename to src/utils/money.ts
index 1a2b3c4..4d5e6f7 100644
--- a/src/money.ts
+++ b/src/utils/money.ts
@@ -1,3 +1,3 @@
 export function formatMoney(value: number): string {
-    return '€' + value.toFixed(2);
+    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value);
 }
`;

const LOGO_PNG = `diff --git a/public/logo.png b/public/logo.png
new file mode 100644
index 0000000..e69de29
Binary files /dev/null and b/public/logo.png differ
`;

/** A new file too large for its lines to be counted. */
const SEED_SQL = `diff --git a/db/seed.sql b/db/seed.sql
new file mode 100644
index 0000000..3f2a9c1
--- /dev/null
+++ b/db/seed.sql
@@ -0,0 +1,3 @@
+INSERT INTO coupons (code, percent) VALUES ('WELCOME10', 10);
+INSERT INTO coupons (code, percent) VALUES ('SPRING15', 15);
+INSERT INTO coupons (code, percent) VALUES ('VIP25', 25);
`;

/** Saved with Windows line endings, nothing else changed: all of it formatting. */
const CART_TS = `diff --git a/src/cart/cart.ts b/src/cart/cart.ts
index 2b4c6d8..7e9f1a3 100644
--- a/src/cart/cart.ts
+++ b/src/cart/cart.ts
@@ -1,9 +1,9 @@
-export interface Item {
-    price: number;
-    quantity: number;
-}
-
-export interface Cart {
-    items: Item[];
-    coupon: { amount: number; expiresAt: number } | null;
-}
+export interface Item {\r
+    price: number;\r
+    quantity: number;\r
+}\r
+\r
+export interface Cart {\r
+    items: Item[];\r
+    coupon: { amount: number; expiresAt: number } | null;\r
+}\r
`;

/** Indented with tabs instead of spaces, and one real change among the lines. */
const SHIPPING_TS = `diff --git a/src/cart/shipping.ts b/src/cart/shipping.ts
index 4e1f2a3..b8c9d0e 100644
--- a/src/cart/shipping.ts
+++ b/src/cart/shipping.ts
@@ -1,6 +1,6 @@
 export function shippingCost(weight: number, country: string): number {
-    if (country === 'IT') {
-        return weight > 2 ? 9.9 : 4.9;
-    }
-    return weight > 2 ? 19.9 : 12.9;
+\tif (country === 'IT') {
+\t\treturn weight > 2 ? 9.9 : 4.9;
+\t}
+\treturn weight > 2 ? 24.9 : 12.9;
 }
`;

/** A file of the fixture, its diff, and the whole file when the fixture has it. */
type FixtureFile = ChangedFile & { diff: string; whole?: string };

/** A long file of the fixture, changed in several places, in an area. */
function longChange(path: string, area: 'unstaged' | 'staged', file: LongFile): FixtureFile {
    return {
        path,
        origPath: null,
        area,
        kind: 'modified',
        additions: file.additions,
        deletions: file.deletions,
        binary: false,
        diff: file.diff.text,
        whole: file.whole.text,
    };
}

const FILES: FixtureFile[] = [
    {
        path: 'src/cart/total.ts',
        origPath: null,
        area: 'unstaged',
        kind: 'modified',
        additions: 3,
        deletions: 1,
        binary: false,
        diff: TOTAL_TS,
    },
    longChange('src/cart/checkout.ts', 'unstaged', CHECKOUT_TS),
    {
        path: 'src/cart/shipping.ts',
        origPath: null,
        area: 'unstaged',
        kind: 'modified',
        additions: 4,
        deletions: 4,
        binary: false,
        diff: SHIPPING_TS,
    },
    {
        path: 'src/cart/cart.ts',
        origPath: null,
        area: 'unstaged',
        kind: 'modified',
        additions: 9,
        deletions: 9,
        binary: false,
        diff: CART_TS,
    },
    {
        path: 'README.md',
        origPath: null,
        area: 'unstaged',
        kind: 'modified',
        additions: 3,
        deletions: 0,
        binary: false,
        diff: README_MD,
    },
    {
        path: 'src/legacy/discounts.ts',
        origPath: null,
        area: 'unstaged',
        kind: 'deleted',
        additions: 0,
        deletions: 4,
        binary: false,
        diff: DISCOUNTS_TS,
    },
    {
        path: 'src/cart/coupon.ts',
        origPath: null,
        area: 'untracked',
        kind: 'untracked',
        additions: 6,
        deletions: 0,
        binary: false,
        diff: COUPON_TS,
    },
    {
        path: 'db/seed.sql',
        origPath: null,
        area: 'untracked',
        kind: 'untracked',
        additions: null,
        deletions: null,
        binary: false,
        diff: SEED_SQL,
    },
    longChange('src/api/orders.ts', 'staged', ORDERS_TS),
    {
        path: 'src/utils/money.ts',
        origPath: 'src/money.ts',
        area: 'staged',
        kind: 'renamed',
        additions: 1,
        deletions: 1,
        binary: false,
        diff: MONEY_TS,
    },
    {
        path: 'public/logo.png',
        origPath: null,
        area: 'staged',
        kind: 'added',
        additions: null,
        deletions: null,
        binary: true,
        diff: LOGO_PNG,
    },
];

export function reviewSnapshot(clean: boolean): RepositorySnapshot {
    const files = clean ? [] : FILES.map(({ diff: _diff, whole: _whole, ...file }) => file);
    const branch = {
        head: 'feature/coupons',
        commit: 'a1b2c3d',
        upstream: 'origin/feature/coupons',
        ahead: clean ? 0 : 2,
        behind: 0,
    };
    return { files, summary: fixtureSummary(branch, files) };
}

/** What `git diff -w` leaves of the fixture's formatting changes; any other file as it is. */
const IGNORING_WHITESPACE: Record<string, readonly [number, number] | null> = {
    'src/cart/shipping.ts': [1, 1],
    'src/cart/cart.ts': null,
};

/** The staged and unstaged changes of `files` with whitespace ignored, as the backend answers. */
export function fixtureIgnoringWhitespace(
    files: readonly ChangedFile[],
): ChangesIgnoringWhitespace {
    const lines = files.flatMap(({ path, area, additions, deletions }) => {
        if (area === 'untracked' || additions === null || deletions === null) return [];
        const left =
            path in IGNORING_WHITESPACE ? IGNORING_WHITESPACE[path] : [additions, deletions];
        return left ? [{ path, area, additions: left[0], deletions: left[1] }] : [];
    });
    return { files: lines, truncated: false };
}

/** A file's diff, or its whole file with its changes (`wholeFile`), as the backend answers. */
export function reviewDiff(
    file: Pick<ChangedFile, 'area' | 'path'> & { wholeFile: boolean },
): UnifiedDiff {
    const match = FILES.find((f) => f.area === file.area && f.path === file.path);
    const diff = { text: match?.diff ?? '', truncated: false };
    if (!file.wholeFile) return diff;
    return match?.whole ? { text: match.whole, truncated: false } : wholeFileDiff(diff);
}
