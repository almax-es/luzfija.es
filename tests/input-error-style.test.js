import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const styles = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

function renderInput(type) {
  const value = type === 'number' ? '0.123' : '0,123';
  document.head.innerHTML = `<style>${styles}</style>`;
  document.body.innerHTML = `
    <div class="group">
      <input id="subject" class="input" type="${type}" placeholder="Ejemplo" value="${value}">
    </div>
  `;
  return document.getElementById('subject');
}

describe('Prioridad visual de los estados de input', () => {
  it.each(['text', 'number'])('muestra verde un input %s válido y relleno', (type) => {
    const input = renderInput(type);

    expect(getComputedStyle(input).borderColor).toBe('rgba(34, 197, 94, 0.4)');
  });

  it.each(['text', 'number'])('muestra rojo un input %s relleno con error', (type) => {
    const input = renderInput(type);
    input.classList.add('error');

    expect(getComputedStyle(input).borderColor).toBe('rgba(239, 68, 68, 0.7)');
    expect(getComputedStyle(input).backgroundColor).toBe('rgba(239, 68, 68, 0.08)');
  });
});
