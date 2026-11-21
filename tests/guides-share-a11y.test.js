/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const GUIDE_DIR = path.join(ROOT, 'guias');
const SHARE_START = '/* Compartir (global para onclick) */';
const GUIDE = 'autoconsumo-y-placas-solares-lo-basico.html';

function affectedGuides() {
  return fs.readdirSync(GUIDE_DIR)
    .filter((file) => file.endsWith('.html') && file !== 'index.html')
    .sort();
}

function guideScript(file) {
  const html = fs.readFileSync(path.join(GUIDE_DIR, file), 'utf8');
  const start = html.indexOf('/* Progreso de lectura + TOC */');
  const end = html.indexOf('</script>', start);
  return html.slice(start, end);
}

function setupCopy() {
  document.body.innerHTML = '<a id="copy" href="#" class="share-btn" onclick="return share(\'copy\')">Copiar</a>';
  const code = guideScript(GUIDE);
  const share = new Function(code.slice(code.indexOf(SHARE_START)) + '\nreturn share;')();
  const trigger = document.getElementById('copy');
  trigger.focus();
  return { share, trigger };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  delete document.execCommand;
});

describe('guías: accesibilidad del fallback Copiar', () => {
  it('las 25 guías comparten el script y conservan la navegación nativa del índice', () => {
    const files = affectedGuides();
    expect(files).toHaveLength(25);
    const reference = guideScript(GUIDE);
    const index = reference.slice(0, reference.indexOf(SHARE_START));
    expect(index).toContain("a.href = '#' + heading.id");
    expect(index).not.toMatch(/preventDefault|scrollIntoView/);

    files.forEach((file) => {
      expect(guideScript(file), file).toBe(reference);
      const html = fs.readFileSync(path.join(GUIDE_DIR, file), 'utf8');
      expect(html, file).toContain('@media (prefers-reduced-motion: no-preference){html.guide-toc-jump{scroll-behavior:smooth}}');
    });
  });

  it('el fallback representativo restaura foco y crea una confirmación status', () => {
    vi.useFakeTimers();
    document.execCommand = vi.fn(() => true);
    const { share, trigger } = setupCopy();

    share('copy');

    expect(document.activeElement).toBe(trigger);
    const notice = Array.from(document.querySelectorAll('[role="status"]'))
      .find((el) => el.textContent === '¡Link copiado! 📋');
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('aria-atomic')).toBe('true');
  });

  it.each(['false', 'excepción', 'permiso denegado'])('ofrece una copia manual cuando falla: %s', async (failure) => {
    const { share, trigger } = setupCopy();
    document.execCommand = vi.fn(() => {
      if (failure === 'excepción') throw new Error('Copy unavailable');
      return false;
    });
    let writeText;
    if (failure === 'permiso denegado') {
      writeText = vi.fn().mockRejectedValue(new DOMException('Bloqueado', 'NotAllowedError'));
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      vi.stubGlobal('isSecureContext', true);
    }

    share('copy');
    await Promise.resolve();

    if (writeText) expect(writeText).toHaveBeenCalledWith(location.href);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.textContent).not.toContain('¡Link copiado!');
    const panel = document.querySelector('.guide-copy-fallback');
    const field = panel.querySelector('input');
    expect(panel.querySelector('[role="status"]').textContent).toContain('No se ha podido copiar');
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(location.href);
    expect(document.activeElement).toBe(field);
    expect(field.selectionEnd).toBe(field.value.length);

    if (failure === 'false') panel.querySelector('button').click();
    else field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
