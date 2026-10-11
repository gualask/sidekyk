import type { ChangedFile, FileDiff, RepositoryInfo, RepositorySnapshot } from '@/modules/changes';

export const FIXTURE_REPOSITORY: RepositoryInfo = {
    root: '/Users/dev/Projects/shop',
    name: 'shop',
};

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

type FixtureFile = ChangedFile & { diff: string };

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
    const files = clean ? [] : FILES.map(({ diff: _diff, ...file }) => file);
    return {
        repository: FIXTURE_REPOSITORY,
        branch: {
            head: 'feature/coupons',
            commit: 'a1b2c3d',
            upstream: 'origin/feature/coupons',
            ahead: clean ? 0 : 2,
            behind: 0,
        },
        files,
        totals: clean
            ? { files: 0, additions: 0, deletions: 0 }
            : { files: 6, additions: 10, deletions: 6 },
    };
}

export function reviewDiff(file: Pick<ChangedFile, 'area' | 'path'>): FileDiff {
    const match = FILES.find((f) => f.area === file.area && f.path === file.path);
    return { path: file.path, area: file.area, text: match?.diff ?? '', truncated: false };
}
