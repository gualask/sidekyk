import type { SyntaxTone } from '../model/repository.types';

/** The class of each tone's color (literal names, for Tailwind). */
export const TONE_CLASS: Record<SyntaxTone, string> = {
    comment: 'text-ui-syntax-comment',
    string: 'text-ui-syntax-string',
    escape: 'text-ui-syntax-escape',
    literal: 'text-ui-syntax-literal',
    constant: 'text-ui-syntax-constant',
    keyword: 'text-ui-syntax-keyword',
    operator: 'text-ui-syntax-operator',
    function: 'text-ui-syntax-function',
    type: 'text-ui-syntax-type',
    tag: 'text-ui-syntax-tag',
    attribute: 'text-ui-syntax-attribute',
    property: 'text-ui-syntax-property',
    parameter: 'text-ui-syntax-parameter',
    title: 'text-ui-syntax-title',
    link: 'text-ui-syntax-link',
    inserted: 'text-ui-syntax-inserted',
    deleted: 'text-ui-syntax-deleted',
};
