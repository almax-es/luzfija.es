import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const desgloseIntegrationCode = fs.readFileSync(
  path.resolve(__dirname, '../js/desglose-integration.js'),
  'utf8'
);

function renderBaseDom() {
  document.body.innerHTML = `
    <input id="p1" value="3,45" />
    <input id="p2" value="3,45" />
    <input id="dias" value="30" />
    <input id="cPunta" value="100" />
    <input id="cLlano" value="100" />
    <input id="cValle" value="100" />
    <input id="exTotal" value="0" />
    <input id="bvSaldo" value="0" />
    <input id="zonaFiscal" value="Península" />
    <input id="viviendaCanarias" type="checkbox" />
    <input id="solarOn" type="checkbox" />
    <input id="mtPunta" value="" />
    <input id="mtLlano" value="" />
    <input id="mtValle" value="" />
    <input id="mtP1" value="" />
    <input id="mtP2" value="" />
    <input id="mtPrecioExc" value="" />
    <table><tbody id="tbody"></tbody></table>
  `;
}

function bootstrapIntegration() {
  const runner = new Function(desgloseIntegrationCode);
  runner();
}

beforeEach(() => {
  renderBaseDom();

  window.toast = vi.fn();
  global.toast = window.toast;

  window.LF_CONFIG = {
    getTodayYmd: () => '2026-03-21',
    resolveFiscalDateYmd: (value) => value || '2026-03-21',
    formatDateYmdInMadrid: () => '2026-03-21'
  };

  window.__LF_DesgloseFactura = { abrir: vi.fn() };
  delete window.pvpcLastMeta;

  global.fetch = vi.fn(async () => ({
    json: async () => ({
      tarifas: [{ id: 'x', nombre: 'Tarifa X' }]
    })
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.mostrarDesglose;
  delete window.__LF_DesgloseFactura;
  delete window.pvpcLastMeta;
  delete window.LF_CONFIG;
  delete window.toast;
  delete global.toast;
  delete global.fetch;
  document.body.innerHTML = '';
});

describe('Desglose integration UX guardrails', () => {
  it('no reintroduce alert() en flujo de validación', () => {
    expect(desgloseIntegrationCode).not.toMatch(/\balert\s*\(/);
  });

  it('Mi tarifa muestra toast de error y corta ejecución si faltan campos', async () => {
    bootstrapIntegration();

    await window.mostrarDesglose('Mi tarifa ⭐');

    expect(window.toast).toHaveBeenCalledWith(
      expect.stringContaining('Completa todos los campos de "Mi tarifa"'),
      'err'
    );
    expect(window.__LF_DesgloseFactura.abrir).not.toHaveBeenCalled();
  });

  it('PVPC sin cálculo previo muestra toast y no abre el modal de desglose', async () => {
    bootstrapIntegration();

    await window.mostrarDesglose('PVPC (Regulada) ⚡');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(window.toast).toHaveBeenCalledWith(
      expect.stringContaining('No hay datos de PVPC calculados'),
      'err'
    );
    expect(window.__LF_DesgloseFactura.abrir).not.toHaveBeenCalled();
  });

  it('ignora clics en celdas marcadas como no comparables', () => {
    bootstrapIntegration();

    document.getElementById('tbody').innerHTML = `
      <tr data-tarifa-nombre="PVPC (Regulada) ⚡">
        <td class="tarifa-cell" aria-disabled="true">PVPC (Regulada) ⚡</td>
        <td class="total-cell" aria-disabled="true">—</td>
      </tr>
    `;

    document.querySelector('.total-cell').click();

    expect(window.__LF_DesgloseFactura.abrir).not.toHaveBeenCalled();
    expect(window.toast).not.toHaveBeenCalled();
  });

  it('usa la misma fecha fiscal del cálculo principal para el desglose de tarifas libres', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({
        tarifas: [{
          id: 'visalia',
          nombre: 'Visalia',
          cPunta: 0.097999,
          cLlano: 0.097999,
          cValle: 0.097999,
          p1: 0.0603,
          p2: 0.0603
        }]
      })
    }));

    bootstrapIntegration();

    await window.mostrarDesglose('Visalia');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        fechaYmd: '2026-03-21',
        fechaInicio: '20/02/2026',
        fechaFin: '21/03/2026'
      })
    );
  });
});
