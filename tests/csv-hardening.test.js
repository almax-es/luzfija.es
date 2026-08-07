import { describe, it, expect, beforeAll } from 'vitest';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';

/**
 * Endurecimiento del importador CSV/XLSX (25/07/2026).
 *
 * Origen: 5 eventos `csv-import-error/solar/{csv,xlsx}/cabecera` el 25/07/2026 con cero
 * importaciones completadas. La investigacion destapo tres fallos de integridad
 * silenciosa y varios falsos rechazos. Estos tests fijan el comportamiento acordado.
 */

describe('Desambiguacion hora / periodo tarifario por contenido', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const parse = (header, ...rows) =>
    u.parseEnergyTableRows([header.split(';'), ...rows.map(r => r.split(';'))], { headerRowIndex: 0 });

  it.each(['Periodo', 'Período', 'Periodo horario', 'Tramo', 'Intervalo'])(
    'acepta Hora junto a "%s": antes se rechazaba por ambiguedad', (nombre) => {
      const res = parse(`Fecha;Hora;${nombre};Consumo_kWh`,
        '01/04/2026;10;P1;1,0', '01/04/2026;18;P1;2,0');
      expect(res.records.length).toBe(2);
      expect(res.records.map(r => r.periodo)).toEqual(['P1', 'P1']);
    }
  );

  it('la columna de periodo ya puede usarse para inferir la base horaria 0-23', () => {
    // Esta es la consecuencia util de arreglar la colision: inferHourBaseFromPeriods
    // existia desde siempre, pero con la columna llamada "Periodo" a secas el fichero se
    // rechazaba por ambiguedad antes de llegar a ella. P1 en CNMC es 10-14h y 18-22h, asi
    // que unas horas crudas 10 y 18 solo son coherentes si el fichero es 0-23 -> 11 y 19.
    const res = parse('Fecha;Hora;Periodo;Consumo_kWh',
      '01/04/2026;10;P1;1,0', '01/04/2026;18;P1;2,0');
    expect(res.records.map(r => r.hora)).toEqual([11, 19]);
    expect(res.warnings.some(w => /periodo tarifario/i.test(w))).toBe(true);
  });

  it('usa Periodo como hora cuando trae valores numericos y no hay columna Hora', () => {
    const res = parse('Fecha;Periodo;Consumo_kWh',
      '01/04/2026;1;1,0', '01/04/2026;2;2,0', '01/04/2026;24;3,0');
    expect(res.records.map(r => r.hora)).toEqual([1, 2, 24]);
  });

  it('RECHAZA un agregado por periodo tarifario sin hora en vez de fabricar horas 1,2,3', () => {
    expect(() => parse('Fecha;Periodo;Consumo_kWh',
      '01/04/2026;P1;10,0', '01/04/2026;P2;20,0', '01/04/2026;P3;30,0'))
      .toThrow(/agregado por periodo tarifario/i);
  });

  it('el agregado por periodo se clasifica como agregado-por-periodo en analitica', () => {
    let lanzado = null;
    try {
      parse('Fecha;Periodo;Consumo_kWh', '01/04/2026;P1;10,0', '01/04/2026;P3;30,0');
    } catch (e) { lanzado = e; }
    expect(lanzado).not.toBeNull();
    expect(u.csvErrorCodeForTracking(lanzado.message)).toBe('agregado-por-periodo');
  });

  it('nunca asigna la misma columna a hora y a periodo a la vez', () => {
    // El 24 es el discriminador horario: sin ningun valor 0 o >3 la columna se considera
    // indistinguible de P1/P2/P3 y se rechaza (ver test siguiente).
    const res = parse('Fecha;Periodo;Consumo_kWh', '01/04/2026;1;1,0', '01/04/2026;24;2,0');
    // 'Periodo' se ha usado como hora, asi que el periodo se recalcula, no se lee de ahi.
    expect(res.records.every(r => ['P1', 'P2', 'P3'].includes(r.periodo))).toBe(true);
  });

  it('RECHAZA una columna ambigua con solo 1/2/3: es indistinguible de P1/P2/P3', () => {
    // Sin discriminador horario (un 0 o algun valor 4..25) no hay forma de saber si son
    // horas o periodos escritos sin la P. Antes se tomaba por hora en silencio.
    expect(() => parse('Fecha;Periodo;Consumo_kWh',
      '01/04/2026;1;10,0', '01/04/2026;2;20,0', '01/04/2026;3;30,0'))
      .toThrow(/no se pudo interpretar/i);
  });

  it('acepta la hora escrita como HH:00 o como entero con decimal cero', () => {
    const conReloj = parse('Fecha;Intervalo;Consumo_kWh', '01/04/2026;08:00;1,0', '01/04/2026;19:00;2,0');
    expect(conReloj.records.map(r => r.hora)).toEqual([8, 19]);
    const conDecimal = parse('Fecha;Intervalo;Consumo_kWh', '01/04/2026;8,0;1,0', '01/04/2026;19,0;2,0');
    expect(conDecimal.records.map(r => r.hora)).toEqual([8, 19]);
  });

  it('RECHAZA una columna ambigua con contenido heterogeneo en vez de descartar filas', () => {
    // Antes: se clasificaba como hora, la fila con "foo" se descartaba y al quedar
    // exactamente el 50% no se activaba el rechazo por mayoria de filas invalidas.
    expect(() => parse('Fecha;Intervalo;Consumo_kWh', '01/04/2026;7;1,0', '01/04/2026;foo;2,0'))
      .toThrow(/no se pudo interpretar/i);
  });

  it('RECHAZA dos columnas ambiguas que las dos parecen hora', () => {
    expect(() => parse('Fecha;Intervalo;Tramo;Consumo_kWh',
      '01/04/2026;7;7;1,0', '01/04/2026;19;19;2,0'))
      .toThrow(/dos columnas que podrían ser la hora/i);
  });

  it('con una columna de hora explicita, la ambigua se ignora sin lanzar', () => {
    const res = parse('Fecha;Hora;Tramo;Consumo_kWh', '01/04/2026;7;7;1,0', '01/04/2026;19;19;2,0');
    expect(res.records.length).toBe(2);
    expect(res.warnings.some(w => /ya hay una columna de hora explícita/i.test(w))).toBe(true);
  });

  it('mantiene el contrato de Periodo_tarifario para inferir 0-23', () => {
    const res = parse('CUPS;Fecha;Hora;Periodo_tarifario;Consumo_kWh',
      'ES1;01/04/2026;10;P1;1,0', 'ES1;01/04/2026;18;P1;1,0');
    expect(res.records.map(r => r.hora)).toEqual([11, 19]);
  });
});

describe('Centinela de columna solar sin reconocer', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const rows = (header, ...data) => [header.split(';'), ...data.map(r => r.split(';'))];
  const SOSPECHOSA = 'Fecha;Hora;Inyección a red (kWh);Consumo (kWh)';
  const datos = ['01/04/2026;1;0,2;0,5', '01/04/2026;2;0,3;0,6'];

  it('con politica error bloquea en vez de importar excedentes=0 en silencio', () => {
    expect(() => u.parseEnergyTableRows(rows(SOSPECHOSA, ...datos), {
      headerRowIndex: 0, unmappedSolarPolicy: 'error'
    })).toThrow(/parece representar energía solar/i);
  });

  it('con politica warn importa el consumo pero avisa de la columna ignorada', () => {
    const res = u.parseEnergyTableRows(rows(SOSPECHOSA, ...datos), {
      headerRowIndex: 0, unmappedSolarPolicy: 'warn'
    });
    expect(res.records.map(r => r.kwh)).toEqual([0.5, 0.6]);
    expect(res.warnings.some(w => /no se ha usado en el cálculo/i.test(w))).toBe(true);
  });

  it('el bloqueo se clasifica como columna-solar en analitica', () => {
    let lanzado = null;
    try {
      u.parseEnergyTableRows(rows(SOSPECHOSA, ...datos), {
        headerRowIndex: 0, unmappedSolarPolicy: 'error'
      });
    } catch (e) { lanzado = e; }
    expect(lanzado).not.toBeNull();
    expect(u.csvErrorCodeForTracking(lanzado.message)).toBe('columna-solar');
  });

  it('detecta tambien energiaGenerada_kWh (el lexema es "genera", no "generac")', () => {
    expect(() => u.parseEnergyTableRows(
      rows('CUPS;Fecha;Hora;consumo_kWh;energiaGenerada_kWh', 'ES1;01/04/2026;1;0,5;0,2'),
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    )).toThrow(/parece representar energía solar/i);
  });

  it('el token "id" no puede entrar en las exclusiones: romperia vertida/vertidos', () => {
    // Regresion explicita: 'energia_vertida_kwh'.includes('id') es true, asi que si 'id'
    // estuviera en SOLAR_METADATA_TOKENS el centinela nunca saltaria con esas columnas.
    expect(() => u.parseEnergyTableRows(
      rows('Fecha;Hora;Consumo_kWh;Excedentes vertidos totales', '01/04/2026;1;0,5;0,2', '01/04/2026;2;0,6;0,3'),
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    )).toThrow(/parece representar energía solar/i);
  });

  it.each([
    ['Precio excedentes (€/kWh)', '0,05'],
    ['Potencia de generación (kW)', '3,5'],
    ['Coeficiente de autoconsumo', '0,8'],
    ['Tarifa de exportación', '0,06'],
    ['Export price (€/kWh)', '0,06'],
    ['Feed-in tariff', '0,05'],
    ['ID exportación', '123']
  ])('no salta con el metadato "%s" (las exclusiones tienen precedencia)', (nombre, valor) => {
    const res = u.parseEnergyTableRows(
      rows(`Fecha;Hora;Consumo_kWh;${nombre}`, `01/04/2026;1;0,5;${valor}`, `01/04/2026;2;0,6;${valor}`),
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    );
    expect(res.records.length).toBe(2);
  });

  it('no salta si la columna sospechosa no contiene numeros', () => {
    const res = u.parseEnergyTableRows(
      rows('Fecha;Hora;Consumo_kWh;Observaciones vertido', '01/04/2026;1;0,5;revisado', '01/04/2026;2;0,6;pendiente'),
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    );
    expect(res.records.length).toBe(2);
  });

  it('no salta cuando los excedentes SI se reconocen', () => {
    const res = u.parseEnergyTableRows(
      rows('CUPS;Fecha;Hora;AE_kWh;AS_kWh', 'ES1;01/04/2026;1;0,5;0,1'),
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    );
    expect(res.hasExcedenteColumn).toBe(true);
  });

  it('la politica por defecto es warn, nunca bloquear', () => {
    const res = u.parseEnergyTableRows(rows(SOSPECHOSA, ...datos), { headerRowIndex: 0 });
    expect(res.records.length).toBe(2);
  });
});

describe('Matriz horaria compartida: politica de celdas', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const HDR = ['Fecha', ...Array.from({ length: 24 }, (_, i) => 'H' + String(i + 1).padStart(2, '0'))];
  const matriz = (valores, opts) => u.parseHourlyMatrixRows([HDR, ['01/04/2026', ...valores]], 0, opts);
  const v24 = (x) => Array(24).fill(x);

  it('descarta negativos en vez de conservarlos', () => {
    const valores = v24('1,0');
    valores[20] = '-5';
    valores[21] = '-5';
    const res = matriz(valores);
    expect(res.records.every(r => r.kwh >= 0)).toBe(true);
    expect(res.records.length).toBe(22);
    expect(res.warnings.some(w => /negativo/i.test(w))).toBe(true);
  });

  it('descarta valores por encima de 10.000 kWh', () => {
    const valores = v24('1,0');
    valores[23] = '20000';
    const res = matriz(valores);
    expect(res.records.length).toBe(23);
    expect(res.warnings.some(w => /10\.000/.test(w))).toBe(true);
  });

  it('descarta texto arbitrario y avisa', () => {
    const valores = v24('1,0');
    valores[23] = 'texto';
    const res = matriz(valores);
    expect(res.records.length).toBe(23);
    expect(res.warnings.some(w => /no numéricos/i.test(w))).toBe(true);
  });

  it('interpreta la celda vacia como 0 y conserva la hora', () => {
    const valores = v24('1,0');
    valores[23] = '';
    const res = matriz(valores);
    expect(res.records.length).toBe(24);
    expect(res.records[23].kwh).toBe(0);
    expect(res.warnings.some(w => /sin dato/i.test(w))).toBe(true);
  });

  it('rechaza una matriz entera de texto en vez de fabricar 24 ceros', () => {
    expect(() => matriz(v24('texto'))).toThrow(/no contiene ningún valor numérico/i);
  });

  it('rechaza cuando la mitad o mas de las celdas no vacias son invalidas', () => {
    const valores = [...v24('1,0').slice(0, 12), ...Array(12).fill('-1')];
    expect(() => matriz(valores)).toThrow(/no interpretables/i);
  });

  it('descartar una hora no desplaza las demas', () => {
    const valores = v24('1,0');
    valores[4] = '-3'; // corresponde a H05 -> hora 5
    const res = matriz(valores);
    expect(res.records.find(r => r.hora === 4)).toBeDefined();
    expect(res.records.find(r => r.hora === 5)).toBeUndefined();
    expect(res.records.find(r => r.hora === 6)).toBeDefined();
  });

  it('computePeriodo:false deja el periodo a null (lo necesita el solar)', () => {
    const res = matriz(v24('1,0'), { computePeriodo: false });
    expect(res.records.every(r => r.periodo === null)).toBe(true);
  });

  it('por defecto calcula el periodo (lo necesita la home)', () => {
    const res = matriz(v24('1,0'));
    expect(res.records.every(r => ['P1', 'P2', 'P3'].includes(r.periodo))).toBe(true);
  });

  it('busca la cabecera de matriz hasta 30 filas, no 10', () => {
    const preambulo = Array.from({ length: 12 }, (_, i) => ['aviso ' + i]);
    expect(u.findHourlyMatrixHeaderRow([...preambulo, HDR])).toBe(12);
  });

  it('los fallos de matriz se clasifican en slugs distinguibles', () => {
    // La cabecera H01..H24 SI se detecto, asi que el diagnostico es de datos, no de cabecera.
    let sinNumeros = null;
    try { matriz(v24('texto')); } catch (e) { sinNumeros = e; }
    expect(u.csvErrorCodeForTracking(sinNumeros.message)).toBe('filas-invalidas');

    let mayoriaInvalida = null;
    try { matriz([...v24('1,0').slice(0, 12), ...Array(12).fill('-1')]); } catch (e) { mayoriaInvalida = e; }
    expect(u.csvErrorCodeForTracking(mayoriaInvalida.message)).toBe('filas-invalidas');
  });
});

describe('Ancho minimo de cabecera: fecha_hora + consumo', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  it('acepta dos columnas cuando son fecha_hora + consumo exactos', () => {
    const { rows } = u.parseCSVToRows('FechaHora;Consumo_kWh\n01/04/2026 01:00;0,5\n01/04/2026 02:00;0,6');
    const res = u.parseEnergyTableRows(rows, { headerRowIndex: 0 });
    expect(res.records.map(r => r.kwh)).toEqual([0.5, 0.6]);
  });

  it('sigue rechazando dos columnas que no son fecha_hora + consumo', () => {
    expect(() => u.parseCSVToRows('Fecha;Consumo_kWh\n01/04/2026;0,5\n02/04/2026;0,6'))
      .toThrow(/no se pudo detectar la cabecera/i);
  });
});

describe('Mejor fila candidata para el error de XLSX', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  it('devuelve las cabeceras vistas para que el mensaje no diga "(sin cabeceras)"', () => {
    const data = [['Informe'], ['CUPS', 'Fecha', 'Hora', 'Energía (kWh)'], ['ES1', '01/04/2026', '1', '0,5']];
    expect(u.guessEnergyHeaderRow(data)).toBe(-1);
    const candidata = u.bestEnergyHeaderCandidate(data);
    expect(candidata).toContain('fecha');
    expect(candidata).toContain('energia_kwh');
  });
});

describe('No regresion: formatos reales que ya funcionaban', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const ok = (contenido) => {
    const { rows, separator, headerRowIndex } = u.parseCSVToRows(contenido);
    return u.parseEnergyTableRows(rows, { separator, headerRowIndex, parseNumber: u.parseNumberFlexibleCSV });
  };

  it.each([
    ['Datadis autoconsumo', 'CUPS;Fecha;Hora;AE_kWh;AS_KWh;AE_AUTOCONS_kWh;REAL/ESTIMADO\nES1;11/02/2026;1;0,875;0;;R\nES1;11/02/2026;2;0,503;0;;R'],
    ['Datadis solo consumo', 'CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion\nES1;01/04/2026;1;0,5;R\nES1;01/04/2026;2;0,6;R'],
    ['Datadis con parentesis', 'CUPS;Fecha;Hora;Consumo (kWh);Método obtención\nES1;01/04/2026;1;0,5;R\nES1;01/04/2026;2;0,6;R'],
    ['UFD EHCR/EHEX', 'CUPS;FECHA;HORA;EHCR (kWh);EHEX (kWh)\nES1;01/04/2026;1;0,5;0,1\nES1;01/04/2026;2;0,6;0,2'],
    ['i-DE bruto Wh', 'CUPS;FechaHora;CONSUMO Wh;GENERACION Wh\nES1;01/04/2026 00:00;500;200\nES1;01/04/2026 01:00;100;400']
  ])('%s sigue importando', (_nombre, contenido) => {
    const res = ok(contenido);
    expect(res.records.length).toBeGreaterThan(0);
  });
});

describe('Tokens del centinela: falsos positivos y negativos', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const rows = (header, ...data) => [header.split(';'), ...data.map(r => r.split(';'))];
  const conPolitica = (header, ...data) => u.parseEnergyTableRows(
    rows(header, ...data), { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
  );

  it.each([
    'Energía entregada a la red (kWh)',
    'Energía cedida a la red (kWh)',
    'Energía devuelta a la red (kWh)'
  ])('detecta el compuesto "%s" (raiz + red, no una sola subcadena)', (nombre) => {
    expect(() => conPolitica(`Fecha;Hora;Consumo_kWh;${nombre}`,
      '01/04/2026;1;0,5;0,2', '01/04/2026;2;0,6;0,3'))
      .toThrow(/parece representar energía solar/i);
  });

  it.each([
    ['ID generador', '17'],
    ['Número de generadores', '2'],
    ['Rendimiento generador', '0,92']
  ])('NO bloquea "%s": "genera" es token debil y necesita contexto energetico', (nombre, valor) => {
    const res = conPolitica(`Fecha;Hora;Consumo_kWh;${nombre}`,
      `01/04/2026;1;0,5;${valor}`, `01/04/2026;2;0,6;${valor}`);
    expect(res.records.length).toBe(2);
  });

  it('un marcador "Sin dato" ya no desactiva el centinela', () => {
    // Antes se exigia numeric === seen, asi que un solo "Sin dato" en la columna la dejaba
    // pasar y los excedentes entraban como cero.
    expect(() => conPolitica('Fecha;Hora;Inyección a red (kWh);Consumo (kWh)',
      '01/04/2026;1;0,2;0,5', '01/04/2026;2;Sin dato;0,6', '01/04/2026;3;0,3;0,7'))
      .toThrow(/parece representar energía solar/i);
  });

  it('una columna de texto con un numero suelto no bloquea', () => {
    const res = conPolitica('Fecha;Hora;Consumo_kWh;Observaciones vertido',
      '01/04/2026;1;0,5;revisado', '01/04/2026;2;0,6;123', '01/04/2026;3;0,7;pendiente');
    expect(res.records.length).toBe(3);
  });
});

describe('Matriz horaria: hora 25 solo con cabecera H25 y en el cambio de octubre', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const H24 = ['Fecha', ...Array.from({ length: 24 }, (_, i) => 'H' + String(i + 1).padStart(2, '0'))];
  const H25 = [...H24, 'H25'];
  const v24 = () => Array(24).fill('1,0');
  const DST_OCT = '26/10/2025';   // ultimo domingo de octubre de 2025
  const NO_DST = '01/04/2026';

  it('acepta H25 cuando la cabecera la declara y la fecha es el cambio horario', () => {
    const res = u.parseHourlyMatrixRows([H25, [DST_OCT, ...v24(), '5']], 0);
    expect(res.records).toHaveLength(25);
    expect(res.records.find(r => r.hora === 25).kwh).toBe(5);
  });

  it('IGNORA un 25 valor si la cabecera no declara H25 (columna de total diario)', () => {
    const res = u.parseHourlyMatrixRows([H24, [DST_OCT, ...v24(), '999']], 0);
    expect(res.records).toHaveLength(24);
    expect(res.records.some(r => r.hora === 25)).toBe(false);
  });

  it('una cabecera "Total" en la posicion 25 no se convierte en hora', () => {
    const res = u.parseHourlyMatrixRows([[...H24, 'Total'], [DST_OCT, ...v24(), '24']], 0);
    expect(res.records).toHaveLength(24);
    expect(res.records.some(r => r.hora === 25)).toBe(false);
  });

  it('descarta H25 con aviso cuando la fecha NO es el cambio horario de octubre', () => {
    const res = u.parseHourlyMatrixRows([H25, [NO_DST, ...v24(), '5']], 0);
    expect(res.records).toHaveLength(24);
    expect(res.warnings.some(w => /H25/.test(w))).toBe(true);
  });

  it('reconoce el ultimo domingo de octubre y no otro domingo del mes', () => {
    // 19/10/2025 es domingo pero NO el ultimo; 26/10/2025 si lo es.
    const noUltimo = u.parseHourlyMatrixRows([H25, ['19/10/2025', ...v24(), '5']], 0);
    expect(noUltimo.records.some(r => r.hora === 25)).toBe(false);
    const ultimo = u.parseHourlyMatrixRows([H25, ['26/10/2025', ...v24(), '5']], 0);
    expect(ultimo.records.some(r => r.hora === 25)).toBe(true);
  });
});

describe('Contexto energetico por token completo, no por subcadena', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const rows = (header, ...data) => [header.split(';'), ...data.map(r => r.split(';'))];
  const conPolitica = (header, ...data) => u.parseEnergyTableRows(
    rows(header, ...data), { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
  );

  it.each([
    ['Capacidad generador KW', '5'],
    ['Producción instantánea KW', '3,2'],
    ['Producto wholesale', '12'],
    ['Export when', '7']
  ])('NO bloquea "%s"', (nombre, valor) => {
    // 'kw' es potencia y se ha quitado del contexto; 'wh' ya no casa dentro de
    // 'wholesale' ni de 'when' porque la comparacion es por token completo.
    const res = conPolitica(`Fecha;Hora;Consumo_kWh;${nombre}`,
      `01/04/2026;1;0,5;${valor}`, `01/04/2026;2;0,6;${valor}`);
    expect(res.records.length).toBe(2);
  });

  it('detecta "Exported energy": el contexto en ingles cuenta', () => {
    expect(() => conPolitica('Fecha;Hora;Consumo_kWh;Exported energy',
      '01/04/2026;1;0,5;0,2', '01/04/2026;2;0,6;0,3'))
      .toThrow(/parece representar energía solar/i);
  });
});

describe('Umbral de muestras del centinela', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  const rows = (header, ...data) => [header.split(';'), ...data.map(r => r.split(';'))];
  const conPolitica = (header, ...data) => u.parseEnergyTableRows(
    rows(header, ...data), { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
  );

  it('con unidad en la cabecera basta UNA muestra numerica (antes 3/4 = 75% no saltaba)', () => {
    expect(() => conPolitica('Fecha;Hora;Consumo_kWh;Inyección a red (kWh)',
      '01/04/2026;1;0,5;1', '01/04/2026;2;0,6;2',
      '01/04/2026;3;0,7;3', '01/04/2026;4;0,8;texto'))
      .toThrow(/parece representar energía solar/i);
  });

  it('con unidad en la cabecera salta incluso con una sola celda numerica entre muchas', () => {
    expect(() => conPolitica('Fecha;Hora;Consumo_kWh;Inyección a red (kWh)',
      '01/04/2026;1;0,5;0,2', '01/04/2026;2;0,6;n', '01/04/2026;3;0,7;n', '01/04/2026;4;0,8;n'))
      .toThrow(/parece representar energía solar/i);
  });

  it('sin contexto energetico en el nombre se sigue exigiendo mayoria: 3/4 = 75% no basta', () => {
    const res = conPolitica('Fecha;Hora;Consumo_kWh;Excedentes vertidos totales',
      '01/04/2026;1;0,5;1', '01/04/2026;2;0,6;2',
      '01/04/2026;3;0,7;3', '01/04/2026;4;0,8;texto');
    expect(res.records.length).toBe(4);
  });

  it('sin contexto energetico, 4/5 = 80% si basta (borde)', () => {
    expect(() => conPolitica('Fecha;Hora;Consumo_kWh;Excedentes vertidos totales',
      '01/04/2026;1;0,5;1', '01/04/2026;2;0,6;2', '01/04/2026;3;0,7;3',
      '01/04/2026;4;0,8;4', '01/04/2026;5;0,9;texto'))
      .toThrow(/parece representar energía solar/i);
  });

  it('los marcadores sin dato no cuentan para el porcentaje', () => {
    // 3 numeros + 1 "Sin dato" (ignorado) = 100% de las significativas.
    expect(() => conPolitica('Fecha;Hora;Consumo_kWh;Excedentes vertidos totales',
      '01/04/2026;1;0,5;1', '01/04/2026;2;0,6;Sin dato',
      '01/04/2026;3;0,7;3', '01/04/2026;4;0,8;4'))
      .toThrow(/parece representar energía solar/i);
  });
});

describe('Metadato estructurado unmappedSolarColumns', () => {
  let u;
  beforeAll(() => { u = window.LF.csvUtils; });

  it('con politica warn expone las columnas sospechosas para el llamante', () => {
    const res = u.parseEnergyTableRows(
      [['Fecha', 'Hora', 'Consumo (kWh)', 'Inyección a red (kWh)'],
       ['01/04/2026', '1', '0,5', '0,2'],
       ['01/04/2026', '2', '0,6', '0,3']],
      { headerRowIndex: 0, unmappedSolarPolicy: 'warn' }
    );
    expect(res.unmappedSolarColumns).toEqual(['inyeccion_a_red_kwh']);
    expect(res.unmappedSolarIndices).toEqual([3]);
    expect(res.unmappedSolarFallbackExportIndices).toEqual([]);
    expect(Array.isArray(res.headersNorm)).toBe(true);
  });

  it('marca por indice una exportacion que el fallback puede consumir con seguridad', () => {
    const res = u.parseEnergyTableRows(
      [['Fecha', 'Hora', 'Consumo (kWh)', 'Exportación total'],
       ['01/04/2026', '1', '0,5', '0,2'],
       ['01/04/2026', '2', '0,6', '0,3']],
      { headerRowIndex: 0, unmappedSolarPolicy: 'warn' }
    );
    expect(res.unmappedSolarColumns).toEqual(['exportacion_total']);
    expect(res.unmappedSolarIndices).toEqual([3]);
    expect(res.unmappedSolarFallbackExportIndices).toEqual([3]);
  });

  it.each([
    'Inyección a red (kWh)',
    'Energía entregada a la red (kWh)',
    'Energía cedida a la red (kWh)',
    'Energía devuelta a la red (kWh)',
    'Exportación total',
    'Excedentes vertidos totales'
  ])('detecta otra medida de exportacion "%s" aunque ya exista AS_kWh', (nombre) => {
    expect(() => u.parseEnergyTableRows(
      [['Fecha', 'Hora', 'Consumo (kWh)', 'AS_kWh', nombre],
       ['01/04/2026', '1', '0,5', '0', '0,2'],
       ['01/04/2026', '2', '0,6', '0', '0,3']],
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    )).toThrow(/parece representar energía solar/i);
  });

  it.each([
    'Energía generada (kWh)',
    'Producción solar (kWh)'
  ])('no trata "%s" como otra exportacion cuando AS_kWh ya esta mapeada', (nombre) => {
    const res = u.parseEnergyTableRows(
      [['Fecha', 'Hora', 'Consumo (kWh)', 'AS_kWh', nombre],
       ['01/04/2026', '1', '0,5', '0,1', '0,4'],
       ['01/04/2026', '2', '0,6', '0,2', '0,5']],
      { headerRowIndex: 0, unmappedSolarPolicy: 'error' }
    );
    expect(res.unmappedSolarColumns).toEqual([]);
    expect(res.hasExcedenteColumn).toBe(true);
  });

  it('esta vacio cuando los excedentes se reconocen', () => {
    const res = u.parseEnergyTableRows(
      [['CUPS', 'Fecha', 'Hora', 'AE_kWh', 'AS_kWh'], ['ES1', '01/04/2026', '1', '0,5', '0,1']],
      { headerRowIndex: 0, unmappedSolarPolicy: 'warn' }
    );
    expect(res.unmappedSolarColumns).toEqual([]);
  });

  it('buildUnmappedSolarError produce un mensaje que clasifica como columna-solar', () => {
    const err = u.buildUnmappedSolarError(['inyeccion_a_red_kwh'], ['fecha', 'hora']);
    expect(u.csvErrorCodeForTracking(err.message)).toBe('columna-solar');
  });
});
