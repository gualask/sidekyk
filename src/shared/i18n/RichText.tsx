import { Fragment, type ReactNode } from 'react';

/**
 * A message whose placeholders are elements, such as code or a key cap: `t` gives it unfilled,
 * `parts` fills it.
 */
export function RichText({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
    const nodes: ReactNode[] = [];
    let at = 0;
    for (const match of text.matchAll(/\{(\w+)\}/g)) {
        if (match.index > at) nodes.push(text.slice(at, match.index));
        const name = match[1];
        nodes.push(<Fragment key={`${name}@${match.index}`}>{parts[name] ?? match[0]}</Fragment>);
        at = match.index + match[0].length;
    }
    if (at < text.length) nodes.push(text.slice(at));
    return nodes;
}
