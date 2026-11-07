import { describe, it, expect, beforeAll } from 'vitest';
import '../js/lf-utils.js';
import '../js/lf-csv-utils.js';
import '../js/lf-csv-import.js';
import '../js/bv/bv-import.js';

/**
 * Vertido sin publicar (analizarVertidoPublicado, lf-csv-utils.js).
 * Caso real (05/11/2026): el CSV de la web de i-DE llega con el consumo de octubre completo y la
 * energia vertida de todo octubre (y del 01/11) vacia porque aun no estaba publicada. Antes se
 * interpretaba como 0 kWh vertidos con un aviso generico de "768 celdas vacias", y el simulador
 * solar quitaba un mes de compensacion y de saldo BV justo a las tarifas que mejor pagan los
 * excedentes. Se mide por DIA para cubrir tambien un ultimo mes publicado solo en parte.
 * Formato reproducido del fichero real: valores entre comillas, metodoObtencion vacio en todas las
 * filas, ceros explicitos en las horas sin sol y 23 h el dia del cambio de hora de marzo.
 */

const CABECERA = 'cups;fecha;hora;consumo_kWh;metodoObtencion;energiaVertida_kWh;energiaGenerada_kWh;energiaAutoconsumida_kWh';

function ymd(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Fichero i-DE sintetico del 01/01/2026 al `fin` (incluido).
 * vertido(fecha, hora) -> texto de la celda ('' = sin dato); metodo -> celda de metodoObtencion.
 */
function ficheroIde({ fin = '2026/11/01', vertido, metodo = () => '', incluirHora25 = false } = {}) {
  const lineas = [CABECERA];
  for (let d = new Date(2026, 0, 1); ymd(d) <= fin; d.setDate(d.getDate() + 1)) {
    const fecha = ymd(d);
    const ultimaHora = incluirHora25 && fecha === '2026/10/25' ? 25 : 24;
    for (let h = 1; h <= ultimaHora; h++) {
      if (fecha === '2026/03/29' && h === 3) continue; // dia de 23 h, como el fichero real
      const v = vertido(fecha, h);
      lineas.push(`"ES0000000000000000XX0F";"${fecha}";"${String(h).padStart(2, '0')}:00";"0,500";${metodo(fecha, h)};${v === '' ? '' : `"${v}"`};;`);
    }
  }
  return lineas.join('\r\n') + '\r\n';
}

const sol = (h) => h >= 12 && h <= 15;
// Vertido publicado hasta `hasta` (2 kWh a mediodia, 0,000 explicito el resto); despues vacio.
const publicadoHasta = (hasta) => (fecha, h) => (fecha > hasta ? '' : (sol(h) ? '2,000' : '0,000'));
const vertidoHastaSeptiembre = publicadoHasta('2026/09/30');

function archivo(texto, nombre = 'Consumo_ide.csv') {
  return new File([texto], nombre, { type: 'text/csv' });
}

describe('Vertido sin publicar al final del fichero (i-DE)', () => {
  let csvUtils;
  beforeAll(() => { csvUtils = window.LF.csvUtils; });

  it('El parser devuelve la cobertura del vertido dia a dia y el analisis encuentra el tramo final', () => {
    const { rows, separator, headerRowIndex } = csvUtils.parseCSVToRows(ficheroIde({ vertido: vertidoHastaSeptiembre }));
    const parsed = csvUtils.parseEnergyTableRows(rows, { headerRowIndex, separator });
    expect(parsed.exportCoberturaDias['2026-09-30']).toEqual({
      horas: 24, vacias: 0, ultimaHoraVacia: false, ultimaHoraCero: true, ultimaHoraConDato: 24
    });
    expect(parsed.exportCoberturaDias['2026-03-29']).toEqual({
      horas: 23, vacias: 0, ultimaHoraVacia: false, ultimaHoraCero: true, ultimaHoraConDato: 24
    });
    expect(parsed.exportCoberturaDias['2026-10-01']).toEqual({
      horas: 24, vacias: 24, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: null
    });
    expect(parsed.exportCoberturaDias['2026-11-01']).toEqual({
      horas: 24, vacias: 24, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: null
    });
    expect(parsed.warnings).toContain(parsed.exportEmptyWarning);
    expect(csvUtils.analizarVertidoPublicado(parsed.exportCoberturaDias)).toEqual({
      primerDia: '2026-01-01',
      ultimoDia: '2026-09-30',
      finales: { desde: '2026-10-01', hasta: '2026-11-01', dias: 32, diasParciales: [] },
      otros: [],
      sueltas: 0
    });
  });

  it('Simulador solar: descarta octubre y el 01/11 y lo explica, sin el recuento generico', async () => {
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido: vertidoHastaSeptiembre })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.start).toBe('2026-01-01');
    expect(r.meta.end).toBe('2026-09-30');
    expect(r.meta.months).toBe(9);
    expect(r.records.some((x) => x.fecha.getMonth() >= 9)).toBe(false);
    expect(r.warnings[0]).toBe(
      '✂️ Se descarta del 1 de octubre al 1 de noviembre de 2026 (32 días): tu fichero trae el consumo de esos días, ' +
      'pero no la energía vertida, que la distribuidora aún no ha publicado. Simularlos con 0 kWh vertidos ' +
      'restaría compensación a las tarifas que mejor pagan los excedentes y cambiaría el ranking.\n' +
      'Se simula del 1 de enero al 30 de septiembre de 2026. Cuando se publique, vuelve a descargar el fichero.'
    );
    expect(r.warnings.join('\n')).not.toMatch(/celdas vacías/);
  });

  it('Simulador solar: un ultimo mes publicado SOLO EN PARTE se recorta al ultimo dia publicado', async () => {
    // Octubre publicado hasta el dia 20; del 21 al 31 consumo sin vertido. Por meses no se veia:
    // octubre trae vertido, asi que esas 264 horas se simulaban con 0 kWh vertidos.
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido: publicadoHasta('2026/10/20'), fin: '2026/10/31' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-10-20');
    expect(r.meta.months).toBe(10);
    expect(r.warnings[0]).toMatch(/^✂️ Se descarta del 21 al 31 de octubre de 2026 \(11 días\): tu fichero trae el consumo de esos días/);
    expect(r.warnings[0]).toContain('Se simula del 1 de enero al 20 de octubre de 2026.');
    expect(r.warnings.join('\n')).not.toMatch(/celdas vacías/);
  });

  it('Simulador solar: recorta el ultimo dia parcial cuando la distribuidora escribe ceros de noche', async () => {
    // El 30/09 trae vertido hasta las 14:00 y deja vacias las horas siguientes. Los dias anteriores
    // escriben ceros explicitos a ultima hora, asi que el patron permite detectar el corte.
    const vertido = (fecha, h) => (fecha === '2026/09/30' && h > 14 ? '' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/10/31' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-29');
    expect(r.warnings[0]).toContain('Se descarta del 30 de septiembre al 31 de octubre de 2026 (32 días)');
    expect(r.warnings[0]).toContain('El 30 de septiembre de 2026 solo trae la energía vertida hasta las 14:00.');
    expect(r.warnings[0]).toContain('Se simula del 1 de enero al 29 de septiembre de 2026.');
    expect(r.warnings.join('\\n')).not.toMatch(/celdas vacías/);
  });



  it('Simulador solar: recorta varios dias parciales consecutivos hasta el ultimo dia completo', async () => {
    const vertido = (fecha, h) => (
      (fecha === '2026/09/29' || fecha === '2026/09/30') && h > 14
        ? ''
        : vertidoHastaSeptiembre(fecha, h)
    );
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-28');
    expect(r.warnings[0]).toContain('Se descarta del 29 al 30 de septiembre de 2026 (2 días)');
    expect(r.warnings[0]).toContain('El 29 de septiembre de 2026 solo trae la energía vertida hasta las 14:00.');
    expect(r.warnings[0]).toContain('El 30 de septiembre de 2026 solo trae la energía vertida hasta las 14:00.');
  });

  it('Simulador solar: 24 ceros explicitos en el ultimo dia se conservan', async () => {
    const vertido = (fecha) => (fecha === '2026/09/30' ? '0,000' : vertidoHastaSeptiembre(fecha, 1));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-30');
    expect(r.warnings.some((w) => w.startsWith('✂️'))).toBe(false);
  });

  it('Simulador solar: 24 celdas vacias en el ultimo dia se descartan', async () => {
    const vertido = (fecha, h) => (fecha === '2026/09/30' ? '' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-29');
    expect(r.warnings[0]).toContain('Se descarta el 30 de septiembre de 2026 (1 día)');
  });

  it('Simulador solar: el corte respeta las 23 horas del cambio de marzo', async () => {
    const vertido = (fecha, h) => (fecha === '2026/03/29' && h > 14 ? '' : (sol(h) ? '2,000' : '0,000'));
    const csv = ficheroIde({ vertido, fin: '2026/03/29' });
    const { rows, separator, headerRowIndex } = csvUtils.parseCSVToRows(csv);
    const parsed = csvUtils.parseEnergyTableRows(rows, { headerRowIndex, separator });
    expect(parsed.exportCoberturaDias['2026-03-29']).toEqual({
      horas: 23, vacias: 10, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: 14
    });
    const r = await window.BVSim.importFile(archivo(csv), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-03-28');
    expect(r.warnings[0]).toContain('El 29 de marzo de 2026 solo trae la energía vertida hasta las 14:00.');
  });

  it('Simulador solar: el corte respeta las 25 horas del cambio de octubre', async () => {
    const vertido = (fecha, h) => (fecha === '2026/10/25' && h > 14 ? '' : (sol(h) ? '2,000' : '0,000'));
    const csv = ficheroIde({ vertido, fin: '2026/10/25', incluirHora25: true });
    const { rows, separator, headerRowIndex } = csvUtils.parseCSVToRows(csv);
    const parsed = csvUtils.parseEnergyTableRows(rows, { headerRowIndex, separator });
    expect(parsed.exportCoberturaDias['2026-10-25']).toEqual({
      horas: 25, vacias: 11, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: 14
    });
    expect(parsed.records.some((r) => ymd(r.fecha) === '2026/10/25' && r.hora === 25)).toBe(true);
    const r = await window.BVSim.importFile(archivo(csv), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-10-24');
    expect(r.warnings[0]).toContain('El 25 de octubre de 2026 solo trae la energía vertida hasta las 14:00.');
  });

  it('Parser: en el dia de 25 h la ultima hora es la 25, no la 24', () => {
    // Hora 24 publicada (0,000) y hora 25 vacia: el dia esta incompleto. Mirando la hora 24 se
    // daria por completo.
    const vertido = (fecha, h) => (fecha === '2026/10/25' && h === 25 ? '' : (sol(h) ? '2,000' : '0,000'));
    const csv = ficheroIde({ vertido, fin: '2026/10/25', incluirHora25: true });
    const { rows, separator, headerRowIndex } = csvUtils.parseCSVToRows(csv);
    const parsed = csvUtils.parseEnergyTableRows(rows, { headerRowIndex, separator });
    expect(parsed.exportCoberturaDias['2026-10-25']).toMatchObject({ horas: 25, vacias: 1, ultimaHoraVacia: true });
  });

  it('Simulador solar: un dia entero vacio entre dos dias publicados no provoca el corte', async () => {
    const vertido = (fecha, h) => (fecha === '2026/09/10' ? '' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-30');
    expect(r.records.some((x) => ymd(x.fecha) === '2026/09/10')).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('✂️'))).toBe(false);
    expect(r.warnings).toContain('Se encontraron 24 celdas vacías o "Sin dato" en la columna energiaVertida_kWh; interpretadas como 0.');
  });

  it('Home: informa de la hora hasta la que llega el vertido en el ultimo dia parcial', async () => {
    const vertido = (fecha, h) => (fecha === '2026/09/30' && h > 14 ? '' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.LF.procesarCSVConsumos(archivo(ficheroIde({ vertido })));
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(305);
    const aviso = r.warnings.find((w) => w.includes('no trae toda la energía vertida'));
    expect(aviso).toContain('El 30 de septiembre de 2026 solo trae la energía vertida hasta las 14:00.');
    expect(aviso).toContain('La energía vertida que falta se calcula con 0 kWh vertidos');
  });

  it('Simulador solar: un solo dia final sin vertido usa singular', async () => {
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido: vertidoHastaSeptiembre, fin: '2026/10/01' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-30');
    expect(r.warnings[0]).toMatch(/^✂️ Se descarta el 1 de octubre de 2026 \(1 día\): tu fichero trae el consumo de ese día, pero no la energía vertida.*Simularlo con 0 kWh/s);
  });

  it('Simulador solar: noches en blanco (horas a cero sin escribir) no recortan nada', async () => {
    // Una distribuidora que deje vacias las horas sin vertido en vez de escribir 0: el ultimo dia
    // trae vertido a mediodia y se conserva entero. Sus noches son celdas sueltas, no un tramo final.
    const vertido = (fecha, h) => (sol(h) ? '2,000' : '');
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-30');
    expect(r.warnings.some((w) => w.startsWith('✂️'))).toBe(false);
    expect(r.warnings.join('\n')).toMatch(/^Se encontraron \d+ celdas vacías/m);
  });

  it('Simulador solar: las celdas sueltas de dias con vertido siguen avisandose con su recuento', async () => {
    const vertido = (fecha, h) => (fecha === '2026/09/10' && h <= 3 ? '' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-09-30');
    const aviso = r.warnings.find((w) => /celdas vacías/.test(w));
    expect(aviso).toMatch(/^Se encontraron 3 celdas vacías o "Sin dato" en la columna energiaVertida_kWh; interpretadas como 0\.$/);
  });

  it('Simulador solar: un mes sin vertido EN MEDIO no se descarta; se avisa por su nombre y del efecto en el ranking', async () => {
    const vertido = (fecha, h) => (fecha.startsWith('2026/03/') ? '' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido, fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.months).toBe(9);
    expect(r.records.some((x) => x.fecha.getMonth() === 2)).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('✂️'))).toBe(false);
    expect(r.warnings).toContain('Marzo de 2026 no trae energía vertida en tu fichero: se simula con 0 kWh vertidos. Si ya tenías las placas funcionando, falta la compensación de ese mes y el orden del ranking puede cambiar.');
    expect(r.warnings.join('\n')).not.toMatch(/celdas vacías/);
  });

  it('Simulador solar: ceros EXPLICITOS al final no se descartan (como los escribe la importacion Datadis)', async () => {
    const vertido = (fecha, h) => (fecha >= '2026/10/01' ? '0,000' : vertidoHastaSeptiembre(fecha, h));
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-11-01');
    expect(r.warnings.some((w) => w.startsWith('✂️'))).toBe(false);
  });

  it('Columna vacia entera: dice que el fichero no trae vertido, no que no haya excedentes', async () => {
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido: () => '' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.meta.end).toBe('2026-11-01');
    // En el simulador solar, y solo aqui, el aviso comun anade la tabla mensual.
    expect(r.warnings).toContain(`${csvUtils.AVISO_VERTIDO_COLUMNA_VACIA} Si sabes cuántos kWh vertiste cada mes, puedes introducirlos a mano en la tabla mensual.`);
    expect(r.warnings.join('\n')).not.toMatch(/No se detectaron excedentes/);
    expect(r.warnings.some((w) => w.startsWith('✂️'))).toBe(false);
  });

  it('Columna con ceros explicitos en todo el fichero: es un dato, sin aviso de vertido', async () => {
    const r = await window.BVSim.importFile(archivo(ficheroIde({ vertido: () => '0,000', fin: '2026/09/30' })), 'Península');
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).not.toMatch(/vertida|excedentes|celdas vacías/);
  });

  it('Home: no recorta el periodo, pero dice que dias no traen vertido y hasta cuando esta publicado', async () => {
    const r = await window.LF.procesarCSVConsumos(archivo(ficheroIde({ vertido: vertidoHastaSeptiembre })));
    expect(r.ok).toBe(true);
    expect(r.dias).toBe(305);
    expect(r.warnings).toContain(
      'Del 1 de octubre al 1 de noviembre de 2026 tu fichero no trae energía vertida: la distribuidora aún no la ha publicado. ' +
      'Esos días se calculan con 0 kWh vertidos, así que su compensación falta en el resultado y puede cambiar qué tarifa sale más barata. ' +
      'Para comparar con todos tus excedentes, importa un periodo que termine el 30 de septiembre de 2026.'
    );
    expect(r.warnings.join('\n')).not.toMatch(/celdas vacías/);
  });
});

describe('Mayoría de últimas horas informadas', () => {
  it('Excluye el ultimo dia del recuento y exige mayoria estricta', () => {
    const cobertura = {
      '2026-01-01': { horas: 24, vacias: 0, ultimaHoraVacia: false, ultimaHoraCero: true, ultimaHoraConDato: 24 },
      '2026-01-02': { horas: 24, vacias: 1, ultimaHoraVacia: true, ultimaHoraConDato: 23 },
      '2026-01-03': { horas: 24, vacias: 1, ultimaHoraVacia: true, ultimaHoraConDato: 23 }
    };
    // Los dos dias anteriores empatan: no se puede concluir que la distribuidora escriba ceros.
    const empate = window.LF.csvUtils.analizarVertidoPublicado(cobertura);
    expect(empate.ultimoDia).toBe('2026-01-03');
    expect(empate.finales).toBe(null);
  });

  it('Cuenta los dias naturales del tramo aunque falte un dia entero en el fichero', () => {
    const cobertura = {
      '2026-10-01': { horas: 24, vacias: 0, ultimaHoraVacia: false, ultimaHoraCero: true, ultimaHoraConDato: 24 },
      '2026-10-03': { horas: 24, vacias: 24, ultimaHoraVacia: true, ultimaHoraConDato: null }
    };
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(cobertura);
    expect(analisis.finales).toEqual({
      desde: '2026-10-02',
      hasta: '2026-10-03',
      dias: 2,
      diasParciales: []
    });
  });

  // Cobertura sintetica: `n` dias publicados con la ultima hora informada (salvo `huecos` dias
  // con una noche suelta en blanco) y, al final, `cola` dias con la ultima hora vacia.
  const coberturaCon = ({ n, huecos = [], cola = 1 }) => {
    const c = {};
    const dia = (i) => `2026-02-${String(i).padStart(2, '0')}`;
    for (let i = 1; i <= n; i++) {
      const hueco = huecos.includes(i);
      c[dia(i)] = { horas: 24, vacias: hueco ? 1 : 0, ultimaHoraVacia: hueco, ultimaHoraCero: !hueco, ultimaHoraConDato: hueco ? 23 : 24 };
    }
    for (let j = 1; j <= cola; j++) {
      c[dia(n + j)] = { horas: 24, vacias: 10, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: 14 };
    }
    return c;
  };

  it('Una noche suelta en blanco entre los dias de referencia no anula la regla (>= 90 %)', () => {
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(coberturaCon({ n: 14, huecos: [2] }));
    expect(analisis.ultimoDia).toBe('2026-02-14');
    expect(analisis.finales).toEqual({
      desde: '2026-02-15', hasta: '2026-02-15', dias: 1, diasParciales: [{ fecha: '2026-02-15', hora: 14 }]
    });
  });

  it('El umbral es inclusivo al 90 % y conserva el tramo por debajo del umbral', () => {
    const justo = window.LF.csvUtils.analizarVertidoPublicado(coberturaCon({ n: 10, huecos: [2] }));
    expect(justo.finales?.diasParciales).toEqual([{ fecha: '2026-02-11', hora: 14 }]);

    const porDebajo = window.LF.csvUtils.analizarVertidoPublicado(coberturaCon({ n: 9, huecos: [2] }));
    expect(porDebajo.finales).toBeNull();
    expect(porDebajo.ultimoDia).toBe('2026-02-10');
  });

  it('Evidencia debil: pocos dias de referencia no bastan para recortar un dia con datos', () => {
    // 3 dias con ceros explicitos y un ultimo dia con la ultima hora vacia: no se puede saber.
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(coberturaCon({ n: 3 }));
    expect(analisis.finales).toBeNull();
    expect(analisis.ultimoDia).toBe('2026-02-04');
  });

  it('Formato mixto: meses con ceros explicitos y un tramo largo en blanco NO se recorta (cambio de formato)', () => {
    // 20 dias con ceros explicitos y despues 5 dias con la ultima hora vacia: mas parecido a un
    // cambio de exportacion que a un corte de publicacion. Se conserva y avisan las celdas sueltas.
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(coberturaCon({ n: 20, cola: 5 }));
    expect(analisis.finales).toBeNull();
    expect(analisis.ultimoDia).toBe('2026-02-25');
  });

  it('La ventana reciente de 14 dias prevalece sobre evidencia antigua', () => {
    const c = {};
    const fecha = (offset) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
    // Evidencia antigua fuerte: 200 días con la última hora informada.
    for (let i = 0; i < 200; i++) {
      c[fecha(i)] = { horas: 24, vacias: 0, ultimaHoraVacia: false, ultimaHoraCero: true, ultimaHoraConDato: 24 };
    }
    // En la ventana reciente solo el último de estos 14 días trae la última hora.
    for (let i = 0; i < 14; i++) {
      const incompleto = i < 13;
      c[fecha(200 + i)] = { horas: 24, vacias: incompleto ? 10 : 0, ultimaHoraVacia: incompleto, ultimaHoraConDato: incompleto ? 14 : 24 };
    }
    // Un único día al final con la última hora vacía es el candidato a recorte.
    c[fecha(214)] = { horas: 24, vacias: 10, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: 14 };

    const analisis = window.LF.csvUtils.analizarVertidoPublicado(c);
    expect(analisis.finales).toBeNull();
    expect(analisis.ultimoDia).toBe(fecha(214));
  });

  it('Un vertido POSITIVO en la ultima hora no prueba que la distribuidora escriba los ceros', () => {
    // Instalacion con bateria que vierte de noche, con la distribuidora dejando los ceros en
    // blanco: 13 de 14 dias con valor positivo en la hora final y un ultimo dia sin vertido
    // nocturno. Ese ultimo dia esta completo: no se recorta (perderia su vertido diurno).
    const c = coberturaCon({ n: 14 });
    Object.keys(c).forEach((k) => { c[k].ultimaHoraCero = false; c[k].ultimaHoraConDato = 24; });
    const analisis = window.LF.csvUtils.analizarVertidoPublicado({ ...c, '2026-02-15': { horas: 24, vacias: 10, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: 14 } });
    expect(analisis.finales).toBeNull();
    expect(analisis.ultimoDia).toBe('2026-02-15');
  });

  const diaCero = { horas: 24, vacias: 0, ultimaHoraVacia: false, ultimaHoraCero: true, ultimaHoraConDato: 24 };
  const diaParcial = { horas: 24, vacias: 10, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: 14 };
  const diaVacio = { horas: 24, vacias: 24, ultimaHoraVacia: true, ultimaHoraCero: false, ultimaHoraConDato: null };
  const f = (n) => `2026-02-${String(n).padStart(2, '0')}`;

  it('Dias enteros en blanco dentro de la ventana cuentan como no probados (ventana en dias naturales)', () => {
    // 14 dias naturales de referencia, 6 de ellos enteros en blanco: solo 8 con cero explicito
    // (< 90 % de 14). Con "14 dias publicados" la ventana retrocederia a evidencia mas antigua.
    const c = {};
    for (let i = 1; i <= 20; i++) c[f(i)] = diaCero;
    for (let i = 9; i <= 14; i++) c[f(i)] = diaVacio;
    c[f(21)] = diaParcial;
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(c);
    expect(analisis.finales).toBeNull();
    expect(analisis.ultimoDia).toBe(f(21));
  });

  it('Parciales separados por dias en blanco: el limite se aplica al intervalo natural descartado', () => {
    // 16-17 parciales, 18-19 enteros en blanco, 20 parcial: el tramo contiguo final es solo el 20,
    // y su ventana (6-19) tiene 2 dias en blanco y 2 parciales: sin evidencia, no se recorta nada.
    const c = {};
    for (let i = 1; i <= 15; i++) c[f(i)] = diaCero;
    c[f(16)] = diaParcial; c[f(17)] = diaParcial;
    c[f(18)] = diaVacio; c[f(19)] = diaVacio;
    c[f(20)] = diaParcial;
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(c);
    expect(analisis.finales).toBeNull();
    expect(analisis.ultimoDia).toBe(f(20));
  });

  it('Tres dias parciales CONSECUTIVOS con referencia limpia si se recortan; un cuarto dia no', () => {
    const base = {};
    for (let i = 1; i <= 14; i++) base[f(i)] = diaCero;
    const tres = window.LF.csvUtils.analizarVertidoPublicado({ ...base, [f(15)]: diaParcial, [f(16)]: diaParcial, [f(17)]: diaParcial });
    expect(tres.finales).toMatchObject({ desde: f(15), hasta: f(17), dias: 3 });
    const cuatro = window.LF.csvUtils.analizarVertidoPublicado({ ...base, [f(15)]: diaParcial, [f(16)]: diaParcial, [f(17)]: diaParcial, [f(18)]: diaParcial });
    expect(cuatro.finales).toBeNull();
  });

  it('Parser: distingue cero explicito, valor positivo y celda vacia en la ultima hora', () => {
    const vertido = (fecha, h) => (h !== 24 ? '0,000' : fecha === '2026/01/01' ? '1,500' : fecha === '2026/01/02' ? '' : '0,000');
    const { rows, separator, headerRowIndex } = window.LF.csvUtils.parseCSVToRows(ficheroIde({ vertido, fin: '2026/01/03' }));
    const { exportCoberturaDias: c } = window.LF.csvUtils.parseEnergyTableRows(rows, { headerRowIndex, separator });
    expect(c['2026-01-01']).toMatchObject({ ultimaHoraVacia: false, ultimaHoraCero: false });
    expect(c['2026-01-02']).toMatchObject({ ultimaHoraVacia: true, ultimaHoraCero: false });
    expect(c['2026-01-03']).toMatchObject({ ultimaHoraVacia: false, ultimaHoraCero: true });
  });

  it('Dias de la ventana sin fila para la ultima hora cuentan como no probados', () => {
    // 7 dias con cero explicito + 7 dias sin la hora 24 en el fichero: 7/14 = 50 % < 90 %.
    const c = coberturaCon({ n: 14 });
    for (let i = 8; i <= 14; i++) {
      c[`2026-02-${String(i).padStart(2, '0')}`] = { horas: 23, vacias: 0, ultimaHoraVacia: null, ultimaHoraCero: null, ultimaHoraConDato: null };
    }
    const analisis = window.LF.csvUtils.analizarVertidoPublicado(c);
    expect(analisis.finales).toBeNull();
  });
});

describe('Textos de fechas', () => {
  it('rangoFechasTexto: un dia, mismo año y años distintos', () => {
    const { rangoFechasTexto } = window.LF.csvUtils;
    expect(rangoFechasTexto('2026-11-01', '2026-11-01')).toBe('el 1 de noviembre de 2026');
    expect(rangoFechasTexto('2026-10-21', '2026-10-31')).toBe('del 21 al 31 de octubre de 2026');
    expect(rangoFechasTexto('2026-10-01', '2026-11-01')).toBe('del 1 de octubre al 1 de noviembre de 2026');
    expect(rangoFechasTexto('2025-12-30', '2026-01-02', { mayuscula: true })).toBe('Del 30 de diciembre de 2025 al 2 de enero de 2026');
  });
});

describe('Metodo de obtencion vacio = sin indicar, no "estimada"', () => {
  it('El parser marca null la celda vacia y conserva Real/Estimada cuando vienen', () => {
    const csvUtils = window.LF.csvUtils;
    const metodo = (fecha, h) => (h === 1 ? '"R"' : h === 2 ? '"E"' : '');
    const { rows, separator, headerRowIndex } = csvUtils.parseCSVToRows(ficheroIde({ vertido: vertidoHastaSeptiembre, metodo, fin: '2026/01/01' }));
    const { records } = csvUtils.parseEnergyTableRows(rows, { headerRowIndex, separator });
    expect(records[0].esReal).toBe(true);
    expect(records[1].esReal).toBe(false);
    expect(records[2].esReal).toBe(null);
  });

  it('Home: el fichero de i-DE (metodo vacio en todas las filas) no se presenta como 7319 estimadas', async () => {
    const r = await window.LF.procesarCSVConsumos(archivo(ficheroIde({ vertido: vertidoHastaSeptiembre })));
    expect(r.ok).toBe(true);
    expect(r.horasTotales).toBe(7319);
    expect(r.datosReales).toBe(0);
    expect(r.datosEstimados).toBe(0);
  });
});
