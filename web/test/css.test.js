// The CSS standard for this app's own stylesheet: tokens only, no dark-mode media query, no forced priority, no italics, breakpoints
// 600 and 900 only, no inline styles except run-time values, and the shared stylesheet loads first.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const css = read('styles.css');

describe('app CSS follows the CSS standard', () => {
  it('has no colour literal, no prefers-color-scheme, no !important, no italics', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/!important/);
    expect(css).not.toMatch(/font-style:\s*italic/);
  });

  it('uses only the 600px and 900px breakpoints', () => {
    const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w === '600' || w === '900')).toBe(true);
  });

  it('loads the shared stylesheet before the app stylesheet', () => {
    const main = read('main.jsx');
    expect(main.indexOf('standalone-ui.css')).toBeGreaterThan(-1);
    expect(main.indexOf('standalone-ui.css')).toBeLessThan(main.indexOf("'./styles.css'"));
  });

  it('writes no style attribute in the components, except the diagram edge label position (a run-time value)', () => {
    expect(read('App.jsx')).not.toMatch(/style=\{\{/);
    const lines = read('Diagram.jsx').split('\n').filter((l) => /style=\{\{/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/transform/);
  });

  it('never uses the disabled attribute on a button (aria-disabled keeps focus)', () => {
    for (const f of ['App.jsx', 'Diagram.jsx']) expect(read(f)).not.toMatch(/(?<!aria-)\bdisabled=\{/);
  });
});
