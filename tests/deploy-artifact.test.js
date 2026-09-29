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

    const auditStep = workflow.match(/      - name: Security Audit[\s\S]*?(?=\n      - name:)/)?.[0] || '';
    // Admite un npm fijado por version (npx -y npm@11): el npm 10 de Node 22 usa el
    // endpoint "quick audit" ya retirado por el registro. Lo que se protege son los
    // flags, no el ejecutable.
    expect(auditStep).toMatch(/npm(@\d+)?\s+audit --omit=dev --audit-level=high/);
    expect(auditStep).not.toContain('continue-on-error: true');
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

  // 29/09/2026: `actions/upload-pages-artifact` excluye por defecto todo lo que empieza por
  // punto (`--exclude=.[^/]*`). El `test -f _site/.well-known/...` previo pasaba porque mira
  // el directorio ANTES de empaquetar, pero el tar subido a Pages no llevaba el fichero y
  // https://luzfija.es/.well-known/assetlinks.json respondia 404. Sin el flag y sin el guard
  // sobre el tar real, ese fallo vuelve a ser invisible para el CI.
  it('empaqueta .well-known en el artefacto que se sube y lo comprueba sobre el tar real', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const uploadStep = workflow.match(/      - name: Upload artifact[\s\S]*?(?=\n      - name:|\n  deploy_pages:)/)?.[0] || '';

    expect(uploadStep).toContain('actions/upload-pages-artifact@');
    expect(uploadStep).toMatch(/include-hidden-files:\s*true/);

    const guardStep = workflow.match(/      - name: Verificar que el artefacto empaquetado conserva \.well-known[\s\S]*?(?=\n  deploy_pages:)/)?.[0] || '';
    expect(guardStep).toContain('$RUNNER_TEMP/artifact.tar');
    expect(guardStep).toContain('assetlinks');
    expect(guardStep).toContain('exit 1');
    // El guard debe ir despues de la subida y antes del job de despliegue.
    expect(workflow.indexOf(uploadStep)).toBeLessThan(workflow.indexOf(guardStep));
    expect(workflow.indexOf(guardStep)).toBeLessThan(workflow.indexOf('  deploy_pages:'));
  });

  it('no conserva el prompt historico de validacion', () => {
    expect(fs.existsSync(path.join(ROOT, 'PROMPT-VALIDACION-CLAUDE.md'))).toBe(false);
  });
});
