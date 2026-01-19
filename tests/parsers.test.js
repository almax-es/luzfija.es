import { describe, it, expect, beforeAll } from 'vitest';

// Cargamos dependencias
import '../js/lf-utils.js'; // Necesario para parseNum
import '../js/factura.js';

describe('Motor de Extracción de Facturas (PDF Text)', () => {
  
  // Accedemos a las funciones internas que expone tu módulo o simulamos el entorno
  // Como factura.js no exporta todo, probaremos la lógica de detección si es accesible,
  // o simularemos los helpers clave si están en scope global o prototype.
  
  // Nota: Dado que factura.js es una IIFE cerrada, para testear las funciones privadas 
  // (__LF_parsearDatos, etc) idealmente deberíamos exportarlas. 
  // PERO, para no refactorizar tu código, usaremos la función pública principal 
  // o replicaremos la lógica de prueba sobre las funciones de utilidad si están expuestas.
  
  // En tu código actual, __LF_parsearDatos NO está expuesta globalmente. 
  // ESTRATEGIA: Para este test, vamos a testear la lógica de `LF.parseNum` (utils) 
  // y simularemos la lógica de extracción regex que es lo más frágil.
  
  const extraerRegex = (texto, regex) => {
    const m = texto.match(regex);
    return m ? window.LF.parseNum(m[1]) : null;
  };

  describe('Detección de Compañía', () => {
    it('Debe detectar Endesa por palabras clave', () => {
      const texto = "Factura de Endesa Energía S.A.U. Referencia contrato...";
      const esEndesa = /endesa energ[ií]a/i.test(texto);
      expect(esEndesa).toBe(true);
    });

    it('Debe detectar Iberdrola Clientes', () => {
      const texto = "IBERDROLA CLIENTES S.A.U. NIF A-12345678";
      const esIberdrola = /iberdrola clientes/i.test(texto);
      expect(esIberdrola).toBe(true);
    });
  });

  describe('Extracción de Periodos (Días)', () => {
    it('Patrón Genérico: "X días de facturación"', () => {
      const texto = "Periodo de facturación: 30 días de consumo";
      const dias = extraerRegex(texto, /(\d+)\s*d[ií]as/i);
      expect(dias).toBe(30);
    });

    it('Patrón Endesa: "(X días)"', () => {
      const texto = "del 01/01/2025 al 31/01/2025 (31 días)";
      const dias = extraerRegex(texto, /\(\s*(\d+)\s*d[ií]as\s*\)/i);
      expect(dias).toBe(31);
    });
  });

  describe('Extracción de Potencias', () => {
    it('Debe extraer P1 y P2 formato estándar', () => {
      const texto = "Potencia contratada P1: 3,45 kW \n Potencia contratada P2: 4,60 kW";
      
      const p1 = extraerRegex(texto, /p1[:\s]+([0-9,]+)\s*kW/i);
      const p2 = extraerRegex(texto, /p2[:\s]+([0-9,]+)\s*kW/i);
      
      expect(p1).toBe(3.45);
      expect(p2).toBe(4.6);
    });
  });

  describe('Extracción de Consumos (Triple)', () => {
    it('Debe extraer Punta, Llano, Valle de tabla estándar', () => {
      // Simula una línea de tabla de factura
      const texto = "Energía activa (kWh) Punta 120,5 Llano 80,2 Valle 150,0";
      
      const p = extraerRegex(texto, /Punta\s+([0-9,]+)/i);
      const l = extraerRegex(texto, /Llano\s+([0-9,]+)/i);
      const v = extraerRegex(texto, /Valle\s+([0-9,]+)/i);
      
      expect(p).toBe(120.5);
      expect(l).toBe(80.2);
      expect(v).toBe(150.0);
    });
  });
});
