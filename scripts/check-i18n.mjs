#!/usr/bin/env node

// The UI's catalogs (`src/shared/i18n/messages`) against English and the code: every catalog has
// English's keys and placeholders, every key is used, no key is built at runtime (a key the code
// builds cannot be seen as used, nor its removal as dead).

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseSync } from 'vite';

const ROOT_DIR = process.cwd();
const MESSAGES_DIR = path.join(ROOT_DIR, 'src/shared/i18n/messages');
const SOURCE_DIR = path.join(ROOT_DIR, 'src');
const BASE_LOCALE = 'en';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const TRANSLATE_CALLS = new Set(['t', 'tp']);

function relativePath(filePath) {
    return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

async function readCatalogs() {
    const entries = await fs.readdir(MESSAGES_DIR, { withFileTypes: true });
    const catalogs = new Map();
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const text = await fs.readFile(path.join(MESSAGES_DIR, entry.name), 'utf8');
        catalogs.set(path.basename(entry.name, '.json'), JSON.parse(text));
    }
    return catalogs;
}

function placeholders(message) {
    return [...String(message).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

/** Source files the app runs: tests and fixtures may name keys without keeping them alive. */
async function collectSourceFiles(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory() && relativePath(entryPath) !== 'src/infrastructure/fixtures') {
            files.push(...(await collectSourceFiles(entryPath)));
        } else if (
            !entry.isDirectory() &&
            SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
            !/\.test\.tsx?$/.test(entry.name)
        ) {
            files.push(entryPath);
        }
    }
    return files;
}

function isTranslateCall(node) {
    if (node.type !== 'CallExpression') return false;
    const callee = node.callee;
    if (callee.type === 'Identifier') return TRANSLATE_CALLS.has(callee.name);
    return (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        TRANSLATE_CALLS.has(callee.property.name)
    );
}

function walk(node, ancestors, visit) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    visit(node, ancestors);
    ancestors.push(node);
    for (const [key, child] of Object.entries(node)) {
        if (key === 'loc' || key === 'range') continue;
        for (const item of Array.isArray(child) ? child : [child]) walk(item, ancestors, visit);
    }
    ancestors.pop();
}

function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/** Every string the code holds that is a key, or a plural's base; template keys passed to `t`. */
async function scanSources(keys) {
    const pluralKeys = pluralKeysByBase(keys);
    const used = new Set();
    const mark = (value) => {
        if (keys.has(value)) used.add(value);
        for (const key of pluralKeys.get(value) ?? []) used.add(key);
    };
    const dynamic = [];

    for (const file of await collectSourceFiles(SOURCE_DIR)) {
        const text = await fs.readFile(file, 'utf8');
        walk(parseSource(file, text), [], (node, ancestors) => {
            const value = staticString(node, ancestors);
            if (value !== undefined) {
                mark(value);
            } else if (isBuiltKey(node, ancestors)) {
                const source = text.slice(node.start, node.end).replaceAll('\n', ' ');
                dynamic.push(`${relativePath(file)}:${lineAt(text, node.start)} ${source}`);
            }
        });
    }
    return { unused: [...keys].filter((key) => !used.has(key)).sort(), dynamic };
}

/** The keys of each plural (`<base>.one`, `<base>.other`) by its base. */
function pluralKeysByBase(keys) {
    const pluralKeys = new Map();
    for (const key of keys) {
        const base = key.match(/^(.*)\.(one|other)$/)?.[1];
        if (base) pluralKeys.set(base, [...(pluralKeys.get(base) ?? []), key]);
    }
    return pluralKeys;
}

/** A source file's program; a file that does not parse stops the check. */
function parseSource(file, text) {
    const lang = path.extname(file) === '.tsx' ? 'tsx' : 'ts';
    const result = parseSync(file, text, { astType: 'ts', lang, sourceType: 'module' });
    if (result.errors.length > 0) {
        throw new Error(`${relativePath(file)}: ${result.errors.map((e) => e.message).join('\n')}`);
    }
    return result.program;
}

/** The string a literal or a template without expressions holds; a literal type names no key. */
function staticString(node, ancestors) {
    if (node.type === 'Literal' && typeof node.value === 'string') {
        return ancestors.at(-1)?.type === 'TSLiteralType' ? undefined : node.value;
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis[0].value.cooked;
    }
    return undefined;
}

/** A template with expressions given as the key of a `t` or `tp` call: a key built at runtime. */
function isBuiltKey(node, ancestors) {
    if (node.type !== 'TemplateLiteral' || node.expressions.length === 0) return false;
    const call = ancestors.findLast(isTranslateCall);
    const key = call?.arguments[0];
    return key !== undefined && key.start <= node.start && node.end <= key.end;
}

function report(title, lines) {
    if (lines.length === 0) return 0;
    console.error(`\n${title}`);
    for (const line of lines) console.error(`  - ${line}`);
    return lines.length;
}

async function main() {
    const catalogs = await readCatalogs();
    const base = catalogs.get(BASE_LOCALE);
    if (!base) throw new Error(`no ${BASE_LOCALE}.json in ${relativePath(MESSAGES_DIR)}`);
    const baseKeys = Object.keys(base);
    let problems = 0;

    for (const [locale, messages] of catalogs) {
        if (locale !== BASE_LOCALE) problems += reportCatalog(locale, messages, base);
    }

    const { unused, dynamic } = await scanSources(new Set(baseKeys));
    problems += report('Keys no code uses', unused);
    problems += report('Keys built at runtime: name each key whole', dynamic);

    if (problems > 0) {
        process.exitCode = 1;
        return;
    }
    console.log(`i18n ok: ${catalogs.size} languages, ${baseKeys.length} keys, none unused.`);
}

/** A catalog against English's: its keys missing and extra, its placeholders unlike; how many. */
function reportCatalog(locale, messages, base) {
    const baseKeys = Object.keys(base);
    const keys = new Set(Object.keys(messages));
    let problems = report(
        `Missing in ${locale}`,
        baseKeys.filter((key) => !keys.has(key)),
    );
    problems += report(
        `Not in ${BASE_LOCALE}, extra in ${locale}`,
        [...keys].filter((key) => !(key in base)),
    );
    problems += report(
        `Placeholders of ${locale} unlike ${BASE_LOCALE}'s`,
        baseKeys
            .filter((key) => keys.has(key))
            .filter((key) => placeholders(base[key]).join() !== placeholders(messages[key]).join())
            .map((key) => `${key}: {${placeholders(messages[key]).join('}, {')}}`),
    );
    return problems;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
