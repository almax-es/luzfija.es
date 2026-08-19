import { describe, it, expect, beforeAll } from 'vitest';

// Setup global window object for utils
window.LF = window.LF || {};
import '../js/lf-config.js';

// Import the utils
import '../js/lf-utils.js';

describe('Utilidades Base (lf-utils.js)', () => {

  describe('parseNum: Robustez en lectura de números', () => {
    const parse = window.LF.parseNum;

    it('Debe manejar números puros y básicos', () => {
      expect(parse(123.45)).toBe(123.45);
      expect(parse("123.45")).toBe(123.45);
      expect(parse("123,45")).toBe(123.45);
    });

    it('Debe manejar separadores de miles y decimales (formato ES)', () => {
      expect(parse("1.234,56")).toBe(1234.56);
      expect(parse("12.345,67 €")).toBe(12345.67);
    });

    it('Debe interpretar adecuadamente números decimales españoles con 3 dígitos (ej. potencia 3,450 kW)', () => {
      expect(parse("3,450")).toBe(3.45);
      expect(parse("4,600")).toBe(4.6);
      expect(parse("123,456")).toBe(123.456);
    });

    it('Debe manejar separadores de miles y decimales (formato EN)', () => {
      expect(parse("1,234.56")).toBe(1234.56);
    });

    it('Debe aplicar la heurística de decimal con cero inicial', () => {
      // Si empieza por "0," asumimos decimal aunque parezca patrón de miles raro
      expect(parse("0,1234")).toBe(0.1234);
      expect(parse("0.1234")).toBe(0.1234);
    });

    it('Debe limpiar basura y espacios', () => {
      expect(parse("  100,50 kWh  ")).toBe(100.5);
      expect(parse("Importe: -45,20€")).toBe(-45.2);
      expect(parse("1 000,50")).toBe(1000.5); // Espacio como separador miles
    });

    it('Debe devolver 0 para valores inválidos', () => {
      expect(parse(null)).toBe(0);
      expect(parse(undefined)).toBe(0);
      expect(parse("texto")).toBe(0);
      expect(parse("")).toBe(0);
    });
  });

  describe('escapeHtml: Seguridad XSS', () => {
    const escape = window.LF.escapeHtml;

    it('Debe neutralizar etiquetas script y carácteres peligrosos', () => {
      const input = '<script>alert("xss")</script> & "quote"';
      const output = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quote&quot;';
      expect(escape(input)).toBe(output);
    });

    it('Debe manejar valores nulos o vacíos', () => {
      expect(escape(null)).toBe("");
      expect(escape(undefined)).toBe("");
      expect(escape(123)).toBe("123");
    });
  });

  describe('formatMoney: Formato monetario defensivo', () => {
    it('Formatea número con dos decimales y coma', () => {
      expect(window.LF.formatMoney(12.3)).toBe('12,30 €');
    });

    it('Formatea cero correctamente', () => {
      expect(window.LF.formatMoney(0)).toBe('0,00 €');
    });

    it('Formatea negativos', () => {
      expect(window.LF.formatMoney(-5.5)).toBe('-5,50 €');
    });

    it('Devuelve — para null', () => {
      expect(window.LF.formatMoney(null)).toBe('—');
    });

    it('Devuelve — para undefined', () => {
      expect(window.LF.formatMoney(undefined)).toBe('—');
    });

    it('Devuelve — para NaN', () => {
      expect(window.LF.formatMoney(NaN)).toBe('—');
    });
  });

  describe('formatValueForDisplay: no altera la semántica numérica', () => {
    const format = window.LF.formatValueForDisplay;
    const parse = window.LF.parseNum;

    it('preserva separadores de miles con punto', () => {
      expect(format('1.234')).toBe('1.234');
      expect(format('12.345')).toBe('12.345');
      expect(format('1.234.567')).toBe('1.234.567');
    });

    it('convierte solo puntos decimales inequívocos a coma', () => {
      expect(format('0.123')).toBe('0,123');
      expect(format('1234.56')).toBe('1234,56');
      expect(format('1 234.56')).toBe('1 234,56');
    });

    it('mantiene el valor numérico antes y después del formateo', () => {
      ['1.234', '12.345', '1.234.567', '0.123', '1234.56', '1 234.56'].forEach((raw) => {
        expect(parse(format(raw))).toBe(parse(raw));
      });
    });

    it('no maquilla formatos con varios puntos mal agrupados', () => {
      expect(format('12.34.567')).toBe('12.34.567');
      expect(format('1..234')).toBe('1..234');
    });
  });

  describe('esNumericoValido: estructura y precisión coherentes con parseNum', () => {
    const valid = window.LF.esNumericoValido;

    it('acepta enteros, decimales y miles europeos bien formados', () => {
      expect(valid('1234', 8)).toBe(true);
      expect(valid('1 234', 8)).toBe(true);
      expect(valid('1.234', 8)).toBe(true);
      expect(valid('1.234.567', 8)).toBe(true);
      expect(valid('1.234,56', 8)).toBe(true);
      expect(valid('1234.56', 8)).toBe(true);
      expect(valid('0.12345678', 8)).toBe(true);
    });

    it('rechaza múltiples puntos salvo agrupación estricta de miles', () => {
      expect(valid('1.2.3', 8)).toBe(false);
      expect(valid('12.34.567', 8)).toBe(false);
      expect(valid('1..234', 8)).toBe(false);
      expect(valid('1,2,3', 8)).toBe(false);
    });

    it('aplica maxDecimales tanto a coma como a punto decimal', () => {
      expect(valid('0,12345678', 8)).toBe(true);
      expect(valid('0.12345678', 8)).toBe(true);
      expect(valid('0,123456789', 8)).toBe(false);
      expect(valid('0.123456789', 8)).toBe(false);
      expect(valid('1234.567', 2)).toBe(false);
    });
  });

  describe('safeUrl: rutas relativas no pueden escapar de origen', () => {
    const safeUrl = window.LF.safeUrl;

    it('mantiene rutas relativas explícitas y http/https', () => {
      expect(safeUrl('/tarifas/oferta')).toBe('/tarifas/oferta');
      expect(safeUrl('../oferta')).toBe('../oferta');
      expect(safeUrl('https://example.com/oferta')).toBe('https://example.com/oferta');
    });

    it('bloquea esquemas peligrosos y URLs protocol-relative', () => {
      expect(safeUrl('javascript:alert(1)')).toBe('');
      expect(safeUrl('data:text/html,x')).toBe('');
      expect(safeUrl('//evil.example')).toBe('');
    });

    it('bloquea backslashes y controles que WHATWG convertiría en cross-origin', () => {
      expect(safeUrl('/\\evil.example')).toBe('');
      expect(safeUrl('/\t/evil.example')).toBe('');
      expect(safeUrl('/\r/evil.example')).toBe('');
      expect(safeUrl('/\n/evil.example')).toBe('');
    });
  });

  describe('Clamping y Redondeo', () => {
    it('round2: Debe redondear correctamente a 2 decimales', () => {
      expect(window.LF.round2(10.456)).toBe(10.46);
      expect(window.LF.round2(10.454)).toBe(10.45);
      expect(window.LF.round2(1.005)).toBe(1.01); // Caso típico de error float
    });

    it('clamp01to370Days: Debe validar el rango de días', () => {
      const clamp = window.LF.clamp01to365Days;
      expect(clamp(15)).toBe(15);
      expect(clamp(400)).toBe(370);
      expect(clamp(-5)).toBe(1);
      expect(clamp(0)).toBe(30); // Default según código
      expect(clamp("31.5")).toBe(31);
    });
  });

  describe('assessConsumoAnualLimits: requisitos de consumo y estimación opt-in', () => {
    const tarifas = [
      { nombre: 'Máximo 4000', maxConsumoAnual: 4000 },
      { nombre: 'Tramo 4000-8000', minConsumoAnualExclusivo: 4000, maxConsumoAnual: 8000 },
      { nombre: 'Sin límite' }
    ];

    it('solo excluye el máximo cuando los kWh ya registrados lo superan', () => {
      const parcial = window.LF.assessConsumoAnualLimits(tarifas, { consumoKwh: 500, annualScope: false });
      expect(parcial.compatibles.map((t) => t.nombre)).toEqual(['Máximo 4000', 'Tramo 4000-8000', 'Sin límite']);

      const supera = window.LF.assessConsumoAnualLimits(tarifas, { consumoKwh: 4100, annualScope: false });
      expect(supera.excluidas.map((item) => item.tarifa.nombre)).toEqual(['Máximo 4000']);
      expect(supera.excluidas[0]).toMatchObject({ tipo: 'maximo', limiteKwh: 4000 });
    });

    it('no excluye nunca por un mínimo de consumo, ni con año completo', () => {
      const parcial = window.LF.assessConsumoAnualLimits(tarifas, { consumoKwh: 3000, annualScope: false });
      expect(parcial.compatibles.map((t) => t.nombre)).toContain('Tramo 4000-8000');

      const anual = window.LF.assessConsumoAnualLimits(tarifas, { consumoKwh: 4000, annualScope: true });
      expect(anual.excluidas).toEqual([]);
      expect(anual.compatibles).toEqual(tarifas);
    });

    it('informa qué cambiaría la estimación sin aplicarla por defecto', () => {
      const parcial = window.LF.assessConsumoAnualLimits(tarifas, {
        consumoKwh: 500,
        annualScope: false,
        coveredDays: 30
      });

      expect(parcial.estimatedAnnualKwh).toBeCloseTo(6083.33, 2);
      expect(parcial.estimateAvailable).toBe(true);
      expect(parcial.estimateApplied).toBe(false);
      expect(parcial.compatibles).toEqual(tarifas);
      expect(parcial.excluidas).toEqual([]);
      expect(parcial.excluidasEstimadas.map((item) => item.tarifa.nombre)).toEqual(['Máximo 4000']);
    });

    it('aplica solo máximos proyectados tras el opt-in y no recupera una exclusión real', () => {
      const estimadaAlta = window.LF.assessConsumoAnualLimits(tarifas, {
        consumoKwh: 500,
        coveredDays: 30,
        useAnnualEstimate: true
      });
      expect(estimadaAlta.estimateApplied).toBe(true);
      expect(estimadaAlta.excluidas.map((item) => item.tarifa.nombre)).toEqual(['Máximo 4000']);
      expect(estimadaAlta.excluidas[0].origen).toBe('estimacion');

      const estimadaBaja = window.LF.assessConsumoAnualLimits(tarifas, {
        consumoKwh: 100,
        coveredDays: 30,
        useAnnualEstimate: true
      });
      expect(estimadaBaja.excluidas).toEqual([]);
      expect(estimadaBaja.compatibles).toEqual(tarifas);

      const real = window.LF.assessConsumoAnualLimits(tarifas, {
        consumoKwh: 4100,
        coveredDays: 200,
        useAnnualEstimate: false
      });
      expect(real.excluidas.map((item) => item.tarifa.nombre)).toEqual(['Máximo 4000']);
      expect(real.excluidas[0].origen).toBe('registrado');
    });
  });

  describe('calcPvpcBonoSocial: Lógica Fiscal PVPC', () => {
    const calc = window.LF.calcPvpcBonoSocial;

    it('Debe calcular el descuento correcto para Vulnerable (42,5%)', () => {
      const meta = { terminoFijo: 10, terminoVariable: 20, bonoSocial: 1, equipoMedida: 0.8 };
      const inputs = {
        bonoSocialOn: true,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 10000,
        dias: 30,
        cPunta: 100, cLlano: 100, cValle: 100 // Consumo total 300 kWh
      };

      const res = calc(meta, inputs, window.LF_CONFIG);

      // Base descuento: Fijo(10) + Margen(0 en test) + Bono(1) + Variable(20 ya que 300kWh > limite_periodo)
      // Nota: limitePeriodo = (10000/365)*30 = 821 kWh. Como 300 < 821, bonifica los 20€ enteros.
      // Total Base Descuento = 10 + 1 + 20 = 31€
      // Descuento = 31 * 0.425 = 13.18€ (vulnerable, RDL 7/2026 vigente durante 2026)
      expect(res.descuentoEur).toBe(13.18);
    });

    it('Debe aplicar el límite de kWh bonificables', () => {
      const meta = { terminoFijo: 10, terminoVariable: 100 }; // 100€ de energía
      const inputs = {
        bonoSocialOn: true,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 365, // 1 kWh al día de límite
        dias: 30,
        cPunta: 100, cLlano: 0, cValle: 0 // 100 kWh consumo total
      };

      const res = calc(meta, inputs, window.LF_CONFIG);

      // Límite periodo = (365 / 365) * 30 = 30 kWh
      expect(res.kwhBonificable).toBe(30);
      // Ratio = 30/100 = 0.3
      expect(res.ratioBonificable).toBe(0.3);
    });

    it('Debe aplicar fiscalidad de Canarias (IGIC 0% vivienda)', () => {
      const meta = { terminoFijo: 10, terminoVariable: 20, equipoMedida: 1 };
      const inputs = { zonaFiscal: 'Canarias', viviendaCanarias: true, p1: 3.45, p2: 3.45 };

      const res = calc(meta, inputs, window.LF_CONFIG);

      expect(res.meta.usoFiscal).toBe('vivienda');
      expect(res.meta.iva).toBe(0); // Vivienda en Canarias no paga IGIC energía
    });

    it('Falla de forma explícita si no está disponible la configuración regulada del descuento', () => {
      const meta = { terminoFijo: 10, terminoVariable: 20, bonoSocial: 1 };
      const inputs = {
        bonoSocialOn: true,
        bonoSocialTipo: 'vulnerable',
        bonoSocialLimite: 10000,
        dias: 30,
        cPunta: 100,
        cLlano: 0,
        cValle: 0
      };

      expect(() => calc(meta, inputs, {})).toThrow(/getBonoSocialDiscountRate/);
    });
  });

  describe('modalScrollLock: BODY es el scroller y los locks son reentrantes', () => {
    it('preserva scroll/estilos y solo restaura al liberar el último modal', () => {
      const lock = window.LF.modalScrollLock;
      document.body.scrollTop = 320;
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'clip';

      const first = lock.lock('factura');
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');

      document.body.scrollTop = 410;
      const second = lock.lock('csv');
      expect(lock.unlock(first)).toBe(true);
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');

      expect(lock.unlock(second)).toBe(true);
      expect(document.body.style.overflow).toBe('auto');
      expect(document.documentElement.style.overflow).toBe('clip');
      expect(document.body.scrollTop).toBe(320);

      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.scrollTop = 0;
    });
  });

});
