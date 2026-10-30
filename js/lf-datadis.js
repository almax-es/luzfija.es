/**
 * lf-datadis.js - Importacion OPCIONAL de consumos desde la API privada de Datadis.
 *
 * Todo ocurre en el navegador del usuario: NIF y contrasena viajan de su navegador a datadis.es
 * y a ningun otro sitio. No hay backend, no se guarda nada (ni credenciales ni token ni
 * respuestas) y nada de esto se manda a analitica.
 *
 * Reutiliza el importador CSV canonico: la respuesta JSON de Datadis se convierte a un CSV con
 * la cabecera del propio Datadis y se pasa por `procesarCSVConsumos` + `mostrarPreviewCSV`
 * (js/lf-csv-import.js). Asi la clasificacion P1/P2/P3, festivos, cambios de hora y avisos son
 * exactamente los del importador de ficheros; este modulo NO duplica ninguna logica horaria.
 *
 * Hechos medidos contra la API real (29-30/10/2026), que condicionan el diseno:
 *  - 3 logins fallidos seguidos bloquean el usuario ("User blocked", HTTP 500) tambien por API.
 *    Por eso aqui solo se permiten 2 fallos. El contador va en localStorage con caducidad de 24 h
 *    (con sessionStorage, otra pestana o una recarga dejaban gastar el tercero) y un NIF/NIE con
 *    la letra de control equivocada se rechaza ANTES de llamar a Datadis, sin gastar intento.
 *  - Los errores de login llegan como HTTP 500 con { message: 'Bad credentials' | 'User blocked' }.
 *  - Datadis no deja repetir la misma consulta de consumo en 24 h: nunca se reintenta, lo ya
 *    descargado se guarda en memoria durante la pagina y cancelar NO aborta una descarga de
 *    consumos ya pedida (Datadis la contaria igual): termina en segundo plano y queda en memoria.
 *  - get-supplies puede tardar mas de un minuto.
 *  - Dias de cambio de hora: el de 23 h SALTA la etiqueta 03 y el de 25 h REPITE la 03.
 *
 * Interruptor de apagado: poner DATADIS_IMPORT_ENABLED = false oculta el boton y deja solo el
 * importador de CSV. No hay otra dependencia.
 */
(function () {
  'use strict';

  window.LF = window.LF || {};

  const DATADIS_IMPORT_ENABLED = true;

  const BASE = 'https://datadis.es';
  const DIAS_HISTORICO = 365;
  const MAX_FALLOS_LOGIN = 2;
  const FALLOS_KEY = 'lf_datadis_fallos';
  const FALLOS_TTL_MS = 24 * 60 * 60 * 1000;
  const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

  const T_LOGIN = 30000;
  const T_SUMINISTROS = 180000;
  const T_CONTRATO = 60000;
  const T_CONSUMO = 300000;
  const T_CONSUMO_MES = 120000;

  // Lo ya descargado en esta pagina (solo memoria). Evita repetir una consulta que Datadis
  // rechazaria durante 24 h si el usuario vuelve a abrir el modal.
  const cacheConsumos = new Map();

  class DatadisError extends Error {
    constructor(code, status) {
      super(code);
      this.name = 'DatadisError';
      this.code = code;
      this.status = status || 0;
    }
  }

  // ===== Utilidades puras (expuestas para tests) =====

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** Ultimos DIAS_HISTORICO dias terminando AYER (hoy aun no tiene lecturas completas). */
  function rangoUltimosDias(now, dias) {
    const n = Number.isFinite(dias) && dias > 0 ? Math.floor(dias) : DIAS_HISTORICO;
    const base = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    const fin = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
    const ini = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - (n - 1));
    const ymd = (d) => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    const ym = (d) => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`;
    return { iniYmd: ymd(ini), finYmd: ymd(fin), iniMes: ym(ini), finMes: ym(fin) };
  }

  const fmtYmd = (d) => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const fmtYm = (d) => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}`;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function hoyLocal(now) {
    const base = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    return new Date(base.getFullYear(), base.getMonth(), base.getDate());
  }

  /** Simulador solar: los 12 ultimos meses naturales COMPLETOS (exige 12 meses, no 365 dias). */
  function rangoMesesCompletos(now) {
    const hoy = hoyLocal(now);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    const ini = new Date(fin.getFullYear(), fin.getMonth() - 11, 1);
    return { iniYmd: fmtYmd(ini), finYmd: fmtYmd(fin), iniMes: fmtYm(ini), finMes: fmtYm(fin) };
  }

  /**
   * Home, "Otro periodo": fechas 'AAAA-MM-DD' de los <input type="date">. Se valida ANTES de
   * llamar a Datadis (una consulta erronea tambien cuenta para su limite de 24 h).
   * Datadis solo pide por meses: se piden los meses que cubren el rango y se recortan los dias.
   */
  function rangoPersonalizado(desde, hasta, now) {
    const leer = (v) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
    };
    const ini = leer(desde);
    const fin = leer(hasta);
    if (!ini || !fin) return { error: 'formato' };
    const hoy = hoyLocal(now);
    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    if (ini > fin) return { error: 'orden' };
    if (fin > ayer) return { error: 'futuro' };
    if (ini < inicioMasAntiguo(hoy)) return { error: 'antiguo' };
    if (Math.round((fin - ini) / 86400000) + 1 > DIAS_HISTORICO) return { error: 'largo' };
    return { rango: { iniYmd: fmtYmd(ini), finYmd: fmtYmd(fin), iniMes: fmtYm(ini), finMes: fmtYm(fin) } };
  }

  /**
   * Primer dia que se puede pedir. Datadis rechaza (HTTP 400) una consulta cuyo mes de inicio
   * empiece hace mas de 2 anos, y las consultas son por mes: vale el primer mes cuyo dia 1 este
   * dentro de esos 2 anos (no basta con que lo este el dia elegido).
   */
  function inicioMasAntiguo(now) {
    const hoy = hoyLocal(now);
    const limite = new Date(hoy.getFullYear() - 2, hoy.getMonth(), hoy.getDate());
    const mes = new Date(limite.getFullYear(), limite.getMonth(), 1);
    return mes >= limite ? mes : new Date(limite.getFullYear(), limite.getMonth() + 1, 1);
  }

  /** '2025/10' -> 'octubre de 2025' */
  function etiquetaMes(ym) {
    const m = /^(\d{4})\/(\d{2})$/.exec(String(ym || ''));
    return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : String(ym || '');
  }

  /**
   * Valor numerico de un campo de Datadis o NaN si no hay dato. Una cadena vacia NO es 0: Datadis
   * deja vacias las horas sin lectura (por ejemplo, el primer dia de alta del contador).
   */
  function numero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string' || !v.trim()) return NaN;
    return Number(v.trim().replace(',', '.'));
  }

  /** Hora de la etiqueta de Datadis ('01:00'..'24:00'). */
  function horaEtiqueta(f) {
    return parseInt(String(f && f.time), 10);
  }

  /**
   * Fila util: fecha valida y hora distinta de 00:00. Algunas distribuidoras anaden una fila
   * "00:00" (vacia) en dias que ya traen sus 24 horas, sobre todo el primer dia de alta del
   * contador; contarla convertiria ese dia en uno de 25 h y desplazaria todas sus horas.
   */
  function filaUtil(f) {
    return !!f && typeof f.date === 'string' && /^\d{4}\/\d{2}\/\d{2}$/.test(f.date) && horaEtiqueta(f) !== 0;
  }

  function tieneConsumo(f) {
    return filaUtil(f) && Number.isFinite(numero(f.consumptionKWh));
  }

  const UMBRAL_COBERTURA = 0.98;

  function mesesDelRango(rango) {
    const [y0, m0] = rango.iniMes.split('/').map(Number);
    const [y1, m1] = rango.finMes.split('/').map(Number);
    const meses = [];
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1);) {
      meses.push(`${y}/${pad2(m)}`);
      if (++m > 12) { m = 1; y++; }
    }
    return meses;
  }

  /**
   * Horas que DEBERIAN existir en ese mes dentro del rango: dias x 24, menos una el ultimo
   * domingo de marzo y mas una el ultimo de octubre (cambios de hora, tambien en Canarias).
   */
  function horasEsperadasMes(mes, rango) {
    const [y, m] = mes.split('/').map(Number);
    const dias = new Date(y, m, 0).getDate();
    const ini = rango.iniYmd.slice(0, 7) === mes ? Number(rango.iniYmd.slice(8)) : 1;
    const fin = rango.finYmd.slice(0, 7) === mes ? Number(rango.finYmd.slice(8)) : dias;
    let horas = Math.max(0, fin - ini + 1) * 24;
    if (m === 3 || m === 10) {
      const ultimoDomingo = dias - new Date(y, m - 1, dias).getDay();
      if (ultimoDomingo >= ini && ultimoDomingo <= fin) horas += m === 3 ? -1 : 1;
    }
    return horas;
  }

  /**
   * Cobertura del CONSUMO contra lo que deberia llegar (no contra lo que llega): un mes o unos
   * dias que Datadis omite por completo tambien cuentan como hueco.
   *  - Meses vacios al PRINCIPIO (suministro dado de alta hace menos de un ano), mas un primer mes
   *    parcial si lo hay (alta a mitad de mes): se omiten y se importan los meses siguientes.
   *  - Cualquier otro mes por debajo del 98 % (vacio en medio o al final, o con dias de menos):
   *    fallo; el simulador infravaloraria el consumo.
   *  - Entre el 98 % y el 100 %: se acepta y se avisa de las horas que faltan.
   */
  function evaluarCobertura(filas, rango) {
    const horas = new Map();
    for (const f of Array.isArray(filas) ? filas : []) {
      if (!f || typeof f.date !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(f.date) || !tieneConsumo(f)) continue;
      if (f.date < rango.iniYmd || f.date > rango.finYmd) continue;
      const mes = f.date.slice(0, 7);
      horas.set(mes, (horas.get(mes) || 0) + 1);
    }
    const meses = mesesDelRango(rango).map((mes) => {
      const esperadas = horasEsperadasMes(mes, rango);
      const h = Math.min(horas.get(mes) || 0, esperadas);
      return { mes, esperadas, horas: h, cobertura: esperadas ? h / esperadas : 0 };
    });
    let i = 0;
    while (i < meses.length && meses[i].horas === 0) i++;
    if (i < meses.length && meses[i].cobertura < UMBRAL_COBERTURA) i++;
    const usados = meses.slice(i);
    return {
      meses,
      omitidos: meses.slice(0, i).map((m) => m.mes),
      usados: usados.map((m) => m.mes),
      fallos: usados.filter((m) => m.cobertura < UMBRAL_COBERTURA),
      huecos: usados.filter((m) => m.cobertura >= UMBRAL_COBERTURA && m.horas < m.esperadas)
    };
  }

  /**
   * Excedentes MES A MES. Un mes trae dato si alguna de sus horas trae un numero; sus horas en
   * null se toman como 0 kWh: Datadis no obliga a las distribuidoras a enviar el excedente
   * cuando es 0, asi que dentro de un mes con datos un null es casi siempre un cero no enviado.
   * Un mes ENTERO sin ningun dato es otra cosa: puede ser un cero no enviado o un hueco, y
   * decidirSolar lo trata segun la epoca del ano.
   */
  function evaluarExcedentes(filas, rango) {
    const meses = new Map();
    for (const f of Array.isArray(filas) ? filas : []) {
      if (!f || typeof f.date !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(f.date) || !tieneConsumo(f)) continue;
      if (rango && (f.date < rango.iniYmd || f.date > rango.finYmd)) continue;
      const mes = f.date.slice(0, 7);
      if (!meses.has(mes)) meses.set(mes, { mes, horas: 0, conDato: 0, positivos: 0, kwh: 0 });
      const m = meses.get(mes);
      m.horas++;
      const v = numero(f.surplusEnergyKWh);
      if (Number.isFinite(v)) {
        m.conDato++;
        if (v > 0) { m.positivos++; m.kwh += v; }
      }
    }
    const lista = [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));
    for (const m of lista) m.estado = m.conDato === 0 ? 'sin' : 'con';
    const estado = !lista.length ? 'ausente'
      : lista.every((m) => m.estado === 'con') ? 'completo'
        : lista.every((m) => m.estado === 'sin') ? 'ausente' : 'parcial';
    const hayPositivos = lista.some((m) => m.positivos > 0);
    return {
      meses: lista,
      estado,
      hayPositivos,
      horasSinDato: lista.filter((m) => m.estado === 'con').reduce((s, m) => s + (m.horas - m.conDato), 0),
      mesesSinDato: lista.filter((m) => m.estado === 'sin').map((m) => m.mes),
      mesesACero: hayPositivos ? lista.filter((m) => m.estado === 'con' && m.positivos === 0).map((m) => m.mes) : []
    };
  }

  // Tipo de autoconsumo (tabla 113 de los formatos CNMC). Conviven dos codificaciones oficiales:
  // la antigua (31-33 sin excedentes; 41-43, 51-58, 61-64 y 71-74 con excedentes) y la nueva
  // (11 sin excedentes, 12 con excedentes). 00 = sin autoconsumo. 0C (baja de un autoconsumo
  // colectivo) y los tipos del regimen anterior (01, 2A, 2B, 2G) no se clasifican: "no se sabe".
  const AUTOCONSUMO_SIN_EXCEDENTES = ['11', '31', '32', '33'];
  const AUTOCONSUMO_CON_EXCEDENTES = ['12', '41', '42', '43', '51', '52', '53', '54', '55', '56', '57', '58',
    '61', '62', '63', '64', '71', '72', '73', '74'];

  /**
   * Que dice el contrato sobre autoconsumo: 'con' | 'sin' (excedentes) | 'si' (autoconsumo de
   * tipo no identificable) | 'no' | null (no se sabe). Primero la DESCRIPCION, despues el CODIGO
   * de la tabla 113 y por ultimo indicios (potencia instalada, CAU).
   * 'no' exige una prueba POSITIVA (codigo 00 o "sin autoconsumo"): si el contrato no dice nada,
   * es "no se sabe", nunca "no hay placas".
   */
  function leerAutoconsumo(respuestaContrato) {
    const c = contratoVigente(respuestaContrato);
    if (!c) return null;
    const desc = String(c.selfConsumptionTypeDesc || '');
    if (/sin\s+autoconsumo/i.test(desc)) return 'no';
    if (/sin\s+excedentes/i.test(desc)) return 'sin';
    if (/con\s+excedentes/i.test(desc)) return 'con';
    const code = String(c.selfConsumptionTypeCode == null ? '' : c.selfConsumptionTypeCode).trim().toUpperCase();
    if (AUTOCONSUMO_SIN_EXCEDENTES.includes(code)) return 'sin';
    if (AUTOCONSUMO_CON_EXCEDENTES.includes(code)) return 'con';
    const cap = Number(c.installedCapacityKW != null ? c.installedCapacityKW : c.installedCapacity);
    if ((code && !/^0+$/.test(code)) || (Number.isFinite(cap) && cap > 0) || (typeof c.cau === 'string' && c.cau.trim())) return 'si';
    if (/^0+$/.test(code)) return 'no';
    return null;
  }

  /** Abril a septiembre: con placas es muy improbable un mes entero sin verter nada. */
  function esMesDeSol(mes) {
    const m = Number(String(mes).slice(5, 7));
    return m >= 4 && m <= 9;
  }

  /**
   * Simulador solar: nunca se genera un ranking como si no hubiera excedentes cuando puede
   * haberlos y faltan. Devuelve { accion: 'importar'|'confirmar'|'bloquear', excedentes, motivo }.
   */
  function decidirSolar(autoconsumo, ev) {
    if (!ev.hayPositivos && (autoconsumo === 'no' || autoconsumo === 'sin')) {
      return { accion: 'importar', excedentes: 'sin', motivo: autoconsumo };
    }
    if (ev.hayPositivos) {
      if (ev.estado === 'parcial') {
        // Meses enteros sin dato de excedentes mientras otros si traen: en un mes de sol es casi
        // seguro un hueco; en invierno puede ser un cero que la distribuidora no envia.
        if (ev.mesesSinDato.some(esMesDeSol)) return { accion: 'bloquear', motivo: 'parcial' };
        return { accion: 'confirmar', excedentes: 'con', motivo: 'meses-sin-dato' };
      }
      // Un mes entero a 0 kWh mientras otros vierten: puede ser real (instalacion posterior,
      // averia) o un hueco publicado como 0. No se puede distinguir: se pregunta.
      if (ev.mesesACero.length) return { accion: 'confirmar', excedentes: 'con', motivo: 'meses-cero' };
      return { accion: 'importar', excedentes: 'con', motivo: 'completo' };
    }
    // Ni un kWh vertido en todo el periodo (todo null, todo 0 o una mezcla).
    if (autoconsumo === 'con') {
      return ev.estado === 'completo'
        ? { accion: 'confirmar', excedentes: 'con', motivo: 'ceros' }
        : { accion: 'bloquear', motivo: 'ausente-con' };
    }
    return { accion: 'confirmar', excedentes: 'sin', motivo: 'desconocido' };
  }

  function decimalEs(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    const s = /e/i.test(String(n)) ? n.toFixed(6) : String(n);
    return s.replace('.', ',');
  }

  /**
   * timeCurve de Datadis -> CSV con la cabecera del propio Datadis.
   * - La hora es la ETIQUETA de Datadis (01..24), salvo el dia de 25 h, que se numera 1..25
   *   cronologicamente (la etiqueta 03 aparece dos veces). El dia de 23 h conserva el salto.
   * - Filas sin consumo se omiten (hueco honesto) en vez de inventar un 0.
   * - El CSV no lleva CUPS ni direccion: solo fecha, hora, kWh y metodo.
   * - Excedentes: 'auto' (home) anade la columna si hay algun valor > 0; 'con' la anade siempre y
   *   'sin' nunca (simulador solar, segun decidirSolar). Con columna, una hora sin dato va a 0
   *   (ver evaluarExcedentes); un mes ENTERO sin dato lo avisa la home y lo decide el solar.
   */
  function construirCsv(filas, rango, modoExcedentes) {
    const lista = Array.isArray(filas) ? filas : [];
    const porDia = new Map();
    for (const f of lista) {
      if (!filaUtil(f)) continue; // incluida la fila 00:00 de mas: no cuenta para las 24/25 h
      if (rango && (f.date < rango.iniYmd || f.date > rango.finYmd)) continue;
      if (!porDia.has(f.date)) porDia.set(f.date, []);
      porDia.get(f.date).push(f);
    }
    // Solo con las filas DEL RANGO: excedentes de dias que el usuario ha dejado fuera no deben
    // crear la columna (sus horas saldrian como ceros que nadie ha medido).
    const hayExcedentes = modoExcedentes === 'con' ? true
      : modoExcedentes === 'sin' ? false
        : [...porDia.values()].some((arr) => arr.some((f) => tieneConsumo(f) && numero(f.surplusEnergyKWh) > 0));
    const cab = ['CUPS', 'Fecha', 'Hora', 'Consumo_kWh', 'Metodo_obtencion'];
    if (hayExcedentes) cab.push('Energia_vertida_kWh');
    const out = [cab.join(';')];
    let filasUsadas = 0;
    for (const dia of [...porDia.keys()].sort()) {
      const arr = porDia.get(dia);
      const [y, m, d] = dia.split('/');
      arr.forEach((f, i) => {
        if (!tieneConsumo(f)) return;
        const hora = arr.length === 25 ? i + 1 : horaEtiqueta(f);
        if (!Number.isFinite(hora) || hora < 1 || hora > 25) return;
        const metodo = /^real$/i.test(String(f.obtainMethod || '').trim()) ? 'Real' : 'Estimada';
        const fila = ['CUPS', `${d}/${m}/${y}`, hora, decimalEs(numero(f.consumptionKWh)), metodo];
        const vertido = numero(f.surplusEnergyKWh);
        if (hayExcedentes) fila.push(vertido > 0 ? decimalEs(vertido) : '0');
        out.push(fila.join(';'));
        filasUsadas++;
      });
    }
    return { csv: out.join('\r\n') + '\r\n', filasUsadas, diasConDatos: porDia.size, hayExcedentes };
  }

  /**
   * El contrato VIGENTE de la respuesta. get-contract-detail puede devolver varios (cambio de
   * potencia, de titular o de modalidad de autoconsumo): el que no tiene fecha de fin y, si hay
   * varios o ninguno, el de inicio mas reciente.
   */
  function contratoVigente(respuestaContrato) {
    const lista = respuestaContrato && Array.isArray(respuestaContrato.contract)
      ? respuestaContrato.contract.filter((c) => c && typeof c === 'object') : [];
    if (lista.length <= 1) return lista[0] || null;
    const abiertos = lista.filter((c) => !c.endDate);
    const candidatos = abiertos.length ? abiertos : lista;
    return candidatos.slice().sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0];
  }

  /** Potencias del contrato vigente (kW) o null si no son creibles. */
  function leerPotencias(respuestaContrato) {
    const c = contratoVigente(respuestaContrato);
    const p = c && Array.isArray(c.contractedPowerkW) ? c.contractedPowerkW : null;
    if (!p) return null;
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 100;
    const p1 = p[0];
    const p2 = ok(p[1]) ? p[1] : p[0];
    if (!ok(p1)) return null;
    return { p1, p2 };
  }

  function normalizarSuministros(j) {
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.supplies) ? j.supplies : []);
    return arr.filter((s) => s && typeof s.cups === 'string' && s.cups && s.distributorCode !== undefined && s.distributorCode !== null);
  }

  /** "12345678-z " -> "12345678Z". Datadis usa el documento en mayusculas y sin separadores. */
  function normalizarDocumento(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/[\s.\-_/]/g, '');
  }

  /**
   * Error de formato detectable SIN llamar a Datadis (cada login fallido acerca el bloqueo).
   * Solo se rechaza lo que es seguro que esta mal: DNI/NIE con la letra de control equivocada o
   * DNI sin letra. Cualquier otro formato (CIF, NIF K/L/M...) se deja pasar.
   */
  function errorDocumento(doc) {
    if (!doc) return 'vacio';
    if (/^\d{8}$/.test(doc)) return 'sinletra';
    let m = /^(\d{8})([A-Z])$/.exec(doc);
    if (m) return LETRAS_DNI[Number(m[1]) % 23] === m[2] ? '' : 'letra';
    m = /^([XYZ])(\d{7})([A-Z])$/.exec(doc);
    if (m) return LETRAS_DNI[Number('XYZ'.indexOf(m[1]) + m[2]) % 23] === m[3] ? '' : 'letra';
    return '';
  }

  function cupsEnmascarado(cups) {
    const c = String(cups || '');
    return c.length > 12 ? `${c.slice(0, 6)}…${c.slice(-4)}` : '…';
  }

  // ===== Red =====

  function mensajeServidor(texto) {
    try {
      const j = JSON.parse(texto);
      return j && typeof j.message === 'string' ? j.message.slice(0, 120) : '';
    } catch { return ''; }
  }

  async function peticion(url, init, ms, senalUsuario) {
    const ctrl = new AbortController();
    let agotado = false;
    const timer = setTimeout(() => { agotado = true; ctrl.abort(); }, ms);
    const alAbortar = () => ctrl.abort();
    if (senalUsuario) {
      if (senalUsuario.aborted) ctrl.abort();
      else senalUsuario.addEventListener('abort', alAbortar, { once: true });
    }
    try {
      const r = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
      const text = await r.text();
      return { ok: r.ok, status: r.status, text };
    } catch {
      if (agotado) throw new DatadisError('timeout');
      if (senalUsuario && senalUsuario.aborted) throw new DatadisError('cancelado');
      throw new DatadisError('red');
    } finally {
      clearTimeout(timer);
      if (senalUsuario) senalUsuario.removeEventListener('abort', alAbortar);
    }
  }

  async function hacerLogin(nif, clave, senal) {
    const r = await peticion(BASE + '/nikola-auth/tokens/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ username: nif, password: clave }).toString()
    }, T_LOGIN, senal);
    if (r.ok) {
      // El token llega como texto plano; se acepta tambien entre comillas o dentro de { token }.
      let t = r.text.trim();
      if (t.startsWith('{')) {
        try { t = String(JSON.parse(t).token || ''); } catch { t = ''; }
      }
      t = t.replace(/^"|"$/g, '').trim();
      if (!/^[\w-]+\.[\w-]+\.[\w-]*$/.test(t)) throw new DatadisError('http', r.status);
      return t;
    }
    const m = mensajeServidor(r.text);
    if (/user blocked/i.test(m)) throw new DatadisError('bloqueado', r.status);
    if (r.status === 401 || r.status === 403 || /bad credentials/i.test(m)) throw new DatadisError('credenciales', r.status);
    throw new DatadisError('http', r.status);
  }

  async function consultar(ruta, params, token, ms, senal) {
    const qs = new URLSearchParams(params).toString();
    const r = await peticion(BASE + ruta + (qs ? '?' + qs : ''), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    }, ms, senal);
    if (r.status === 401) throw new DatadisError('sesion', r.status);
    if (r.status === 429) throw new DatadisError('repeticion', r.status);
    if (!r.ok) {
      // El aviso de consulta repetida puede venir como JSON { message } o como texto plano.
      const aviso = mensajeServidor(r.text) || String(r.text || '').slice(0, 300);
      if (/24 ?h|repet|repeat|identical|misma consulta|already/i.test(aviso)) {
        throw new DatadisError('repeticion', r.status);
      }
      throw new DatadisError('http', r.status);
    }
    // Una respuesta vacia (o el literal null) es "sin datos", no un error: asi, en consumos, se
    // pasa a pedir mes a mes como cuando el periodo llega vacio.
    const cuerpo = String(r.text || '').trim();
    if (!cuerpo || cuerpo === 'null') return [];
    try { return JSON.parse(cuerpo); } catch { throw new DatadisError('http', r.status); }
  }

  // ===== Contador de fallos de login =====
  // Solo un numero y una fecha: ni usuario ni nada del suministro. localStorage (no sessionStorage)
  // para que valga en todas las pestanas y tras cerrar el navegador; caduca a las 24 h.
  // Copia en memoria como respaldo: si el navegador bloquea el almacenamiento (o solo la escritura),
  // el limite de 2 sigue valiendo al menos en esta pagina en vez de volver a 0 en cada intento.
  // Es una precaucion: no conoce los fallos hechos en la web de Datadis ni en otros dispositivos.

  let fallosMemoria = { n: 0, t: 0 };
  // Momento del ultimo reinicio (login correcto): un dato guardado ANTES se ignora aunque no se
  // haya podido borrar (removeItem que falla con getItem que si funciona).
  let ultimoReinicio = 0;

  function fallosVigentes(o) {
    const n = Math.max(0, Math.floor(Number(o && o.n)) || 0);
    const t = Number(o && o.t);
    return n > 0 && t > 0 && t > ultimoReinicio && Date.now() - t <= FALLOS_TTL_MS ? n : 0;
  }

  function leerFallos() {
    let enAlmacen = 0;
    try {
      const raw = localStorage.getItem(FALLOS_KEY);
      if (raw) {
        enAlmacen = fallosVigentes(JSON.parse(raw));
        if (!enAlmacen) localStorage.removeItem(FALLOS_KEY);
      }
    } catch { /* almacenamiento bloqueado o dato corrupto: manda la copia en memoria */ }
    return Math.max(enAlmacen, fallosVigentes(fallosMemoria));
  }
  function guardarFallos(n) {
    const ahora = Math.max(Date.now(), ultimoReinicio + 1);
    if (n > 0) {
      fallosMemoria = { n, t: ahora };
      try { localStorage.setItem(FALLOS_KEY, JSON.stringify({ n, t: ahora })); } catch { /* queda la copia en memoria */ }
      return;
    }
    fallosMemoria = { n: 0, t: 0 };
    ultimoReinicio = ahora;
    try {
      localStorage.removeItem(FALLOS_KEY);
    } catch {
      try { localStorage.setItem(FALLOS_KEY, JSON.stringify({ n: 0, t: ahora })); } catch { /* ultimoReinicio ya lo cubre */ }
    }
  }

  /**
   * Serializa los logins entre pestanas (Web Locks) y, ya dentro del bloqueo, vuelve a leer el
   * contador: si otra pestana acaba de registrar un fallo, este intento no se envia. Sin soporte de
   * Web Locks se ejecuta directamente; la relectura del contador sigue aplicando.
   */
  async function conBloqueoLogin(fn) {
    const locks = typeof navigator !== 'undefined' && navigator && navigator.locks;
    if (locks && typeof locks.request === 'function') {
      let iniciada = false;
      try {
        return await locks.request('lf-datadis-login', () => { iniciada = true; return fn(); });
      } catch (e) {
        // Si el login ya empezo, NUNCA se repite (seria otro intento contra Datadis).
        if (iniciada) throw e;
        // Fallo el propio API de bloqueos antes de empezar: se intenta sin el
      }
    }
    return fn();
  }

  // ===== Flujo de importacion =====

  /**
   * @param {{nif:string, clave:string, conPotencia:boolean, senal:AbortSignal,
   *          onProgreso:function(string):void, elegirSuministro:function(Array):Promise<Object|null>}} o
   */
  async function importar(o) {
    const solar = o.destino === 'solar';
    const rango = solar ? rangoMesesCompletos(new Date()) : (o.rango || rangoUltimosDias(new Date()));
    const nif = normalizarDocumento(o.nif);
    const fallo = errorDocumento(nif);
    if (fallo) {
      const e = new DatadisError('documento');
      e.detalle = fallo;
      throw e;
    }

    o.onProgreso('login');
    // La contrasena solo hace falta para el login. Se suelta del objeto recibido ya y de esta
    // variable en cuanto termina (el marco de una funcion async vive mientras dura toda la
    // importacion, incluida una descarga que siga en segundo plano tras cerrar el modal).
    // JavaScript no permite borrar fisicamente una cadena: se eliminan las referencias.
    let claveLogin = o.clave;
    o.clave = '';
    let token;
    try {
      token = await conBloqueoLogin(async () => {
        if (leerFallos() >= MAX_FALLOS_LOGIN) throw new DatadisError('agotado');
        try {
          const t = await hacerLogin(nif, claveLogin, o.senal);
          guardarFallos(0);
          return t;
        } catch (e) {
          if (e && e.code === 'credenciales') guardarFallos(leerFallos() + 1);
          throw e;
        }
      });
    } finally {
      claveLogin = '';
    }

    o.onProgreso('suministros');
    // get-supplies (v1) a proposito: devuelve los suministros de TODAS las distribuidoras en una
    // llamada. La v2 exige distributorCode y obliga a pedir antes get-distributors-with-supplies-v2,
    // que en la prueba real del 29/10/2026 agoto 60 s sin responder.
    const suministros = normalizarSuministros(await consultar('/api-private/api/get-supplies', {}, token, T_SUMINISTROS, o.senal));
    if (!suministros.length) throw new DatadisError('sinsuministros');
    const suministro = suministros.length === 1 ? suministros[0] : await o.elegirSuministro(suministros);
    if (!suministro) throw new DatadisError('cancelado');

    // El contrato da la potencia (si se pide) y, en el simulador solar, si hay autoconsumo y de que
    // tipo: ahi se pide siempre. Si falla, se sigue: la potencia es un extra y la falta de dato
    // de autoconsumo se trata como "no se sabe" (nunca como "no hay placas").
    let contrato = null;
    if (o.conPotencia || solar) {
      o.onProgreso('contrato');
      try {
        contrato = await consultar('/api-private/api/get-contract-detail-v2', {
          cups: suministro.cups, distributorCode: String(suministro.distributorCode)
        }, token, T_CONTRATO, o.senal);
      } catch (e) {
        if (e && (e.code === 'cancelado' || e.code === 'sesion')) throw e;
        contrato = null;
      }
    }
    const potencias = o.conPotencia ? leerPotencias(contrato) : null;

    if (o.senal && o.senal.aborted) throw new DatadisError('cancelado');
    o.onProgreso('consumos');
    const clave = [suministro.cups, suministro.distributorCode, rango.iniMes, rango.finMes].join('|');
    let filas = cacheConsumos.get(clave);
    if (!filas) {
      const params = {
        cups: suministro.cups,
        distributorCode: String(suministro.distributorCode),
        startDate: rango.iniMes,
        endDate: rango.finMes,
        measurementType: '0'
      };
      if (suministro.pointType !== undefined && suministro.pointType !== null && suministro.pointType !== '') {
        params.pointType = String(suministro.pointType);
      }
      // Sin la senal del usuario A PROPOSITO: una vez pedida, Datadis cuenta la consulta aunque se
      // cancele, y repetirla daria error 24 h. Se deja terminar y se guarda en memoria, asi un
      // segundo intento en esta pagina no vuelve a pedirla.
      const pedir = async (ini, fin, ms) => {
        const r = await consultar('/api-private/api/get-consumption-data-v2',
          Object.assign({}, params, { startDate: ini, endDate: fin }), token, ms, null);
        return Array.isArray(r) ? r : (r && Array.isArray(r.timeCurve) ? r.timeCurve : []);
      };
      let errorPeriodo = null;
      try {
        filas = await pedir(rango.iniMes, rango.finMes, T_CONSUMO);
      } catch (e) {
        if (e && e.code === 'http') e.paso = 'consumos';
        // Sesion caducada, red caida, tiempo agotado o consulta repetida: pedir mes a mes no lo arregla.
        if (!e || e.code !== 'http') throw e;
        errorPeriodo = e;
        filas = [];
      }
      // Algunas distribuidoras rechazan (error 500) o devuelven vacia cualquier consulta que
      // incluya el primer mes de un contrato, y se perderia el periodo entero. Mes a mes, del mas
      // reciente al mas antiguo, un mes roto solo se pierde a si mismo; la cobertura lo detecta.
      if (!filas.length && rango.iniMes !== rango.finMes) {
        o.onProgreso('consumos-mes');
        const trozos = [];
        for (const mes of mesesDelRango(rango).reverse()) {
          try {
            trozos.unshift(await pedir(mes, mes, T_CONSUMO_MES));
          } catch (e) {
            if (e && (e.code === 'sesion' || e.code === 'red')) throw e;
            // un mes que falla (500, vacio, repetido) se deja fuera
          }
        }
        filas = trozos.flat();
        if (!filas.length && errorPeriodo) throw errorPeriodo;
      }
      cacheConsumos.set(clave, filas);
    }
    if (o.senal && o.senal.aborted) throw new DatadisError('cancelado');

    if (solar) {
      // 1) Consumo: contra las horas que DEBERIAN llegar, no contra las que llegan.
      const cob = evaluarCobertura(filas, rango);
      if (!cob.usados.length) throw new DatadisError('sindatos');
      if (cob.fallos.length) {
        const err = new DatadisError('solar');
        err.detalle = textoCoberturaSolar(cob);
        throw err;
      }
      const rangoUsado = cob.omitidos.length
        ? Object.assign({}, rango, { iniYmd: `${cob.usados[0]}/01`, iniMes: cob.usados[0] })
        : rango;
      // 2) Excedentes, solo en los meses que se importan.
      const evSolar = evaluarExcedentes(filas, rangoUsado);
      const decision = decidirSolar(leerAutoconsumo(contrato), evSolar);
      if (decision.accion === 'bloquear') {
        const err = new DatadisError('solar');
        err.detalle = textoBloqueoSolar(decision, evSolar);
        throw err;
      }
      if (decision.accion === 'confirmar') {
        const textoSi = decision.motivo === 'ceros' ? 'Importar con excedentes a 0'
          : decision.motivo === 'meses-cero' || decision.motivo === 'meses-sin-dato' ? 'Importar con esos meses a 0'
            : 'No vierto excedentes: importar solo el consumo';
        const ok = await o.confirmar(textoConfirmacionSolar(decision, evSolar), textoSi);
        if (!ok) throw new DatadisError('cancelado');
      }
      const { csv: csvSolar, filasUsadas: usadasSolar } = construirCsv(filas, rangoUsado, decision.excedentes);
      if (!usadasSolar) throw new DatadisError('sindatos');
      return {
        destino: 'solar',
        fichero: new File([csvSolar], `datadis-${cob.usados.length}-meses.csv`, { type: 'text/csv' }),
        avisos: avisosSolar(decision, evSolar, rangoUsado, cob),
        potencias
      };
    }

    const ev = evaluarExcedentes(filas, rango);

    const { csv, filasUsadas } = construirCsv(filas, rango);
    if (!filasUsadas) throw new DatadisError('sindatos');

    const procesar = window.LF.procesarCSVConsumos;
    const fichero = new File([csv], 'datadis.csv', { type: 'text/csv' });
    const resultado = await procesar(fichero);
    if (!resultado || !resultado.ok) {
      const err = new DatadisError('parseo');
      err.detalle = resultado && resultado.error ? String(resultado.error) : '';
      throw err;
    }
    resultado.formato = 'Datadis';
    // Los avisos del importador hablan de "CSV" y de columnas; aqui el origen es Datadis.
    resultado.warnings = (resultado.warnings || []).map((w) => {
      if (typeof w !== 'string') return w;
      if (/^No se detectaron excedentes/.test(w)) {
        return 'Datadis no ha enviado excedentes, así que se importa solo el consumo. Si tienes placas, puede que tu distribuidora no los esté publicando en Datadis: descarga el CSV desde Datadis o desde tu distribuidora o, si sabes cuántos kWh vertiste en este mismo periodo (sumando tus facturas), introdúcelos a mano después de aplicar, activando «Tengo placas solares» en las opciones avanzadas.';
      }
      return w.replace(/^✓ CSV procesado:/, '✓ Datos de Datadis procesados:');
    });
    // Hay excedentes, pero no de todos los meses: en la home cuentan como 0 (estimacion rapida),
    // asi que se dice expresamente cuales faltan.
    if (ev.hayPositivos && ev.mesesSinDato.length) {
      resultado.warnings.push(`Datadis no ha enviado ningún dato de excedentes de ${listaMeses(ev.mesesSinDato)}: esos meses cuentan como 0 kWh vertidos. Revisa el total de excedentes después de aplicar.`);
    }
    if (potencias) {
      resultado.potenciaContratada = potencias;
      const fmt = (n) => String(n).replace('.', ',');
      resultado.warnings = (resultado.warnings || []).concat(
        `Potencia contratada leída de tu contrato en Datadis: P1 ${fmt(potencias.p1)} kW · P2 ${fmt(potencias.p2)} kW. Se aplicará al pulsar «Aplicar».`
      );
    }
    return resultado;
  }

  // ===== Textos =====

  /** ['2026/01','2026/02'] -> 'enero de 2026 y febrero de 2026' */
  function listaMeses(meses) {
    const e = (meses || []).map(etiquetaMes);
    return e.length <= 1 ? (e[0] || '') : `${e.slice(0, -1).join(', ')} y ${e[e.length - 1]}`;
  }

  function textoCoberturaSolar(cob) {
    const lista = cob.fallos.map((m) => `${etiquetaMes(m.mes)} (${Math.floor(m.cobertura * 100)} %)`);
    const texto = lista.length <= 1 ? (lista[0] || '') : `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
    return `Datadis no ha enviado completos los consumos de ${texto}. ` +
      'Con meses incompletos el simulador infravaloraría tu consumo, así que no importamos. ' +
      'Suele ser un retraso de tu distribuidora: vuelve a probar dentro de unos días, o descarga el CSV desde Datadis o desde tu distribuidora y usa «Seleccionar archivo CSV».';
  }

  function textoBloqueoSolar(decision, ev) {
    if (decision.motivo === 'parcial') {
      return `Datadis no ha enviado ningún dato de excedentes de ${listaMeses(ev.mesesSinDato)}, aunque sí de otros meses. ` +
        'En meses de tanto sol es muy improbable que no vertieras nada, y el simulador calcularía como si no lo hubieras hecho, así que no importamos. ' +
        'Descarga el CSV desde Datadis o desde tu distribuidora y usa «Seleccionar archivo CSV», o rellena los excedentes a mano en la tabla mensual.';
    }
    return 'Tu contrato figura en Datadis con autoconsumo con excedentes, pero Datadis no ha enviado ni un kWh vertido en todo el periodo. ' +
      'Si importáramos solo el consumo, el simulador calcularía como si no vertieras nada, así que no importamos. ' +
      'Descarga el CSV desde Datadis o desde tu distribuidora y usa «Seleccionar archivo CSV», o rellena los excedentes a mano en la tabla mensual.';
  }

  function textoConfirmacionSolar(decision, ev) {
    if (decision.motivo === 'meses-sin-dato') {
      return `Datadis no ha enviado ningún dato de excedentes de ${listaMeses(ev.mesesSinDato)}, aunque sí de otros meses. ` +
        'Son meses de poco sol y algunas distribuidoras no envían el dato cuando no hay vertido, así que puede ser correcto. ' +
        'Si en esos meses vertiste algo, no importes: el simulador calcularía como si no lo hubieras hecho. Usa el CSV o corrige la tabla a mano.';
    }
    if (decision.motivo === 'meses-cero') {
      return `Datadis indica 0 kWh vertidos en ${listaMeses(ev.mesesACero)}, mientras que el resto de meses sí vertiste. ` +
        'Puede ser correcto (por ejemplo, si la instalación es posterior o estuvo parada) o que tu distribuidora no haya publicado esos meses. ' +
        'Si en esos meses produjiste, no importes: el simulador calcularía como si no hubieras vertido nada. Usa el CSV o corrige la tabla a mano.';
    }
    if (decision.motivo === 'ceros') {
      return 'Tu contrato figura con autoconsumo con excedentes, pero Datadis indica 0 kWh vertidos en todo el periodo. ' +
        'Puede ser correcto (por ejemplo, si la instalación es muy reciente) o un fallo de tu distribuidora. ' +
        'Si en este año sí vertiste, no importes: usa el CSV o rellena los excedentes a mano.';
    }
    return 'Datadis no ha enviado excedentes y tu contrato no deja claro si tienes una instalación que vierta a la red. ' +
      'Si no tienes placas, o tu instalación no vierte excedentes, puedes importar solo el consumo. ' +
      'Si sí viertes, no importes: el simulador calcularía como si no vertieras nada. Usa el CSV o rellena los excedentes a mano.';
  }

  function avisosSolar(decision, ev, rango, cob) {
    const avisos = [`Datos de Datadis: ${etiquetaMes(rango.iniMes)} a ${etiquetaMes(rango.finMes)}.`];
    if (cob && cob.omitidos.length) {
      avisos.push(`Datadis no tiene datos completos anteriores a ${etiquetaMes(rango.iniMes)} (suministro reciente o cambio de titular): se simulan ${cob.usados.length} meses.`);
    }
    if (cob && cob.huecos.length) {
      const faltan = cob.huecos.reduce((suma, m) => suma + (m.esperadas - m.horas), 0);
      avisos.push(`${faltan === 1 ? 'Falta 1 hora' : `Faltan ${faltan} horas`} de consumo en ${listaMeses(cob.huecos.map((m) => m.mes))} (menos del 2 % de cada mes).`);
    }
    if (decision.excedentes === 'con') {
      if (ev.horasSinDato > 0) {
        avisos.push(`En ${ev.horasSinDato === 1 ? '1 hora' : `${ev.horasSinDato} horas`} Datadis no envió el dato de excedentes y se han tomado como 0 kWh (algunas distribuidoras no lo envían cuando no hay vertido).`);
      }
      const aCero = ev.mesesSinDato.concat(ev.mesesACero).sort();
      if (aCero.length) {
        avisos.push(`Importado con 0 kWh vertidos en ${listaMeses(aCero)}, como has confirmado.`);
      }
    } else if (decision.motivo === 'sin') {
      avisos.push('Tu contrato es de autoconsumo sin excedentes: se importa el consumo y los excedentes quedan a 0.');
    } else if (decision.motivo === 'no') {
      avisos.push('Tu contrato no tiene autoconsumo y Datadis no ha enviado excedentes: se importa solo el consumo. Si tienes placas, rellena los excedentes a mano en la tabla.');
    } else {
      avisos.push('Importado solo el consumo, como has indicado. Si tienes excedentes, rellénalos a mano en la tabla.');
    }
    return avisos;
  }

  const TEXTO_PERIODO = {
    formato: 'Elige las dos fechas del periodo.',
    orden: 'La fecha de inicio tiene que ser anterior a la de fin.',
    futuro: 'El periodo tiene que terminar como muy tarde ayer: Datadis todavía no tiene los datos de hoy.',
    largo: 'El periodo puede ser como máximo de 365 días.',
    antiguo: 'Datadis solo guarda unos dos años de datos: elige una fecha de inicio más reciente.'
  };

  function textoError(err) {
    const fallos = leerFallos();
    switch (err && err.code) {
      case 'credenciales':
        return fallos >= MAX_FALLOS_LOGIN
          ? 'Usuario o contraseña incorrectos. Para no bloquear tu cuenta de Datadis no seguimos intentándolo. Comprueba tu contraseña entrando en datadis.es y después pulsa «Ya he entrado bien en datadis.es».'
          : 'Usuario o contraseña incorrectos. Te queda un intento: si vuelves a fallar, dejaremos de intentarlo para no bloquear tu cuenta de Datadis.';
      case 'agotado':
        return 'Ya se han producido dos intentos fallidos (quizá en otra pestaña). Para no bloquear tu cuenta de Datadis no seguimos intentándolo. Comprueba tu contraseña entrando en datadis.es y después pulsa «Ya he entrado bien en datadis.es».';
      case 'documento':
        return err.detalle === 'sinletra'
          ? 'Falta la letra de tu NIF. No lo hemos enviado a Datadis, así que no has gastado ningún intento.'
          : 'Revisa tu NIF/NIE: la letra no corresponde con el número. No lo hemos enviado a Datadis, así que no has gastado ningún intento.';
      case 'bloqueado':
        return 'Datadis ha bloqueado tu usuario por demasiados intentos fallidos. Para desbloquearlo, entra en datadis.es y pulsa «¿Has olvidado tu contraseña?»: te enviarán una nueva por correo. Mientras tanto puedes descargar el CSV desde Datadis e importarlo con «Importar CSV».';
      case 'red':
        return 'No hemos podido conectar con Datadis. Comprueba tu conexión e inténtalo de nuevo.';
      case 'timeout':
        return 'Datadis ha tardado demasiado en responder. Suele ser un problema temporal de sus servidores: prueba de nuevo en unos minutos o descarga el CSV desde Datadis.';
      case 'repeticion':
        return 'Datadis no permite repetir la misma consulta durante 24 horas. Si ya la hiciste hoy, espera o usa el CSV descargado desde Datadis.';
      case 'sesion':
        return 'Tu sesión de Datadis ha caducado. Vuelve a intentarlo.';
      case 'sinsuministros':
        return 'No hemos encontrado suministros en tu cuenta de Datadis.';
      case 'sindatos':
        return 'Datadis no ha devuelto consumos para ese periodo. Puede ser un suministro nuevo, un periodo anterior a tu contrato o un retraso de tu distribuidora.';
      case 'periodo':
        return (TEXTO_PERIODO[err.detalle] || TEXTO_PERIODO.formato) + ' No hemos llamado a Datadis.';
      case 'solar':
        return err.detalle || 'Los datos de Datadis no son suficientes para el simulador solar. Usa el CSV o rellena la tabla a mano.';
      case 'parseo':
        return (err.detalle || 'No hemos podido interpretar los consumos recibidos.') + ' Puedes probar con el CSV descargado desde Datadis.';
      case 'http':
        return `Datadis ha respondido con un error${err.status ? ` (código ${err.status})` : ''}.` +
          (err.paso === 'consumos'
            ? ' Si ya importaste estos consumos en las últimas 24 horas, es el límite de Datadis: no deja repetir la misma consulta hasta el día siguiente.'
            : '') +
          ' Inténtalo más tarde o usa el CSV descargado desde Datadis.';
      default:
        return 'No se han podido importar los consumos. Inténtalo más tarde o usa el CSV descargado desde Datadis.';
    }
  }

  const TEXTO_PROGRESO = {
    login: 'Conectando con Datadis…',
    suministros: 'Buscando tus suministros… Datadis puede tardar hasta un par de minutos.',
    contrato: 'Leyendo tu contrato…',
    consumos: 'Descargando tus consumos… Datadis puede tardar un poco.',
    'consumos-mes': 'Datadis no ha devuelto el periodo de una vez: lo pedimos mes a mes. Puede tardar un par de minutos.'
  };

  // ===== Interfaz =====

  function esc(v) {
    const f = window.LF && window.LF.escapeHtml;
    return typeof f === 'function' ? f(v) : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
  }

  function abrirModal(destino) {
    const solar = destino === 'solar';
    const previo = document.activeElement;
    const fallosIniciales = leerFallos();
    let ocupado = false;
    let controlador = null;
    let cerrado = false;
    let tokenBloqueo = null;
    // Promesa pendiente de una decision del usuario (elegir suministro o confirmar); al cerrar
    // el modal se resuelve con null para que importar() no quede colgado.
    let resolverPendiente = null;
    // En tactil no se enfoca el NIF al abrir: sacaria el teclado y taparia los avisos.
    const tactil = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

    // Lo que el usuario ha elegido sobrevive a los repintados (error, aviso...). Nunca la contrasena.
    const hoy = hoyLocal();
    const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    const estado = {
      nif: '',
      conPotencia: true,
      periodo: 'anual',
      desde: iso(new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate() - 29)),
      hasta: iso(ayer)
    };
    const fechaMin = iso(inicioMasAntiguo(hoy));
    const fechaMax = iso(ayer);
    const rangoSolar = rangoMesesCompletos();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'lfDdTitulo');
    overlay.tabIndex = -1;

    const content = document.createElement('div');
    content.className = 'modal-content card lf-dd-modal';
    overlay.appendChild(content);

    const selectorFoco = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])';
    const enfocables = () => Array.from(overlay.querySelectorAll(selectorFoco)).filter((n) => n.offsetWidth || n.offsetHeight || n.getClientRects().length);

    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      if (controlador) controlador.abort();
      if (resolverPendiente) { resolverPendiente(null); resolverPendiente = null; }
      document.removeEventListener('keydown', alTeclear);
      const clave = overlay.querySelector('#lfDdClave');
      if (clave) clave.value = '';
      const shared = window.LF && window.LF.modalScrollLock;
      if (tokenBloqueo && shared && typeof shared.unlock === 'function') shared.unlock(tokenBloqueo);
      overlay.remove();
      if (previo && typeof previo.focus === 'function') previo.focus();
    }

    function alTeclear(e) {
      if (e.key === 'Escape') { cerrar(); return; }
      if (e.key !== 'Tab') return;
      const els = enfocables();
      if (!els.length) return;
      const primero = els[0];
      const ultimo = els[els.length - 1];
      if (!overlay.contains(document.activeElement)) { e.preventDefault(); primero.focus(); return; }
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }

    function pintar(html, focoSel) {
      content.innerHTML = html;
      const x = content.querySelector('.modal-x');
      if (x) x.addEventListener('click', cerrar);
      const foco = (focoSel && content.querySelector(focoSel)) || x;
      if (foco && typeof foco.focus === 'function') foco.focus();
    }

    const cabecera = '<button class="modal-x" type="button" aria-label="Cerrar">✕</button>';
    const titulo = '📥 Importar desde Datadis';
    const botonCsv = solar ? '«Seleccionar archivo CSV»' : '«Importar CSV»';

    function vistaFormulario(mensajeError, aviso) {
      const fallos = leerFallos();
      const agotado = fallos >= MAX_FALLOS_LOGIN;
      const bloqueado = mensajeError && /^Datadis ha bloqueado/.test(mensajeError);
      const off = agotado || bloqueado ? 'disabled' : '';
      const lead = solar
        ? `Consulta en tu cuenta de Datadis los 12 últimos meses completos (${etiquetaMes(rangoSolar.iniMes)} a ${etiquetaMes(rangoSolar.finMes)}) de consumo y excedentes para rellenar la tabla mensual. Si tu suministro tiene menos historial, se usan los meses completos que haya.`
        : 'Descarga tu consumo horario (hasta un año) directamente desde tu cuenta de Datadis, sin tener que bajar el CSV a mano.';
      const periodo = solar ? '' : `
          <fieldset class="lf-dd-periodo" ${off}>
            <legend>Periodo</legend>
            <label class="lf-dd-check"><input type="radio" name="lfDdPeriodo" value="anual"><span>Últimos 12 meses <small>(recomendado: recoge verano e invierno)</small></span></label>
            <label class="lf-dd-check"><input type="radio" name="lfDdPeriodo" value="otro"><span>Otro periodo (máximo 365 días)</span></label>
            <div class="lf-dd-fechas" id="lfDdFechas">
              <div class="group">
                <label for="lfDdDesde">Desde</label>
                <input id="lfDdDesde" class="input" type="date" min="${fechaMin}" max="${fechaMax}">
              </div>
              <div class="group">
                <label for="lfDdHasta">Hasta</label>
                <input id="lfDdHasta" class="input" type="date" min="${fechaMin}" max="${fechaMax}">
              </div>
            </div>
          </fieldset>`;
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">${titulo}</h3>
        <p class="lf-dd-lead">${esc(lead)}</p>
        ${mensajeError ? `<div id="lfDdError" class="lf-dd-box lf-dd-error" role="alert" tabindex="-1">${esc(mensajeError)}</div>` : ''}
        ${aviso ? `<div id="lfDdAviso" class="lf-dd-box lf-dd-warn" role="status" tabindex="-1">${esc(aviso)}</div>` : ''}
        ${agotado && !bloqueado ? `<div class="lf-dd-box">
          Cuando hayas comprobado tu contraseña entrando en <a href="https://datadis.es" target="_blank" rel="noopener noreferrer">datadis.es</a>, puedes volver a intentarlo aquí.
          <div class="lf-dd-actions"><button id="lfDdReintentar" class="btn" type="button"><span>Ya he entrado bien en datadis.es</span></button></div>
        </div>` : ''}
        <div class="lf-dd-box">
          <strong>🔒 Cómo se protegen tus datos</strong>
          <ul>
            <li>Tu usuario y contraseña van <strong>directamente de tu navegador a datadis.es</strong>. LuzFija.es no tiene servidor que los reciba y no los guarda.</li>
            <li>Solo se usan para esta importación: la contraseña, para iniciar sesión, y el permiso de Datadis, mientras se descargan tus datos. No se guardan y nada de esto se envía a analítica.</li>
            <li>LuzFija.es es independiente de Datadis y no es una pasarela oficial. Si prefieres no usar tu contraseña, descarga el CSV desde Datadis y usa ${botonCsv}.</li>
          </ul>
        </div>
        <div class="lf-dd-box lf-dd-warn">
          ⚠️ Datadis <strong>bloquea tu cuenta tras 3 intentos fallidos</strong> (también cuentan los que falles en su web o en otro dispositivo). Por eso aquí solo te dejamos dos, como precaución: no podemos saber si ya has fallado en otro sitio. ¿Entras en Datadis con Cl@ve? Necesitas una contraseña propia: puedes crearla en <a href="https://datadis.es" target="_blank" rel="noopener noreferrer">datadis.es</a>.
        </div>
        <form id="lfDdForm" class="lf-dd-form" autocomplete="on" novalidate>
          <div class="group">
            <label for="lfDdNif">NIF / NIE / CIF</label>
            <input id="lfDdNif" class="input" type="text" name="username" autocomplete="username" autocapitalize="characters" spellcheck="false" inputmode="text" ${off}>
          </div>
          <div class="group">
            <label for="lfDdClave">Contraseña de Datadis</label>
            <input id="lfDdClave" class="input" type="password" name="password" autocomplete="current-password" spellcheck="false" ${off}>
          </div>
          <label class="lf-dd-check"><input type="checkbox" id="lfDdVer" ${off}><span>Mostrar contraseña</span></label>
          ${periodo}
          <label class="lf-dd-check"><input type="checkbox" id="lfDdPotencia" ${off}><span>Rellenar también mi potencia contratada (P1 y P2) desde mi contrato</span></label>
          <div class="lf-dd-actions">
            <button id="lfDdEnviar" class="btn primary" type="submit" ${off}><span>Importar mis consumos</span></button>
          </div>
        </form>
      `, mensajeError ? '#lfDdError' : (aviso ? '#lfDdAviso' : (tactil ? null : '#lfDdNif')));

      const form = content.querySelector('#lfDdForm');
      const nif = content.querySelector('#lfDdNif');
      const clave = content.querySelector('#lfDdClave');
      const ver = content.querySelector('#lfDdVer');
      const potencia = content.querySelector('#lfDdPotencia');
      const desde = content.querySelector('#lfDdDesde');
      const hasta = content.querySelector('#lfDdHasta');
      const fechas = content.querySelector('#lfDdFechas');
      const radios = Array.from(content.querySelectorAll('input[name="lfDdPeriodo"]'));

      nif.value = estado.nif;
      potencia.checked = estado.conPotencia;
      if (desde) { desde.value = estado.desde; hasta.value = estado.hasta; }
      const mostrarFechas = () => {
        if (!fechas) return;
        fechas.hidden = estado.periodo !== 'otro';
      };
      radios.forEach((r) => {
        r.checked = r.value === estado.periodo;
        r.addEventListener('change', () => { if (r.checked) { estado.periodo = r.value; mostrarFechas(); } });
      });
      mostrarFechas();

      ver.addEventListener('change', () => { clave.type = ver.checked ? 'text' : 'password'; });
      form.addEventListener('submit', (e) => { e.preventDefault(); lanzar(); });
      const reintentar = content.querySelector('#lfDdReintentar');
      // No se puede comprobar que de verdad haya entrado en datadis.es: por eso se concede UN solo
      // intento mas, no dos. Si vuelve a fallar, el formulario se detiene otra vez.
      if (reintentar) reintentar.addEventListener('click', () => {
        guardarFallos(MAX_FALLOS_LOGIN - 1);
        vistaFormulario('', 'Tienes un intento más. Si vuelve a fallar, dejaremos de intentarlo para no bloquear tu cuenta de Datadis.');
      });

      async function lanzar() {
        if (ocupado || leerFallos() >= MAX_FALLOS_LOGIN) return;
        estado.nif = normalizarDocumento(nif.value);
        estado.conPotencia = potencia.checked;
        if (desde) { estado.desde = desde.value; estado.hasta = hasta.value; }
        const formato = errorDocumento(estado.nif);
        if (!estado.nif || !clave.value || formato) {
          vistaFormulario(formato && formato !== 'vacio'
            ? textoError({ code: 'documento', detalle: formato })
            : 'Introduce tu NIF/NIE/CIF y tu contraseña de Datadis.');
          return;
        }
        // El periodo se valida antes de llamar: una consulta erronea tambien cuenta para Datadis.
        let rango = null;
        if (!solar && estado.periodo === 'otro') {
          const rp = rangoPersonalizado(estado.desde, estado.hasta);
          if (rp.error) { vistaFormulario(textoError({ code: 'periodo', detalle: rp.error })); return; }
          rango = rp.rango;
        }
        // La contrasena pasa del campo al objeto de la peticion y de ahi solo al login: importar()
        // la suelta nada mas usarla, y esta funcion no guarda otra copia.
        const peticionDatadis = { nif: estado.nif, clave: clave.value };
        clave.value = '';
        ocupado = true;
        controlador = new AbortController();
        vistaProgreso(TEXTO_PROGRESO.login);
        try {
          // Mismo objeto (no una copia): asi importar() puede soltar la contrasena de verdad.
          const resultado = await importar(Object.assign(peticionDatadis, {
            destino: solar ? 'solar' : 'home',
            rango,
            conPotencia: estado.conPotencia,
            senal: controlador.signal,
            onProgreso: (paso) => { if (!cerrado) vistaProgreso(TEXTO_PROGRESO[paso] || TEXTO_PROGRESO.login); },
            elegirSuministro: (lista) => esperar((responder) => vistaSuministros(lista, responder)),
            confirmar: (texto, textoSi) => esperar((responder) => vistaConfirmar(texto, textoSi, responder)).then(Boolean)
          }));
          ocupado = false;
          if (cerrado) return;
          cerrar();
          if (solar) await finalizarSolar(resultado);
          else window.LF.mostrarPreviewCSV(resultado);
        } catch (err) {
          ocupado = false;
          if (cerrado || (err && err.code === 'cancelado')) return;
          vistaFormulario(textoError(err));
        }
      }
    }

    function esperar(pintarVista) {
      return new Promise((resolve) => {
        if (cerrado) { resolve(null); return; }
        resolverPendiente = resolve;
        pintarVista((valor) => {
          const r = resolverPendiente;
          resolverPendiente = null;
          if (r) r(valor);
        });
      });
    }

    function vistaProgreso(texto) {
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">${titulo}</h3>
        <div class="lf-dd-progreso" role="status" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <p>${esc(texto)}</p>
        </div>
        <div class="lf-dd-actions"><button id="lfDdCancelar" class="btn" type="button"><span>Cancelar</span></button></div>
      `, '#lfDdCancelar');
      content.querySelector('#lfDdCancelar').addEventListener('click', cerrar);
    }

    function vistaSuministros(lista, responder) {
      const activos = lista.filter((s) => !s.validDateTo);
      const preferido = (activos[0] || lista[0]);
      const opciones = lista.map((s) => {
        const etiqueta = [s.address, s.municipality, s.province].filter(Boolean).join(', ') || 'Suministro';
        const baja = s.validDateTo ? ` (baja ${s.validDateTo})` : '';
        return `<option value="${esc(s.cups)}"${s === preferido ? ' selected' : ''}>${esc(etiqueta)} · ${esc(cupsEnmascarado(s.cups))}${esc(baja)}</option>`;
      }).join('');
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">📥 Elige tu suministro</h3>
        <p class="lf-dd-lead">Tu cuenta de Datadis tiene ${lista.length} suministros. ¿Cuál quieres importar?</p>
        <div class="group">
          <label for="lfDdSuministro">Suministro</label>
          <select id="lfDdSuministro" class="input">${opciones}</select>
        </div>
        <div class="lf-dd-actions">
          <button id="lfDdElegir" class="btn primary" type="button"><span>Importar este suministro</span></button>
          <button id="lfDdCancelar" class="btn" type="button"><span>Cancelar</span></button>
        </div>
      `, '#lfDdSuministro');
      content.querySelector('#lfDdElegir').addEventListener('click', () => {
        const cups = content.querySelector('#lfDdSuministro').value;
        responder(lista.find((s) => s.cups === cups) || null);
      });
      content.querySelector('#lfDdCancelar').addEventListener('click', cerrar);
    }

    function vistaConfirmar(texto, textoSi, responder) {
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">☀️ Antes de importar</h3>
        <div id="lfDdConfirmar" class="lf-dd-box lf-dd-warn" role="alert" tabindex="-1">${esc(texto)}</div>
        <div class="lf-dd-actions">
          <button id="lfDdSi" class="btn primary" type="button"><span>${esc(textoSi)}</span></button>
          <button id="lfDdCancelar" class="btn" type="button"><span>Cancelar</span></button>
        </div>
      `, '#lfDdConfirmar');
      content.querySelector('#lfDdSi').addEventListener('click', () => responder(true));
      content.querySelector('#lfDdCancelar').addEventListener('click', cerrar);
    }

    // Simulador solar: el fichero generado entra por el MISMO camino que un CSV elegido a mano
    // (bv-ui.js handleFile: importFile, tabla mensual, traza horaria y avisos).
    async function finalizarSolar(r) {
      const fmt = (n) => String(n).replace('.', ',');
      const avisos = (r.avisos || []).slice();
      if (r.potencias) avisos.push(`Potencia de tu contrato aplicada: P1 ${fmt(r.potencias.p1)} kW · P2 ${fmt(r.potencias.p2)} kW.`);
      const ok = await window.BVSim.importarFichero(r.fichero, { avisos });
      if (!ok || !r.potencias) return;
      [['bv-p1', r.potencias.p1], ['bv-p2', r.potencias.p2]].forEach(([id, kw]) => {
        const campo = document.getElementById(id);
        if (!campo) return;
        campo.value = fmt(kw);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    document.body.appendChild(overlay);
    const shared = window.LF && window.LF.modalScrollLock;
    if (shared && typeof shared.lock === 'function') tokenBloqueo = shared.lock('datadis');
    document.addEventListener('keydown', alTeclear);
    // Un toque fuera del modal no cancela una importacion en marcha (en movil es facil hacerlo
    // sin querer); para eso estan Cancelar, la X y Escape.
    overlay.addEventListener('click', (e) => { if (e.target === overlay && !ocupado) cerrar(); });

    vistaFormulario(fallosIniciales >= MAX_FALLOS_LOGIN ? textoError({ code: 'credenciales' }) : '');
  }

  /**
   * Coloca el boton donde toque: en el simulador solar, junto a "Seleccionar archivo CSV" (si
   * bv-ui.js ha publicado BVSim.importarFichero); en la home, junto a "Importar CSV" (si
   * lf-csv-import.js ha publicado procesarCSVConsumos y mostrarPreviewCSV).
   */
  function initDatadisImport() {
    if (!DATADIS_IMPORT_ENABLED) return;
    try {
      // Id distinto en cada pagina: el de la home lleva reglas propias de la barra de botones en
      // movil (pro.css) que no deben alcanzar al boton del simulador solar.
      if (document.getElementById('btnImportarDatadis') || document.getElementById('bvImportarDatadis')) return;

      const subirSolar = document.getElementById('upload-csv-btn');
      if (subirSolar) {
        if (!window.BVSim || typeof window.BVSim.importarFichero !== 'function') return;
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'btn lf-dd-solar-btn';
        boton.id = 'bvImportarDatadis';
        boton.innerHTML = '<span>📥 Importar desde Datadis</span>';
        boton.title = 'Importa hasta 12 meses completos de consumo y excedentes desde tu cuenta de Datadis';
        boton.addEventListener('click', () => abrirModal('solar'));
        subirSolar.after(boton);
        return;
      }

      if (typeof window.LF.procesarCSVConsumos !== 'function' || typeof window.LF.mostrarPreviewCSV !== 'function') return;
      const contenedor = document.querySelector('.actions-center');
      if (!contenedor) return;

      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'btn';
      boton.id = 'btnImportarDatadis';
      boton.innerHTML = '<span>📥</span><span class="btn-text"><em class="lf-dd-solo-desktop">Importar de </em>Datadis</span>';
      boton.title = 'Importa hasta un año de consumo horario directamente desde tu cuenta de Datadis';
      boton.addEventListener('click', () => abrirModal('home'));

      const csv = document.getElementById('btnSubirCSV');
      if (csv) csv.after(boton);
      else contenedor.appendChild(boton);
    } catch { /* la funcion es opcional: si algo falla, queda el importador de CSV */ }
  }

  Object.assign(window.LF, { initDatadisImport });
  window.LF.datadis = {
    rangoUltimosDias,
    rangoMesesCompletos,
    rangoPersonalizado,
    etiquetaMes,
    construirCsv,
    horasEsperadasMes,
    inicioMasAntiguo,
    contratoVigente,
    evaluarCobertura,
    evaluarExcedentes,
    leerAutoconsumo,
    decidirSolar,
    leerPotencias,
    normalizarSuministros,
    cupsEnmascarado,
    normalizarDocumento,
    errorDocumento,
    textoError,
    importar,
    DatadisError
  };

  // En la home lo inicia lf-app.js (tras el importador CSV, para colocar el boton a su lado). En el
  // simulador solar no hay coordinador: este script va detras de bv-ui.js, cuyo DOMContentLoaded
  // (que publica BVSim.importarFichero) se registra antes y por tanto corre antes que este.
  function iniciarSiSolar() {
    if (document.getElementById('upload-csv-btn')) initDatadisImport();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarSiSolar);
  else iniciarSiSolar();
})();
