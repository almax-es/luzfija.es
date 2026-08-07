/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'tests.yml');

describe('Artefacto publico de GitHub Pages', () => {
  it('no publica documentacion interna ni ficheros de desarrollo', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain("--exclude='.*'");
    expect(workflow).toContain("--exclude='tests/'");
    expect(workflow).toContain("--exclude='scripts/'");
    expect(workflow).toContain("--exclude='*.md'");
    expect(workflow).toContain("--exclude='package.json'");
    expect(workflow).toContain("--exclude='package-lock.json'");
    expect(workflow).toContain('cp -a CONTENT-LICENSE.md _site/');
    expect(workflow).toContain("find _site -type f -name '*.md' ! -name 'CONTENT-LICENSE.md'");
    expect(workflow).toContain('test -f _site/index.html');
    expect(workflow).toContain('test -f _site/.well-known/assetlinks.json');
    expect(workflow).toMatch(/path:\s*['_"]_site['_"]/);
  });

  // La linea base de upstream y su parche golden existen para poder reaplicar los
  // parches locales de GoatCounter al actualizar. Son material interno: publicarlos
  // no romperia nada, pero serian bytes muertos y una copia confusa del sender real.
  it('no publica el material de referencia de vendor, pero si el sender real', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain("--exclude='vendor/goatcounter/count.upstream.js'");
    expect(workflow).toContain("--exclude='vendor/goatcounter/count.local.patch'");
    expect(workflow).toContain('_site/vendor/goatcounter/count.upstream.js');
    expect(workflow).toContain('_site/vendor/goatcounter/count.local.patch');
    expect(workflow).toContain('test -f _site/vendor/goatcounter/count.js');
  });

  it('no conserva el prompt historico de validacion', () => {
    expect(fs.existsSync(path.join(ROOT, 'PROMPT-VALIDACION-CLAUDE.md'))).toBe(false);
  });
});
