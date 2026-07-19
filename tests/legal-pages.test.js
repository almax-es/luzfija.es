/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import {
  getTodayMadridYmd,
  isSignificantlyDirty,
  parseSpanishLongDate,
  resolvePageDate
} from '../scripts/seo-date-logic.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');
const PRIVACY_REL_PATH = 'privacidad.html';
const PRIVACY_ABS_PATH = path.join(REPO_ROOT, PRIVACY_REL_PATH);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getExpectedDate(relPath) {
  try {
    const status = String(
      execFileSync('git', ['status', '--porcelain', '--', relPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    ).trim();
    const normalizedRelPath = relPath.split(path.sep).join('/');
    const committed = status
      ? String(execFileSync('git', ['show', `HEAD:${normalizedRelPath}`], { cwd: REPO_ROOT, encoding: 'utf8' }))
      : '';
    const current = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    return resolvePageDate({
      dirty: isSignificantlyDirty({ status, currentContent: current, committedContent: committed }),
      content: current,
      today: getTodayMadridYmd(),
      gitLastModifiedDate: ''
    });
  } catch {
    return getTodayMadridYmd();
  }
}

describe('Legal pages', () => {
  it('keeps privacy accordion sections flat and top-level', () => {
    const html = fs.readFileSync(PRIVACY_ABS_PATH, 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;

    expect(document.querySelectorAll('details details')).toHaveLength(0);

    const summaries = [...document.querySelectorAll('.accordion > .accordion-item > summary')]
      .map((el) => normalizeWhitespace(el.textContent));

    expect(summaries).toContain('Responsable del tratamiento');
  });

  it('keeps the visible privacy update date aligned with the file revision date', () => {
    const html = fs.readFileSync(PRIVACY_ABS_PATH, 'utf8');
    const match = html.match(/Última actualización:\s*([^<]+)/i);

    expect(match).toBeTruthy();
    expect(parseSpanishLongDate(match[1])).toBe(getExpectedDate(PRIVACY_REL_PATH));
  });
});
