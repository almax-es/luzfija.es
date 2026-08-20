import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import '../js/lf-utils.js';

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
    <input id="mtBV" type="checkbox" />
    <input id="mtPrecioBV" value="" />
    <input id="mtCompensacionIndexada" type="checkbox" />
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
  window.LF = window.LF || {};
  window.LF.cachedTarifas = [];

  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      tarifas: [{ id: 'x', nombre: 'Tarifa X', tipo: '1P', p1: 0.05, p2: 0.02, cPunta: 0.1, cLlano: 0.1, cValle: 0.1 }]
    })
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.mostrarDesglose;
  delete window.__LF_DesgloseFactura;
  delete window.pvpcLastMeta;
  if (window.LF) window.LF.cachedTarifas = [];
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

    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.toast).toHaveBeenCalledWith(
      expect.stringContaining('No hay datos de PVPC calculados'),
      'err'
    );
    expect(window.__LF_DesgloseFactura.abrir).not.toHaveBeenCalled();
  });

  it('PVPC pasa una copia de la cobertura horaria al modal de desglose', async () => {
    const pvpcCoverage = {
      mode: 'hybrid',
      hoursWithPrice: 9,
      hoursWithoutPrice: 1,
      missingKwhShare: 0.1,
      hasMissingPrices: true
    };
    window.pvpcLastMeta = {
      precioPunta: 0.20,
      precioLlano: 0.10,
      precioValle: 0.05,
      pvpcCoverage
    };
    document.getElementById('tbody').innerHTML = `
      <tr data-tarifa-nombre="PVPC (Regulada) ⚡"
          data-meta-pvpc='{"terminoFijo":1,"terminoVariable":30,"totalFactura":40}'>
        <td class="tarifa-cell">PVPC (Regulada) ⚡</td>
        <td class="total-cell">40,00 €</td>
      </tr>
    `;
    bootstrapIntegration();

    await window.mostrarDesglose('PVPC (Regulada) ⚡');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        esPVPC: true,
        pvpcCoverage
      })
    );
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


  it('reutiliza LF.cachedTarifas y no hace una segunda descarga para una tarifa libre', async () => {
    window.LF = window.LF || {};
    window.LF.cachedTarifas = [{
      id: 'cacheada',
      nombre: 'Tarifa Cacheada',
      cPunta: 0.1,
      cLlano: 0.1,
      cValle: 0.1,
      p1: 0.05,
      p2: 0.02
    }];
    global.fetch = vi.fn(async () => { throw new Error('no deberia descargar tarifas.json'); });
    bootstrapIntegration();

    await window.mostrarDesglose('Tarifa Cacheada');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({ nombreTarifa: 'Tarifa Cacheada' })
    );
  });

  it('no fija en caché un tarifas.json HTTP 200 malformado y permite reintentar el desglose', async () => {
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { ok: true, json: async () => ({ tarifas: {} }) };
      return {
        ok: true,
        json: async () => ({
          tarifas: [{ id: 'recuperada', nombre: 'Tarifa Recuperada', tipo: '1P', cPunta: 0.1, cLlano: 0.1, cValle: 0.1, p1: 0.05, p2: 0.02 }]
        })
      };
    });
    bootstrapIntegration();

    await window.mostrarDesglose('Tarifa Recuperada');
    expect(window.__LF_DesgloseFactura.abrir).not.toHaveBeenCalled();
    expect(window.toast).toHaveBeenCalledWith('No se pudieron cargar las tarifas', 'err');

    await window.mostrarDesglose('Tarifa Recuperada');
    expect(attempts).toBe(2);
    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({ nombreTarifa: 'Tarifa Recuperada' })
    );
  });

  it('avisa y reporta si el modal de desglose no llegó a cargarse', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tarifas: [{ id: 'visalia', nombre: 'Visalia', tipo: '1P', cPunta: 0.1, cLlano: 0.1, cValle: 0.1, p1: 0.05, p2: 0.02 }]
      })
    }));
    delete window.__LF_DesgloseFactura;
    window.__LF_trackDetail = vi.fn();
    bootstrapIntegration();

    await window.mostrarDesglose('Visalia');

    expect(window.toast).toHaveBeenCalledWith(expect.stringContaining('no terminó de cargarse'), 'err');
    expect(window.__LF_trackDetail).toHaveBeenCalledWith(
      'init-incompleto',
      ['home', 'desglose-modal'],
      expect.any(Object)
    );
  });

  it('usa la misma fecha fiscal del cálculo principal para el desglose de tarifas libres', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tarifas: [{
          id: 'visalia',
          nombre: 'Visalia',
          tipo: '1P',
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
        fechaFin: '21/03/2026',
        pvpcCoverage: null
      })
    );
  });

  it('usa el precio FV ya calculado en la fila para tarifas indexadas', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tarifas: [{
          id: 'indexada',
          nombre: 'Indexada Solar',
          tipo: '1P',
          cPunta: 0.12,
          cLlano: 0.12,
          cValle: 0.12,
          p1: 0.05,
          p2: 0.05,
          fv: {
            exc: -1,
            tipo: 'SIMPLE',
            tope: 'ENERGIA',
            bv: false
          }
        }]
      })
    }));

    document.getElementById('solarOn').checked = true;
    document.getElementById('exTotal').value = '150';
    document.getElementById('tbody').innerHTML = `
      <tr data-tarifa-nombre="Indexada Solar" data-fv-price-used="0.078" data-fv-price-source="hourly-index-base">
        <td class="tarifa-cell">Indexada Solar</td>
        <td class="total-cell">10,00 €</td>
      </tr>
    `;

    bootstrapIntegration();

    await window.mostrarDesglose('Indexada Solar');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        precioCompensacion: 0.078,
        precioCompensacionIndexada: true,
        precioCompensacionSource: 'hourly-index-base'
      })
    );
  });

  it('con cambios pendientes (state.pending), el desglose no abre y avisa (14/08/2026)', async () => {
    window.LF.state = { pending: true };

    bootstrapIntegration();

    await window.mostrarDesglose('Visalia');

    expect(window.toast).toHaveBeenCalledWith(
      expect.stringContaining('Hay cambios pendientes'),
      'err'
    );
    expect(window.__LF_DesgloseFactura.abrir).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sin cambios pendientes (state.pending=false), el desglose sigue abriendo (regresion)', async () => {
    window.LF.state = { pending: false };
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tarifas: [{ id: 'visalia', nombre: 'Visalia', tipo: '1P', cPunta: 0.1, cLlano: 0.1, cValle: 0.1, p1: 0.05, p2: 0.05 }]
      })
    }));

    bootstrapIntegration();

    await window.mostrarDesglose('Visalia');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalled();
  });

  it('sin window.LF.state definido, el desglose sigue abriendo (regresion, uso fuera de home)', async () => {
    delete window.LF.state;
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tarifas: [{ id: 'visalia', nombre: 'Visalia', tipo: '1P', cPunta: 0.1, cLlano: 0.1, cValle: 0.1, p1: 0.05, p2: 0.05 }]
      })
    }));

    bootstrapIntegration();

    await window.mostrarDesglose('Visalia');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalled();
  });

  // Nota: abrir() esta mockeado, asi que esto prueba el cableado (que precioBV y tieneBV
  // llegan al desglose), no que la cuota acabe sumandose al total. Eso lo cubre el motor en
  // tests/desglose.test.js.
  it.each([
    ['de pago', '2,99', 2.99],
    ['gratuita', '0', 0]
  ])('Mi tarifa con BV activa %s pasa precioBV y tieneBV al desglose', async (_caso, precioBVRaw, precioBVEsperado) => {
    document.getElementById('mtPunta').value = '0,15';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,05';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,08';
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtBV').checked = true;
    // La variante gratuita (0 EUR/mes) cubre que la activacion de la BV no dependa de que la
    // cuota sea positiva: `bv: ... && precioBV > 0` es una confusion plausible.
    document.getElementById('mtPrecioBV').value = precioBVRaw;
    // Sin precio de compensacion la BV no es aplicable (fv.bv se normaliza a false) y la
    // cuota no viaja al desglose. Este test cubre la BV realmente activa, asi que necesita
    // compensacion > 0; el caso sin compensacion se cubre en el test siguiente.
    document.getElementById('mtPrecioExc').value = '0,05';

    bootstrapIntegration();

    await window.mostrarDesglose('Mi tarifa ⭐');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        precioBV: precioBVEsperado,
        tieneBV: true,
        reglaBV: 'BV MES ANTERIOR',
        tipoCompensacion: 'SIMPLE + BV'
      })
    );
  });

  it.each([
    ['compensacion vacia', ''],
    ['compensacion cero explicito', '0']
  ])('Mi tarifa con BV marcada y %s no activa la BV ni su cuota', async (_caso, excRaw) => {
    // Invariante: fv.bv significa "BV aplicable", no "el checkbox estaba marcado". Sin
    // compensacion no hay excedente remunerado que alimente la hucha. Si este productor
    // emitiera bv:true con tipo 'NO COMPENSA', bv-sim-monthly.js activaria la BV solo por
    // fv.bv mientras home y desglose la desactivan por tipo, cobrando la cuota en un motor
    // y no en los otros para la misma opcion del usuario.
    // El cero explicito va aparte del vacio: `mtCompensacionIndexada || Boolean(mtPrecioExcVal)`
    // pasaria el caso '' y fallaria con '0', porque Boolean('0') es true.
    document.getElementById('mtPunta').value = '0,15';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,05';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,08';
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = '2,99';
    document.getElementById('mtPrecioExc').value = excRaw;

    bootstrapIntegration();

    await window.mostrarDesglose('Mi tarifa ⭐');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        tieneBV: false,
        reglaBV: 'NO APLICA',
        precioBV: 0,
        tipoCompensacion: 'NO COMPENSA'
      })
    );
  });

  it('Mi tarifa con BV y compensacion indexada mantiene la BV activa', async () => {
    // Sin este caso, una normalizacion mal escrita como `bv: mtTieneBV && mtPrecioExc > 0`
    // pasaria el test anterior (sin compensacion) y sin embargo romperia el centinela
    // exc = -1, que tambien cuenta como compensacion. Mutar solo de vuelta al bug original
    // no cubre esa variante plausible.
    document.getElementById('mtPunta').value = '0,15';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,05';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,08';
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = '2,99';
    document.getElementById('mtPrecioExc').value = '';
    document.getElementById('mtCompensacionIndexada').checked = true;

    bootstrapIntegration();

    await window.mostrarDesglose('Mi tarifa ⭐');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        tieneBV: true,
        reglaBV: 'BV MES ANTERIOR',
        precioBV: 2.99,
        tipoCompensacion: 'SIMPLE + BV'
      })
    );
  });

  it('Mi tarifa sin BV mantiene precioBV a 0 aunque el campo tenga contenido (regresion)', async () => {
    document.getElementById('mtPunta').value = '0,15';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,05';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,08';
    // Cuadrante simetrico del invariante: SI hay compensacion, pero el checkbox esta
    // desmarcado. Sin solar ni compensacion, `bv: mtCompensa` daria false igual que el
    // codigo correcto y la mutacion pasaria inadvertida.
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = '0,05';
    document.getElementById('mtBV').checked = false;
    document.getElementById('mtPrecioBV').value = '2,99';

    bootstrapIntegration();

    await window.mostrarDesglose('Mi tarifa ⭐');

    expect(window.__LF_DesgloseFactura.abrir).toHaveBeenCalledWith(
      expect.objectContaining({
        tieneBV: false,
        reglaBV: 'NO APLICA',
        precioBV: 0,
        tipoCompensacion: 'SIMPLE'
      })
    );
  });
});
