// The demo's flow diagram is a diagram-studio/1 data file in server/data/diagrams. It is read and validated once, at startup,
// against the vendored studio validator (vendor/diagram-validate.js, byte-identical to the studio copy apart from its header),
// and served from memory by name. No request value reaches the file system.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDiagram } from './vendor/diagram-validate.js';

export const DIAGRAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/diagrams');
export const DIAGRAM_IDS = Object.freeze(['progressive-trust-ladder']);

export function loadDiagrams(dir = DIAGRAM_DIR) {
  const out = new Map();
  for (const id of DIAGRAM_IDS) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    const problems = validateDiagram(d);
    if (problems.length) throw new Error(`diagram ${id} is invalid: ${problems.join('; ')}`);
    if (d.id !== id) throw new Error(`diagram file ${id} carries id ${d.id}`);
    out.set(id, Object.freeze(d));
  }
  return out;
}
