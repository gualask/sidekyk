import type { UnifiedDiff } from '@/modules/repository';

/** Lines of context around a change, as git's default. */
const CONTEXT = 3;

/** A change to a file: at line `at` of the old file (from 0), `del` lines go and `add` come. */
interface Change {
    at: number;
    del: number;
    add: readonly string[];
}

/** A file the fixtures change in several places, far apart: its diffs, and their counts. */
export interface LongFile {
    diff: UnifiedDiff;
    whole: UnifiedDiff;
    additions: number;
    deletions: number;
}

/**
 * A plausible module of `blocks` small functions, six lines each: what the long fixtures change.
 * Every line differs, so a search or a diff finds each one.
 */
function moduleLines(name: string, blocks: number): string[] {
    const lines = [
        `// ${name}: steps an order goes through`,
        `import type { Order } from './order';`,
        '',
    ];
    for (let n = 1; n <= blocks; n++) {
        lines.push(
            `export function step${n}(order: Order): Order {`,
            `    const next = { ...order, step: ${n} };`,
            `    if (next.items.length === 0) return next;`,
            `    return validate(next, '${name}-${n}');`,
            '}',
            '',
        );
    }
    return lines;
}

/** One `@@` hunk's text: its header, then its lines. */
function hunkText(
    oldStart: number,
    oldCount: number,
    newStart: number,
    newCount: number,
    body: string[],
) {
    const range = (start: number, count: number) => `${count === 0 ? start - 1 : start},${count}`;
    return [`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`, ...body];
}

/**
 * The diff of `old` with `changes` (in order, apart), as `git diff -U3` writes it, and the whole
 * file as one hunk, as the backend answers a `wholeFile` request.
 */
function longFile(path: string, old: readonly string[], changes: readonly Change[]): LongFile {
    // the new file's lines, each marked as git would, and where each change starts in them
    const marked: { sign: ' ' | '-' | '+'; text: string }[] = [];
    let at = 0;
    for (const change of changes) {
        for (; at < change.at; at++) marked.push({ sign: ' ', text: old[at] });
        for (let i = 0; i < change.del; i++, at++) marked.push({ sign: '-', text: old[at] });
        for (const text of change.add) marked.push({ sign: '+', text });
    }
    for (; at < old.length; at++) marked.push({ sign: ' ', text: old[at] });

    // hunks: the changed lines with their context, merged where the contexts touch
    const changed = marked.flatMap((line, index) => (line.sign === ' ' ? [] : [index]));
    const spans: [number, number][] = [];
    for (const index of changed) {
        const first = Math.max(0, index - CONTEXT);
        const last = Math.min(marked.length - 1, index + CONTEXT);
        const span = spans.at(-1);
        if (span && first <= span[1] + 1) span[1] = last;
        else spans.push([first, last]);
    }
    const head = [
        `diff --git a/${path} b/${path}`,
        'index 4e1f0a2..8c3d9b7 100644',
        `--- a/${path}`,
        `+++ b/${path}`,
    ];
    const body: string[] = [];
    for (const [first, last] of spans) {
        const before = marked.slice(0, first);
        const lines = marked.slice(first, last + 1);
        const oldStart = before.filter((l) => l.sign !== '+').length + 1;
        const newStart = before.filter((l) => l.sign !== '-').length + 1;
        body.push(
            ...hunkText(
                oldStart,
                lines.filter((l) => l.sign !== '+').length,
                newStart,
                lines.filter((l) => l.sign !== '-').length,
                lines.map((l) => `${l.sign}${l.text}`),
            ),
        );
    }
    const oldCount = marked.filter((l) => l.sign !== '+').length;
    const newCount = marked.filter((l) => l.sign !== '-').length;
    const whole = [
        ...head,
        ...hunkText(
            1,
            oldCount,
            1,
            newCount,
            marked.map((l) => `${l.sign}${l.text}`),
        ),
    ];
    return {
        diff: { text: `${[...head, ...body].join('\n')}\n`, truncated: false },
        whole: { text: `${whole.join('\n')}\n`, truncated: false },
        additions: marked.filter((l) => l.sign === '+').length,
        deletions: marked.filter((l) => l.sign === '-').length,
    };
}

/** About 420 lines, changed in six places from top to bottom: added, removed, both, a long block. */
export const CHECKOUT_TS = longFile('src/cart/checkout.ts', moduleLines('checkout', 70), [
    {
        at: 18,
        del: 0,
        add: [
            '    // a coupon applies before the shipping is added',
            '    const priced = applyCoupon(next);',
        ],
    },
    { at: 95, del: 1, add: ["    return validate(next, 'checkout-16', { strict: true });"] },
    { at: 160, del: 3, add: [] },
    {
        at: 230,
        del: 0,
        add: [
            'export function retryPayment(order: Order, attempts = 3): Order {',
            '    let next = order;',
            '    for (let attempt = 1; attempt <= attempts; attempt++) {',
            '        next = charge(next);',
            "        if (next.payment === 'paid') return next;",
            '        wait(attempt * 500);',
            '    }',
            "    return { ...next, payment: 'failed' };",
            '}',
            '',
            '// the cart is kept for a day after a failed payment',
            'export const KEEP_FAILED_CART_MS = 24 * 60 * 60 * 1000;',
        ],
    },
    {
        at: 330,
        del: 2,
        add: [
            '    if (next.items.length === 0) {',
            "        log('empty order skipped', next.id);",
            '        return next;',
            '    }',
        ],
    },
    { at: 412, del: 0, add: ['export { retryPayment as retry };'] },
]);

/** About 260 lines: a long block added in the middle, another removed near the end. */
export const ORDERS_TS = longFile('src/api/orders.ts', moduleLines('orders', 43), [
    {
        at: 120,
        del: 0,
        add: Array.from({ length: 30 }, (_, i) =>
            i % 6 === 0
                ? `export async function fetchPage${i / 6 + 1}(cursor: string): Promise<Order[]> {`
                : i % 6 === 5
                  ? '}'
                  : `    const page${i} = await api.get('/orders', { cursor, limit: ${10 * i} });`,
        ),
    },
    { at: 220, del: 15, add: [] },
]);
