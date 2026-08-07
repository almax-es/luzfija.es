import { describe, it, expect, beforeAll } from 'vitest';
import '../js/lf-utils.js'; // Dependencia
import '../js/lf-csv-utils.js'; // Nueva dependencia critica
import '../js/lf-csv-import.js';

describe('Lógica CSV - Calendario y Festivos', () => {
  let helpers;

  beforeAll(() => {
    helpers = window.LF.csvHelpers;
  });

  describe('Detección de Festivos Nacionales', () => {
    it('Debe detectar festivos fijos (Navidad, Año Nuevo)', () => {
      // Navidad 2025 (Jueves)
      const navidad = new Date(2025, 11, 25); // Mes 11 es Diciembre
      const periodo = helpers.getPeriodoHorarioCSV(navidad, 12); // 12:00
      
      // Debe ser Valle (P3)
      expect(periodo).toBe('P3');
    });

    it('Viernes Santo NO es P3 (CNMC BOE-A-2020-1066 excluye móviles)', () => {
      // Viernes Santo 2025 es el 18 de Abril
      // (Pascua es el 20 de Abril de 2025)
      // Según CNMC, solo festivos de fecha FIJA cuentan como P3 24h.
      // Viernes Santo es móvil, por lo que se comporta como laborable normal.
      const viernesSanto = new Date(2025, 3, 18); // Viernes (laborable)
      const periodo = helpers.getPeriodoHorarioCSV(viernesSanto, 11);

      // A hora 11 (10:00-11:00) en un viernes laborable = P1 (punta: 10-14h)
      expect(periodo).toBe('P1');
    });

    it('NO debe marcar como festivo un día laborable normal', () => {
      // 16 de Abril 2025 (Miércoles Santo - Laborable)
      const miercoles = new Date(2025, 3, 16);
      const periodo = helpers.getPeriodoHorarioCSV(miercoles, 12); // 12:00 es Punta
      
      expect(periodo).toBe('P1');
    });
  });

  describe('Clasificación Horaria (2.0TD)', () => {
    // Laborable (ej: Lunes 14 Abril 2025)
    const lunes = new Date(2025, 3, 14);

    it('Hora Punta (10h-14h)', () => {
      expect(helpers.getPeriodoHorarioCSV(lunes, 11)).toBe('P1');
    });

    it('Hora Llano (8h-10h)', () => {
      expect(helpers.getPeriodoHorarioCSV(lunes, 9)).toBe('P2');
    });

    it('Hora Valle (0h-8h)', () => {
      expect(helpers.getPeriodoHorarioCSV(lunes, 5)).toBe('P3');
    });

    it('Fin de semana siempre es Valle', () => {
      const domingo = new Date(2025, 3, 20);
      expect(helpers.getPeriodoHorarioCSV(domingo, 12)).toBe('P3'); // 12:00 Punta entre semana -> Valle finde
    });
  });
});

describe('csvErrorCodeForTracking - códigos de error para analítica', () => {
  let codeFor;
  let buildImportError;

  beforeAll(() => {
    codeFor = window.LF.csvUtils.csvErrorCodeForTracking;
    buildImportError = window.LF.csvUtils.buildImportError;
  });

  it('clasifica los mensajes conocidos del importador', () => {
    expect(codeFor('El archivo es demasiado grande (12.3 MB). El tamaño máximo permitido es 10 MB.')).toBe('archivo-grande');
    expect(codeFor('Formato no soportado. Solo CSV y Excel (.xlsx, .xls)')).toBe('formato-no-soportado');
    expect(codeFor('No se ha seleccionado ningún archivo.')).toBe('sin-archivo');
    expect(codeFor('Error al leer el archivo Excel')).toBe('error-lectura');
    expect(codeFor('No se pudo cargar el parser de CSV (lf-csv-utils.js faltante)')).toBe('error-lectura');
    expect(codeFor('CSV vacío o inválido.')).toBe('archivo-vacio');
    expect(codeFor('Archivo Excel vacío o formato no reconocido.')).toBe('archivo-vacio');
    expect(codeFor('Error en marzo 2026: el campo "Valle" no contiene un número válido (valor: "abc").')).toBe('valor-invalido');
    expect(codeFor('Formato Datadis mensual: fecha no reconocida en una fila de datos ("XX"). El formato esperado es YYYY/MM (ej: 2025/01).')).toBe('valor-invalido');
    expect(codeFor('No se identificó la columna obligatoria de "fecha".')).toBe('columnas');
    expect(codeFor('Formato Datadis mensual: faltan columnas obligatorias (Fecha, Valle, Llano, Punta).')).toBe('columnas');
    // Taxonomía partida el 25/07/2026: antes las dos caían en 'cabecera' y en analítica
    // no había forma de distinguir un formato no reconocido de un separador mal detectado.
    expect(codeFor('No se pudo detectar la cabecera del CSV.')).toBe('cabecera-no-detectada');
    expect(codeFor('No se encontró la fila de cabecera en el Excel.')).toBe('cabecera-no-detectada');
    expect(codeFor('No se encontró una cabecera válida en el archivo.')).toBe('cabecera-no-detectada');
    expect(codeFor('La mayoría de filas no se pudo interpretar; probable separador o cabecera incorrecta.')).toBe('filas-invalidas');
    expect(codeFor('La matriz horaria tiene 20 de 24 celdas con valores no interpretables; probable formato incorrecto.')).toBe('filas-invalidas');
    // La cabecera H01..H24 SI se reconocio, asi que el problema son los datos.
    expect(codeFor('La mayoría de filas no se pudo interpretar: la matriz horaria no contiene ningún valor numérico válido.')).toBe('filas-invalidas');
    // 'cabecera' se conserva como cajón legacy para mensajes no reclasificados.
    expect(codeFor('Cabecera desconocida en el archivo.')).toBe('cabecera');
    // Centinela de energía solar sin reconocer: el mensaje nombra la columna, así que la
    // regla debe ir ANTES de 'columnas' para no confundirse con una columna obligatoria.
    expect(codeFor('El archivo contiene una columna que parece representar energía solar ("energia_generada_kwh"), pero no se reconoce con seguridad. No se importará como cero.')).toBe('columna-solar');
    expect(codeFor('El archivo contiene columnas que parecen representar energía solar ("a", "b"), pero no se reconoce con seguridad. No se importará como cero.')).toBe('columna-solar');
    expect(codeFor('El archivo está agregado por periodo tarifario ("periodo" contiene P1/P2/P3) y no trae ninguna columna de hora. Se necesita una curva horaria para calcular; no se puede repartir un agregado por periodos entre las 24 horas.')).toBe('agregado-por-periodo');
    expect(codeFor('Se detectaron importación y excedentes simultáneos tras el neteo horario.')).toBe('datos-inconsistentes');
    expect(codeFor('El CSV abarca 500 días (2024-01-01 → 2025-05-15).\n\nEl máximo permitido es 370 días (~1 año).')).toBe('rango-fechas');
    expect(codeFor('El CSV contiene 15 meses distintos.\n\nEl comparador solar requiere máximo 13 meses consecutivos (se ajusta automáticamente a 12).')).toBe('rango-fechas');
    expect(codeFor('Tras aplicar el recorte a 12 meses, no quedan registros válidos para procesar.')).toBe('rango-fechas');
    expect(codeFor('El CSV tiene datos muy fragmentados:\n\n• enero 2026: 3/31 días (10%)')).toBe('rango-fechas');
    expect(codeFor('No se encontraron datos válidos en el CSV.')).toBe('sin-datos-validos');
    expect(codeFor('El archivo no contiene datos de consumo válidos o reconocibles.')).toBe('sin-datos-validos');
    expect(codeFor('No se encontraron fechas válidas en el CSV.')).toBe('sin-datos-validos');
    expect(codeFor('Formato Datadis mensual: no se encontraron filas de datos válidas.')).toBe('sin-datos-validos');
  });

  it('el sufijo de cabeceras que añade buildHeaderError no contamina la clasificación', () => {
    // buildImportError añade "Separador detectado" y "Cabeceras normalizadas detectadas"
    // a TODOS los mensajes; solo debe clasificar la primera línea.
    const err = buildImportError('No se encontraron datos válidos en el CSV.', {
      headersNorm: ['nombre', 'direccion', 'importe'],
      separator: ';'
    });
    expect(err.message).toContain('Cabeceras normalizadas detectadas');
    expect(codeFor(err.message)).toBe('sin-datos-validos');
  });

  it('nunca devuelve contenido del archivo: entradas desconocidas caen en "otro"', () => {
    expect(codeFor('ES1234000000000000AB;Juan Pérez;C/ Falsa 123')).toBe('otro');
    expect(codeFor('unexpected token in JSON at position 0')).toBe('otro');
    expect(codeFor('')).toBe('otro');
    expect(codeFor(null)).toBe('otro');
    expect(codeFor(undefined)).toBe('otro');
  });
});

describe('safeFileExtensionForTracking - extensión con allowlist para analítica', () => {
  let extFor;

  beforeAll(() => {
    extFor = window.LF.csvUtils.safeFileExtensionForTracking;
  });

  it('devuelve las extensiones soportadas normalizadas', () => {
    expect(extFor('consumos.csv')).toBe('csv');
    expect(extFor('DATOS.XLSX')).toBe('xlsx');
    expect(extFor('export.mensual.xls')).toBe('xls');
  });

  it('un nombre de archivo sin punto nunca viaja como segmento', () => {
    // split('.').pop() sobre un nombre sin punto devuelve el nombre entero
    expect(extFor('ES0021000000000000AB')).toBe('desconocido');
    expect(extFor('mi factura de enero')).toBe('desconocido');
  });

  it('sufijos arbitrarios caen en desconocido', () => {
    expect(extFor('factura.ES0021000000000000AB')).toBe('desconocido');
    expect(extFor('datos.txt')).toBe('desconocido');
    expect(extFor('')).toBe('desconocido');
    expect(extFor(null)).toBe('desconocido');
    expect(extFor(undefined)).toBe('desconocido');
  });
});
