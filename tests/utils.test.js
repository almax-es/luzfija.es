import { describe, it, expect, beforeAll } from 'vitest';

// Setup global window object for utils
window.LF = window.LF || {};
window.LF_CONFIG = window.LF_CONFIG || {};

// Mock LF_CONFIG for calcPvpcBonoSocial tests
window.LF_CONFIG = {
  bonoSocial: { eurosAnuales: 10 },
  iee: { porcentaje: 5.11269632, minimoEurosKwh: 0.0005 },
  alquilerContador: { eurosMes: 0.81 },
  getTerritorio: (zona) => {
    if (zona === 'Canarias') return { nombre: 'Canarias', impuestos: { energiaOtros: 0.03, contador: 0.07 }, limiteViviendaKw: 10 };
    if (zona === 'CeutaMelilla') return { nombre: 'Ceuta y Melilla', impuestos: { energia: 0.01, contador: 0.04 } };
    return { nombre: 'Península', impuestos: { energia: 0.21, contador: 0.21 } };
  }
};

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

  describe('calcPvpcBonoSocial: Lógica Fiscal PVPC', () => {
    const calc = window.LF.calcPvpcBonoSocial;

    it('Debe calcular el descuento correcto para Vulnerable (42.5%)', () => {
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
      // Descuento = 31 * 0.425 = 13.18€ (vulnerable, decreto vigente)
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
  });

});
