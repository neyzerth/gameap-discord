#!/usr/bin/env node
// Documentation guard for a bilingual repo: English is the primary language in
// docs/, Spanish is the mirror in docs/es/. Catches the three failure modes that
// silently rot translated docs: a missing counterpart, a broken relative link or
// anchor, and a diagram that only exists in one language.
//
//   npm run check:docs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EN_DIR = join(ROOT, 'docs');
const ES_DIR = join(ROOT, 'docs', 'es');
const problems = [];
const notes = [];

const read = (p) => readFileSync(p, 'utf8');
const md = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const fenceCount = (text, lang) => (text.match(new RegExp('^```' + lang, 'gm')) ?? []).length;

// GitHub's heading slug: strip markdown/inline code/punctuation, lowercase,
// spaces to hyphens. Accents are kept on purpose (the existing ES anchors rely on it).
function slug(heading) {
  return heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|\*|_/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function headings(file) {
  return read(file)
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => slug(l.replace(/^#{1,6}\s+/, '')));
}

function checkLinks(file) {
  const text = read(file);
  const dir = dirname(file);
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    let file2 = file;
    if (path) {
      const resolved = resolve(dir, path);
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        problems.push(`${relative(ROOT, file)}: link to a missing file -> ${target}`);
        continue;
      }
      file2 = resolved;
    }
    if (anchor) {
      const want = decodeURIComponent(anchor).toLowerCase();
      if (!headings(file2).includes(want)) {
        problems.push(`${relative(ROOT, file)}: dead anchor -> ${target}`);
      }
    }
  }
}

function checkSwitcher(file, expected) {
  const first = read(file).split('\n')[0].trim();
  if (first !== expected) {
    problems.push(`${relative(ROOT, file)}: first line must be exactly "${expected}" (found "${first}")`);
  }
}

// Internal details that must not reach the public repo.
//
// The strings depend on your machine (guild ids, host paths, real server
// aliases, usernames), so they live in a gitignored file — one regular
// expression per line, '#' starts a comment, matching is case-insensitive —
// and NOT in this script: a checker that ships the very secrets it protects is
// worse than no checker at all.
//
//   cp .docs-leaks.example .docs-leaks   # then list your own patterns
//
// Without that file the leak check is skipped (and reported as skipped).
const LEAKS_FILE = process.env.DOCS_LEAKS_FILE ?? join(ROOT, '.docs-leaks');

const LEAKS = existsSync(LEAKS_FILE)
  ? read(LEAKS_FILE)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => new RegExp(line, 'i'))
  : null;

function checkLeaks(files) {
  if (!LEAKS) return;
  for (const file of files) {
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      // The pattern itself is never printed: it is machine-specific data.
      if (LEAKS.some((re) => re.test(line))) {
        problems.push(`${relative(ROOT, file)}:${i + 1}: matches a pattern in .docs-leaks`);
      }
    });
  }
}

// ---- language parity -------------------------------------------------------

const en = md(EN_DIR);
const es = md(ES_DIR);
for (const f of en) if (!es.includes(f)) problems.push(`docs/${f} has no Spanish mirror (docs/es/${f})`);
for (const f of es) if (!en.includes(f)) problems.push(`docs/es/${f} has no English file (docs/${f})`);
notes.push(`docs/: ${en.length} files · docs/es/: ${es.length} files`);

// Docs must stay structurally parallel: a dropped section or table row in one
// language is the main way a translation silently loses information.
const countHeadings = (t) => (t.match(/^#{1,6}\s/gm) ?? []).length;
const countRows = (t) => (t.match(/^\|/gm) ?? []).length;

for (const f of en) {
  const a = read(join(EN_DIR, f));
  const b = existsSync(join(ES_DIR, f)) ? read(join(ES_DIR, f)) : '';
  if (countHeadings(a) !== countHeadings(b)) {
    problems.push(`docs/${f}: heading count differs en=${countHeadings(a)} es=${countHeadings(b)}`);
  }
  if (countRows(a) !== countRows(b)) {
    notes.push(`docs/${f}: table rows en=${countRows(a)} es=${countRows(b)} (review manually)`);
  }
  for (const lang of ['mermaid', 'json', 'bash']) {
    const [ca, cb] = [fenceCount(a, lang), fenceCount(b, lang)];
    if (ca !== cb) notes.push(`docs/${f}: ${lang} blocks en=${ca} es=${cb} (review manually)`);
  }
}

// ---- switchers, links, leaks ----------------------------------------------

checkSwitcher(join(ROOT, 'README.md'), '**English** · [Español](README.es.md)');
checkSwitcher(join(ROOT, 'README.es.md'), '[English](README.md) · **Español**');
for (const f of en) {
  checkSwitcher(join(EN_DIR, f), `**English** · [Español](es/${f})`);
  if (es.includes(f)) checkSwitcher(join(ES_DIR, f), `[English](../${f}) · **Español**`);
}

const all = [
  join(ROOT, 'README.md'),
  join(ROOT, 'README.es.md'),
  ...en.map((f) => join(EN_DIR, f)),
  ...es.map((f) => join(ES_DIR, f)),
  ...['servers.example.json', 'guilds.example.json', 'power.example.json'].map((f) => join(ROOT, 'config', f)),
].filter(existsSync);

all.forEach(checkLinks);

// Leak check also covers the code: /help examples and test fixtures live there.
const codeFiles = [
  ...readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => join(ROOT, 'src', f)),
  ...readdirSync(join(ROOT, 'src', 'commands')).map((f) => join(ROOT, 'src', 'commands', f)),
];
checkLeaks([...all, ...codeFiles]);

// ---- report ----------------------------------------------------------------

if (!LEAKS) {
  notes.push(`leak check skipped: no ${relative(ROOT, LEAKS_FILE)} (see .docs-leaks.example)`);
}

for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nok: ${all.length} files checked (links, anchors, switchers, language parity)`);
