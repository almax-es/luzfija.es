import { describe, it, expect, beforeAll } from 'vitest';

// Cargamos dependencias
import '../js/lf-utils.js'; // Necesario para parseNum
import '../js/factura-parsers.js';
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
    it('Debe detectar Bualá por marca o razón social', () => {
      const detectar = window.__LF_FacturaParsers.__LF_detectarCompania;
      expect(detectar('bualá luz (y ya)')).toBe('buala');
      expect(detectar('Energy Plus Iberia S.L.')).toBe('buala');
    });

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

  describe('Fallback genérico - no confundir consumo con potencia', () => {
    it('lee la fila Consumo (kWh) P1/P2/P3 sin confundir las fechas de lectura', () => {
      const texto = [
        'Período de consumo del 01/01/2026 al 31/01/2026 (31 días)',
        'Lectura Fecha P1 P2 P3',
        'Lectura inicial (kWh) Real 31/12/2025 1000 2000 3000',
        'Lectura final (kWh) Real 31/01/2026 1101 2202 3303',
        'Consumo (kWh) 101 202 303',
        'Potencia contratada: P1: 3,45 kW P2: 4,6 kW'
      ].join('\n');

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(
        texto,
        texto.replace(/\s+/g, ' ').trim()
      );

      expect(datos).toMatchObject({
        dias: 31,
        p1: 3.45,
        p2: 4.6,
        consumoPunta: 101,
        consumoLlano: 202,
        consumoValle: 303,
        confianza: 100
      });
    });

    it('no recorta como P1/P2/P3 una fila Consumo (kWh) con más de tres columnas', () => {
      const texto = 'Consumo (kWh) 10 20 30 60';
      const triple = window.__LF_FacturaParsers.__LF_extractTripleConsumo(texto);
      expect(triple).toBeNull();
    });

    it('deja P1/P2 a null si solo hay líneas Punta/Valle en kWh', () => {
      const texto = [
        '30 días',
        'Punta 10 kWh',
        'Llano 20 kWh',
        'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
      expect(datos.consumoPunta).toBe(10);
      expect(datos.consumoLlano).toBe(20);
      expect(datos.consumoValle).toBe(30);
    });

    it.each(['10,5', '10.5'])('no trunca un consumo decimal %s kWh para inventar P1/P2', (valor) => {
      const texto = [
        '30 días',
        `Punta ${valor} kWh`,
        `Llano 20,5 kWh`,
        `Valle 30,5 kWh`
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
      expect(datos.consumoPunta).toBe(10.5);
    });

    it('no interpreta el precio del término de potencia como kW contratados', () => {
      const texto = [
        '30 días',
        'Término de potencia P1 0,15 €/kW día',
        'Término de potencia P2 0,25 €/kW día',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
    });

    it('no interpreta precios de energía €/kWh como consumos', () => {
      const texto = [
        '30 días',
        'Energía activa P1 0,15 €/kWh',
        'Energía activa P2 0,12 €/kWh',
        'Energía activa P3 0,08 €/kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBeNull();
    });

    it.each([
      ['Detalle de energía activa'],
      ['Detalle de consumo'],
      ['Energía activa facturada']
    ])('tampoco reutiliza potencias kW como consumos por la vía de "%s" + bloque de potencia', (encabezado) => {
      // Misma familia que el test siguiente pero por OTRA ruta: los patrones individuales
      // del tipo /activa…P1…numero/ y /consumo…P1…numero/ admiten hasta 80-100 caracteres
      // entre la palabra clave y el periodo, asi que al compactar el documento un simple
      // encabezado de seccion queda pegado al bloque de potencia contratada y sus kW se
      // toman como kWh. Medido antes del arreglo: 3,45/4,60/300 con 100% de confianza, que
      // ademas dispara el autocalculo. El guard dimensional debe rechazar un valor seguido
      // de `kW` tambien aqui, no solo en el fallback de tabla compacta.
      const texto = [
        'Factura', '31 días',
        encabezado,
        'Potencia contratada P1 3,45 kW',
        'Potencia contratada P2 4,60 kW',
        'Consumo P3 300 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBe(300);
      // La potencia contratada SI debe seguir leyendose: solo se rechaza como consumo.
      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
      // Por debajo del umbral de autocalculo (99,5%): el usuario revisa antes de calcular.
      expect(datos.confianza).toBeLessThan(99.5);
    });

    it('con los tres consumos reales presentes no cambia nada (regresión del guard kW)', () => {
      const texto = [
        'Factura', '31 días',
        'Detalle de energía activa',
        'Potencia contratada P1 3,45 kW',
        'Potencia contratada P2 4,60 kW',
        'Consumo P1 100 kWh', 'Consumo P2 200 kWh', 'Consumo P3 300 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
    });

    it('no reutiliza potencias kW como consumos al compactar si faltan periodos de consumo', () => {
      const texto = [
        'Factura eléctrica',
        '31 días',
        'Potencia contratada',
        'P1',
        '3,45 kW',
        'P2',
        '4,60 kW',
        'Consumo total 500 kWh',
        'Consumo facturado P2 200 kWh',
        'Consumo facturado P3 300 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
      expect(datos.consumoTotalDetectado).toBe(500);
      expect(datos.confianza).toBe(83);
    });

    it('lee una tabla con etiquetas y valores en líneas alternas (fallback compacto)', () => {
      // Formato frecuente en PDF: cada etiqueta y cada valor en su propia línea. Ninguna
      // línea suelta contiene a la vez la unidad y los tres periodos, así que el extractor
      // estructurado no puede resolverlo y hace falta el fallback sobre el texto compacto.
      // Regresión de la propuesta (rechazada el 15/08/2026) de desactivar ese fallback
      // cuando el documento conserva saltos de línea: dejaba este caso sin detectar.
      const texto = ['Consumo Energía (kWh)', 'Punta', '100', 'Llano', '200', 'Valle', '300'].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('no convierte una línea compacta de precios P1/P2/P3 en una tabla de consumos', () => {
      const texto = '30 días P1 0,15 €/kWh P2 0,12 €/kWh P3 0,08 €/kWh';
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto);

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBeNull();
    });

    it('parsea una tabla compacta con cabecera P1/P2/P3 sin tomar los dígitos de las etiquetas', () => {
      const texto = 'Energía (kWh) P1 P2 P3 100 200 300';
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto);

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });


    it('parsea cabecera P1/P2/P3 y valores en la línea siguiente sin inventar 3/3/3', () => {
      const texto = ['Energía (kWh)', 'P1 P2 P3', '100 200 300'].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('no convierte precios €/kWh de una tabla multilinea en consumos', () => {
      const texto = ['Energía kWh', 'P1 0,15 €/kWh', 'P2 0,12 €/kWh', 'P3 0,08 €/kWh'].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBeNull();
    });

    it('prefiere la cantidad kWh al precio unitario e importe de la misma fila', () => {
      const texto = [
        'Energía kWh',
        'P1 100 kWh 0,15 €/kWh 15,00 €',
        'P2 200 kWh 0,12 €/kWh 24,00 €',
        'P3 300 kWh 0,08 €/kWh 24,00 €'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('"Ajuste lectura distribuidora" (DISA) NO desactiva la extracción de consumos', () => {
      // Regresion REAL medida sobre Factura EP26 1003403.pdf (DISA): la factura contiene
      // la frase "Ajuste lectura distribuidora" junto a su tabla de telegestion, y el guard
      // anti-lecturas la tomaba por el encabezado de una tabla de lecturas acumuladas. Los
      // consumos 346/310/313 desaparecian y la confianza caia de 100% a 50%, pese a que el
      // documento dice literalmente "Energia P1 346 kWh x 0,108700 €/kWh". El guard exige
      // ahora plural + articulo ("Lecturas del contador"), que es como se titula esa tabla.
      const texto = [
        'DISA Energia Electrica',
        'Consumo Ajuste lectura distribuidora 06/01/2026 04/02/2026 Telegestión',
        'P1 2.621 2.967 346',
        'Energía P1 346 kWh x 0,108700 €/kWh 37,61 €',
        'Energía P2 310 kWh x 0,108700 €/kWh 33,70 €',
        'Energía P3 313 kWh x 0,108700 €/kWh 34,02 €'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(346);
      expect(datos.consumoLlano).toBe(310);
      expect(datos.consumoValle).toBe(313);
    });

    it('una mención suelta de "Lectura anterior" NO desactiva la extracción de consumos', () => {
      // Casi cualquier factura española menciona la lectura anterior/actual del contador.
      // El guard que protege de las lecturas acumuladas debe reconocer el ENCABEZADO de esa
      // tabla ("Lecturas del contador"), no cualquier aparición de la palabra: si no, deja
      // sin consumos a facturas normales. Medido antes de acotarlo: 100/200/300 -> null.
      const texto = ['Factura', 'Lectura anterior: 15/01/2026', '30 días',
        'Punta 100 kWh', 'Llano 200 kWh', 'Valle 300 kWh'].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('no usa lecturas acumuladas del contador como consumo facturado', () => {
      const texto = ['Lecturas del contador', 'P1 12345 kWh', 'P2 23456 kWh', 'P3 34567 kWh'].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBeNull();
    });

    it('prioriza el consumo facturado cuando convive con lecturas acumuladas', () => {
      const texto = [
        'Lecturas del contador',
        'P1 12345 kWh', 'P2 23456 kWh', 'P3 34567 kWh',
        'Consumo facturado',
        'P1 345 kWh', 'P2 456 kWh', 'P3 567 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBe(345);
      expect(datos.consumoLlano).toBe(456);
      expect(datos.consumoValle).toBe(567);
    });

    it('prioriza "Consumo en Pn" cuando la misma fila también contiene la lectura acumulada', () => {
      // Formato real de Energía XXI/Curenergía: lectura acumulada y consumo del periodo
      // comparten línea. Producción tomaba la lectura de P2/P3 aunque el consumo explícito
      // aparecía unos caracteres después.
      const texto = [
        'ENERGÍA XXI',
        'Lectura actual (real) (25 de diciembre de 2023)',
        'Lectura en P1: 008231 kWh Consumo en P1: 46 kWh',
        'Lectura en P2: 007158 kWh Consumo en P2: 38 kWh',
        'Lectura en P3: 003933 kWh Consumo en P3: 94 kWh',
        'Facturación por potencia contratada P1 3,3 kW P2 3,3 kW 29 días'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBe(3.3);
      expect(datos.p2).toBe(3.3);
      expect(datos.consumoPunta).toBe(46);
      expect(datos.consumoLlano).toBe(38);
      expect(datos.consumoValle).toBe(94);
    });

    it('mantiene decimales ES en filas Lectura + Consumo del mismo periodo', () => {
      const texto = [
        'Lectura en P1 (punta): 8.893,69 kWh Consumo en P1: 57,85 kWh',
        'Lectura en P2 (llano): 2.093,92 kWh Consumo en P2: 78,36 kWh',
        'Lectura en P3 (valle): 3.276,28 kWh Consumo en P3: 101,99 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBe(57.85);
      expect(datos.consumoLlano).toBe(78.36);
      expect(datos.consumoValle).toBe(101.99);
    });

    it('una tabla local "Lectura en Pn" sin consumo no se convierte en consumo facturado', () => {
      const texto = [
        'Lectura actual (real)',
        'Lectura en P1 (punta): 14.212 kWh',
        'Lectura en P2 (llano): 6.531 kWh',
        'Lectura en P3 (valle): 1.200 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBeNull();
    });

    it('no convierte producción/generación/exportación por periodos en consumo de red', () => {
      for (const etiqueta of ['Producción', 'Generación', 'Autoconsumo', 'Vertido', 'Exportación', 'Excedente']) {
        const texto = [
          `${etiqueta} P1 100 kWh`,
          `${etiqueta} P2 200 kWh`,
          `${etiqueta} P3 300 kWh`
        ].join('\n');
        const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());
        expect(datos.consumoPunta, etiqueta).toBeNull();
        expect(datos.consumoLlano, etiqueta).toBeNull();
        expect(datos.consumoValle, etiqueta).toBeNull();
      }
    });

    it('si conviven producción y consumo facturado, conserva el consumo y descarta la producción como candidato', () => {
      const texto = [
        'Producción P1 400 kWh', 'Producción P2 500 kWh', 'Producción P3 600 kWh',
        'Consumo facturado',
        'P1 100 kWh', 'P2 200 kWh', 'P3 300 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('lee la columna Consumo de tablas Desde/Hasta/Lectura anterior/Lectura actual sin tomar el día de la fecha', () => {
      const texto = [
        'Periodo de facturación: 13/09/2023 a 12/10/2023',
        'Desde Hasta Lectura anterior Lectura actual Ajuste Consumo',
        'Consumo P1 13/09/2023 12/10/2023 11587.00 11627.00 40.00',
        'Consumo P2 13/09/2023 12/10/2023 10954.00 11003.00 49.00',
        'Consumo P3 13/09/2023 12/10/2023 2244.00 2318.00 74.00'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.dias).toBe(30);
      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
      expect(datos.consumoPunta).toBe(40);
      expect(datos.consumoLlano).toBe(49);
      expect(datos.consumoValle).toBe(74);
    });

    it('no confunde las potencias máximas demandadas de Endesa con potencia contratada', () => {
      const texto = 'Endesa Energía S.A. Las potencias máximas demandadas en el último año han sido 3,980 kW en P1 (punta) y 3,950 kW en P3 (valle).';
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto);

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
    });

    it('tampoco confunde máximas demandadas en una factura genérica', () => {
      const texto = 'Potencias máximas demandadas P1 3,98 kW P2 3,95 kW';
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto);

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
    });

    it('mantiene el soporte de P1/P2 sin unidad cuando no son kWh', () => {
      const texto = [
        '30 días',
        'P1: 3,45',
        'P2: 4,60',
        'Punta 10 kWh',
        'Llano 20 kWh',
        'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
    });


    it('no cruza líneas compactadas para asociar una potencia sin periodo con Punta de consumo', () => {
      const texto = [
        'Potencia contratada 3,45 kW',
        'Periodo del 01/01/2026 al 31/01/2026 (31 dias)',
        'Punta 100 kWh',
        'Llano 200 kWh',
        'Valle 300 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
      expect(datos.consumoPunta).toBe(100);
    });

    it('mantiene el formato inverso valor-kW-periodo cuando está en la misma línea', () => {
      const texto = ['Potencia 3,45 kW P1', 'Potencia 4,60 kW P2'].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
    });

    it('no inventa consumo P1 desde la etiqueta P2 cuando P1 solo declara la unidad', () => {
      const texto = ['P1 kWh', 'P2 200 kWh', 'P3 300 kWh'].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('mantiene el formato unit-before-value P1 kWh 100 sin cruzar periodos', () => {
      const texto = ['P1 kWh 100', 'P2 kWh 200', 'P3 kWh 300'].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBe(100);
      expect(datos.consumoLlano).toBe(200);
      expect(datos.consumoValle).toBe(300);
    });

    it('mantiene fail-closed si máximas demandadas ponen sus P1/P2 en líneas posteriores', () => {
      const texto = ['Potencias máximas demandadas', 'P1 3,98 kW', 'P2 3,95 kW'].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
    });

    it('recupera P1/P2 reales bajo Datos del contrato aunque convivan con máximas demandadas', () => {
      const texto = [
        'Potencias máximas demandadas',
        'P1 3,98 kW',
        'P2 3,95 kW',
        'Datos del contrato',
        'P1: 3,45 kW',
        'P2: 4,60 kW'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
    });


    it('un encabezado Potencia contratada vacío no legitima P1/P2 de máximas demandadas', () => {
      const texto = [
        'Potencia contratada',
        'Potencias máximas demandadas',
        'P1 3,98 kW',
        'P2 3,95 kW'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
    });

    it.each([
      ['TotalEnergies', 'P2 3,95 kW'],
      ['Imagina Energía', 'P2 3,95 kW'],
      ['DISA Energía', 'P3 3,95 kW']
    ])('%s no salta el guard de máximas demandadas con su extractor específico', (marca, lineaP2) => {
      const texto = [marca, 'Potencias máximas demandadas', 'P1 3,98 kW', lineaP2].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
    });
  });

  describe('TotalEnergies - no confundir precios de potencia con kW contratados', () => {
    it('ignora P1/P2 expresados como €/kW·día pero conserva los consumos', () => {
      const texto = [
        'TotalEnergies',
        '30 días',
        'Potencia P1: 0,15 €/kW día',
        'Potencia P2: 0,25 €/kW día',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBeNull();
      expect(datos.p2).toBeNull();
      expect(datos.consumoPunta).toBe(10);
      expect(datos.consumoLlano).toBe(20);
      expect(datos.consumoValle).toBe(30);
    });

    it('mantiene el formato válido P1 sin unidad cuando P2 lleva kW', () => {
      const texto = [
        'TotalEnergies',
        '30 días',
        'Potencia contratada: P1: 3,45 P2: 4,60 kW',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
    });
  });

  describe('Consumos genéricos - no confundir consumo total con lecturas acumuladas', () => {
    it('no usa P1/P2/P3 de Lecturas del contador aunque antes aparezca Consumo total', () => {
      const texto = [
        'Consumo total: 600 kWh',
        'Lecturas del contador',
        'P1 12345 kWh',
        'P2 23456 kWh',
        'P3 34567 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBeNull();
      expect(datos.consumoLlano).toBeNull();
      expect(datos.consumoValle).toBeNull();
      expect(datos.consumoTotalDetectado).toBe(600);
    });

    it('si después de las lecturas existe Consumo facturado, prioriza ese bloque real', () => {
      const texto = [
        'Consumo total: 1368 kWh',
        'Lecturas del contador',
        'P1 12345 kWh',
        'P2 23456 kWh',
        'P3 34567 kWh',
        'Consumo facturado',
        'P1 345 kWh',
        'P2 456 kWh',
        'P3 567 kWh'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.consumoPunta).toBe(345);
      expect(datos.consumoLlano).toBe(456);
      expect(datos.consumoValle).toBe(567);
    });
  });

  describe('Dominio del comparador - peajes no 2.0TD', () => {
    it.each(['3.0TD', '6.1TD', '6.2TD', '6.3TD', '6.4TD'])(
      'marca %s como peaje no soportado y no reutiliza sus primeros periodos',
      (peaje) => {
        const texto = [
          `Peaje de acceso ${peaje}`,
          'Potencia contratada P1: 10 kW',
          'Potencia contratada P2: 12 kW',
          'Potencia contratada P3: 16 kW',
          'Consumo P1: 100 kWh',
          'Consumo P2: 200 kWh',
          'Consumo P3: 300 kWh'
        ].join('\n');
        const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

        expect(datos.peajeNoSoportado).toBe(true);
        expect(datos.peajeAcceso).toBe(peaje);
        expect(datos.p1).toBeNull();
        expect(datos.p2).toBeNull();
        expect(datos.consumoPunta).toBeNull();
        expect(datos.consumoLlano).toBeNull();
        expect(datos.consumoValle).toBeNull();
        expect(datos.confianza).toBe(0);
      }
    );

    it('no bloquea una 2.0TD cuya letra pequeña menciona el peaje de acceso 3.0TD', () => {
      // Caso real y frecuente: la factura declara su peaje (2.0TD) y ademas explica que
      // por encima de 15 kW pasarias a 3.0TD. Sin tener en cuenta la declaracion propia,
      // el detector bloqueaba una factura perfectamente valida (medido: p1/p2/consumos
      // pasaban a null). Una factura solo tiene un peaje: el que declara.
      const texto = [
        'Peaje de acceso: 2.0TD',
        'Potencia contratada P1 3,45 kW P2 4,60 kW',
        '30 días',
        'Punta 100 kWh', 'Llano 200 kWh', 'Valle 300 kWh',
        'Si su potencia contratada supera los 15 kW se le aplicará el peaje de acceso 3.0TD.'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.peajeNoSoportado).toBeFalsy();
      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
      expect(datos.consumoPunta).toBe(100);
    });

    it('no bloquea una mera mención informativa a 3.0TD sin etiqueta de acceso', () => {
      const texto = [
        'Información sobre 3.0TD disponible en la web',
        'Peaje de acceso 2.0TD',
        'Potencia contratada P1: 3,45 kW',
        'Potencia contratada P2: 4,60 kW',
        'Consumo Punta: 100 kWh',
        'Consumo Llano: 200 kWh',
        'Consumo Valle: 300 kWh',
        '30 días'
      ].join('\n');
      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' ').trim());

      expect(datos.peajeNoSoportado).not.toBe(true);
      expect(datos.p1).toBe(3.45);
      expect(datos.p2).toBe(4.6);
      expect(datos.consumoPunta).toBe(100);
    });
  });

  describe('Días de factura - no aceptar decimales por matches parciales', () => {
    it('ignora 30,5 días en vez de convertirlo en 5 o 30', () => {
      const texto = '30,5 días';
      expect(window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto).dias).toBeNull();
    });

    it('puede recuperar otra mención entera válida aunque exista una decimal inválida', () => {
      const texto = 'Detalle 30,5 días. Total días facturados: 31';
      expect(window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto).dias).toBe(31);
    });

    it('no interpreta el piso 1ºD de una dirección como un día', () => {
      const texto = 'Adreça de subministrament: Carrer Major 8 - 1ºD';
      expect(window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto).dias).toBeNull();
    });

    it('reconoce el campo catalán Dies aunque la dirección contenga 1ºD', () => {
      const texto = 'Adreça: Carrer Major 8 - 1ºD. Període facturat. Dies: 30';
      expect(window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto).dias).toBe(30);
    });
  });

  describe('QR CNMC - validar origen y datos antes de dar confianza 100%', () => {
    it('convierte la potencia anual a la base fija de 365 días del comparador', () => {
      const annual = 27.704413;
      const daily = window.__LF_FacturaParsers.__LF_qrAnnualPowerPriceToDaily(annual);

      expect(daily).toBeCloseTo(annual / 365, 15);
      expect(daily).not.toBeCloseTo(annual / 366, 8);
      expect(new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 }).format(daily)).toBe('0,075903');
    });

    it('solo prepara Mi tarifa para contratos fijos sin cuota y con cinco precios válidos', () => {
      const base = {
        tipoContrato: 'E0',
        precioEnergiaP1: 0.15,
        precioEnergiaP2: 0.12,
        precioEnergiaP3: 0.09,
        precioPotenciaP1: 27.704413,
        precioPotenciaP2: 0.725423
      };
      expect(window.__LF_FacturaParsers.__LF_qrInfoToCustomTarifaPrices(base)).toEqual({
        punta: 0.15,
        llano: 0.12,
        valle: 0.09,
        p1: 27.704413 / 365,
        p2: 0.725423 / 365
      });
      expect(window.__LF_FacturaParsers.__LF_qrInfoToCustomTarifaPrices({
        ...base,
        tipoContrato: 'F0',
        precioEnergiaP2: 0,
        precioEnergiaP3: 0,
        precioPotenciaP2: 0
      })).toEqual({
        punta: 0.15,
        llano: 0.15,
        valle: 0.15,
        p1: 27.704413 / 365,
        p2: 0
      });
      expect(window.__LF_FacturaParsers.__LF_qrInfoToCustomTarifaPrices({ ...base, tipoContrato: 'B0' })).toBeNull();
      expect(window.__LF_FacturaParsers.__LF_qrInfoToCustomTarifaPrices({ ...base, tipoContrato: 'E1' })).toBeNull();
      expect(window.__LF_FacturaParsers.__LF_qrInfoToCustomTarifaPrices({ ...base, precioEnergiaP3: null })).toBeNull();
    });

    it('explica por qué un QR no puede alimentar Mi tarifa', () => {
      const base = {
        tipoContrato: 'E0',
        precioEnergiaP1: 0.15,
        precioEnergiaP2: 0.12,
        precioEnergiaP3: 0.09,
        precioPotenciaP1: 27.704413,
        precioPotenciaP2: 0.725423
      };
      const evaluar = info => window.__LF_FacturaParsers.__LF_qrCustomTarifaAvailability(info);

      expect(evaluar(base)).toMatchObject({ motivo: 'ok', precios: expect.any(Object) });
      expect(evaluar({ ...base, tipoContrato: 'A0' })).toEqual({
        motivo: 'tipo-no-representable',
        precios: null
      });
      expect(evaluar({ ...base, tipoContrato: null })).toEqual({
        motivo: 'qr-datos-incompletos',
        precios: null
      });
      expect(evaluar({ ...base, precioEnergiaP3: null })).toEqual({
        motivo: 'qr-precios-incompletos',
        precios: null
      });
      expect(evaluar({ ...base, precioPotenciaP1: 500 })).toEqual({
        motivo: 'qr-precios-incompletos',
        precios: null
      });
    });

    it('rechaza hosts que solo contienen el dominio CNMC como substring', () => {
      const url = 'https://comparador.cnmc.gob.es.ejemplo.com/comparador/QRE?pP1=3.45&pP2=4.6&cfP1=10&cfP2=20&cfP3=30';
      expect(window.__LF_FacturaParsers.__LF_isTrustedCnmcQrUrl(url)).toBe(false);
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toBeNull();
    });

    it('rechaza rutas distintas aunque el hostname CNMC sea exacto', () => {
      const url = 'https://comparador.cnmc.gob.es/otro/QRE?pP1=3.45&pP2=4.6&cfP1=10&cfP2=20&cfP3=30';
      expect(window.__LF_FacturaParsers.__LF_isTrustedCnmcQrUrl(url)).toBe(false);
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toBeNull();
    });

    it('acepta las rutas oficiales QRE y QRE2, pero no variantes por prefijo', () => {
      window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };
      const query = 'pP1=3.45kW&pP2=4.6kW&cfP1=101kWh&cfP2=202kWh&cfP3=303kWh&iniF=2026-01-01&finF=2026-01-31';
      for (const route of ['QRE', 'QRE2']) {
        const url = `https://comparador.cnmc.gob.es/comparador/${route}?${query}`;
        expect(window.__LF_FacturaParsers.__LF_extractQRUrl(`Factura ${url}`)).toBe(url);
        expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toMatchObject({
          p1: 3.45,
          p2: 4.6,
          consumoPunta: 101,
          consumoLlano: 202,
          consumoValle: 303,
          dias: 30,
          confianza: 100
        });
      }

      for (const route of ['QRE20', 'QRE2/otro']) {
        const url = `https://comparador.cnmc.gob.es/comparador/${route}?${query}`;
        expect(window.__LF_FacturaParsers.__LF_isTrustedCnmcQrUrl(url)).toBe(false);
        expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toBeNull();
      }
    });

    it('rechaza campos obligatorios no numéricos en un QR de origen válido', () => {
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=abc&pP2=4.6&cfP1=10&cfP2=20&cfP3=30';
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toBeNull();
    });


    it('rechaza unidades QR dimensionalmente incorrectas en campos numéricos', () => {
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45kWh&pP2=4.6kW&cfP1=10kW&cfP2=20kWh&cfP3=30kWh';
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toBeNull();
    });

    it('rechaza basura tras el prefijo numérico en parámetros QR', () => {
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45texto&pP2=4.6kW&cfP1=10kWh&cfP2=20kWh&cfP3=30kWh';
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toBeNull();
    });

    it('acepta el formato QR con sufijos de unidad y conserva consumos cero', () => {
      window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45kW&pP2=4.60kW&cfP1=0kWh&cfP2=20kWh&cfP3=30kWh&iniF=2026-01-01&finF=2026-01-31';
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toMatchObject({
        p1: 3.45,
        p2: 4.6,
        consumoPunta: 0,
        consumoLlano: 20,
        consumoValle: 30,
        dias: 30,
        confianza: 100,
        fuenteDatos: 'QR'
      });
    });

    it('acepta nombres de parámetros QR con cualquier combinación de mayúsculas/minúsculas', () => {
      window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?PP1=3.45kW&pp2=4.60kW&CFP1=0kWh&cFp2=20kWh&cfp3=30kWh&INIF=2026-01-01&fInF=2026-01-31';
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toMatchObject({
        p1: 3.45,
        p2: 4.6,
        consumoPunta: 0,
        consumoLlano: 20,
        consumoValle: 30,
        dias: 30,
        confianza: 100,
        fuenteDatos: 'QR'
      });
    });

    it('no normaliza fechas QR imposibles a otro día válido', () => {
      window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45&pP2=4.60&cfP1=10&cfP2=20&cfP3=30&iniF=2026-02-31&finF=2026-03-31';
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toMatchObject({
        p1: 3.45,
        p2: 4.6,
        consumoPunta: 10,
        consumoLlano: 20,
        consumoValle: 30,
        dias: null,
        confianza: 100
      });
    });

    it('extrae la información contractual y económica sin conservar CUPS ni código postal', () => {
      window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };
      const url = [
        'https://comparador.cnmc.gob.es/comparador/QRE2?',
        'pP1=3.45&pP2=3.45&cfP1=188&cfP2=157&cfP3=244',
        '&iniF=2026-07-15&finF=2026-08-12&fFact=2026-08-25',
        '&com=R2-796&tc=E0&tf=N&finContrato=2027-07-15&finPen=0000-00-00',
        '&rev=0&verde=1&imp=85.38&impPot=15.46&impEner=50.3&impSA=0',
        '&finBS=0.69&impOtrosSinIE=0.75&prP1=29.2&prP2=29.2',
        '&prE1=0.0852&prE2=0.0852&prE3=0.0852&pmaxP1=4.344&pmaxP2=4.44',
        '&cups=ES0021000000000000AA&cp=50420'
      ].join('');
      const parsed = window.__LF_FacturaParsers.__LF_parseQRData(url);

      expect(parsed).toMatchObject({
        dias: 28,
        codigoComercializadora: 'R2-796',
        qrInfo: {
          codigoComercializadora: 'R2-796',
          fechaFactura: '2026-08-25',
          finContrato: '2027-07-15',
          permanencia: false,
          tipoContrato: 'E0',
          revisionPrecios: 0,
          energiaVerde: true,
          totalFacturado: 85.38,
          precioEnergiaP1: 0.0852,
          potenciaMaximaP2: 4.44
        }
      });
      expect(JSON.stringify(parsed).toLowerCase()).not.toContain('cups');
      expect(JSON.stringify(parsed)).not.toContain('50420');
      expect(JSON.stringify(parsed)).not.toContain('ES0021000000000000AA');
    });

    it('descarta campos informativos mal formados sin invalidar los consumos estructurales', () => {
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45&pP2=4.6&cfP1=10&cfP2=20&cfP3=30&imp=85.38texto&com=%3Cscript%3E&tc=E9';
      const parsed = window.__LF_FacturaParsers.__LF_parseQRData(url);
      expect(parsed).toMatchObject({
        confianza: 100,
        codigoComercializadora: null,
        qrInfo: {
          codigoComercializadora: null,
          tipoContrato: null,
          totalFacturado: null
        }
      });
      expect(JSON.stringify(parsed)).not.toContain('<script>');
    });

    it('acepta los códigos R2 de cuatro cifras que ya publica el censo vivo de la CNMC', () => {
      const url = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45&pP2=4.6&cfP1=10&cfP2=20&cfP3=30&com=R2-1000';
      expect(window.__LF_FacturaParsers.__LF_isCnmcCommercializerCode('r2-1000')).toBe(true);
      expect(window.__LF_FacturaParsers.__LF_isCnmcCommercializerCode('R2-10000')).toBe(false);
      expect(window.__LF_FacturaParsers.__LF_parseQRData(url)).toMatchObject({
        codigoComercializadora: 'R2-1000',
        qrInfo: { codigoComercializadora: 'R2-1000' }
      });
    });
  });

  describe('Octopus Energy - Potencias con formato X,XXX', () => {
    it('No debe confundir kWh (consumo) con kW (potencia)', () => {
      // Simula texto de factura Octopus con potencia "3,300 kW" y consumo "27,01 kWh"
      const texto = "Potencia 11,33 €\nPunta 3,300 kW * 29 días 0,093 €/kW/día\nValle 3,300 kW * 29 días\nEnergía Activa 8,29 €\nPunta 27,01 kWh\nLlano 14,83 kWh\nValle 29,63 kWh";

      // Los patrones de potencia con kw\b NO deben hacer match con kWh
      const reP1_kw = /punta[^\d]{0,40}([0-9][0-9\.,]*)\s*kw\b/i;
      const m1 = texto.match(reP1_kw);
      expect(m1).not.toBeNull();
      // Debe capturar 3,300 (el valor de kW), NO 27,01 (kWh)
      expect(m1[1]).toBe('3,300');

      // El patrón "Punta X kW *" distingue potencia de consumo
      const reOctopus = /punta\s+([0-9][0-9\.,]*)\s*kw\s*\*/i;
      const mOc = texto.match(reOctopus);
      expect(mOc).not.toBeNull();
      expect(parseFloat(mOc[1].replace(',', '.'))).toBe(3.3);
    });

    it('Debe extraer de tabla "Potencia Contratada (kW) X Y"', () => {
      const texto = "Potencia Contratada (kW) 3,300 3,300 0 0 0 0";
      const m = texto.match(/potencia\s+contratada\s*\(kw\)\s+([0-9][0-9\.,]*)\s+([0-9][0-9\.,]*)/i);
      expect(m).not.toBeNull();
      expect(parseFloat(m[1].replace(',', '.'))).toBe(3.3);
      expect(parseFloat(m[2].replace(',', '.'))).toBe(3.3);
    });
  });

  describe('Plenitude - Potencias con formato X,XXX0', () => {
    it('Debe parsear "3,450 kW" como 3.45 (no como 3450)', () => {
      const texto = "Potencia contratada P1: 3,450 kW P2: 3,450 kW";
      const m1 = texto.match(/potencia\s+contratada\s+p1[:\s]+([0-9][0-9\.,]*)\s*kw\b/i);
      const m2 = texto.match(/potencia\s+contratada\s+[^\n]*p2[:\s]+([0-9][0-9\.,]*)\s*kw\b/i);
      expect(m1).not.toBeNull();
      expect(m2).not.toBeNull();
      expect(parseFloat(m1[1].replace(',', '.'))).toBe(3.45);
      expect(parseFloat(m2[1].replace(',', '.'))).toBe(3.45);
    });

    it('Debe parsear "3,4500 kW *" del detalle de factura', () => {
      const texto = "Periodo P1 (15/10/2025 - 15/11/2025): 3,4500 kW * 0,073782 €/kW día * 32 días";
      const m = texto.match(/periodo\s+p1\b[^:]*:\s*([0-9][0-9\.,]*)\s*kw\s*\*/i);
      expect(m).not.toBeNull();
      expect(parseFloat(m[1].replace(',', '.'))).toBe(3.45);
    });
  });

  describe('P1 contratada = 0 kW', () => {
    it('el parser público conserva el 0 contractual y no captura un consumo como potencia', () => {
      const texto = [
        'Factura eléctrica',
        'Potencia contratada P1: 0 kW',
        'Potencia contratada P2: 7,4 kW',
        '30 días',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBe(0);
      expect(datos.p2).toBe(7.4);
    });

    it.each(['P1: 0 kW', 'Potencia P1: 0 kW'])('%s no cae al consumo Punta como falso P1', (lineaP1) => {
      const texto = [
        'Factura eléctrica',
        lineaP1,
        'P2: 7,4 kW',
        '30 días',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBe(0);
      expect(datos.p2).toBe(7.4);
    });

    it('Octopus conserva P1=0 de su tabla específica sin caer al fallback genérico', () => {
      const texto = [
        'Octopus Energy',
        'Potencia Contratada (kW) 0,000 7,400 0 0 0 0',
        '30 días',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBe(0);
      expect(datos.p2).toBe(7.4);
    });

    it('Endesa conserva P1=0 cuando Pot. Punta-Llano y Pot. Valle están en líneas separadas', () => {
      const texto = [
        'Endesa Energía S.A.',
        'Pot. Punta-Llano 0 kW',
        'Pot. Valle 7,400 kW',
        '30 días',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.p1).toBe(0);
      expect(datos.p2).toBe(7.4);
    });
  });

  describe('Días de facturación hasta el límite público de 370', () => {
    it.each([201, 365, 370])('el parser público conserva %i días en vez de degradarlo a otro número', (dias) => {
      const texto = [
        'Factura eléctrica',
        `${dias} días`,
        'Potencia contratada P1: 3 kW',
        'Potencia contratada P2: 3 kW',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.dias).toBe(dias);
    });

    it('un valor explícito fuera de rango no se degrada a un número de otro campo', () => {
      const texto = [
        'Factura eléctrica',
        '371 días',
        'Potencia contratada P1: 3 kW',
        'Potencia contratada P2: 3 kW',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.dias).toBeNull();
    });

    it('si solo hay rango de fechas usa el rango de facturacion inclusivo (enero entero = 31)', () => {
      const texto = [
        'Factura eléctrica',
        'Periodo de facturación 01/01/2026 - 31/01/2026',
        'Potencia contratada P1: 3 kW',
        'Potencia contratada P2: 3 kW',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      // "Periodo de facturacion 01/01 - 31/01" es un rango en lenguaje natural, inclusivo:
      // enero entero son 31 dias. La regla CNMC de lectura inicial excluida se aplica en la
      // ruta del QR (iniF/finF), no aqui (ver AUDITORIA-REGISTRO.md, hallazgo rechazado 15/08/2026).
      expect(datos.dias).toBe(31);
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

    it('Visalia: lecturas de contador (15364,00) NO deben confundirse con consumo facturado', () => {
      // invoice-21170005: pág. 3 tiene "P1 15364,00 15398,00 34,00" (lectura contador, periodo ene-feb)
      // pero el consumo facturado en pág. 2 es: P1=0, P2=2,48 kWh, P3=4,32 kWh
      // El extractor Visalia usa "Término de energía P1/P2/P3 X kWh" y devuelve 0 si P1 ausente
      const texto = [
        'Término de energia P2 2,48 kWh 0,097999 €/kWh 0,24 €',
        'Término de energia P3 4,32 kWh 0,097922 €/kWh 0,42 €',
        // Tabla de lecturas que NO debe usarse:
        'P1 15364,00 15398,00 34,00 0,00',
        'P2 3300,00 3327,00 27,00',
        'P3 3424,00 3479,00 55,00 0,00',
      ].join('\n');

      const mP1 = texto.match(/t[eé]rmino\s+de\s+energ[ií]a\s+p1\s+([0-9][0-9\.,]*)\s*kwh/i);
      const mP2 = texto.match(/t[eé]rmino\s+de\s+energ[ií]a\s+p2\s+([0-9][0-9\.,]*)\s*kwh/i);
      const mP3 = texto.match(/t[eé]rmino\s+de\s+energ[ií]a\s+p3\s+([0-9][0-9\.,]*)\s*kwh/i);

      expect(mP1).toBeNull();              // P1 no facturado → 0
      expect(mP2).not.toBeNull();
      expect(window.LF.parseNum(mP2[1])).toBe(2.48);
      expect(mP3).not.toBeNull();
      expect(window.LF.parseNum(mP3[1])).toBe(4.32);
    });
  });

  describe('Octopus Energy - Consumos multi-periodo', () => {
    it('Debe extraer totales de tabla "Consumo kWh X Y Z"', () => {
      // Tabla de lecturas de contador Octopus (tiene los totales reales)
      const texto = "Consumo kWh 35 28 56 0 0 0 119";
      const m = texto.match(/consumo\s+kwh\s+(\d+)\s+(\d+)\s+(\d+)/i);
      expect(m).not.toBeNull();
      expect(parseInt(m[1], 10)).toBe(35);
      expect(parseInt(m[2], 10)).toBe(28);
      expect(parseInt(m[3], 10)).toBe(56);
    });

    it('La tabla Octopus 0/0/0 se conserva como consumo detectado, no como ausencia de datos', () => {
      const datos = window.__LF_FacturaParsers.__LF_extractConsumoOctopus('Consumo kWh 0 0 0 0 0 0 0');
      expect(datos).toEqual({ punta: 0, llano: 0, valle: 0 });
    });

    it('Debe sumar consumos de dos periodos distintos', () => {
      // Simula factura Octopus con dos periodos de facturación
      const texto = [
        "Energía Activa 8,29 €",
        "Punta 18,15 kWh",
        "Llano 14,52 kWh",
        "Valle 29,04 kWh",
        "Energía Activa 7,63 €",
        "Punta 16,85 kWh",
        "Llano 13,48 kWh",
        "Valle 26,96 kWh"
      ].join("\n");

      // El patrón sumAll debe acumular valores únicos de cada línea
      const sumAll = (re) => {
        const r = new RegExp(re.source, 'gi');
        const seen = new Set();
        let m, total = 0;
        while ((m = r.exec(texto)) !== null) {
          const v = window.LF.parseNum(m[1]);
          if (v != null && v > 0 && !seen.has(v)) {
            seen.add(v);
            total += v;
          }
        }
        return total > 0 ? Math.round(total * 100) / 100 : null;
      };

      const punta = sumAll(/(?:^|\n)\s*punta\s+([0-9][0-9\.,]*)\s*kwh/i);
      const llano = sumAll(/(?:^|\n)\s*llano\s+([0-9][0-9\.,]*)\s*kwh/i);
      const valle = sumAll(/(?:^|\n)\s*valle\s+([0-9][0-9\.,]*)\s*kwh/i);

      expect(punta).toBe(35);      // 18.15 + 16.85
      expect(llano).toBe(28);      // 14.52 + 13.48
      expect(valle).toBe(56);      // 29.04 + 26.96
    });

    it('La función de producción suma bloques Octopus aunque dos bloques tengan el mismo valor', () => {
      const texto = [
        'Octopus Energy',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh',
        'Punta 10 kWh', 'Llano 20 kWh', 'Valle 30 kWh'
      ].join('\n');

      expect(window.__LF_FacturaParsers.__LF_extractConsumoOctopus(texto)).toEqual({
        punta: 20, llano: 40, valle: 60
      });
    });

    it('Octopus multi-periodo suma correctamente aunque un periodo tenga 0 kWh en todos los bloques', () => {
      const texto = [
        'Octopus Energy',
        'Potencia Contratada (kW) 3,300 3,300 0 0 0 0',
        '30 días',
        'Energía Activa A',
        'Punta 0 kWh', 'Llano 10 kWh', 'Valle 20 kWh',
        'Energía Activa B',
        'Punta 0 kWh', 'Llano 5 kWh', 'Valle 10 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(0);
      expect(datos.consumoLlano).toBe(15);
      expect(datos.consumoValle).toBe(30);
    });

    it('__LF_parsearDatos conserva los saltos de línea necesarios para sumar Octopus multi-periodo', () => {
      const texto = [
        'Octopus Energy',
        'Potencia Contratada (kW) 3,300 3,300 0 0 0 0',
        '30 días',
        'Energía Activa 8,29 €',
        'Punta 18,15 kWh', 'Llano 14,52 kWh', 'Valle 29,04 kWh',
        'Energía Activa 7,63 €',
        'Punta 16,85 kWh', 'Llano 13,48 kWh', 'Valle 26,96 kWh'
      ].join('\n');
      const compacto = texto.replace(/\s+/g, ' ').trim();

      const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, compacto);

      expect(datos.consumoPunta).toBe(35);
      expect(datos.consumoLlano).toBe(28);
      expect(datos.consumoValle).toBe(56);
    });

    it('Debe parsear consumos Octopus con separador de miles correctamente (ej. 1.234,56)', () => {
      const texto = [
        "Energía Activa 8,29 €",
        "Punta 1.234,56 kWh",
        "Llano 14,52 kWh",
        "Valle 29,04 kWh"
      ].join("\n");

      const sumAll = (re) => {
        const r = new RegExp(re.source, 'gi');
        const seen = new Set();
        let m, total = 0;
        while ((m = r.exec(texto)) !== null) {
          const v = window.LF.parseNum(m[1]);
          if (v != null && v > 0 && !seen.has(v)) {
            seen.add(v);
            total += v;
          }
        }
        return total > 0 ? Math.round(total * 100) / 100 : null;
      };

      const punta = sumAll(/(?:^|\n)\s*punta\s+([0-9][0-9\.,]*)\s*kwh/i);
      expect(punta).toBe(1234.56);
    });
  });

  describe('Endesa - Consumos con tabla de lecturas', () => {
    it('mantiene la lectura real Punta/Llano/Valle tras ignorar cabeceras P1/P2/P3', () => {
      const texto = [
        'Energía kWh',
        'Punta 55.365,63 55.640,29 1,00 0,00 274,66',
        'Llano 14.771,79 15.004,57 1,00 0,00 232,78',
        'Valle 8.043,53 8.355,83 1,00 0,00 312,30'
      ].join('\n');

      expect(window.__LF_FacturaParsers.__LF_extractConsumoEndesa(texto)).toEqual({
        punta: 274.66,
        llano: 232.78,
        valle: 312.3
      });
    });

    it('no degrada consumos Endesa superiores a 5.000 kWh a ceros de la propia fila', () => {
      const texto = [
        'Energía kWh',
        'Punta 10000 16000 1,00 0,00 6000',
        'Llano 20000 27000 1,00 0,00 7000',
        'Valle 30000 38000 1,00 0,00 8000'
      ].join('\n');

      expect(window.__LF_FacturaParsers.__LF_extractConsumoEndesa(texto)).toEqual({
        punta: 6000,
        llano: 7000,
        valle: 8000
      });
    });
  });

  describe('Endesa - Consumos con separador de miles', () => {
    it('Debe extraer el consumo completo sin cortarlo (ej. 1.234,56)', () => {
      const texto = "Punta 1.234,56 kWh";
      // La lógica antigua usaba \d+[,.]\d+|\d+ que cortaba el número
      // La lógica nueva debe capturarlo entero:
      const extraerConsumo = (str) => {
        const nums = str.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+[,.]\d+|\d+/g);
        if (!nums || nums.length === 0) return null;
        for (let k = nums.length - 1; k >= 0; k--) {
          const num = window.LF.parseNum(nums[k]);
          if (num != null && num >= 0 && num <= 5000) return num;
        }
        return null;
      };

      const punta = extraerConsumo(texto);
      expect(punta).toBe(1234.56);
    });
  });
});

// Auditoría temática de importaciones 24/08/2026: una factura rectificativa no puede
// perder el signo y convertirse en consumo positivo con confianza alta.
describe('Facturas rectificativas: consumos negativos', () => {
  it('falla cerrado ante P1/P2/P3 negativos y no publica sus valores absolutos', () => {
    const texto = [
      'Factura eléctrica',
      'Periodo de facturación: 01/01/2026 - 31/01/2026',
      'Potencia contratada P1 3,45 kW P2 3,45 kW',
      'Consumo P1 -100 kWh',
      'Consumo P2 -20 kWh',
      'Consumo P3 -30 kWh'
    ].join('\n');

    const datos = window.__LF_FacturaParsers.__LF_parsearDatos(
      texto,
      texto.replace(/\s+/g, ' ').trim()
    );

    expect(datos.consumoNegativoDetectado).toBe(true);
    expect(datos.consumoPunta).toBeNull();
    expect(datos.consumoLlano).toBeNull();
    expect(datos.consumoValle).toBeNull();
    expect(datos.consumoTotalDetectado).toBeNull();
    expect(datos.confianza).toBeLessThan(100);
  });

  it('no confunde excedentes negativos con consumo facturado negativo', () => {
    const texto = [
      'Excedentes P1 -100 kWh',
      'Consumo P1 10 kWh',
      'Consumo P2 20 kWh',
      'Consumo P3 30 kWh'
    ].join('\n');
    const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' '));

    expect(datos.consumoNegativoDetectado).toBe(false);
    expect(datos.consumoPunta).toBe(10);
    expect(datos.consumoLlano).toBe(20);
    expect(datos.consumoValle).toBe(30);
  });

  it('mantiene el parseo ordinario de consumos positivos', () => {
    const texto = [
      'Factura eléctrica',
      'Periodo de facturación: 01/01/2026 - 31/01/2026',
      'Potencia contratada P1 3,45 kW P2 3,45 kW',
      'Consumo P1 100 kWh',
      'Consumo P2 20 kWh',
      'Consumo P3 30 kWh'
    ].join('\n');
    const datos = window.__LF_FacturaParsers.__LF_parsearDatos(texto, texto.replace(/\s+/g, ' '));

    expect(datos.consumoNegativoDetectado).toBe(false);
    expect(datos.consumoPunta).toBe(100);
    expect(datos.consumoLlano).toBe(20);
    expect(datos.consumoValle).toBe(30);
  });
});
