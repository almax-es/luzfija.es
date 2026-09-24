/**
 * @vitest-environment node
 * E2E opcional: LF_RUN_CHROMIUM_E2E=1 y CHROMIUM_BIN=<ruta>.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const suite = process.env.LF_RUN_CHROMIUM_E2E === '1' ? describe : describe.skip;
const repoRoot = path.resolve(__dirname, '..');
const chromiumBin = process.env.CHROMIUM_BIN || 'chromium';
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'],
  ['.css', 'text/css; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.wasm', 'application/wasm'],
  ['.gz', 'application/gzip'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml']
]);

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// La pagina esta lista para procesar un PDF cuando factura.js se ha evaluado Y lf-app.js ya ha
// enganchado los listeners del modal (__LF_bindFacturaParser marca el boton con __LF_BOUND).
// Esperar solo a __LF_facturaModuleReady dejaba una carrera: el test llama directamente a
// __LF_openFacturaModal, y si lf-app.js no habia llegado a enganchar el `change` del input, el
// primer intento no procesaba nada y el corte de red simulado le caia al segundo. Fallaba 1 de
// cada 2-4 ejecuciones y paro el .bat de despliegue dos veces el 23-24/09/2026. Un usuario no
// puede verse en esto: el boton que abre el modal se engancha en esa misma funcion.
const FACTURA_LISTA = "Boolean(window.__LF_facturaModuleReady) && Boolean(document.getElementById('btnSubirFactura')?.__LF_BOUND)";

async function waitFor(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(50);
  }
  throw new Error(`Timeout (${timeout} ms)`);
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params || {});
      }
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close() { try { this.socket.close(); } catch (_) {} }
}

// Reintento = segundo intento del usuario. En Windows, Chrome sin interfaz pierde a veces las
// primeras peticiones al servidor local (net::ERR_FAILED/ERR_ABORTED a los 40-90 ms del test, con
// y sin service worker; la causa de ese corte no se aislo). Investigandolo aparecio un bug real:
// en modo fake-worker el reintento repetia la URL del vendor del worker y no se recuperaba nunca
// (17/09/2026, paro el .bat de despliegue); lo fija el tercer test. Un fallo real del flujo falla
// tambien en los reintentos.
suite('factura PDF en Chromium real', { retry: 2 }, () => {
  let server;
  let origin;
  let chromium;
  let profile;
  let pageCdp;
  let browserCdp;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!relative) relative = 'index.html';
      if (relative.split('/').includes('..')) { response.writeHead(400).end(); return; }
      // Leer ANTES de escribir la cabecera: con writeHead(200) primero, una ruta que no es un
      // fichero hacia que el writeHead(404) del catch lanzase ERR_HTTP_HEADERS_SENT y la peticion
      // quedaba colgada para siempre.
      const file = path.join(repoRoot, relative);
      let body;
      try {
        body = readFileSync(file);
      } catch (_) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': MIME.get(path.extname(file)) || 'application/octet-stream',
        'cache-control': 'no-cache'
      });
      response.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;

    profile = mkdtempSync(path.join(tmpdir(), 'lf-factura-chromium-'));
    chromium = spawn(chromiumBin, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `${origin}/`
    ], { stdio: 'ignore' });

    const portFile = path.join(profile, 'DevToolsActivePort');
    const port = await waitFor(() => {
      try { return Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]); } catch (_) { return 0; }
    });
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browserCdp = new Cdp(version.webSocketDebuggerUrl);
    await browserCdp.send('Target.setDiscoverTargets', { discover: true });
    const page = await waitFor(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return targets.find(target => target.type === 'page' && target.url.startsWith(origin));
    });
    pageCdp = new Cdp(page.webSocketDebuggerUrl);
    await pageCdp.send('Runtime.enable');
    await waitFor(async () => (await evaluate(FACTURA_LISTA)).value);
  }, 30000);

  afterAll(async () => {
    const sigueVivo = () => chromium && chromium.exitCode === null && chromium.signalCode === null;
    // Cierre ordenado: Browser.close deja que Chromium termine sus procesos hijos y suelte el perfil.
    // Con solo kill() el proceso principal sale antes que los hijos, y en Windows el borrado del
    // perfil fallaba con EPERM aunque todos los tests hubieran pasado, lo que paraba el .bat de
    // despliegue (15/09/2026).
    if (browserCdp && sigueVivo()) {
      await Promise.race([browserCdp.send('Browser.close').catch(() => {}), wait(2000)]);
    }
    pageCdp?.close();
    browserCdp?.close();
    if (sigueVivo()) {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 5000);
        chromium.once('exit', () => { clearTimeout(timeout); resolve(); });
        try { chromium.kill(); } catch (_) { clearTimeout(timeout); resolve(); }
      });
    }
    await new Promise(resolve => server?.close(resolve));
    if (profile) {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch (error) {
        // El perfil vive en el directorio temporal del sistema. Si Windows aun lo tiene bloqueado,
        // dejarlo ahi no cambia ningun resultado; convertirlo en un fallo del suite si. Cualquier
        // otro error sigue fallando.
        if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
        console.warn(`[factura-lifecycle-chromium] Perfil temporal no borrado (${error.code}): ${profile}`);
      }
    }
  });

  async function evaluate(expression) {
    const result = await pageCdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
    return result.result;
  }

  it('renderiza con el worker bootstrap y termina el flujo sintetico', async () => {
    const result = (await evaluate(`(async () => {
      const NativeWorker = window.Worker;
      const workerUrls = [];
      window.Worker = function(...args) {
        workerUrls.push(String(args[0] || ''));
        return new NativeWorker(...args);
      };
      window.Worker.prototype = NativeWorker.prototype;
      window.__LF_openFacturaModal?.();
      const response = await fetch('/tests/fixtures/factura-sintetica.pdf');
      const file = new File([await response.arrayBuffer()], 'factura-sintetica.pdf', { type: 'application/pdf' });
      const input = document.getElementById('fileInputFactura');
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const end = Date.now() + 30000;
      while (Date.now() < end && window.__LF_FACTURA_BUSY) await new Promise(resolve => setTimeout(resolve, 50));
      return {
        busy: window.__LF_FACTURA_BUSY,
        source: document.getElementById('fuenteDatosBadge')?.textContent || '',
        warning: document.getElementById('avisoFactura')?.textContent || '',
        workerSrc: window.pdfjsLib?.GlobalWorkerOptions?.workerSrc || '',
        shim: typeof Map.prototype.getOrInsertComputed,
        workerUrls
      };
    })()`)).value;

    expect(result.busy).toBe(false);
    expect(result.source).toContain('PDF');
    expect(result.warning).toContain('consumo total');
    expect(result.workerSrc).toMatch(/\/js\/pdfjs-worker-bootstrap\.mjs\?v=/);
    expect(result.shim).toBe('function');
    expect(result.workerUrls.some(url => /\/js\/pdfjs-worker-bootstrap\.mjs\?v=/.test(url))).toBe(true);
  }, 40000);

  it('conserva el fallback fake-worker cuando Worker no puede construirse', async () => {
    const result = (await evaluate(`(async () => {
      document.getElementById('btnCancelarFactura')?.click();
      delete window.pdfjsLib;
      window.Worker = function() { throw new Error('Worker bloqueado por prueba'); };
      window.__LF_openFacturaModal?.();
      const response = await fetch('/tests/fixtures/factura-sintetica.pdf');
      const file = new File([await response.arrayBuffer()], 'factura-sintetica-fallback.pdf', { type: 'application/pdf' });
      const input = document.getElementById('fileInputFactura');
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const end = Date.now() + 30000;
      while (Date.now() < end && window.__LF_FACTURA_BUSY) await new Promise(resolve => setTimeout(resolve, 50));
      return {
        busy: window.__LF_FACTURA_BUSY,
        source: document.getElementById('fuenteDatosBadge')?.textContent || '',
        warning: document.getElementById('avisoFactura')?.textContent || '',
        workerSrc: window.pdfjsLib?.GlobalWorkerOptions?.workerSrc || ''
      };
    })()`)).value;

    expect(result.busy).toBe(false);
    expect(result.source).toContain('PDF');
    expect(result.warning).toContain('consumo total');
    expect(result.workerSrc).toMatch(/\/js\/pdfjs-worker-bootstrap\.mjs\?v=/);
  }, 40000);

  // En modo fake-worker el vendor del worker se importa en el realm de la PAGINA, y Chromium
  // memoriza un import() fallido para esa URL. Si el reintento repetia la misma URL HTTP, un solo
  // corte de red dejaba la lectura de PDF rota el resto de la sesion (17/09/2026).
  it('tras un corte de red del worker en modo fake-worker, el segundo intento lee el PDF', async () => {
    // Pagina recargada: mapa de modulos limpio, sin el worker que importaron los tests anteriores.
    await evaluate('window.__lfBeforeReload = true; setTimeout(() => location.reload(), 0); true');
    await waitFor(async () => {
      try {
        return (await evaluate('!window.__lfBeforeReload && ' + FACTURA_LISTA)).value;
      } catch (_) {
        return false;
      }
    });

    // Las peticiones van directas a la red para que el dominio Fetch de la pagina las vea.
    await pageCdp.send('Network.enable');
    await pageCdp.send('Network.setBypassServiceWorker', { bypass: true });
    const workerRequests = [];
    const onPaused = (params) => {
      workerRequests.push(params.request.url);
      const command = workerRequests.length === 1
        ? pageCdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' })
        : pageCdp.send('Fetch.continueRequest', { requestId: params.requestId });
      command.catch(() => {});
    };
    pageCdp.on('Fetch.requestPaused', onPaused);
    await pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*pdf.worker.min.mjs*' }] });

    const attempt = (name) => evaluate(`(async () => {
      document.getElementById('btnCancelarFactura')?.click();
      window.Worker = function() { throw new Error('Worker bloqueado por prueba'); };
      window.__LF_openFacturaModal?.();
      const response = await fetch('/tests/fixtures/factura-sintetica.pdf');
      const file = new File([await response.arrayBuffer()], ${JSON.stringify(name)}, { type: 'application/pdf' });
      const input = document.getElementById('fileInputFactura');
      const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      const end = Date.now() + 30000;
      while (Date.now() < end && window.__LF_FACTURA_BUSY) await new Promise(resolve => setTimeout(resolve, 50));
      return {
        busy: window.__LF_FACTURA_BUSY,
        source: document.getElementById('fuenteDatosBadge')?.textContent || ''
      };
    })()`).then(result => result.value);

    try {
      const first = await attempt('corte-de-red.pdf');
      expect(first.busy).toBe(false);
      expect(first.source).not.toContain('PDF');

      const second = await attempt('segundo-intento.pdf');
      expect(second.busy).toBe(false);
      expect(second.source).toContain('PDF');

      // El segundo intento pide el worker con otra URL HTTP y conserva la version del build.
      expect(workerRequests).toHaveLength(2);
      expect(new URL(workerRequests[0]).searchParams.get('lf_retry')).toBeNull();
      expect(new URL(workerRequests[1]).searchParams.get('lf_retry')).toBe('1');
      expect(new URL(workerRequests[1]).searchParams.get('v')).toBe(new URL(workerRequests[0]).searchParams.get('v'));
    } finally {
      await pageCdp.send('Fetch.disable').catch(() => {});
      await pageCdp.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
      const listeners = pageCdp.listeners.get('Fetch.requestPaused') || [];
      pageCdp.listeners.set('Fetch.requestPaused', listeners.filter(listener => listener !== onPaused));
    }
  }, 60000);
});
