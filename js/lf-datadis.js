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
  // Meses de margen que se piden de mas (misma consulta) por si los ultimos no tienen aun los
  // excedentes publicados. Medido en real: el mes en curso llega sin publicar; dos de margen cubren
  // los primeros dias de mes, cuando el anterior tampoco lo esta.
  const MESES_MARGEN = 2;
  const MAX_FALLOS_LOGIN = 2;
  const FALLOS_KEY = 'lf_datadis_fallos';
  const FALLOS_TTL_MS = 24 * 60 * 60 * 1000;
  const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

  const T_LOGIN = 30000;
  const T_SUMINISTROS = 180000;
  const T_CONTRATO = 60000;
  const T_CONSUMO = 300000;
  const T_CONSUMO_MES = 120000;
  // Tope de TODO el reintento mes a mes (hasta 15 meses en serie): sin el, en el peor caso la
  // espera llegaba a ~28 min. Al agotarse se sigue con los meses ya recibidos (los mas
  // recientes) y la cobertura decide; si no llego ninguno, error de tiempo agotado.
  const T_MES_A_MES_TOTAL = 360000;

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
    // Solo 'HH:MM' o 'HH:MM:SS' en punto: cualquier otra cosa ('99:00' da 99 con parseInt, 'abc'
    // da NaN) es una hora no valida y no debe contar para la cobertura ni entrar en el CSV.
    const m = /^(\d{1,2}):00(?::00)?$/.exec(String(f && f.time).trim());
    return m ? Number(m[1]) : NaN;
  }

  /**
   * Fila util: fecha valida y hora distinta de 00:00. Algunas distribuidoras anaden una fila
   * "00:00" (vacia) en dias que ya traen sus 24 horas, sobre todo el primer dia de alta del
   * contador; contarla convertiria ese dia en uno de 25 h y desplazaria todas sus horas.
   */
  function filaUtil(f) {
    if (!f || typeof f.date !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(f.date)) return false;
    const h = horaEtiqueta(f);
    // 25 solo el dia del cambio de hora de octubre (hay distribuidoras que numeran ese dia 1..25).
    return Number.isInteger(h) && h >= 1 && (h <= 24 || (h === 25 && esDiaCambioOtono(f.date)));
  }

  /** El dia del cambio de hora de octubre (ultimo domingo): el unico con una hora repetida. */
  function esDiaCambioOtono(ymd) {
    const [y, m, d] = ymd.split('/').map(Number);
    if (m !== 10) return false;
    const dias = new Date(y, 10, 0).getDate();
    return d === dias - new Date(y, 9, dias).getDay();
  }

  /**
   * Quita horas repetidas: solo el dia del cambio de hora de octubre puede traer UNA etiqueta
   * repetida (la hora que se vive dos veces). En otro dia, una repetida hacia que el dia sumara
   * horas de mas (la cobertura no veria el hueco) o, con 25 filas, que se numerara como el del
   * cambio de hora y se desplazaran todas sus horas. Se queda la primera aparicion.
   */
  function quitarHorasRepetidas(filas) {
    const vistas = new Map();
    const repetidaPorDia = new Map();
    let descartadas = 0;
    const salida = [];
    for (const f of filas) {
      if (!filaUtil(f)) { salida.push(f); continue; }
      const clave = `${f.date}|${horaEtiqueta(f)}`;
      if (vistas.has(clave)) {
        // La hora que se vive dos veces: 02:00-03:00 en la peninsula (etiqueta 03) y 01:00-02:00
        // en Canarias (etiqueta 02). Cualquier otra repetida ese dia tambien sobra.
        if (esDiaCambioOtono(f.date) && !repetidaPorDia.has(f.date) && [2, 3].includes(horaEtiqueta(f))) {
          repetidaPorDia.set(f.date, true);
          salida.push(f);
        } else {
          descartadas++;
        }
        continue;
      }
      vistas.set(clave, true);
      salida.push(f);
    }
    return { filas: salida, descartadas };
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
   * Excedentes que la distribuidora AUN NO HA PUBLICADO. Medido con datos reales (e-distribucion,
   * autoconsumo colectivo, 30/10/2026): en los meses ya publicados generacion = autoconsumo +
   * excedentes cuadra al 0,0, y en el mes en curso llegan generacion y autoconsumo en null pero el
   * excedente en 0. Ese 0 no es un dato: si el suministro informa de generacion o autoconsumo en
   * otras horas, una hora con excedente 0 y ambos campos vacios se trata como SIN DATO (null).
   * En suministros que nunca informan de generacion no se toca nada.
   */
  function marcarExcedentesSinPublicar(filas) {
    const lista = Array.isArray(filas) ? filas : [];
    const informaGeneracion = lista.some((f) => f && (Number.isFinite(numero(f.generationEnergyKWh)) || Number.isFinite(numero(f.selfConsumptionEnergyKWh))));
    if (!informaGeneracion) return lista;
    return lista.map((f) => (f && numero(f.surplusEnergyKWh) === 0
      && !Number.isFinite(numero(f.generationEnergyKWh)) && !Number.isFinite(numero(f.selfConsumptionEnergyKWh))
      ? Object.assign({}, f, { surplusEnergyKWh: null })
      : f));
  }

  /**
   * "Ultimos 12 meses" de la home con los ultimos dias sin excedentes publicados (ya marcados en
   * null): devuelve los 365 dias que terminan en el ultimo dia publicado, o null si no hace falta
   * (sin excedentes, nada pendiente) o no se puede (no hay consumos tan antiguos).
   */
  function anoHastaUltimoPublicado(filas, rango, rangoPedido) {
    let ultimoPublicado = '';
    let ultimoConsumo = '';
    let primerConsumo = '';
    let hayPositivos = false;
    for (const f of filas) {
      if (!filaUtil(f) || f.date < rangoPedido.iniYmd || f.date > rango.finYmd) continue;
      const exc = numero(f.surplusEnergyKWh);
      if (Number.isFinite(exc)) {
        if (f.date > ultimoPublicado) ultimoPublicado = f.date;
        if (exc > 0) hayPositivos = true;
      }
      if (tieneConsumo(f)) {
        if (f.date > ultimoConsumo) ultimoConsumo = f.date;
        if (!primerConsumo || f.date < primerConsumo) primerConsumo = f.date;
      }
    }
    if (!hayPositivos || !ultimoPublicado || ultimoConsumo <= ultimoPublicado) return null;
    const [y, m, d] = ultimoPublicado.split('/').map(Number);
    const fin = new Date(y, m - 1, d);
    const ini = new Date(y, m - 1, d - (DIAS_HISTORICO - 1));
    const iniYmd = fmtYmd(ini);
    if (iniYmd < rangoPedido.iniYmd || primerConsumo > iniYmd) return null;
    return { iniYmd, finYmd: fmtYmd(fin), iniMes: fmtYm(ini), finMes: fmtYm(fin) };
  }

  /** Rango de un mes completo ('2026/09'). */
  function rangoDeMes(mes) {
    const [y, m] = mes.split('/').map(Number);
    return { iniYmd: `${mes}/01`, finYmd: fmtYmd(new Date(y, m, 0)), iniMes: mes, finMes: mes };
  }

  /** El mismo rango empezando un mes antes. */
  /**
   * Error de la distribuidora del suministro en la respuesta v2 (`distributorError`). La lista
   * puede traer errores de OTRAS distribuidoras de la cuenta aunque los datos lleguen bien: solo
   * cuenta el de la distribuidora consultada (o uno sin codigo). Texto de Datadis acotado; se
   * pinta escapado.
   */
  function errorDeDistribuidora(respuesta, distributorCode) {
    const lista = respuesta && Array.isArray(respuesta.distributorError) ? respuesta.distributorError : [];
    const e = lista.find((x) => x && (x.distributorCode == null || String(x.distributorCode) === String(distributorCode)));
    if (!e) return null;
    const corto = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 120);
    const err = new DatadisError('distribuidora');
    err.detalle = { nombre: corto(e.distributorName), descripcion: corto(e.errorDescription) };
    return err;
  }

  /** El mismo rango empezando `n` meses antes (1 por defecto). */
  function conMesAnterior(rango, n) {
    const [y, m] = rango.iniMes.split('/').map(Number);
    const ini = new Date(y, m - 1 - (Number.isFinite(n) ? n : 1), 1);
    return Object.assign({}, rango, { iniYmd: fmtYmd(ini), iniMes: fmtYm(ini) });
  }

  /** Los 12 meses naturales completos que terminan en `finMes` ('2026/08'). */
  function anoHastaMes(finMes) {
    const [y, m] = finMes.split('/').map(Number);
    const ini = new Date(y, m - 12, 1);
    const fin = new Date(y, m, 0);
    return { iniYmd: fmtYmd(ini), finYmd: fmtYmd(fin), iniMes: fmtYm(ini), finMes: fmtYm(fin) };
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

  /**
   * El contrato DECLARA que no hay autoconsumo: trae los campos de autoconsumo y todos vacios.
   * Datadis lo comunico asi al anadirlos (2023): "en caso de que no se tenga autoconsumo, estos
   * campos vendran con valor null"; visto en contratos reales de i-DE y e-distribucion. Si faltan
   * los campos (otra version, error de la distribuidora), no se deduce nada. Solo se usa para no
   * mostrar en la home el aviso "si tienes placas..."; el simulador solar sigue preguntando
   * (leerAutoconsumo exige ahi prueba positiva, por si alguna distribuidora no los rellena).
   */
  function contratoDeclaraSinAutoconsumo(respuestaContrato) {
    const c = contratoVigente(respuestaContrato);
    if (!c || !('selfConsumptionTypeCode' in c) || !('cau' in c)) return false;
    const vacio = (v) => v == null || String(v).trim() === '';
    const cap = c.installedCapacityKW != null ? c.installedCapacityKW : c.installedCapacity;
    return vacio(c.selfConsumptionTypeCode) && vacio(c.selfConsumptionTypeDesc) && vacio(c.cau)
      && (vacio(cap) || Number(cap) === 0);
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

  /** Fecha de baja del suministro ('2025/07/02') o '' si sigue activo o el formato no es el esperado. */
  function fechaBaja(suministro) {
    const v = suministro && typeof suministro.validDateTo === 'string' ? suministro.validDateTo.trim() : '';
    return /^\d{4}\/\d{2}\/\d{2}$/.test(v) ? v : '';
  }

  /** '2025/07/02' -> '02/07/2025'. */
  function fechaEs(ymd) {
    const [y, m, d] = ymd.split('/');
    return `${d}/${m}/${y}`;
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
      if (!/^[\w-]+\.[\w-]+\.[\w-]*$/.test(t)) {
        const err = new DatadisError('http', r.status);
        err.servidor = `login: respuesta correcta pero sin un token reconocible (${t.length} caracteres; no se incluye)`;
        throw err;
      }
      return t;
    }
    const m = mensajeServidor(r.text);
    if (/user blocked/i.test(m)) throw new DatadisError('bloqueado', r.status);
    if (r.status === 401 || r.status === 403 || /bad credentials/i.test(m)) throw new DatadisError('credenciales', r.status);
    const err = new DatadisError('http', r.status);
    err.servidor = `login: ${textoTecnicoLimpio(m || String(r.text || '').slice(0, 120))}`;
    throw err;
  }

  async function consultar(ruta, params, token, ms, senal) {
    const qs = new URLSearchParams(params).toString();
    const r = await peticion(BASE + ruta + (qs ? '?' + qs : ''), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    }, ms, senal);
    if (r.status === 401) throw new DatadisError('sesion', r.status);
    if (r.status === 429) throw new DatadisError('repeticion', r.status);
    const endpoint = ruta.split('/').pop();
    if (!r.ok) {
      // El aviso de consulta repetida puede venir como JSON { message } o como texto plano.
      const aviso = mensajeServidor(r.text) || String(r.text || '').slice(0, 300);
      if (/24 ?h|repet|repeat|identical|misma consulta|already/i.test(aviso)) {
        throw new DatadisError('repeticion', r.status);
      }
      const err = new DatadisError('http', r.status);
      err.servidor = `${endpoint}: ${textoTecnicoLimpio(aviso)}`;
      throw err;
    }
    // Una respuesta vacia (o el literal null) es "sin datos", no un error: asi, en consumos, se
    // pasa a pedir mes a mes como cuando el periodo llega vacio.
    const cuerpo = String(r.text || '').trim();
    if (!cuerpo || cuerpo === 'null') return [];
    try { return JSON.parse(cuerpo); } catch {
      const err = new DatadisError('http', r.status);
      err.servidor = `${endpoint}: respuesta que no es JSON (${cuerpo.length} caracteres): ${textoTecnicoLimpio(cuerpo.slice(0, 80))}`;
      throw err;
    }
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
    // Diagnostico SIN datos personales para el informe que el usuario puede enviar si falla
    // (ver construirInforme): nunca NIF, contrasena, token, CUPS, direccion ni kWh.
    const diag = o.diagnostico || {};
    diag.destino = solar ? 'solar' : 'home';
    diag.tiempos = [];
    const progreso = (paso) => {
      const ahora = Date.now();
      if (diag.paso && diag.inicioPaso) diag.tiempos.push(`${diag.paso} ${segundos(ahora - diag.inicioPaso)}`);
      diag.paso = paso;
      diag.inicioPaso = ahora;
      o.onProgreso(paso);
    };
    let rango = solar ? rangoMesesCompletos(new Date()) : (o.rango || rangoUltimosDias(new Date()));
    // El simulador solar y los "ultimos 12 meses" de la home piden MESES_MARGEN meses mas al
    // principio (en la misma consulta): si los ultimos dias aun no tienen los excedentes publicados
    // (la distribuidora tarda semanas), se analiza el ano que termina en lo ultimo publicado. Un
    // periodo elegido a mano no se mueve.
    const rangoPedido = solar || !o.rango ? conMesAnterior(rango, MESES_MARGEN) : rango;
    diag.periodo = `${rangoPedido.iniMes} a ${rangoPedido.finMes} (${solar ? 'simulador solar' : (o.rango ? 'otro periodo' : 'últimos 12 meses')})`;
    const nif = normalizarDocumento(o.nif);
    const fallo = errorDocumento(nif);
    if (fallo) {
      const e = new DatadisError('documento');
      e.detalle = fallo;
      throw e;
    }

    progreso('login');
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

    progreso('suministros');
    // get-supplies (v1) a proposito: devuelve los suministros de TODAS las distribuidoras en una
    // llamada. La v2 exige distributorCode y obliga a pedir antes get-distributors-with-supplies-v2,
    // que en la prueba real del 29/10/2026 agoto 60 s sin responder.
    const crudos = await consultar('/api-private/api/get-supplies', {}, token, T_SUMINISTROS, o.senal);
    diag.suministrosForma = formaRespuesta(crudos, 'supplies');
    const suministros = normalizarSuministros(crudos);
    if (!suministros.length) throw new DatadisError('sinsuministros');
    const suministro = suministros.length === 1 ? suministros[0] : await o.elegirSuministro(suministros);
    if (!suministro) throw new DatadisError('cancelado');
    diag.distribuidora = {
      nombre: textoTecnicoLimpio(suministro.distributor).slice(0, 60),
      codigo: String(suministro.distributorCode),
      pointType: suministro.pointType == null ? '' : String(suministro.pointType),
      suministros: suministros.length,
      deBaja: Boolean(fechaBaja(suministro))
    };
    // Suministro dado de baja antes del periodo: no hay nada que pedir. Se corta aqui para no
    // gastar consultas (que Datadis no deja repetir en 24 h) en una respuesta vacia segura.
    const baja = fechaBaja(suministro);
    if (baja && baja < rango.iniYmd) {
      const err = new DatadisError('baja');
      err.detalle = { fecha: baja, solar };
      throw err;
    }

    // El contrato da la potencia (si se pide) y, en el simulador solar, si hay autoconsumo y de que
    // tipo: ahi se pide siempre. Si falla, se sigue: la potencia es un extra y la falta de dato
    // de autoconsumo se trata como "no se sabe" (nunca como "no hay placas").
    let contrato = null;
    if (o.conPotencia || solar) {
      progreso('contrato');
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
    diag.contrato = resumenContrato(contrato, Boolean(o.conPotencia || solar));

    if (o.senal && o.senal.aborted) throw new DatadisError('cancelado');
    progreso('consumos');
    const clave = [suministro.cups, suministro.distributorCode, rangoPedido.iniMes, rangoPedido.finMes].join('|');
    // En la cache van las filas o, mientras se descargan, la PROMESA: si el usuario cancela (la
    // descarga sigue, ver abajo) y reintenta antes de que acabe, espera a la misma descarga en vez
    // de lanzar otra consulta identica, que Datadis rechazaria durante 24 h.
    let descarga = cacheConsumos.get(clave);
    if (!descarga) {
      descarga = descargarConsumos();
      cacheConsumos.set(clave, descarga);
      descarga.then((f) => cacheConsumos.set(clave, f), () => cacheConsumos.delete(clave));
    }
    // La documentacion fija 'AAAA/MM/DD'; si alguna distribuidora mandase 'AAAA-MM-DD', sin esto
    // se descartarian TODAS las filas y el usuario veria "sin datos".
    const descargado = await descarga;
    const mesesSinPedir = descargado.sinPedir || [];
    let filas = descargado.filas.map((f) => (f && typeof f.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date)
      ? Object.assign({}, f, { date: f.date.replace(/-/g, '/') }) : f));

    async function descargarConsumos() {
      let filas;
      const sinPedir = [];
      const params = {
        cups: suministro.cups,
        distributorCode: String(suministro.distributorCode),
        startDate: rangoPedido.iniMes,
        endDate: rangoPedido.finMes,
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
        const recibidas = Array.isArray(r) ? r : (r && Array.isArray(r.timeCurve) ? r.timeCurve : []);
        // Vacia con un error de SU distribuidora en `distributorError`: el fallo es de la
        // distribuidora (no "no hay datos") y pedir mes a mes solo multiplicaria consultas fallidas.
        if (r && Array.isArray(r.distributorError) && r.distributorError.length) {
          diag.erroresDistribuidora = r.distributorError.slice(0, 4).map((x) => [x && x.distributorCode, x && x.distributorName, x && x.errorCode, x && x.errorDescription]
            .map((v) => textoTecnicoLimpio(v).slice(0, 80)).join(' · '));
        }
        if (!recibidas.length) {
          const err = errorDeDistribuidora(r, params.distributorCode);
          if (err) { diag.respuesta = resumenFilas(recibidas); throw err; }
        }
        return recibidas;
      };
      let errorPeriodo = null;
      try {
        filas = await pedir(rangoPedido.iniMes, rangoPedido.finMes, T_CONSUMO);
      } catch (e) {
        if (e && e.code === 'http') e.paso = 'consumos';
        // Sesion caducada, red caida, tiempo agotado o consulta repetida: pedir mes a mes no lo arregla.
        if (!e || e.code !== 'http') throw e;
        errorPeriodo = e;
        diag.periodoError = `HTTP ${e.status}${e.servidor ? ` (${e.servidor})` : ''}`;
        filas = [];
      }
      // Algunas distribuidoras rechazan (error 500) o devuelven vacia cualquier consulta que
      // incluya el primer mes de un contrato, y se perderia el periodo entero. Mes a mes, del mas
      // reciente al mas antiguo, un mes roto solo se pierde a si mismo; la cobertura lo detecta.
      if (!filas.length && rangoPedido.iniMes !== rangoPedido.finMes) {
        progreso('consumos-mes');
        const trozos = [];
        diag.mesAMes = [];
        const limite = Date.now() + T_MES_A_MES_TOTAL;
        let agotado = false;
        for (const mes of mesesDelRango(rangoPedido).reverse()) {
          const queda = limite - Date.now();
          if (queda < 5000) {
            agotado = true;
            sinPedir.push(mes);
            diag.mesAMes.push(`${mes} sin pedir (tiempo total agotado)`);
            continue;
          }
          try {
            const trozo = await pedir(mes, mes, Math.min(T_CONSUMO_MES, queda));
            diag.mesAMes.push(`${mes} ${trozo.length ? `${trozo.length} filas` : 'vacío'}`);
            trozos.unshift(trozo);
          } catch (e) {
            diag.mesAMes.push(`${mes} ${(e && e.code) || 'error'}${e && e.status ? ` ${e.status}` : ''}`);
            if (e && (e.code === 'sesion' || e.code === 'red')) throw e;
            // Tiempo agotado o consulta repetida: el mes existe pero no se ha podido descargar, igual
            // que uno sin pedir. Un 500 o un mes vacio se dejan fuera sin mas: es justo el caso del
            // primer mes de un contrato que algunas distribuidoras rechazan (de antes del alta).
            if (e && (e.code === 'timeout' || e.code === 'repeticion')) sinPedir.push(mes);
          }
        }
        filas = trozos.flat();
        if (!filas.length && agotado) throw new DatadisError('timeout');
        if (!filas.length && errorPeriodo) throw errorPeriodo;
      }
      // Los meses que NO se llegaron a pedir viajan aparte: un hueco por tiempo agotado no es lo
      // mismo que un suministro sin historial (la cobertura omitiria esos meses como "de antes
      // del alta" y el simulador daria un ano mas corto con una explicacion falsa).
      return { filas, sinPedir: sinPedir.sort() };
    }
    if (o.senal && o.senal.aborted) throw new DatadisError('cancelado');
    const recibidas = filas.length;
    const sinRepetidas = quitarHorasRepetidas(filas);
    filas = sinRepetidas.filas;
    // El resumen del informe, con lo que de verdad se procesa (ya sin repetidas).
    diag.respuesta = resumenFilas(filas);
    diag.respuesta.recibidas = recibidas;
    diag.respuesta.repetidas = sinRepetidas.descartadas;
    filas = marcarExcedentesSinPublicar(filas);

    if (solar) {
      // 0) Ultimos meses cerrados (hasta MESES_MARGEN) sin excedentes publicados mientras los
      //    anteriores si los tienen: se simulan los 12 meses que terminan en el ultimo publicado,
      //    en vez de bloquear o importar ceros.
      let rangoSolar = rango;
      let mesesSinPublicar = [];
      let finSolar = rango.finMes;
      for (let k = 0; k < MESES_MARGEN; k++) {
        const ev = evaluarExcedentes(filas, rangoDeMes(finSolar));
        if (!ev.meses.length || ev.estado !== 'ausente') break;
        mesesSinPublicar.unshift(finSolar);
        finSolar = fmtYm(new Date(Number(finSolar.slice(0, 4)), Number(finSolar.slice(5, 7)) - 2, 1)); // mes anterior
      }
      if (mesesSinPublicar.length) {
        const candidato = anoHastaMes(finSolar);
        if (evaluarExcedentes(filas, candidato).hayPositivos) rangoSolar = candidato;
        else mesesSinPublicar = [];
      }
      // 0b) Meses del ano a simular que no se llegaron a pedir por tiempo agotado: no se simula un
      //     ano incompleto por un retraso de Datadis ni se presenta como suministro reciente.
      const sinPedirSolar = mesesSinPedir.filter((m) => m >= rangoSolar.iniMes && m <= rangoSolar.finMes);
      if (sinPedirSolar.length) {
        const err = new DatadisError('solar');
        err.detalle = `No hemos podido descargar ${listaMeses(sinPedirSolar)}: Datadis ha tardado demasiado en responder o no deja repetir hoy esa consulta. ` +
          'No simulamos un año incompleto por un retraso de Datadis. Prueba mañana (Datadis no deja repetir hoy las mismas consultas) o descarga el CSV desde Datadis y usa «Seleccionar archivo CSV».';
        throw err;
      }
      // 1) Consumo: contra las horas que DEBERIAN llegar, no contra las que llegan.
      const cob = evaluarCobertura(filas, rangoSolar);
      if (!cob.usados.length) throw new DatadisError('sindatos');
      if (cob.fallos.length) {
        const err = new DatadisError('solar');
        err.detalle = textoCoberturaSolar(cob);
        throw err;
      }
      const rangoUsado = cob.omitidos.length
        ? Object.assign({}, rangoSolar, { iniYmd: `${cob.usados[0]}/01`, iniMes: cob.usados[0] })
        : rangoSolar;
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
        avisos: avisosSolar(decision, evSolar, rangoUsado, cob, mesesSinPublicar),
        potencias
      };
    }

    let excedentesHasta = '';
    if (!o.rango) {
      const desplazado = anoHastaUltimoPublicado(filas, rango, rangoPedido);
      if (desplazado) { rango = desplazado; excedentesHasta = desplazado.finYmd; }
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
    // Sin excedentes: si el contrato (cuando se ha pedido) dice que no hay autoconsumo o que es
    // sin excedentes, no hay nada que avisar; si dice que vierte, el aviso lo dice claro.
    const autoconsumo = contrato ? leerAutoconsumo(contrato) : null;
    const remedio = 'descarga el CSV desde Datadis o desde tu distribuidora o, si sabes cuántos kWh vertiste en este mismo periodo (sumando tus facturas), introdúcelos a mano después de aplicar, activando «Tengo placas solares» en las opciones avanzadas.';
    resultado.warnings = (resultado.warnings || []).map((w) => {
      if (typeof w !== 'string') return w;
      if (/^No se detectaron excedentes/.test(w)) {
        if (autoconsumo === 'no' || autoconsumo === 'sin' || contratoDeclaraSinAutoconsumo(contrato)) return null;
        if (autoconsumo === 'con') {
          // Caso real (30/10/2026): un periodo elegido dentro del mes en curso llega con el
          // excedente a 0 y la produccion vacia porque la distribuidora aun no lo ha publicado.
          const reciente = o.rango
            ? ' Si el periodo es reciente, lo más probable es que aún no estén publicados (suele tardar unas semanas): elige meses anteriores o usa «Últimos 12 meses», que termina en el último día publicado. Si no,'
            : ' Puede que tu distribuidora aún no los haya publicado o no los publique en Datadis:';
          return `Tu contrato tiene autoconsumo con excedentes, pero Datadis no ha enviado ningún excedente de este periodo, así que se importa solo el consumo y el cálculo no incluye lo que vertiste.${reciente} ${remedio}`;
        }
        return `Datadis no ha enviado excedentes, así que se importa solo el consumo. Si tienes placas, puede que tu distribuidora no los esté publicando en Datadis: ${remedio}`;
      }
      return w.replace(/^✓ CSV procesado:/, '✓ Datos de Datadis procesados:')
        .replace(/^⚠️ CSV antiguo:/, '⚠️ Datos antiguos:')
        .replace('revisa que estás importando el archivo correcto.', 'comprueba que el periodo elegido es el que querías.');
    }).filter((w) => w !== null);
    if (excedentesHasta) {
      resultado.warnings.push(`Tu distribuidora aún no ha publicado en Datadis los excedentes posteriores al ${fechaEs(excedentesHasta)}: para no contarlos como 0 kWh, se analizan los 365 días que terminan ese día.`);
    }
    // Datos que empiezan o acaban lejos de lo pedido (p. ej. el ultimo mes dio un 500 en el
    // reintento y los anteriores llegaron bien): la deteccion de huecos del importador solo mira
    // DENTRO de lo recibido, asi que se dice aqui. 7 dias de margen: hay distribuidoras que
    // publican con unos dias de retraso y eso no merece aviso.
    const conConsumo = filas.filter((f) => tieneConsumo(f) && f.date >= rango.iniYmd && f.date <= rango.finYmd).map((f) => f.date).sort();
    const sinPedirHome = mesesSinPedir.filter((m) => m >= rango.iniMes && m <= rango.finMes);
    if (conConsumo.length && !sinPedirHome.length) {
      const dias = (a, b) => Math.round((new Date(b.replace(/\//g, '-')) - new Date(a.replace(/\//g, '-'))) / 86400000);
      const primero = conConsumo[0];
      const ultimo = conConsumo[conConsumo.length - 1];
      if (dias(rango.iniYmd, primero) > 7 || dias(ultimo, rango.finYmd) > 7) {
        resultado.warnings.push(`Datadis solo ha devuelto consumos del ${fechaEs(primero)} al ${fechaEs(ultimo)}, y pediste del ${fechaEs(rango.iniYmd)} al ${fechaEs(rango.finYmd)}. ` +
          'Puede ser un suministro reciente, un retraso de tu distribuidora o un mes que Datadis no ha podido servir: el análisis usa solo los días recibidos.');
      }
    }
    if (sinPedirHome.length) {
      resultado.warnings.push(`No hemos podido descargar ${listaMeses(sinPedirHome)} (Datadis ha tardado demasiado en responder o no deja repetir hoy esa consulta): esos días faltan en el análisis, no es que no tengas consumo. Si necesitas el periodo completo, prueba mañana o usa el CSV descargado desde Datadis.`);
    }
    // Hay excedentes, pero no de todos los meses: en la home cuentan como 0 (estimacion rapida),
    // asi que se dice expresamente cuales faltan.
    if (ev.hayPositivos && ev.mesesSinDato.length) {
      resultado.warnings.push(`Datadis todavía no ha publicado (o no ha enviado) los excedentes de ${listaMeses(ev.mesesSinDato)}: aquí cuentan como 0 kWh vertidos. Las distribuidoras suelen publicarlos unas semanas después del consumo; para no infravalorarlos, elige «Otro periodo» terminando antes de ese mes.`);
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

  // ===== Informe de fallo (lo envia el usuario por su correo, si quiere) =====

  const INFORME_EMAIL = 'hola@luzfija.es';
  // Outlook y otros clientes truncan o rechazan mailto de mas de ~2.000 caracteres (mismo
  // presupuesto que el aviso de CSV fallido): el cuerpo se recorta y "Copiar" lo da entero.
  const INFORME_MAILTO_MAX = 1900;
  // Errores en los que el informe puede descubrir una rareza de la distribuidora o un fallo
  // nuestro. Los de contrasena, bloqueo, red, sesion o periodo no aportan nada.
  const CODIGOS_INFORME = new Set(['http', 'parseo', 'sindatos', 'solar', 'distribuidora', 'timeout', 'sinsuministros', 'otro']);

  function codigoInforme(err) {
    const code = err && err.code;
    return CODIGOS_INFORME.has(code) ? code : (err instanceof DatadisError ? null : 'otro');
  }

  /**
   * Texto tecnico (mensajes de Datadis, excepciones) sin nada que parezca un dato personal:
   * CUPS, NIF/NIE/CIF, emails, telefonos, tokens largos. Acotado.
   */
  function textoTecnicoLimpio(v) {
    return String(v == null ? '' : v)
      .replace(/ES\d{4}[A-Z0-9]{12}[A-Z0-9]{0,4}/gi, '[CUPS]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/\b[XYZ]?\d{7,8}[A-Z]\b/gi, '[documento]')
      .replace(/\b[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]\b/gi, '[documento]')
      .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '[token]')
      .replace(/\+?\d[\d\s]{8,}\d/g, '[número]')
      .replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function segundos(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')} s`;
  }

  /** Familia y version principal del navegador, sin mas (ej. "Chrome 156 · móvil"). */
  function navegadorBasico(ua) {
    const u = String(ua || '');
    const v = (re) => { const m = re.exec(u); return m ? m[1] : '?'; };
    let nombre = 'otro';
    if (/Edg\//.test(u)) nombre = `Edge ${v(/Edg\/(\d+)/)}`;
    else if (/OPR\//.test(u)) nombre = `Opera ${v(/OPR\/(\d+)/)}`;
    else if (/SamsungBrowser\//.test(u)) nombre = `Samsung Internet ${v(/SamsungBrowser\/(\d+)/)}`;
    else if (/Firefox\/|FxiOS\//.test(u)) nombre = `Firefox ${v(/(?:Firefox|FxiOS)\/(\d+)/)}`;
    else if (/CriOS\//.test(u)) nombre = `Chrome iOS ${v(/CriOS\/(\d+)/)}`;
    else if (/Chrome\//.test(u)) nombre = `Chrome ${v(/Chrome\/(\d+)/)}`;
    else if (/Safari\//.test(u)) nombre = `Safari ${v(/Version\/(\d+)/)}`;
    return `${nombre}${/Mobi|Android|iPhone|iPad/.test(u) ? ' · móvil' : ''}`;
  }

  /** Forma de una respuesta (sin valores): tipo, longitud y nombres de campos. */
  function formaRespuesta(r, clave) {
    if (Array.isArray(r)) {
      const primero = r.find((x) => x && typeof x === 'object');
      return `lista de ${r.length}${primero ? ` · campos ${Object.keys(primero).slice(0, 14).join(',')}` : ''}`;
    }
    if (r && typeof r === 'object') {
      const lista = Array.isArray(r[clave]) ? r[clave] : null;
      return `objeto {${Object.keys(r).slice(0, 8).join(',')}}${lista ? ` · ${clave}: ${formaRespuesta(lista)}` : ''}`;
    }
    return typeof r;
  }

  /** Contrato sin datos personales: tipo de autoconsumo y si trae los campos. */
  function resumenContrato(respuesta, pedido) {
    if (!pedido) return 'no pedido';
    const c = contratoVigente(respuesta);
    if (!c) return 'sin contrato en la respuesta';
    const n = respuesta && Array.isArray(respuesta.contract) ? respuesta.contract.length : 1;
    const campos = 'selfConsumptionTypeCode' in c ? 'presentes' : 'ausentes';
    const codigo = c.selfConsumptionTypeCode == null ? '-' : textoTecnicoLimpio(c.selfConsumptionTypeCode).slice(0, 8);
    const desc = c.selfConsumptionTypeDesc ? ` «${textoTecnicoLimpio(c.selfConsumptionTypeDesc).slice(0, 70)}»` : '';
    return `autoconsumo ${codigo}${desc} · campos ${campos} · contratos ${n} · tarifa ${textoTecnicoLimpio(c.codeFare || '-').slice(0, 8)}`;
  }

  /** Que llego de Datadis, por mes y sin valores de energia. */
  function resumenFilas(filas) {
    const lista = Array.isArray(filas) ? filas : [];
    const meses = new Map();
    const metodos = new Set();
    const campos = new Set();
    const tiposConsumo = {};
    const horasRaras = new Set();
    const fechasEjemplo = new Set();
    let ceros = 0;
    let fechasRaras = 0;
    let horasNoValidas = 0;
    for (const f of lista) {
      if (f && typeof f === 'object') Object.keys(f).forEach((k) => { if (campos.size < 16) campos.add(textoTecnicoLimpio(k).slice(0, 30)); });
      if (f && !Number.isFinite(horaEtiqueta(f)) && horasRaras.size < 3) horasRaras.add(textoTecnicoLimpio(f.time).slice(0, 12) || String(f.time));
      if (f) {
        const v = f.consumptionKWh;
        const t = v === null ? 'null' : (v === '' ? 'vacío' : typeof v);
        tiposConsumo[t] = (tiposConsumo[t] || 0) + 1;
      }
      if (!f || typeof f.date !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(f.date)) {
        fechasRaras++;
        if (fechasEjemplo.size < 3) fechasEjemplo.add(textoTecnicoLimpio(f && f.date).slice(0, 20) || String(f && f.date));
        continue;
      }
      if (horaEtiqueta(f) === 0) { ceros++; continue; }
      if (!filaUtil(f)) { horasNoValidas++; continue; }
      metodos.add(typeof f.obtainMethod === 'string' ? (textoTecnicoLimpio(f.obtainMethod) || '(vacío)').slice(0, 16) : '(sin campo)');
      const k = f.date.slice(0, 7);
      const m = meses.get(k) || { horas: 0, consumo: 0, excNum: 0, excPos: 0, excNull: 0, gen: 0 };
      m.horas++;
      if (Number.isFinite(numero(f.consumptionKWh))) m.consumo++;
      const exc = numero(f.surplusEnergyKWh);
      if (Number.isFinite(exc)) { m.excNum++; if (exc > 0) m.excPos++; } else m.excNull++;
      if (Number.isFinite(numero(f.generationEnergyKWh)) || Number.isFinite(numero(f.selfConsumptionEnergyKWh))) m.gen++;
      meses.set(k, m);
    }
    const claves = [...meses.keys()].sort();
    return {
      filas: lista.length,
      desde: claves[0] || '',
      hasta: claves[claves.length - 1] || '',
      ceros,
      fechasRaras,
      horasNoValidas,
      fechasEjemplo: [...fechasEjemplo],
      horasRaras: [...horasRaras],
      campos: [...campos],
      tiposConsumo: Object.entries(tiposConsumo).map(([k, n]) => `${k} ${n}`).join(', '),
      metodos: [...metodos].slice(0, 6),
      meses: claves.map((k) => {
        const m = meses.get(k);
        return `${k} ${m.consumo}/${horasEsperadasMes(k, rangoDeMes(k))}h · exc ${m.excNum}/${m.excNull}/${m.excPos} · gen ${m.gen ? 'sí' : 'no'}`;
      })
    };
  }

  /** Texto del informe: el usuario lo ve y lo edita antes de enviarlo. */
  function construirInforme(diag, err, mensaje) {
    const d = diag || {};
    const r = d.respuesta;
    const dist = d.distribuidora;
    const build = typeof window !== 'undefined' && typeof window.__LF_BUILD_ID === 'string' ? window.__LF_BUILD_ID : '?';
    const ahora = new Date();
    const lineas = [
      `Herramienta: ${d.destino === 'solar' ? 'Comparador de tarifas solares' : 'Comparador principal'} · importación desde Datadis`,
      `Versión: ${build} · ${fmtYmd(ahora)} ${pad2(ahora.getHours())}:${pad2(ahora.getMinutes())}`,
      `Error: ${codigoInforme(err) || (err && err.code) || 'otro'}${err && err.status ? ` (HTTP ${err.status})` : ''} · paso: ${(err && err.paso) || d.paso || '?'}` +
        `${d.inicioPaso ? ` (tras ${segundos(ahora.getTime() - d.inicioPaso)})` : ''}`,
      ...(err && err.servidor ? [`Respuesta de Datadis: ${err.servidor}`] : []),
      ...(err && !(err instanceof DatadisError) ? [`Excepción: ${textoTecnicoLimpio(`${err.name || 'Error'}: ${err.message || ''}`)}${lugarExcepcion(err)}`] : []),
      `Mensaje: ${textoTecnicoLimpio(mensaje)}`,
      `Navegador: ${navegadorBasico(typeof navigator !== 'undefined' ? navigator.userAgent : '')}`,
      ...(d.tiempos && d.tiempos.length ? [`Tiempos: ${d.tiempos.join(' · ')}`] : []),
      `Periodo pedido: ${d.periodo || '?'}`,
      dist ? `Distribuidora: ${dist.nombre || '?'} (código ${dist.codigo}) · tipo de punto ${dist.pointType || '?'} · suministros en la cuenta: ${dist.suministros}${dist.deBaja ? ' · elegido de baja' : ''}` : 'Distribuidora: (no se llegó a elegir suministro)',
      `Contrato: ${d.contrato || '(no se llegó a pedir)'}`
    ];
    if (d.suministrosForma && (!dist || (err && err.code === 'sinsuministros'))) lineas.push(`Respuesta de suministros: ${d.suministrosForma}`);
    if (d.erroresDistribuidora && d.erroresDistribuidora.length) lineas.push(`Errores de distribuidora: ${d.erroresDistribuidora.join(' | ')}`);
    if (d.periodoError) lineas.push(`Consulta del periodo: ${d.periodoError}`);
    if (d.mesAMes && d.mesAMes.length) lineas.push(`Mes a mes: ${d.mesAMes.join(' · ')}`);
    if (r) {
      lineas.push(`Respuesta: ${r.recibidas != null && r.recibidas !== r.filas ? `${r.recibidas} filas recibidas, ${r.filas} procesadas` : `${r.filas} filas`} · ${r.desde || '-'} a ${r.hasta || '-'} · horas 00:00: ${r.ceros} · fechas no reconocidas: ${r.fechasRaras}` +
        `${r.fechasEjemplo.length ? ` (${r.fechasEjemplo.join(' | ')})` : ''} · métodos: ${r.metodos.join(', ') || '-'}`);
      lineas.push(`Forma: campos ${r.campos.join(',') || '-'} · consumo ${r.tiposConsumo || '-'}${r.horasRaras.length ? ` · horas con otro formato: ${r.horasRaras.join(' | ')}` : ''}` +
        ` · horas no válidas: ${r.horasNoValidas} · repetidas descartadas: ${r.repetidas || 0}`);
      if (r.meses.length) {
        lineas.push('Por mes (horas con consumo/esperadas · excedentes con valor/nulos/positivos · generación):');
        lineas.push(...r.meses);
      }
    } else {
      lineas.push('Respuesta de consumos: (no se llegó a recibir)');
    }
    return lineas.join('\n');
  }

  /** Fichero y linea de la excepcion dentro de nuestros scripts (sin URL completa ni datos). */
  function lugarExcepcion(err) {
    const m = /\/(lf-[\w-]+\.js|bv\/[\w-]+\.js)[^:\s]*:(\d+):(\d+)/.exec(String(err && err.stack || ''));
    return m ? ` · en ${m[1]}:${m[2]}:${m[3]}` : '';
  }

  function mailtoInforme(texto, maxChars) {
    const limite = Number.isFinite(maxChars) ? maxChars : INFORME_MAILTO_MAX;
    const asunto = 'Fallo al importar desde Datadis en LuzFija';
    const cabeza = 'Hola:\n\nLa importación desde Datadis me ha fallado. Este es el informe que genera la web (sin mis datos personales):\n';
    const build = (t) => `mailto:${INFORME_EMAIL}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(`${cabeza}\n${t}`)}`;
    const completo = String(texto == null ? '' : texto);
    let href = build(completo);
    if (href.length <= limite) return { href, recortado: false };
    const lineas = completo.split('\n');
    const nota = '[…recortado para que quepa en el correo; pulsa «Copiar texto» en la web para pegarlo entero]';
    while (lineas.length > 1) {
      lineas.pop();
      href = build(`${lineas.join('\n')}\n${nota}`);
      if (href.length <= limite) return { href, recortado: true };
    }
    return { href: build(nota), recortado: true };
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
      return `Datadis no ha publicado (o no ha enviado) los excedentes de ${listaMeses(ev.mesesSinDato)}, aunque sí los de otros meses. ` +
        'En meses de tanto sol es muy improbable que no vertieras nada, y el simulador calcularía como si no lo hubieras hecho, así que no importamos. ' +
        'Descarga el CSV desde Datadis o desde tu distribuidora y usa «Seleccionar archivo CSV», o rellena los excedentes a mano en la tabla mensual.';
    }
    return 'Tu contrato figura en Datadis con autoconsumo con excedentes, pero Datadis no ha enviado ni un kWh vertido en todo el periodo. ' +
      'Si importáramos solo el consumo, el simulador calcularía como si no vertieras nada, así que no importamos. ' +
      'Descarga el CSV desde Datadis o desde tu distribuidora y usa «Seleccionar archivo CSV», o rellena los excedentes a mano en la tabla mensual.';
  }

  function textoConfirmacionSolar(decision, ev) {
    if (decision.motivo === 'meses-sin-dato') {
      return `Datadis no ha publicado (o no ha enviado) los excedentes de ${listaMeses(ev.mesesSinDato)}, aunque sí los de otros meses. ` +
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

  function avisosSolar(decision, ev, rango, cob, mesesSinPublicar) {
    const avisos = [`Datos de Datadis: ${etiquetaMes(rango.iniMes)} a ${etiquetaMes(rango.finMes)}.`];
    if (mesesSinPublicar && mesesSinPublicar.length) {
      avisos.push(`Tu distribuidora aún no ha publicado los excedentes de ${listaMeses(mesesSinPublicar)} (suele tardar unas semanas): se simulan los 12 meses anteriores.`);
    }
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
      case 'baja':
        return `Ese suministro está dado de baja desde el ${fechaEs(err.detalle.fecha)}, así que Datadis no tiene consumos suyos en el periodo elegido. No hemos pedido los consumos. ` +
          (err.detalle.solar
            ? 'El simulador solar necesita los últimos 12 meses completos de un suministro activo.'
            : 'Si quieres analizarlo, elige «Otro periodo» anterior a esa fecha.');
      case 'sinsuministros':
        return 'No hemos encontrado suministros en tu cuenta de Datadis.';
      case 'distribuidora': {
        const d = err.detalle || {};
        return `Datadis no ha podido obtener tus consumos de la distribuidora${d.nombre ? ` (${d.nombre})` : ''}` +
          `${d.descripcion ? `: «${d.descripcion}»` : ''}. Es un fallo de la distribuidora, no de tu cuenta ni de tu contraseña, y suele ser temporal. ` +
          'Prueba más tarde (si vuelve a fallar, mañana: Datadis puede contar la consulta) o usa el CSV descargado desde Datadis.';
      }
      case 'sindatos':
        return 'Datadis no ha devuelto consumos para ese periodo. Puede ser un suministro nuevo o dado de baja, un periodo fuera de tu contrato o un retraso de tu distribuidora.';
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
    'consumos-mes': 'Datadis no ha devuelto el periodo de una vez: lo pedimos mes a mes. Puede tardar unos minutos (como mucho, seis).'
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

    function vistaFormulario(mensajeError, aviso, informe) {
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
        ${mensajeError && informe ? `<div class="lf-dd-box lf-dd-informe">
          <strong>🛠️ ¿Me ayudas a que funcione?</strong>
          <p>Soy aLMaX y hago LuzFija yo solo. Cada distribuidora envía los datos a Datadis a su manera y no puedo probarlas todas: con este informe puedo ver qué ha pasado con la tuya y arreglarlo.</p>
          <p>Lleva solo datos técnicos: el error, tu navegador, tu distribuidora y cuántas horas y excedentes llegaron cada mes. No incluimos tu NIF, tu contraseña, tu CUPS, tu dirección ni tus consumos. Sí van los textos que devuelve Datadis (por ejemplo, sus mensajes de error), en los que ocultamos automáticamente lo que parezca un CUPS, un documento, un correo o un teléfono; un nombre o una dirección no se pueden detectar así, de modo que revísalo antes de enviarlo.</p>
          <details>
            <summary>Revisa el informe (puedes editarlo)</summary>
            <textarea id="lfDdInforme" class="lf-dd-informe-texto" rows="8" spellcheck="false" aria-label="Informe que se enviará"></textarea>
          </details>
          <div class="lf-dd-actions">
            <a id="lfDdInformeEnviar" class="btn lf-dd-informe-enviar" href="mailto:${INFORME_EMAIL}"><span>📧 Enviar a ${INFORME_EMAIL}</span></a>
            <button id="lfDdInformeCopiar" class="btn" type="button"><span>📋 Copiar texto</span></button>
          </div>
          <p id="lfDdInformeEstado" class="lf-dd-informe-estado" role="status" aria-live="polite"></p>
          <p class="lf-dd-informe-nota">Se abrirá tu correo con el texto ya escrito: tú decides si lo envías. Nada se envía solo.</p>
        </div>` : ''}
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

      const informeTexto = content.querySelector('#lfDdInforme');
      if (informeTexto) {
        const enviar = content.querySelector('#lfDdInformeEnviar');
        const estadoInforme = content.querySelector('#lfDdInformeEstado');
        informeTexto.value = informe;
        const refrescar = () => enviar.setAttribute('href', mailtoInforme(informeTexto.value).href);
        informeTexto.addEventListener('input', refrescar);
        refrescar();
        enviar.addEventListener('click', () => {
          estadoInforme.textContent = '¡Gracias! Si no se ha abierto tu correo, pulsa «Copiar texto» y mándalo a ' + INFORME_EMAIL + '.';
        });
        content.querySelector('#lfDdInformeCopiar').addEventListener('click', () => {
          const hecho = (ok) => {
            estadoInforme.textContent = ok
              ? 'Texto copiado. Pégalo en un correo a ' + INFORME_EMAIL + '.'
              : 'No se pudo copiar automáticamente: abre «Revisa el informe», selecciona el texto y cópialo a mano.';
          };
          const aMano = () => {
            try { informeTexto.closest('details').open = true; informeTexto.focus(); informeTexto.select(); return document.execCommand('copy'); } catch (_) { return false; }
          };
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(informeTexto.value).then(() => hecho(true), () => hecho(aMano()));
          } else hecho(aMano());
        });
      }

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
        const diagnostico = {};
        vistaProgreso(TEXTO_PROGRESO.login);
        try {
          // Mismo objeto (no una copia): asi importar() puede soltar la contrasena de verdad.
          const resultado = await importar(Object.assign(peticionDatadis, {
            diagnostico,
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
          const mensaje = textoError(err);
          vistaFormulario(mensaje, null, codigoInforme(err) ? construirInforme(diagnostico, err, mensaje) : null);
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
      const describir = (s) => {
        const etiqueta = [s.address, s.municipality, s.province].filter(Boolean).join(', ') || 'Suministro';
        const baja = fechaBaja(s) ? ` (de baja desde el ${fechaEs(fechaBaja(s))})` : (s.validDateTo ? ' (de baja)' : '');
        return `${etiqueta} · ${cupsEnmascarado(s.cups)}${baja}`;
      };
      const opciones = lista.map((s) => `<option value="${esc(s.cups)}"${s === preferido ? ' selected' : ''}>${esc(describir(s))}</option>`).join('');
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">📥 Elige tu suministro</h3>
        <p class="lf-dd-lead">Tu cuenta de Datadis tiene ${lista.length} suministros. ¿Cuál quieres importar?</p>
        <div class="group">
          <label for="lfDdSuministro">Suministro</label>
          <select id="lfDdSuministro" class="input" aria-describedby="lfDdSuministroInfo">${opciones}</select>
          <p id="lfDdSuministroInfo" class="lf-dd-suministro-info">${esc(describir(preferido))}</p>
        </div>
        <div class="lf-dd-actions">
          <button id="lfDdElegir" class="btn primary" type="button"><span>Importar este suministro</span></button>
          <button id="lfDdCancelar" class="btn" type="button"><span>Cancelar</span></button>
        </div>
      `, '#lfDdSuministro');
      const selector = content.querySelector('#lfDdSuministro');
      selector.addEventListener('change', () => {
        const s = lista.find((x) => x.cups === selector.value);
        if (s) content.querySelector('#lfDdSuministroInfo').textContent = describir(s);
      });
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
      // `origen` solo cambia la etiqueta del evento que bv-ui ya envia al completar una importacion.
      const ok = await window.BVSim.importarFichero(r.fichero, { avisos, origen: 'datadis' });
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
  /**
   * Conecta el boton de Datadis. Viene en el HTML (no se crea aqui) para que la pagina no se
   * recoloque al arrancar (CLS); solo se crea si una pagina antigua no lo trae. Si la importacion
   * no puede funcionar en esta pagina, se OCULTA: nunca un boton que no hace nada.
   * Id distinto en cada pagina: el de la home lleva reglas propias de la barra de botones en
   * movil (pro.css) que no deben alcanzar al boton del simulador solar.
   */
  function initDatadisImport() {
    const ocultar = (b) => { if (b) b.hidden = true; };
    try {
      const subirSolar = document.getElementById('upload-csv-btn');
      if (subirSolar) {
        let boton = document.getElementById('bvImportarDatadis');
        if (!DATADIS_IMPORT_ENABLED || !window.BVSim || typeof window.BVSim.importarFichero !== 'function') { ocultar(boton); return; }
        if (boton && boton.dataset.lfListo) return;
        if (!boton) {
          boton = document.createElement('button');
          boton.type = 'button';
          boton.className = 'btn lf-dd-solar-btn';
          boton.id = 'bvImportarDatadis';
          boton.innerHTML = '<span>📥 Importar desde Datadis</span>';
          boton.title = 'Importa hasta 12 meses completos de consumo y excedentes desde tu cuenta de Datadis';
          subirSolar.after(boton);
        }
        boton.addEventListener('click', () => abrirModal('solar'));
        boton.dataset.lfListo = '1';
        return;
      }

      let boton = document.getElementById('btnImportarDatadis');
      if (!DATADIS_IMPORT_ENABLED || typeof window.LF.procesarCSVConsumos !== 'function' || typeof window.LF.mostrarPreviewCSV !== 'function') { ocultar(boton); return; }
      if (boton && boton.dataset.lfListo) return;
      const contenedor = document.querySelector('.actions-center');
      if (!boton) {
        if (!contenedor) return;
        boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'btn';
        boton.id = 'btnImportarDatadis';
        boton.innerHTML = '<span>📥</span><span class="btn-text"><em class="lf-dd-solo-desktop">Importar de </em>Datadis</span>';
        boton.title = 'Importa hasta un año de consumo horario directamente desde tu cuenta de Datadis';
        const csv = document.getElementById('btnSubirCSV');
        if (csv) csv.after(boton);
        else contenedor.appendChild(boton);
      }
      boton.addEventListener('click', () => abrirModal('home'));
      boton.dataset.lfListo = '1';
    } catch {
      // la funcion es opcional: si algo falla, queda el importador de CSV (y el boton, oculto)
      ocultar(document.getElementById('btnImportarDatadis') || document.getElementById('bvImportarDatadis'));
    }
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
    marcarExcedentesSinPublicar,
    quitarHorasRepetidas,
    filaUtil,
    contratoDeclaraSinAutoconsumo,
    errorDeDistribuidora,
    resumenFilas,
    resumenContrato,
    construirInforme,
    textoTecnicoLimpio,
    navegadorBasico,
    formaRespuesta,
    mailtoInforme,
    codigoInforme,
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
