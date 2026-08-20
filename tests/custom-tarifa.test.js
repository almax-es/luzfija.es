import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// 0. Cargar utilidades base (esNumericoValido y dependencias compartidas)
import '../js/lf-utils.js';

// Referencia al parseNum REAL de lf-utils.js, capturada antes de que el mock de
// abajo lo sustituya. El mock (parseFloat sobre replace(',', '.')) es mucho mas
// simple que el parser real y no sirve para afirmar nada sobre precision: para
// eso se usa esta referencia. Ver el describe del final.
const parseNumReal = window.LF.parseNum;

// 1. Setup JSDOM
document.body.innerHTML = `
  <input id="compararMiTarifa" type="checkbox">
  <input id="solarOn" type="checkbox">
  <div id="miTarifaPrecios"></div>
  <input id="mtPunta" value="">
  <input id="mtLlano" value="">
  <input id="mtValle" value="">
  <input id="mtP1" value="">
  <input id="mtP2" value="">
  <input id="mtPrecioExc" value="">
  <input id="mtBV" type="checkbox">
  <input id="mtPrecioBV" value="">
  <input id="mtSinSSAA" type="checkbox">
  <input id="mtCompensacionIndexada" type="checkbox">
  <input id="mtTopeParcial" type="checkbox">
`;

// 2. Mocks
beforeAll(async () => {
  window.LF = window.LF || {};
  window.LF.parseNum = (val) => {
    if (!val) return 0;
    return parseFloat(String(val).replace(',', '.'));
  };
  window.LF.toast = vi.fn();
  window.LF.$ = (id) => document.getElementById(id);

  // 3. Import code AFTER mocks are set
  await import('../js/lf-tarifa-custom.js');
});

describe('Tarifa Personalizada (lf-tarifa-custom.js)', () => {

  // Este describe encadena estado a proposito (cada test parte del DOM que dejo el
  // anterior), pero la compensacion indexada NO puede filtrarse: con exc = -1 el
  // constructor ignora el precio fijo, asi que un test posterior que escriba
  // mtPrecioExc = "0,07" estaria midiendo un escenario distinto del que declara.
  // Se resetea solo ese checkbox; el resto del encadenamiento se conserva.
  beforeEach(() => {
    const indexada = document.getElementById('mtCompensacionIndexada');
    if (indexada) indexada.checked = false;
  });

  it('agregarMiTarifa: Debe retornar null si el checkbox no está marcado', () => {
    document.getElementById('compararMiTarifa').checked = false;
    expect(window.LF.agregarMiTarifa()).toBeNull();
  });

  it('agregarMiTarifa: Debe crear una tarifa 3P válida', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = "0,15";
    document.getElementById('mtLlano').value = "0,12";
    document.getElementById('mtValle').value = "0,08";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,05";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(tarifa.nombre).toBe('Mi tarifa ⭐');
    expect(tarifa.tipo).toBe('3P');
    expect(tarifa.cPunta).toBe(0.15);
    expect(tarifa.p1).toBe(0.10);
  });

  it('agregarMiTarifa: acepta precio de potencia 0 explícito como permite el contrato interno', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = "0,15";
    document.getElementById('mtLlano').value = "0,12";
    document.getElementById('mtValle').value = "0,08";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(tarifa.p1).toBe(0.10);
    expect(tarifa.p2).toBe(0);
  });

  it('agregarMiTarifa: Debe detectar automáticamente una tarifa 1P', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = "0,12";
    document.getElementById('mtLlano').value = "0,12";
    document.getElementById('mtValle').value = "0,12";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();
    expect(tarifa.tipo).toBe('1P');
  });

  it('agregarMiTarifa: Debe incluir configuración solar y BV si procede', () => {
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "0,07";
    document.getElementById('mtBV').checked = true;
    // Con BV activa, la cuota mensual es obligatoria (14/08/2026) — puede ser 0, pero no vacía.
    document.getElementById('mtPrecioBV').value = "2,99";
    // Rellenar básicos
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa.fv.exc).toBe(0.07);
    expect(tarifa.fv.bv).toBe(true); // Activa BV automáticamente si hay precio exc
    expect(tarifa.fv.tipo).toBe('SIMPLE + BV');
    expect(tarifa.fv.precioBV).toBe(2.99);
  });

  it('agregarMiTarifa: BV marcada sin compensación se normaliza a fv.bv=false', () => {
    // INVARIANTE: fv.bv significa "BV aplicable", no "el checkbox estaba marcado". Sin
    // compensación no hay excedente remunerado que alimente la hucha. Emitir bv:true junto a
    // tipo 'NO COMPENSA' divergía entre motores: lf-calc.js y desglose-calculo.js exigen
    // tipo === 'SIMPLE + BV', pero bv-sim-monthly.js activa la BV solo por fv.bv, así que
    // cobraba la cuota mensual en el simulador y no en home para la misma configuración.
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = ""; // sin compensación
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = "2,99";
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa.fv.bv).toBe(false);
    expect(tarifa.fv.reglaBV).toBe('NO APLICA');
    expect(tarifa.fv.tipo).toBe('NO COMPENSA');
  });

  it('agregarMiTarifa: BV con compensación 0 explícito también se normaliza a fv.bv=false', () => {
    // El vacío y el cero explícito son ramas distintas en este proyecto (AUDITORIA-IA.md
    // dedica una sección al asunto). Una implementación futura basada en truthiness del
    // valor crudo — Boolean(rawPrecioExc) — pasaría el caso "" y fallaría con "0".
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "0";
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = "2,99";
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa.fv.exc).toBe(0);
    expect(tarifa.fv.bv).toBe(false);
    expect(tarifa.fv.reglaBV).toBe('NO APLICA');
    expect(tarifa.fv.tipo).toBe('NO COMPENSA');
  });

  it('agregarMiTarifa: BV con compensación indexada sigue activa (exc = -1 compensa)', () => {
    // El centinela fv.exc = -1 cuenta como compensación, así que la normalización del
    // invariante anterior no debe desactivar la BV en la modalidad indexada.
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "";
    document.getElementById('mtCompensacionIndexada').checked = true;
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = "2,99";
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa.fv.exc).toBe(-1);
    expect(tarifa.fv.bv).toBe(true);
    expect(tarifa.fv.reglaBV).toBe('BV MES ANTERIOR');
    expect(tarifa.fv.tipo).toBe('SIMPLE + BV');
  });

  it('agregarMiTarifa: con BV activa pero sin cuota rellenada, bloquea (14/08/2026)', () => {
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "0,07";
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = ""; // sin rellenar a proposito
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).toBeNull();
  });

  it('agregarMiTarifa: con BV activa y cuota explicita 0, se acepta y precioBV es 0 (regresion)', () => {
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "0,07";
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = "0";
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(tarifa.fv.precioBV).toBe(0);
  });

  it('agregarMiTarifa: sin BV, precioBV es siempre 0 aunque el campo tenga contenido (regresion)', () => {
    document.getElementById('solarOn').checked = true;
    document.getElementById('mtPrecioExc').value = "0,07";
    document.getElementById('mtBV').checked = false;
    document.getElementById('mtPrecioBV').value = "2,99";
    document.getElementById('mtPunta').value = "0,10";
    document.getElementById('mtLlano').value = "0,10";
    document.getElementById('mtValle').value = "0,10";
    document.getElementById('mtP1').value = "0,10";
    document.getElementById('mtP2').value = "0,10";

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(tarifa.fv.precioBV).toBe(0);
  });

  it('agregarMiTarifa: Debe fallar y mostrar toast si faltan campos', () => {
    document.getElementById('compararMiTarifa').checked = true;
    document.getElementById('mtPunta').value = ""; // Vació
    
    const tarifa = window.LF.agregarMiTarifa();
    
    expect(tarifa).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('Completa todos los campos'));
  });

  it('agregarMiTarifa: Debe rechazar precios negativos o absurdos', () => {
    document.getElementById('mtPunta').value = "-0,15";
    expect(window.LF.agregarMiTarifa()).toBeNull();

    document.getElementById('mtPunta').value = "5,00"; // > 1€/kWh
    expect(window.LF.agregarMiTarifa()).toBeNull();
  });

  // 14/08/2026: sin estos tres, "Mi tarifa" no podia reproducir 17 de las 118 tarifas
  // activas que usan al menos una de estas condiciones economicas (SSAA aparte, tope
  // ENERGIA_PARCIAL, compensacion indexada). Ver AUDITORIA-IA.md.
  describe('agregarMiTarifa: opciones avanzadas (14/08/2026)', () => {
    beforeEach(() => {
      document.getElementById('compararMiTarifa').checked = true;
      document.getElementById('mtPunta').value = "0,10";
      document.getElementById('mtLlano').value = "0,10";
      document.getElementById('mtValle').value = "0,10";
      document.getElementById('mtP1').value = "0,10";
      document.getElementById('mtP2').value = "0,10";
      document.getElementById('mtSinSSAA').checked = false;
      document.getElementById('mtCompensacionIndexada').checked = false;
      document.getElementById('mtTopeParcial').checked = false;
      document.getElementById('mtBV').checked = false;
      document.getElementById('mtPrecioBV').value = '';
      document.getElementById('mtPrecioExc').value = '';
    });

    it('por defecto, incluyeServiciosAjuste es true (sin SSAA aparte)', () => {
      const tarifa = window.LF.agregarMiTarifa();
      expect(tarifa.incluyeServiciosAjuste).toBe(true);
    });

    it('mtSinSSAA marcado produce incluyeServiciosAjuste: false (SSAA se cobra aparte)', () => {
      document.getElementById('mtSinSSAA').checked = true;
      const tarifa = window.LF.agregarMiTarifa();
      expect(tarifa.incluyeServiciosAjuste).toBe(false);
    });

    it('mtCompensacionIndexada marcada produce fv.exc=-1, ignorando el precio fijo', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtPrecioExc').value = '0,07';
      document.getElementById('mtCompensacionIndexada').checked = true;
      const tarifa = window.LF.agregarMiTarifa();
      expect(tarifa.fv.exc).toBe(-1);
      expect(tarifa.fv.tipo).toBe('SIMPLE');
    });

    it('con indexada ON, un precio fijo invalido NO bloquea (residual 14/08/2026)', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtPrecioExc').value = 'abc';
      document.getElementById('mtCompensacionIndexada').checked = true;

      const tarifa = window.LF.agregarMiTarifa();

      expect(tarifa).not.toBeNull();
      expect(tarifa.fv.exc).toBe(-1);
    });

    it('con indexada OFF, el mismo precio fijo invalido si bloquea (regresion)', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtPrecioExc').value = 'abc';
      document.getElementById('mtCompensacionIndexada').checked = false;

      const tarifa = window.LF.agregarMiTarifa();

      expect(tarifa).toBeNull();
    });

    it('indexada ON + BV ON + cuota BV vacia SI bloquea (regresion de alcance de llave)', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtCompensacionIndexada').checked = true;
      document.getElementById('mtBV').checked = true;
      document.getElementById('mtPrecioBV').value = '';

      const tarifa = window.LF.agregarMiTarifa();

      expect(tarifa).toBeNull();
    });

    it('indexada ON + BV ON + cuota BV valida: tarifa completa con exc=-1 y precioBV correcto', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtCompensacionIndexada').checked = true;
      document.getElementById('mtBV').checked = true;
      document.getElementById('mtPrecioBV').value = '2,99';

      const tarifa = window.LF.agregarMiTarifa();

      expect(tarifa).not.toBeNull();
      expect(tarifa.fv.exc).toBe(-1);
      expect(tarifa.fv.precioBV).toBe(2.99);
    });

    it('indexada ON + BV ON + cuota BV con formato invalido bloquea', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtCompensacionIndexada').checked = true;
      document.getElementById('mtBV').checked = true;
      document.getElementById('mtPrecioBV').value = 'abc';

      const tarifa = window.LF.agregarMiTarifa();

      expect(tarifa).toBeNull();
    });

    it('mtTopeParcial marcado produce fv.tope: ENERGIA_PARCIAL', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtPrecioExc').value = '0,07';
      document.getElementById('mtTopeParcial').checked = true;
      const tarifa = window.LF.agregarMiTarifa();
      expect(tarifa.fv.tope).toBe('ENERGIA_PARCIAL');
    });

    it('por defecto (sin marcar), fv.tope sigue siendo ENERGIA (regresion)', () => {
      document.getElementById('solarOn').checked = true;
      document.getElementById('mtPrecioExc').value = '0,07';
      const tarifa = window.LF.agregarMiTarifa();
      expect(tarifa.fv.tope).toBe('ENERGIA');
      expect(tarifa.fv.exc).toBe(0.07);
    });
  });

});

// Regresion del issue #14: "Mi tarifa" rechazaba precios con mas de 6 decimales
// (esNumericoValido se invocaba con maxDecimales = 6). Las facturas reales traen
// 7 decimales de forma habitual (0,1118785 EUR/kWh), asi que el limite se subio
// a 8 (MAX_DECIMALES_PRECIO en js/lf-tarifa-custom.js).
//
// Estos casos ejercitan el flujo real de "Mi tarifa" (validateMiTarifa /
// agregarMiTarifa), no el helper aislado.
describe('Mi tarifa: precision decimal de los precios (issue #14)', () => {
  const $ = (id) => document.getElementById(id);

  function setMiTarifa({
    punta = '0,10',
    llano = '0,10',
    valle = '0,10',
    p1 = '0,10',
    p2 = '0,05',
    exc = ''
  } = {}) {
    $('mtPunta').value = punta;
    $('mtLlano').value = llano;
    $('mtValle').value = valle;
    $('mtP1').value = p1;
    $('mtP2').value = p2;
    $('mtPrecioExc').value = exc;
  }

  beforeEach(() => {
    // Los tests anteriores dejan estado en el DOM (solar activo, BV marcado...).
    $('compararMiTarifa').checked = true;
    $('solarOn').checked = false;
    $('mtBV').checked = false;
    setMiTarifa();
    window.LF.toast.mockClear();
  });

  it('acepta precios de energia con 7 decimales y coma (valores reales de factura)', () => {
    setMiTarifa({ punta: '0,1118785', llano: '0,0379625', valle: '0,1112950' });

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    expect(window.LF.validateMiTarifa({ silent: true })).toBe(true);
    expect($('mtPunta').classList.contains('error')).toBe(false);
    expect($('mtLlano').classList.contains('error')).toBe(false);
    expect($('mtValle').classList.contains('error')).toBe(false);
  });

  it('acepta 8 decimales con coma en energia y potencia sin perder precision', () => {
    setMiTarifa({
      punta: '0,12345678',
      llano: '0,11111111',
      valle: '0,09876543',
      p1: '0,12345678',
      p2: '0,08765432'
    });

    const tarifa = window.LF.agregarMiTarifa();

    expect(tarifa).not.toBeNull();
    // Comparado contra el parser REAL: si el valor se truncara o redondeara en
    // el camino, este assert caeria (el mock no interviene en el valor esperado).
    expect(tarifa.cPunta).toBe(parseNumReal('0,12345678'));
    expect(tarifa.p1).toBe(parseNumReal('0,12345678'));
    expect(tarifa.p2).toBe(parseNumReal('0,08765432'));
    expect($('mtPunta').classList.contains('error')).toBe(false);
    expect($('mtP1').classList.contains('error')).toBe(false);
  });

  it('aplica el mismo límite de 8 decimales cuando se usa punto', () => {
    setMiTarifa({ punta: '0.12345678' });
    expect(window.LF.agregarMiTarifa()).not.toBeNull();

    setMiTarifa({ punta: '0.123456789' });
    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith('Los precios de energía deben ser números válidos');
    expect($('mtPunta').classList.contains('error')).toBe(true);
  });

  it('rechaza 9 decimales con coma en un precio de energia', () => {
    setMiTarifa({ punta: '0,123456789' });

    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith('Los precios de energía deben ser números válidos');
    expect($('mtPunta').classList.contains('error')).toBe(true);
    expect($('mtPunta').getAttribute('aria-invalid')).toBe('true');
  });

  it('rechaza 9 decimales con coma en un precio de potencia', () => {
    setMiTarifa({ p1: '0,123456789' });

    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('precios de potencia'));
    expect($('mtP1').classList.contains('error')).toBe(true);
  });

  it('acepta 8 decimales en la compensacion de excedentes y rechaza 9', () => {
    $('solarOn').checked = true;

    setMiTarifa({ exc: '0,07432198' });
    const tarifa = window.LF.agregarMiTarifa();
    expect(tarifa).not.toBeNull();
    expect(tarifa.fv.exc).toBe(parseNumReal('0,07432198'));
    expect($('mtPrecioExc').classList.contains('error')).toBe(false);

    setMiTarifa({ exc: '0,074321987' });
    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('precio de compensación'));
    expect($('mtPrecioExc').classList.contains('error')).toBe(true);
  });

  it('mantiene los topes monetarios: 8 decimales no permiten superar 1 EUR/kWh', () => {
    setMiTarifa({ punta: '1,00000001' });

    expect(window.LF.agregarMiTarifa()).toBeNull();
    expect(window.LF.toast).toHaveBeenCalledWith(expect.stringContaining('muy altos'));
  });
});

// El parser real de lf-utils.js, separado del flujo anterior porque el suite de
// arriba mockea window.LF.parseNum. Aqui se comprueba que 8 decimales llegan al
// calculo con su valor intacto.
describe('parseNum real: precision de los precios de "Mi tarifa"', () => {
  it('no es el mock del suite anterior', () => {
    expect(parseNumReal).not.toBe(window.LF.parseNum);
  });

  it('conserva el valor de precios con 7 y 8 decimales', () => {
    expect(parseNumReal('0,1118785')).toBe(0.1118785);
    expect(parseNumReal('0,0379625')).toBe(0.0379625);
    expect(parseNumReal('0,12345678')).toBe(0.12345678);
    expect(parseNumReal('0,07432198')).toBe(0.07432198);
  });
});

// Regresion 14/08/2026: activar/desactivar solar reconstruye #miTarifaPrecios entero via
// innerHTML y recarga desde localStorage 50ms despues. Sin el flush sincronico en
// updateMiTarifaForm(), un guardado con debounce (800ms) todavia pendiente sobrevivia a la
// reconstruccion y, al disparar, leia el DOM NUEVO en vez del valor recien tecleado que lo
// origino -> se perdia en silencio. Y sin distinguir "campo no montado" de "campo vaciado",
// guardar con solar desactivado borraba compensacion/BV ya guardadas.
describe('Mi tarifa: no se pierden datos al activar/desactivar solar (14/08/2026)', () => {
  beforeEach(() => {
    // El fixture estatico del fichero (linea 13) deja mtPunta/mtPrecioExc/etc permanentes
    // FUERA de #miTarifaPrecios, para el resto de describes que llaman a agregarMiTarifa()
    // directamente sin pasar por updateMiTarifaForm(). Aqui hacen falta los duplicados
    // fuera para no interferir con getElementById() sobre los que si reconstruye
    // updateMiTarifaForm() dentro del contenedor.
    document.body.innerHTML = `
      <input id="compararMiTarifa" type="checkbox">
      <input id="solarOn" type="checkbox">
      <div id="miTarifaPrecios"></div>
    `;
    localStorage.clear();
  });

  function construirFormulario() {
    window.LF.updateMiTarifaForm();
  }

  it('un valor recien tecleado (debounce aun pendiente) sobrevive a un toggle de solar', async () => {
    vi.useFakeTimers();
    document.getElementById('solarOn').checked = false;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);

    document.getElementById('mtPunta').value = '0,234567';
    document.getElementById('mtPunta').dispatchEvent(new Event('input', { bubbles: true }));
    // Menos de 800ms: el guardado con debounce todavia NO se ha disparado.
    await vi.advanceTimersByTimeAsync(200);

    document.getElementById('solarOn').checked = true;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);

    const guardado = JSON.parse(localStorage.getItem('lf_custom_tarifa'));
    expect(guardado.punta).toBe('0,234567');
    expect(document.getElementById('mtPunta').value).toBe('0,234567');

    vi.useRealTimers();
  });

  it('editar con solar desactivado preserva compensacion/BV ya guardadas (no las vacia)', async () => {
    vi.useFakeTimers();
    document.getElementById('solarOn').checked = true;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);

    document.getElementById('mtPunta').value = '0,10';
    document.getElementById('mtLlano').value = '0,10';
    document.getElementById('mtValle').value = '0,10';
    document.getElementById('mtP1').value = '0,08';
    document.getElementById('mtP2').value = '0,04';
    document.getElementById('mtPrecioExc').value = '0,07';
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = '2,99';
    window.LF.saveCustomTarifaMain();

    let guardado = JSON.parse(localStorage.getItem('lf_custom_tarifa'));
    expect(guardado.exc).toBe('0,07');
    expect(guardado.bv).toBe(true);
    expect(guardado.precioBV).toBe('2,99');

    // Desactivar solar: los campos de compensacion/BV desaparecen del DOM.
    document.getElementById('solarOn').checked = false;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);
    expect(document.getElementById('mtPrecioExc')).toBeNull();

    // Editar solo Punta con solar desactivado.
    document.getElementById('mtPunta').value = '0,11';
    document.getElementById('mtPunta').dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(801);

    guardado = JSON.parse(localStorage.getItem('lf_custom_tarifa'));
    expect(guardado.punta).toBe('0,11');
    // Lo solar NO se ha vaciado por no estar montado en el DOM.
    expect(guardado.exc).toBe('0,07');
    expect(guardado.bv).toBe(true);
    expect(guardado.precioBV).toBe('2,99');

    // Al reactivar solar, reaparecen con los valores preservados.
    document.getElementById('solarOn').checked = true;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);
    expect(document.getElementById('mtPrecioExc').value).toBe('0,07');
    expect(document.getElementById('mtBV').checked).toBe(true);
    expect(document.getElementById('mtPrecioBV').value).toBe('2,99');

    vi.useRealTimers();
  });

  it('"Limpiar datos guardados" sigue vaciando todos los campos deliberadamente (regresion)', async () => {
    vi.useFakeTimers();
    document.getElementById('solarOn').checked = true;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);

    document.getElementById('mtPunta').value = '0,10';
    document.getElementById('mtPrecioExc').value = '0,07';
    document.getElementById('mtBV').checked = true;
    document.getElementById('mtPrecioBV').value = '2,99';
    window.LF.saveCustomTarifaMain();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.LF.clearCustomTarifaMain();

    expect(localStorage.getItem('lf_custom_tarifa')).toBeNull();

    vi.useRealTimers();
  });

  it('mtPrecioBV forma parte de la limpieza de estilos de error (residual)', async () => {
    vi.useFakeTimers();
    document.getElementById('solarOn').checked = true;
    construirFormulario();
    await vi.advanceTimersByTimeAsync(60);

    document.getElementById('mtBV').checked = true;
    const precioBV = document.getElementById('mtPrecioBV');
    precioBV.classList.add('error');

    window.LF.clearMiTarifaErrorStyles();

    expect(precioBV.classList.contains('error')).toBe(false);

    vi.useRealTimers();
  });
});
