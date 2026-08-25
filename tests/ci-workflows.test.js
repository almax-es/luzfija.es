import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('CI workflow hardening', () => {
  it('reintenta y hace fallar visiblemente el dispatch post-push de tests.yml', () => {
    const workflow = readRepoFile('.github/workflows/pvpc.yml');
    const marker = '- name: Trigger tests workflow for published data update';
    const start = workflow.indexOf(marker);
    const end = workflow.indexOf('\n      - name:', start + marker.length);
    const step = workflow.slice(start, end === -1 ? workflow.length : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(step).toContain('curl --fail-with-body -L');
    expect(step).toContain('--retry 3');
    expect(step).toContain('--retry-delay 5');
    expect(step).toContain('--retry-connrefused');
    expect(step).toContain('if ! curl');
    expect(step).toContain('::error::');
    expect(step).toContain('exit 1');
    expect(step).toContain('/actions/workflows/tests.yml/dispatches');
  });
  it('fija todas las actions de GitHub a SHAs completos con versión legible', () => {
    const workflows = [
      '.github/workflows/cnmc-commercializers.yml',
      '.github/workflows/pvpc.yml',
      '.github/workflows/tests.yml'
    ];
    const expectedPins = new Map([
      ['actions/checkout', ['d23441a48e516b6c34aea4fa41551a30e30af803', 'v6.1.0']],
      ['actions/setup-node', ['249970729cb0ef3589644e2896645e5dc5ba9c38', 'v6.5.0']],
      ['actions/setup-python', ['ece7cb06caefa5fff74198d8649806c4678c61a1', 'v6.3.0']],
      ['actions/configure-pages', ['45bfe0192ca1faeb007ade9deae92b16b8254a0d', 'v6.0.0']],
      ['actions/upload-pages-artifact', ['fc324d3547104276b827a68afc52ff2a11cc49c9', 'v5.0.0']],
      ['actions/deploy-pages', ['cd2ce8fcbc39b97be8ca5fce6e763baed58fa128', 'v5.0.0']]
    ]);

    for (const relativePath of workflows) {
      const workflow = readRepoFile(relativePath);
      const actionLines = workflow.split('\n').filter((line) => line.includes('uses: actions/'));
      expect(actionLines.length).toBeGreaterThan(0);

      for (const line of actionLines) {
        const match = line.match(/uses:\s+(actions\/[^@\s]+)@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)\s*$/);
        expect(match, `Referencia mutable o sin comentario de versión en ${relativePath}: ${line.trim()}`).not.toBeNull();
        const [, action, sha, version] = match;
        expect(expectedPins.get(action), `Action no inventariada en el guard: ${action}`).toEqual([sha, version]);
      }
    }
  });

  it('automatiza el censo mensualmente y solo publica altas pequeñas ya clasificadas', () => {
    const workflow = readRepoFile('.github/workflows/cnmc-commercializers.yml');
    const classifyAt = workflow.indexOf('- name: Classify census changes');
    const issueAt = workflow.indexOf('- name: Open or update manual review issue');
    const reviewAt = workflow.indexOf('- name: Stop changes that require manual review');
    const commitAt = workflow.indexOf('- name: Commit and push safe additive update');

    expect(workflow).toContain("cron: '23 7 1 * *'");
    expect(workflow).toContain('scripts/classify-cnmc-commercializers-update.mjs');
    expect(workflow).toContain("steps.classify.outputs.status == 'manual_review'");
    expect(workflow).toContain("steps.classify.outputs.status == 'safe_additive'");
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('gh issue create');
    expect(workflow).toContain('gh issue comment');
    expect(workflow).toContain('git add data/cnmc-commercializers.json');
    expect(workflow).toContain('/actions/workflows/tests.yml/dispatches');
    expect(classifyAt).toBeGreaterThanOrEqual(0);
    expect(issueAt).toBeGreaterThan(classifyAt);
    expect(reviewAt).toBeGreaterThan(classifyAt);
    expect(reviewAt).toBeGreaterThan(issueAt);
    expect(commitAt).toBeGreaterThan(reviewAt);
    expect(workflow).not.toMatch(/git add data\/(?:\s|$)/);
    expect(workflow).not.toContain('git add .');
  });

});
