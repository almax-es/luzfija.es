import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Ronda 43: los avisos de la importacion de la home se lanzaban como toast justo antes de abrir
// la vista previa, y el overlay del modal (z-index 10010) tapaba el toast. Medido en Chrome: el
// usuario no veia ningun aviso. Ahora van dentro del modal. Se prueba con el handler REAL.

function esperar(cond, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const poll = () => {
      if (cond()) return resolve();
      if (Date.now() - inicio > timeoutMs) return reject(new Error('timeout'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function csv(filasExtra = []) {
  const filas = ['CUPS;Fecha;Hora;AE_kWh;AS_kWh'];
  for (let h = 1; h <= 24; h++) filas.push(`ES1;01/04/2026;${h};0,500;0`);
  for (let h = 1; h <= 24; h++) filas.push(`ES1;02/04/2026;${h};0,500;0`);
  return [...filas, ...filasExtra].join('\n');
}

describe('Avisos de la importacion CSV de la home dentro de la vista previa', () => {
  beforeAll(async () => {
    await import('../js/lf-utils.js');
    window.LF = window.LF || {};
    // lf-csv-import.js destructura toast al cargar: el stub debe existir antes.
    window.LF.toast = vi.fn();
    await import('../js/lf-csv-utils.js');
    await import('../js/lf-csv-import.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '<div class="actions-center"></div>';
    window.__LF_trackDetail = vi.fn();
    window.LF.toast.mockClear();
  });

  async function importar(contenido, nombre = 'consumos.csv') {
    window.initCSVImporter();
    const input = document.getElementById('csvConsumoInput');
    Object.defineProperty(input, 'files', { value: [new File([contenido], nombre, { type: 'text/csv' })], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await esperar(() => document.getElementById('btnAplicarCSV') || window.LF.toast.mock.calls.length > 0);
  }

  it('muestra en el modal las filas descartadas y no lanza un toast que quedaria tapado', async () => {
    await importar(csv(['ES1;03/04/2026;1;-0,500;0', 'ES1;03/04/2026;2;abc;0']));

    const avisos = document.getElementById('csvImportNotices');
    expect(avisos).toBeTruthy();
    expect(avisos.closest('.modal-content')).toBeTruthy();
    const lineas = [...avisos.querySelectorAll('li')].map((li) => li.textContent);
    expect(lineas).toContain('Se descartaron 1 filas con valores negativos.');
    expect(lineas).toContain('Se descartaron 1 filas con valores no numéricos.');
    expect(window.LF.toast).not.toHaveBeenCalled();
  });

  it('sin avisos no pinta el bloque', async () => {
    const vacio = window.LF.csvHelpers.buildImportNoticesHTML([]);
    expect(vacio).toBe('');
    expect(window.LF.csvHelpers.buildImportNoticesHTML(['', '  ', null])).toBe('');
  });

  it('escapa el texto: un aviso puede citar una cabecera del archivo', () => {
    const html = window.LF.csvHelpers.buildImportNoticesHTML(['Columna "<img src=x onerror=alert(1)>" ignorada.']);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('li').textContent).toBe('Columna "<img src=x onerror=alert(1)>" ignorada.');
  });

  it('un fichero sin avisos abre la vista previa sin el bloque', async () => {
    const filas = ['CUPS;Fecha;Hora;AE_kWh;AS_kWh'];
    for (let d = 1; d <= 3; d++) {
      for (let h = 1; h <= 24; h++) filas.push(`ES1;0${d}/04/2026;${h};0,500;${h === 12 ? '0,200' : '0'}`);
    }
    const contenido = filas.join('\n');
    const parsed = window.LF.csvHelpers.parseCSVConsumos(contenido);
    await importar(contenido);

    expect(document.getElementById('btnAplicarCSV')).toBeTruthy();
    // El bloque solo existe si el propio parser y la validacion de rango devolvieron avisos.
    const bloque = document.getElementById('csvImportNotices');
    const lineas = bloque ? [...bloque.querySelectorAll('li')].map((li) => li.textContent) : [];
    expect(lineas.join(' ')).not.toMatch(/Se descartaron/);
    expect(parsed.warnings.join(' ')).not.toMatch(/Se descartaron/);
  });
});
