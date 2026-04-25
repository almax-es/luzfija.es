import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const tooltipCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-tooltips.js'), 'utf8');
const loadTooltips = new Function('window', 'document', tooltipCode);

describe('LF tooltips lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button class="tooltip" data-tip="Detalle">i</button>
      <div id="globalTooltip" aria-hidden="true"></div>
    `;

    window.LF = {
      el: {
        globalTooltip: document.getElementById('globalTooltip')
      }
    };

    window.requestAnimationFrame = (cb) => {
      cb();
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
    document.__LF_TT_GLOBAL_BOUND = false;
    loadTooltips(window, document);
  });

  it('drops the active tooltip when its source node is removed from the DOM', () => {
    const source = document.querySelector('.tooltip');
    source.getBoundingClientRect = () => ({
      top: 20,
      bottom: 40,
      left: 20,
      right: 40,
      width: 20,
      height: 20
    });
    window.LF.el.globalTooltip.getBoundingClientRect = () => ({
      width: 120,
      height: 30
    });

    window.LF.initTooltips();
    source.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(window.LF.el.globalTooltip.getAttribute('aria-hidden')).toBe('false');

    source.remove();
    source.getBoundingClientRect = () => {
      throw new Error('disconnected tooltip target should not be measured');
    };

    window.dispatchEvent(new Event('resize'));

    expect(window.LF.el.globalTooltip.getAttribute('aria-hidden')).toBe('true');
    expect(window.LF.el.globalTooltip.style.display).toBe('none');
  });
});
