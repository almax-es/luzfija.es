/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const REPO_ROOT = path.resolve(__dirname, '..');
const PRIVACY_REL_PATH = 'privacidad.html';
const PRIVACY_ABS_PATH = path.join(REPO_ROOT, PRIVACY_REL_PATH);

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getTodayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isDirtyPath(relPath) {
  try {
    return String(
      execFileSync('git', ['status', '--porcelain', '--', relPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    ).trim().length > 0;
  } catch {
    return false;
  }
}

function getGitLastModifiedDate(relPath) {
  try {
    return String(
      execFileSync('git', ['log', '-1', '--format=%cs', '--', relPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
    ).trim();
  } catch {
    return '';
  }
}

function getExpectedDate(relPath) {
  return isDirtyPath(relPath) ? getTodayDate() : getGitLastModifiedDate(relPath);
}

function parseSpanishLongDate(rawValue) {
  const value = normalizeWhitespace(rawValue).toLowerCase();
  const match = value.match(/^(\d{1,2})\s+de\s+([a-zñ]+)\s+de\s+(\d{4})$/i);
  if (!match) return '';

  const months = {
    enero: '01',
    febrero: '02',
    marzo: '03',
    abril: '04',
    mayo: '05',
    junio: '06',
    julio: '07',
    agosto: '08',
    septiembre: '09',
    setiembre: '09',
    octubre: '10',
    noviembre: '11',
    diciembre: '12'
  };

  const month = months[match[2]];
  if (!month) return '';

  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
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
