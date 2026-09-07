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

suite('factura PDF en Chromium real', () => {
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
      try {
        const file = path.join(repoRoot, relative);
        response.writeHead(200, {
          'content-type': MIME.get(path.extname(file)) || 'application/octet-stream',
          'cache-control': 'no-cache'
        });
        response.end(readFileSync(file));
      } catch (_) {
        response.writeHead(404).end('not found');
      }
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
    await waitFor(async () => (await evaluate('Boolean(window.__LF_facturaModuleReady)')).value);
  }, 30000);

  afterAll(async () => {
    pageCdp?.close();
    browserCdp?.close();
    if (chromium && chromium.exitCode === null) {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 5000);
        chromium.once('exit', () => { clearTimeout(timeout); resolve(); });
        try { chromium.kill(); } catch (_) { clearTimeout(timeout); resolve(); }
      });
    }
    await new Promise(resolve => server?.close(resolve));
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
});
