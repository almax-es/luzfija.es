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
   */
  function construirCsv(filas, rango) {
    const lista = Array.isArray(filas) ? filas : [];
    const porDia = new Map();
    for (const f of lista) {
      if (!f || typeof f.date !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(f.date)) continue;
      if (rango && (f.date < rango.iniYmd || f.date > rango.finYmd)) continue;
      if (!porDia.has(f.date)) porDia.set(f.date, []);
      porDia.get(f.date).push(f);
    }
    const hayExcedentes = lista.some((f) => f && Number(f.surplusEnergyKWh) > 0);
    const cab = ['CUPS', 'Fecha', 'Hora', 'Consumo_kWh', 'Metodo_obtencion'];
    if (hayExcedentes) cab.push('Energia_vertida_kWh');
    const out = [cab.join(';')];
    let filasUsadas = 0;
    for (const dia of [...porDia.keys()].sort()) {
      const arr = porDia.get(dia);
      const [y, m, d] = dia.split('/');
      arr.forEach((f, i) => {
        if (f.consumptionKWh === null || f.consumptionKWh === undefined || !Number.isFinite(Number(f.consumptionKWh))) return;
        const hora = arr.length === 25 ? i + 1 : parseInt(String(f.time), 10);
        if (!Number.isFinite(hora) || hora < 1 || hora > 25) return;
        const metodo = /^real$/i.test(String(f.obtainMethod || '').trim()) ? 'Real' : 'Estimada';
        const fila = ['CUPS', `${d}/${m}/${y}`, hora, decimalEs(f.consumptionKWh), metodo];
        if (hayExcedentes) fila.push(Number(f.surplusEnergyKWh) > 0 ? decimalEs(f.surplusEnergyKWh) : '0');
        out.push(fila.join(';'));
        filasUsadas++;
      });
    }
    return { csv: out.join('\r\n') + '\r\n', filasUsadas, diasConDatos: porDia.size, hayExcedentes };
  }

  /** Potencias del contrato (kW) o null si no son creibles. */
  function leerPotencias(respuestaContrato) {
    const c = respuestaContrato && Array.isArray(respuestaContrato.contract) ? respuestaContrato.contract[0] : null;
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
      const t = r.text.trim();
      if (!/^[\w-]+\.[\w-]+\.[\w-]*$/.test(t)) throw new DatadisError('http', r.status);
      return t;
    }
    const m = mensajeServidor(r.text);
    if (/user blocked/i.test(m)) throw new DatadisError('bloqueado', r.status);
    if (r.status === 401 || /bad credentials/i.test(m)) throw new DatadisError('credenciales', r.status);
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
      if (/24 ?h|repet|repeat|identical|misma consulta|already/i.test(mensajeServidor(r.text))) {
        throw new DatadisError('repeticion', r.status);
      }
      throw new DatadisError('http', r.status);
    }
    try { return JSON.parse(r.text); } catch { throw new DatadisError('http', r.status); }
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
    const rango = rangoUltimosDias(new Date());
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

    let potencias = null;
    if (o.conPotencia) {
      o.onProgreso('contrato');
      try {
        potencias = leerPotencias(await consultar('/api-private/api/get-contract-detail-v2', {
          cups: suministro.cups, distributorCode: String(suministro.distributorCode)
        }, token, T_CONTRATO, o.senal));
      } catch (e) {
        if (e && (e.code === 'cancelado' || e.code === 'sesion')) throw e;
        potencias = null; // la potencia es un extra: si falla, se importan igualmente los consumos
      }
    }

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
      let r;
      try {
        // Sin la senal del usuario A PROPOSITO: una vez pedida, Datadis cuenta la consulta aunque
        // se cancele, y repetirla daria error 24 h. Se deja terminar y se guarda en memoria, asi
        // un segundo intento en esta pagina no vuelve a pedirla.
        r = await consultar('/api-private/api/get-consumption-data-v2', params, token, T_CONSUMO, null);
      } catch (e) {
        if (e && e.code === 'http') e.paso = 'consumos';
        throw e;
      }
      filas = Array.isArray(r) ? r : (r && Array.isArray(r.timeCurve) ? r.timeCurve : []);
      cacheConsumos.set(clave, filas);
    }
    if (o.senal && o.senal.aborted) throw new DatadisError('cancelado');

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
        return 'Datadis no ha enviado excedentes, así que se importa solo el consumo. Si tienes placas, puede que tu distribuidora no los esté publicando en Datadis: en ese caso descarga el CSV desde Datadis o desde tu distribuidora.';
      }
      return w.replace(/^✓ CSV procesado:/, '✓ Datos de Datadis procesados:');
    });
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
        return 'Datadis no ha devuelto consumos para los últimos 365 días. Puede ser un suministro nuevo o un retraso de tu distribuidora.';
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
    consumos: 'Descargando tus consumos… Datadis puede tardar un poco.'
  };

  // ===== Interfaz =====

  function esc(v) {
    const f = window.LF && window.LF.escapeHtml;
    return typeof f === 'function' ? f(v) : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
  }

  function abrirModal() {
    const previo = document.activeElement;
    const fallosIniciales = leerFallos();
    let ocupado = false;
    let controlador = null;
    let cerrado = false;
    let tokenBloqueo = null;
    let resolverSuministro = null;
    // En tactil no se enfoca el NIF al abrir: sacaria el teclado y taparia los avisos.
    const tactil = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

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
      if (resolverSuministro) { resolverSuministro(null); resolverSuministro = null; }
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

    function vistaFormulario(mensajeError, aviso) {
      const fallos = leerFallos();
      const agotado = fallos >= MAX_FALLOS_LOGIN;
      const bloqueado = mensajeError && /^Datadis ha bloqueado/.test(mensajeError);
      const deshabilitado = agotado || bloqueado;
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">📥 Importar desde Datadis</h3>
        <p class="lf-dd-lead">Descarga tus últimos ${DIAS_HISTORICO} días de consumo horario directamente desde tu cuenta de Datadis, sin tener que bajar el CSV a mano.</p>
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
            <li>LuzFija.es es independiente de Datadis y no es una pasarela oficial. Si prefieres no usar tu contraseña, descarga el CSV desde Datadis y usa «Importar CSV».</li>
          </ul>
        </div>
        <div class="lf-dd-box lf-dd-warn">
          ⚠️ Datadis <strong>bloquea tu cuenta tras 3 intentos fallidos</strong> (también cuentan los que falles en su web o en otro dispositivo). Por eso aquí solo te dejamos dos, como precaución: no podemos saber si ya has fallado en otro sitio. ¿Entras en Datadis con Cl@ve? Necesitas una contraseña propia: puedes crearla en <a href="https://datadis.es" target="_blank" rel="noopener noreferrer">datadis.es</a>.
        </div>
        <form id="lfDdForm" class="lf-dd-form" autocomplete="on" novalidate>
          <div class="group">
            <label for="lfDdNif">NIF / NIE / CIF</label>
            <input id="lfDdNif" class="input" type="text" name="username" autocomplete="username" autocapitalize="characters" spellcheck="false" inputmode="text" ${deshabilitado ? 'disabled' : ''}>
          </div>
          <div class="group">
            <label for="lfDdClave">Contraseña de Datadis</label>
            <input id="lfDdClave" class="input" type="password" name="password" autocomplete="current-password" spellcheck="false" ${deshabilitado ? 'disabled' : ''}>
          </div>
          <label class="lf-dd-check"><input type="checkbox" id="lfDdVer" ${deshabilitado ? 'disabled' : ''}><span>Mostrar contraseña</span></label>
          <label class="lf-dd-check"><input type="checkbox" id="lfDdPotencia" checked ${deshabilitado ? 'disabled' : ''}><span>Rellenar también mi potencia contratada (P1 y P2) desde mi contrato</span></label>
          <div class="lf-dd-actions">
            <button id="lfDdEnviar" class="btn primary" type="submit" ${deshabilitado ? 'disabled' : ''}><span>Importar mis consumos</span></button>
          </div>
        </form>
      `, mensajeError ? '#lfDdError' : (aviso ? '#lfDdAviso' : (tactil ? null : '#lfDdNif')));

      const form = content.querySelector('#lfDdForm');
      const nif = content.querySelector('#lfDdNif');
      const clave = content.querySelector('#lfDdClave');
      const ver = content.querySelector('#lfDdVer');
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
        const nifValor = normalizarDocumento(nif.value);
        const formato = errorDocumento(nifValor);
        if (!nifValor || !clave.value || formato) {
          vistaFormulario(formato && formato !== 'vacio'
            ? textoError({ code: 'documento', detalle: formato })
            : 'Introduce tu NIF/NIE/CIF y tu contraseña de Datadis.');
          const n = content.querySelector('#lfDdNif');
          if (n) n.value = nifValor;
          return;
        }
        // La contrasena pasa del campo al objeto de la peticion y de ahi solo al login: importar()
        // la suelta nada mas usarla, y esta funcion no guarda otra copia.
        const peticionDatadis = { nif: nifValor, clave: clave.value };
        clave.value = '';
        const conPotencia = content.querySelector('#lfDdPotencia').checked;
        ocupado = true;
        controlador = new AbortController();
        vistaProgreso(TEXTO_PROGRESO.login);
        try {
          // Mismo objeto (no una copia): asi importar() puede soltar la contrasena de verdad.
          const resultado = await importar(Object.assign(peticionDatadis, {
            conPotencia,
            senal: controlador.signal,
            onProgreso: (paso) => { if (!cerrado) vistaProgreso(TEXTO_PROGRESO[paso] || TEXTO_PROGRESO.login); },
            elegirSuministro: (lista) => new Promise((resolve) => {
              if (cerrado) { resolve(null); return; }
              resolverSuministro = resolve;
              vistaSuministros(lista);
            })
          }));
          ocupado = false;
          if (cerrado) return;
          cerrar();
          window.LF.mostrarPreviewCSV(resultado);
        } catch (err) {
          ocupado = false;
          if (cerrado || (err && err.code === 'cancelado')) return;
          vistaFormulario(textoError(err));
          const n = content.querySelector('#lfDdNif');
          if (n) n.value = nifValor;
        }
      }
    }

    function vistaProgreso(texto) {
      pintar(`
        ${cabecera}
        <h3 id="lfDdTitulo" class="lf-dd-title">📥 Importar desde Datadis</h3>
        <div class="lf-dd-progreso" role="status" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <p>${esc(texto)}</p>
        </div>
        <div class="lf-dd-actions"><button id="lfDdCancelar" class="btn" type="button"><span>Cancelar</span></button></div>
      `, '#lfDdCancelar');
      content.querySelector('#lfDdCancelar').addEventListener('click', cerrar);
    }

    function vistaSuministros(lista) {
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
        const resolver = resolverSuministro;
        resolverSuministro = null;
        if (resolver) resolver(lista.find((s) => s.cups === cups) || null);
      });
      content.querySelector('#lfDdCancelar').addEventListener('click', cerrar);
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

  function initDatadisImport() {
    if (!DATADIS_IMPORT_ENABLED) return;
    try {
      if (document.getElementById('btnImportarDatadis')) return;
      if (typeof window.LF.procesarCSVConsumos !== 'function' || typeof window.LF.mostrarPreviewCSV !== 'function') return;
      const contenedor = document.querySelector('.actions-center');
      if (!contenedor) return;

      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'btn';
      boton.id = 'btnImportarDatadis';
      boton.innerHTML = '<span>📥</span><span class="btn-text"><em class="lf-dd-solo-desktop">Importar de </em>Datadis</span>';
      boton.title = 'Importa tus últimos 365 días de consumo directamente desde tu cuenta de Datadis';
      boton.addEventListener('click', abrirModal);

      const csv = document.getElementById('btnSubirCSV');
      if (csv) csv.after(boton);
      else contenedor.appendChild(boton);
    } catch { /* la funcion es opcional: si algo falla, queda el importador de CSV */ }
  }

  Object.assign(window.LF, { initDatadisImport });
  window.LF.datadis = {
    rangoUltimosDias,
    construirCsv,
    leerPotencias,
    normalizarSuministros,
    cupsEnmascarado,
    normalizarDocumento,
    errorDocumento,
    textoError,
    importar,
    DatadisError
  };
})();
