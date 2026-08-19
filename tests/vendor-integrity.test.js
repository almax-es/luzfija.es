/**
 * @vitest-environment node
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const VENDOR_ROOT = path.join(REPO_ROOT, 'vendor');
const README_PATH = path.join(VENDOR_ROOT, 'README.md');

describe('Vendor integrity', () => {
  it('mantiene los SHA-256 documentados alineados con los ficheros autoalojados', () => {
    const readme = fs.readFileSync(README_PATH, 'utf8');
    const documentedHashes = [...readme.matchAll(/\*\*SHA-256:\*\* `([a-f0-9]{64})`/g)];
    const entries = [...readme.matchAll(/- `([^`\r\n]+)`[^\r\n]*\r?\n\s+- \*\*SHA-256:\*\* `([a-f0-9]{64})`/g)]
      .map((match) => ({ relativePath: match[1], expectedHash: match[2] }));

    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toHaveLength(documentedHashes.length);
    expect(new Set(entries.map((entry) => entry.relativePath)).size).toBe(entries.length);

    const failures = [];
    for (const entry of entries) {
      const resolved = path.resolve(VENDOR_ROOT, entry.relativePath);
      if (!resolved.startsWith(`${VENDOR_ROOT}${path.sep}`)) {
        failures.push(`${entry.relativePath}: ruta fuera de vendor/`);
        continue;
      }
      if (!fs.existsSync(resolved)) {
        failures.push(`${entry.relativePath}: fichero inexistente`);
        continue;
      }

      const actualHash = createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
      if (actualHash !== entry.expectedHash) {
        failures.push(`${entry.relativePath}: esperado ${entry.expectedHash}, obtenido ${actualHash}`);
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
