import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Nota: No importamos factura.js arriba porque necesitamos configurar el DOM primero.
// Lo importaremos dinámicamente o nos aseguraremos de que cargue sobre nuestro JSDOM.

describe('Factura PDF Integration (Black Box)', () => {
  let container;

  beforeEach(() => {
    // 1. Configurar DOM mínimo necesario
    document.body.innerHTML = `
      <div id="modalFactura" class="modal">
        <div id="uploadAreaFactura" tabindex="0"></div>
        <input type="file" id="fileInputFactura" />
        <button id="btnSubirFactura"></button>
        <button id="btnAplicarFactura"></button>
        <button id="btnCancelarFactura"></button>
        <button id="btnCerrarFacturaX"></button>
        <div id="loaderFactura" tabindex="-1" style="display:none"></div>
        <div id="resultadoFactura" style="display:none"><h3 id="resultadoFacturaTitulo" tabindex="-1">Datos detectados</h3></div>
        <div id="confianzaBadge"></div>
        <div id="companiaDetectada"></div>
        <div id="nombreCompania"></div>
        <div id="avisoFactura"></div>
        <form id="formValidacionFactura"></form>
      </div>
      <span id="statusText"></span>
      <input id="p1" value=""><input id="p2" value=""><input id="dias" value="">
      <input id="cPunta" value=""><input id="cLlano" value=""><input id="cValle" value="">
      <input id="solarOn" type="checkbox"><input id="exTotal" value=""><input id="bvSaldo" value="">
      <input id="compararMiTarifa" type="checkbox">
      <input id="mtPunta" value=""><input id="mtLlano" value=""><input id="mtValle" value="">
      <input id="mtP1" value=""><input id="mtP2" value="">
    `;
    
    // Resetear estado global si existe
    window.__LF_facturaParserLoaded = false;
    window.__LF_facturaParsersLoaded = false;
    window.__LF_lastFile = null;
    window.__LF_DEBUG = true; // ACTIVAR DEBUG
    window.__LF_FACTURA_BUSY = false;
    window.__LF_PRIVACY_MODE = false;
    
    // Mock PDF.js
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      VerbosityLevel: { ERRORS: 0 },
      getDocument: vi.fn()
    };

    // Mock jsQR para evitar carga de script externo que cuelga JSDOM
    window.jsQR = vi.fn(() => null); // Retorna null (no QR encontrado)
    global.toast = vi.fn();
    window.toast = global.toast;

    // Dependencias globales de __LF_applyValues() tras aplicar con exito (fuera del propio
    // factura.js, normalmente las define lf-app.js). Sin ellas, un test que llegue a esa rama
    // lanzaria ReferenceError en vez de probar la logica de autocalculo.
    window.LF = window.LF || {};
    window.setStatus = vi.fn();
    window.runCalculation = vi.fn();
    window.markPending = vi.fn();
    window.hideResultsToInitialState = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      drawImage: () => {},
      putImageData: () => {},
      clearRect: () => {},
      fillRect: () => {}
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.toast;
    delete window.toast;
    document.body.innerHTML = '';
  });

  it('Rechaza PDFs mayores de 20 MB antes de leerlos', async () => {
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = {
      name: 'factura-enorme.pdf',
      type: 'application/pdf',
      size: 20 * 1024 * 1024 + 1,
      arrayBuffer: vi.fn()
    };

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 50));

    expect(mockFile.arrayBuffer).not.toHaveBeenCalled();
    expect(window.pdfjsLib.getDocument).not.toHaveBeenCalled();
    expect(global.toast).toHaveBeenCalledWith(expect.stringContaining('Máximo 20 MB'), 'err');
  });

  it('__LF_daysInclusive rechaza fechas imposibles en vez de normalizarlas en silencio (14/08/2026)', async () => {
    await import('../js/factura-parsers.js');
    const { __LF_daysInclusive } = window.__LF_FacturaParsers;

    // Date.UTC(2026, 1, 31) desborda a marzo en silencio si no se valida ida y vuelta.
    expect(__LF_daysInclusive('01/02/2026', '31/02/2026')).toBeNull();
    // 2025 no es bisiesto: 29/02/2025 no existe.
    expect(__LF_daysInclusive('01/02/2025', '29/02/2025')).toBeNull();
    // 2024 SI es bisiesto: 29/02/2024 es una fecha real (regresion).
    expect(__LF_daysInclusive('29/02/2024', '29/02/2024')).toBe(1);
    // INCLUSIVO: este helper recibe el rango "del X al Y" de la factura, no fechas de
    // lectura de contador. Junio entero son 30 dias. La regla CNMC de lectura inicial
    // excluida vive en la ruta del QR (iniF/finF), que no pasa por aqui.
    expect(__LF_daysInclusive('01/06/2026', '30/06/2026')).toBe(30);
  });

  it('un consumo total sin reparto P1/P2/P3 no rellena un reparto inventado ni llega a 100% (14/08/2026)', async () => {
    await import('../js/factura-parsers.js');
    const { __LF_parsearDatos } = window.__LF_FacturaParsers;

    const textoSinReparto = [
      'Periodo de facturacion: del 01/01/2026 al 31/01/2026',
      'Potencia contratada P1: 3,45 kW',
      'Potencia contratada P2: 3,45 kW',
      'Consumo total: 300 kWh'
    ];
    const r = __LF_parsearDatos(textoSinReparto, textoSinReparto.join(' '));

    expect(r.consumoPunta).toBeNull();
    expect(r.consumoLlano).toBeNull();
    expect(r.consumoValle).toBeNull();
    expect(r.consumoTotalDetectado).toBe(300);
    expect(r.confianza).toBeLessThan(100);
  });

  it('un reparto P1/P2/P3 completo sigue dando 100% de confianza (regresion 14/08/2026)', async () => {
    await import('../js/factura-parsers.js');
    const { __LF_parsearDatos } = window.__LF_FacturaParsers;

    const textoConReparto = [
      'Periodo de facturacion: del 01/01/2026 al 31/01/2026',
      'Potencia contratada P1: 3,45 kW',
      'Potencia contratada P2: 3,45 kW',
      'Consumo Punta: 100 kWh',
      'Consumo Llano: 50 kWh',
      'Consumo Valle: 25 kWh'
    ];
    const r = __LF_parsearDatos(textoConReparto, textoConReparto.join(' '));

    expect(r.consumoPunta).toBe(100);
    expect(r.consumoLlano).toBe(50);
    expect(r.consumoValle).toBe(25);
    expect(r.confianza).toBe(100);
  });

  it('Libera la tarea de PDF si falla su apertura', async () => {
    const destroy = vi.fn().mockResolvedValue();
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('PDF corrupto')),
      destroy
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const mockFile = {
      name: 'factura-corrupta.pdf',
      type: 'application/pdf',
      size: 100,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10))
    };
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);

    await new Promise(r => setTimeout(r, 50));

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('Limpia datos y libera privacidad al cerrar el modal aunque haya trabajo pendiente', async () => {
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const modal = document.getElementById('modalFactura');
    modal.classList.add('show');
    document.getElementById('formValidacionFactura').innerHTML = '<input id="val_p1" value="3,45">';
    window.__LF_FACTURA_BUSY = true;
    window.__LF_PRIVACY_MODE = true;

    document.getElementById('btnCancelarFactura').click();

    expect(window.__LF_FACTURA_BUSY).toBe(false);
    expect(window.__LF_PRIVACY_MODE).toBe(false);
    expect(document.getElementById('formValidacionFactura').innerHTML).toBe('');
    expect(modal.classList.contains('show')).toBe(false);
  });

  it('Serializa procesos PDF e impide que una operación cancelada libere la siguiente', async () => {
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    let resolveFirst;
    const firstFile = {
      name: 'primera.pdf',
      type: 'application/pdf',
      size: 100,
      arrayBuffer: vi.fn(() => new Promise((resolve) => { resolveFirst = resolve; }))
    };
    const rejectedFile = {
      name: 'segunda.pdf',
      type: 'application/pdf',
      size: 100,
      arrayBuffer: vi.fn()
    };

    const dispatchFile = (file) => {
      const event = new Event('change', { bubbles: true });
      Object.defineProperty(event, 'target', { value: { files: [file] } });
      document.getElementById('fileInputFactura').dispatchEvent(event);
    };

    dispatchFile(firstFile);
    dispatchFile(rejectedFile);
    await Promise.resolve();

    expect(firstFile.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(rejectedFile.arrayBuffer).not.toHaveBeenCalled();
    expect(window.__LF_FACTURA_BUSY).toBe(true);
    expect(global.toast).toHaveBeenCalledWith('Ya hay una factura procesándose', 'err');

    document.getElementById('btnCancelarFactura').click();
    expect(window.__LF_PRIVACY_MODE).toBe(true);

    let resolveThird;
    const thirdFile = {
      name: 'tercera.pdf',
      type: 'application/pdf',
      size: 100,
      arrayBuffer: vi.fn(() => new Promise((resolve) => { resolveThird = resolve; }))
    };
    dispatchFile(thirdFile);
    await Promise.resolve();
    expect(window.__LF_FACTURA_BUSY).toBe(true);

    resolveFirst(new ArrayBuffer(8));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.__LF_FACTURA_BUSY).toBe(true);
    expect(document.getElementById('formValidacionFactura').innerHTML).toBe('');

    document.getElementById('btnCancelarFactura').click();
    expect(window.__LF_PRIVACY_MODE).toBe(true);
    resolveThird(new ArrayBuffer(8));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.__LF_FACTURA_BUSY).toBe(false);
    expect(window.__LF_PRIVACY_MODE).toBe(false);
  });

  it('mueve el foco al estado de procesamiento y despues al resultado cuando oculta el area de subida', async () => {
    let resolvePdf;
    const pdfPromise = new Promise((resolve) => { resolvePdf = resolve; });
    window.pdfjsLib.getDocument.mockReturnValue({ promise: pdfPromise });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura-foco.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.getElementById('uploadAreaFactura').style.display).toBe('none');
    expect(document.activeElement).toBe(document.getElementById('loaderFactura'));

    resolvePdf({
      numPages: 1,
      getPage: () => Promise.resolve({
        getTextContent: () => Promise.resolve({ items: [] }),
        getAnnotations: () => Promise.resolve([]),
        cleanup: () => {},
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() })
      }),
      cleanup: () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.getElementById('resultadoFactura').style.display).not.toBe('none');
    expect(document.activeElement).toBe(document.getElementById('resultadoFacturaTitulo'));
  });

  it('Limita el parseo de texto a las primeras 20 páginas del PDF', async () => {
    const qrUrl = "https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.450&pP2=2.200&cfP1=111&cfP2=222&cfP3=333&iniF=2025-01-01&finF=2025-01-30";
    const getPage = vi.fn((pageNum) => Promise.resolve({
      getTextContent: () => Promise.resolve({
        items: pageNum === 1
          ? [
              { str: "Factura con enlace QR CNMC", transform: [0,0,0,0, 10, 100] },
              { str: qrUrl, transform: [0,0,0,0, 10, 90] },
              { str: "relleno suficiente para superar el mínimo de texto seleccionable", transform: [0,0,0,0, 10, 80] }
            ]
          : [
              { str: `Página ${pageNum} relleno de factura`, transform: [0,0,0,0, 10, 100] }
            ]
      }),
      getAnnotations: () => Promise.resolve([]),
      cleanup: () => {},
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve() })
    }));

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 25,
        getPage,
        cleanup: () => {},
        destroy: () => {}
      })
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura-muchas-paginas.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const pagesRead = getPage.mock.calls.map(([pageNum]) => pageNum);
    expect(Math.max(...pagesRead)).toBe(20);
    expect(pagesRead).not.toContain(21);
    expect(document.getElementById('avisoFactura').textContent).toContain('primeras 20');
  });

  it('Debe procesar un PDF simulado y rellenar el formulario correctamente', async () => {
    // 2. Mockear el contenido del PDF
    // Añadimos texto de relleno para superar el límite de 40 chars de "textRawLen"
    const padding = Array(10).fill({ str: "relleno de texto para validacion de longitud minima", transform: [0,0,0,0, 0, 0] });

    const mockTextItems = [
      // Y=100: Cabecera
      { str: "Factura", transform: [0,0,0,0, 10, 100] },
      { str: "Endesa Energía S.A.", transform: [0,0,0,0, 60, 100] },
      
      // Y=80: Periodo
      { str: "Periodo de facturación:", transform: [0,0,0,0, 10, 80] },
      { str: "del", transform: [0,0,0,0, 50, 80] }, // Faltaba el "del"
      { str: "01/01/2025", transform: [0,0,0,0, 70, 80] },
      { str: "al", transform: [0,0,0,0, 120, 80] },
      { str: "31/01/2025", transform: [0,0,0,0, 140, 80] },

      // Y=60: Potencias
      { str: "Potencia contratada", transform: [0,0,0,0, 10, 60] },
      { str: "Punta", transform: [0,0,0,0, 60, 60] },
      { str: "3,45", transform: [0,0,0,0, 100, 60] }, // Valor esperado P1
      { str: "kW", transform: [0,0,0,0, 140, 60] },
      { str: "Valle", transform: [0,0,0,0, 160, 60] },
      { str: "4,00", transform: [0,0,0,0, 200, 60] }, // Valor esperado P2
      { str: "kW", transform: [0,0,0,0, 240, 60] },

      // Y=40: Consumos
      { str: "Energía consumida", transform: [0,0,0,0, 10, 40] },
      { str: "Punta", transform: [0,0,0,0, 50, 40] },
      { str: "120,50", transform: [0,0,0,0, 100, 40] }, // Valor esperado Consumo P1
      { str: "kWh", transform: [0,0,0,0, 140, 40] },
      
      ...padding
    ];

    // Configurar el mock de getDocument para devolver estos items
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }), // Dummy
          render: () => ({ promise: Promise.resolve() })   // ✅ MOCK NECESARIO para que no se cuelgue buscando QR
        }),
        cleanup: () => {},
        destroy: () => {}
      })
    });

    // 3. Cargar el script (simulando que se carga en la página)
    // Usamos require o import dinámico para asegurar ejecución
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    
    // Forzar re-binding por si el script ya estaba cargado en memoria de Vitest
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    // 4. Simular subida de archivo
    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura.pdf', { type: 'application/pdf' });
    
    // Hack: Sobrescribir arrayBuffer para que no falle si el código lo llama
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    // Disparar evento
    // Nota: js/factura.js escucha 'change' en fileInput
    const dataTransfer = { files: [mockFile] };
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    
    fileInput.dispatchEvent(event);

    // 5. Esperar a que el proceso async termine
    // Aumentamos el tiempo a 500ms y usamos un bucle simple de espera
    await new Promise(r => setTimeout(r, 500));

    // 6. Aserciones
    const form = document.getElementById('formValidacionFactura');
    
    // Helper para buscar valor en el input generado dinámicamente
    const getVal = (field) => {
      // El código crea <div class="input-validacion" data-field="p1">...<input>...</div>
      const wrap = form.querySelector(`.input-validacion[data-field="${field}"]`);
      if (!wrap) return null;
      const input = wrap.querySelector('input');
      return input ? input.value : null;
    };

    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('4'); // Normaliza 4,00 a 4
    expect(getVal('dias')).toBe('31'); // 01/01 a 31/01 inclusive = 31 días (__LF_daysInclusive)

    expect(getVal('consumoPunta')).toBe('120,5');
    
    // Verificar compañía
    const cia = document.getElementById('nombreCompania');
    expect(cia.textContent).toContain('Endesa');
    expect(document.activeElement).toBe(document.getElementById('resultadoFacturaTitulo'));
  });

  it('Debe detectar DISA y mapear potencia P3 como P2 cuando P2 no aparece en potencia', async () => {
    const padding = Array(10).fill({ str: "relleno de texto para validacion de longitud minima", transform: [0,0,0,0, 0, 0] });

    const mockTextItems = [
      { str: "Factura", transform: [0,0,0,0, 10, 100] },
      { str: "DISA Energía Eléctrica", transform: [0,0,0,0, 60, 100] },
      { str: "disagrupo.es", transform: [0,0,0,0, 10, 90] },

      { str: "Término Potencia", transform: [0,0,0,0, 10, 70] },
      { str: "P1", transform: [0,0,0,0, 10, 60] },
      { str: "3,450", transform: [0,0,0,0, 35, 60] },
      { str: "kW", transform: [0,0,0,0, 70, 60] },
      { str: "x", transform: [0,0,0,0, 90, 60] },
      { str: "29", transform: [0,0,0,0, 105, 60] },
      { str: "Días", transform: [0,0,0,0, 125, 60] },
      { str: "x", transform: [0,0,0,0, 155, 60] },

      { str: "P3", transform: [0,0,0,0, 10, 50] },
      { str: "3,450", transform: [0,0,0,0, 35, 50] },
      { str: "kW", transform: [0,0,0,0, 70, 50] },
      { str: "x", transform: [0,0,0,0, 90, 50] },
      { str: "29", transform: [0,0,0,0, 105, 50] },
      { str: "Días", transform: [0,0,0,0, 125, 50] },
      { str: "x", transform: [0,0,0,0, 155, 50] },

      { str: "Término Energía", transform: [0,0,0,0, 10, 40] },
      { str: "P1", transform: [0,0,0,0, 10, 30] },
      { str: "346", transform: [0,0,0,0, 35, 30] },
      { str: "kWh", transform: [0,0,0,0, 65, 30] },
      { str: "P2", transform: [0,0,0,0, 90, 30] },
      { str: "310", transform: [0,0,0,0, 115, 30] },
      { str: "kWh", transform: [0,0,0,0, 145, 30] },
      { str: "P3", transform: [0,0,0,0, 170, 30] },
      { str: "313", transform: [0,0,0,0, 195, 30] },
      { str: "kWh", transform: [0,0,0,0, 225, 30] },

      ...padding
    ];

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {},
        destroy: () => {}
      })
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura-disa.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => {
      const wrap = form.querySelector(`.input-validacion[data-field="${field}"]`);
      if (!wrap) return null;
      const input = wrap.querySelector('input');
      return input ? input.value : null;
    };

    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('3,45');
    expect(getVal('dias')).toBe('29');
    expect(getVal('consumoPunta')).toBe('346');
    expect(getVal('consumoLlano')).toBe('310');
    expect(getVal('consumoValle')).toBe('313');

    const cia = document.getElementById('nombreCompania');
    expect(cia.textContent).toContain('DISA');
  });

  it('Debe priorizar datos del QR cuando existe URL CNMC en el PDF', async () => {
    const padding = Array(10).fill({ str: "relleno de texto para validacion de longitud minima", transform: [0,0,0,0, 0, 0] });
    const qrUrl = "https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.450&pP2=2.200&cfP1=111&cfP2=222&cfP3=333&iniF=2025-01-01&finF=2025-01-30";

    const mockTextItems = [
      { str: "Factura", transform: [0,0,0,0, 10, 100] },
      { str: "Endesa Energía S.A.", transform: [0,0,0,0, 60, 100] },
      { str: qrUrl, transform: [0,0,0,0, 10, 90] },

      // Datos PDF deliberadamente distintos para asegurar prioridad QR
      { str: "Periodo de facturación:", transform: [0,0,0,0, 10, 80] },
      { str: "del", transform: [0,0,0,0, 50, 80] },
      { str: "01/01/2025", transform: [0,0,0,0, 70, 80] },
      { str: "al", transform: [0,0,0,0, 120, 80] },
      { str: "31/01/2025", transform: [0,0,0,0, 140, 80] },

      { str: "Potencia contratada", transform: [0,0,0,0, 10, 60] },
      { str: "Punta", transform: [0,0,0,0, 60, 60] },
      { str: "9,99", transform: [0,0,0,0, 100, 60] },
      { str: "kW", transform: [0,0,0,0, 140, 60] },
      { str: "Valle", transform: [0,0,0,0, 160, 60] },
      { str: "8,88", transform: [0,0,0,0, 200, 60] },
      { str: "kW", transform: [0,0,0,0, 240, 60] },

      { str: "Energía consumida", transform: [0,0,0,0, 10, 40] },
      { str: "Punta", transform: [0,0,0,0, 50, 40] },
      { str: "999", transform: [0,0,0,0, 100, 40] },
      { str: "kWh", transform: [0,0,0,0, 140, 40] },

      ...padding
    ];

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {},
        destroy: () => {}
      })
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura-qr.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => {
      const wrap = form.querySelector(`.input-validacion[data-field="${field}"]`);
      if (!wrap) return null;
      const input = wrap.querySelector('input');
      return input ? input.value : null;
    };

    // Potencias y consumos vienen del QR (prioridad)
    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('2,2');
    // Días: QR dice 29 (iniF=01-01 NO incluida; finF=01-30 incluida, según CNMC),
    // mientras el PDF dice 31 (del 01/01 al 31/01, inclusive). Si QR ≠ PDF → usar PDF.
    // Las dos semanticas conviven a proposito: el QR es formato CNMC, el rango del PDF
    // es lenguaje natural inclusivo.
    expect(getVal('dias')).toBe('31');
    expect(getVal('consumoPunta')).toBe('111');
    expect(getVal('consumoLlano')).toBe('222');
    expect(getVal('consumoValle')).toBe('333');
  });

  it('no mezcla días de una factura anterior con el QR CNMC de otra factura del mismo PDF', async () => {
    const qrUrl = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45kW&pP2=4.60kW&cfP1=100kWh&cfP2=200kWh&cfP3=300kWh&iniF=2026-02-01&finF=2026-03-01';
    const padding = Array(6).fill({ str: 'relleno de texto para superar el minimo de extraccion', transform: [0,0,0,0, 0, 0] });

    const pages = {
      1: [
        { str: 'Factura suministro A', transform: [0,0,0,0, 10, 100] },
        { str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0, 10, 90] },
        { str: 'Potencia contratada P1: 9,90 kW', transform: [0,0,0,0, 10, 80] },
        { str: 'Potencia contratada P2: 9,90 kW', transform: [0,0,0,0, 10, 70] },
        { str: 'Consumo P1: 900 kWh', transform: [0,0,0,0, 10, 60] },
        { str: 'Consumo P2: 900 kWh', transform: [0,0,0,0, 10, 50] },
        { str: 'Consumo P3: 900 kWh', transform: [0,0,0,0, 10, 40] },
        ...padding
      ],
      2: [
        { str: 'Factura suministro B', transform: [0,0,0,0, 10, 100] },
        { str: qrUrl, transform: [0,0,0,0, 10, 90] },
        { str: 'Periodo de facturación: del 02/02/2026 al 01/03/2026', transform: [0,0,0,0, 10, 80] },
        ...padding
      ]
    };

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: (pageNum) => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: pages[pageNum] }),
          getAnnotations: () => Promise.resolve([]),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {}
      }),
      destroy: () => Promise.resolve()
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const mockFile = new File(['dummy'], 'dos-facturas.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => form.querySelector(`.input-validacion[data-field="${field}"] input`)?.value ?? null;

    // Los valores estructurales vienen del QR de la segunda factura.
    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('4,6');
    expect(getVal('consumoPunta')).toBe('100');
    expect(getVal('consumoLlano')).toBe('200');
    expect(getVal('consumoValle')).toBe('300');
    // Producción mezclaba estos valores con 31 días de la primera factura y mantenía 100%.
    expect(getVal('dias')).toBe('28');
    expect(document.getElementById('confianzaBadge').textContent).toContain('75%');
    expect(document.getElementById('avisoFactura').textContent).toContain('no coincide con el periodo');
  });

  it('Debe leer el QR por imagen aunque el PDF escaneado no tenga texto seleccionable', async () => {
    const qrUrl = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=3.45kW&pP2=4.60kW&cfP1=0kWh&cfP2=20kWh&cfP3=30kWh&iniF=2026-01-01&finF=2026-01-31';
    window.jsQR.mockReturnValue({ data: qrUrl });

    const mockPage = {
      getTextContent: () => Promise.resolve({ items: [] }),
      cleanup: () => {},
      getViewport: ({ scale }) => ({ width: Math.round(100 * scale), height: Math.round(100 * scale) }),
      render: () => ({ promise: Promise.resolve() })
    };
    window.pdfjsLib.getDocument.mockImplementation(() => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve(mockPage),
        cleanup: () => {}
      }),
      destroy: () => Promise.resolve()
    }));

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) window.__LF_bindFacturaParser();

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['scan'], 'factura-escaneada-qr.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => {
      const input = form.querySelector(`.input-validacion[data-field="${field}"] input`);
      return input ? input.value : null;
    };

    expect(window.jsQR).toHaveBeenCalled();
    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('4,6');
    expect(getVal('dias')).toBe('30');
    expect(getVal('consumoPunta')).toBe('0');
    expect(getVal('consumoLlano')).toBe('20');
    expect(getVal('consumoValle')).toBe('30');
    expect(document.getElementById('avisoFactura').textContent).not.toContain('No se ha detectado texto seleccionable');
  });

  it('Debe renderizar avisos contextuales con marcado permitido sin mostrar etiquetas literales', async () => {
    const padding = Array(10).fill({ str: "relleno de texto para validacion de longitud minima", transform: [0,0,0,0, 0, 0] });

    const mockTextItems = [
      { str: "Factura", transform: [0,0,0,0, 10, 100] },
      { str: "Endesa Energía S.A.", transform: [0,0,0,0, 60, 100] },
      { str: "Periodo de facturación:", transform: [0,0,0,0, 10, 80] },
      { str: "del", transform: [0,0,0,0, 50, 80] },
      { str: "01/01/2025", transform: [0,0,0,0, 70, 80] },
      { str: "al", transform: [0,0,0,0, 120, 80] },
      { str: "15/01/2025", transform: [0,0,0,0, 140, 80] },
      { str: "Potencia contratada", transform: [0,0,0,0, 10, 60] },
      { str: "Punta", transform: [0,0,0,0, 60, 60] },
      { str: "3,45", transform: [0,0,0,0, 100, 60] },
      { str: "kW", transform: [0,0,0,0, 140, 60] },
      { str: "Valle", transform: [0,0,0,0, 160, 60] },
      { str: "4,00", transform: [0,0,0,0, 200, 60] },
      { str: "kW", transform: [0,0,0,0, 240, 60] },
      { str: "Energía consumida", transform: [0,0,0,0, 10, 40] },
      { str: "Punta", transform: [0,0,0,0, 50, 40] },
      { str: "120,50", transform: [0,0,0,0, 100, 40] },
      { str: "kWh", transform: [0,0,0,0, 140, 40] },
      ...padding
    ];

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {},
        destroy: () => {}
      })
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura-aviso.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const aviso = document.getElementById('avisoFactura');
    expect(aviso.innerHTML).toContain('<b>');
    expect(aviso.innerHTML).not.toContain('&lt;b&gt;');
  });

  it('No renderiza HTML malicioso extraído del PDF en los avisos', async () => {
    const padding = Array(10).fill({ str: 'relleno de texto para validacion de longitud minima', transform: [0,0,0,0, 0, 0] });
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({
            items: [
              { str: 'Factura', transform: [0,0,0,0, 10, 100] },
              { str: 'Endesa Energía S.A.', transform: [0,0,0,0, 60, 100] },
              { str: 'Periodo de facturación:', transform: [0,0,0,0, 10, 80] },
              { str: 'del', transform: [0,0,0,0, 50, 80] },
              { str: '01/01/2025', transform: [0,0,0,0, 70, 80] },
              { str: 'al', transform: [0,0,0,0, 120, 80] },
              { str: '15/01/2025', transform: [0,0,0,0, 140, 80] },
              { str: 'Potencia contratada', transform: [0,0,0,0, 10, 60] },
              { str: 'Punta', transform: [0,0,0,0, 60, 60] },
              { str: payload, transform: [0,0,0,0, 100, 60] },
              { str: 'kW', transform: [0,0,0,0, 140, 60] },
              { str: 'Valle', transform: [0,0,0,0, 160, 60] },
              { str: '4,00', transform: [0,0,0,0, 200, 60] },
              { str: 'kW', transform: [0,0,0,0, 240, 60] },
              { str: 'Energía consumida', transform: [0,0,0,0, 10, 40] },
              ...padding
            ]
          }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {},
        destroy: () => {}
      })
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['dummy content'], 'factura-maliciosa.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);

    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(r => setTimeout(r, 500));

    const aviso = document.getElementById('avisoFactura');
    expect(aviso.querySelector('img')).toBeNull();
    expect(aviso.querySelector('script')).toBeNull();
    expect(aviso.innerHTML).not.toContain(payload);
    expect(aviso.innerHTML).not.toContain('onerror');
    expect(aviso.innerHTML).toContain('<b>');
  });

  it('Factura 3.0TD queda bloqueada aunque se rellenen manualmente los campos del modal', async () => {
    const padding = Array(8).fill({ str: 'relleno de texto para superar el mínimo de extracción', transform: [0,0,0,0, 0, 0] });
    const mockTextItems = [
      { str: 'Factura eléctrica', transform: [0,0,0,0, 10, 100] },
      { str: 'Peaje de acceso 3.0TD', transform: [0,0,0,0, 10, 90] },
      { str: 'Potencia contratada P1: 10 kW', transform: [0,0,0,0, 10, 80] },
      { str: 'Potencia contratada P2: 12 kW', transform: [0,0,0,0, 10, 70] },
      { str: 'Potencia contratada P3: 16 kW', transform: [0,0,0,0, 10, 60] },
      { str: 'Consumo P1: 100 kWh', transform: [0,0,0,0, 10, 50] },
      { str: 'Consumo P2: 200 kWh', transform: [0,0,0,0, 10, 40] },
      { str: 'Consumo P3: 300 kWh', transform: [0,0,0,0, 10, 30] },
      ...padding
    ];

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {}
      }),
      destroy: () => Promise.resolve()
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const mockFile = new File(['dummy'], 'factura-3-0td.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);

    await new Promise(r => setTimeout(r, 300));

    expect(document.getElementById('avisoFactura').textContent).toContain('3.0TD');
    expect(document.getElementById('avisoFactura').textContent).toContain('solo modela 2.0TD');

    // Incluso si el usuario rellena manualmente los seis campos visibles, no se deben
    // reinterpretar como un suministro 2.0TD.
    const values = { p1: '10', p2: '12', dias: '30', consumoPunta: '100', consumoLlano: '200', consumoValle: '300' };
    for (const [field, value] of Object.entries(values)) {
      const input = document.querySelector(`.input-validacion[data-field="${field}"] input`);
      expect(input).not.toBeNull();
      input.value = value;
    }
    document.getElementById('p1').value = '3,45';
    document.getElementById('p2').value = '4,60';

    document.getElementById('btnAplicarFactura').click();

    expect(document.getElementById('p1').value).toBe('3,45');
    expect(document.getElementById('p2').value).toBe('4,60');
    expect(global.toast).toHaveBeenCalledWith(expect.stringContaining('solo modela 2.0TD'), 'err');
    expect(window.runCalculation).not.toHaveBeenCalled();
  });

  it('un QR no puede saltarse el bloqueo si el propio PDF declara peaje 3.0TD', async () => {
    const qrUrl = 'https://comparador.cnmc.gob.es/comparador/QRE?pP1=10kW&pP2=12kW&cfP1=100kWh&cfP2=200kWh&cfP3=300kWh&iniF=2026-01-01&finF=2026-01-31';
    const padding = Array(6).fill({ str: 'relleno suficiente para mantener texto seleccionable', transform: [0,0,0,0, 0, 0] });
    const mockTextItems = [
      { str: 'Factura eléctrica', transform: [0,0,0,0, 10, 100] },
      { str: 'Peaje de acceso 3.0TD', transform: [0,0,0,0, 10, 90] },
      { str: qrUrl, transform: [0,0,0,0, 10, 80] },
      ...padding
    ];
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {}
      }),
      destroy: () => Promise.resolve()
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const mockFile = new File(['dummy'], 'factura-3td-con-qr.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(r => setTimeout(r, 300));

    expect(document.getElementById('avisoFactura').textContent).toContain('3.0TD');
    expect(document.getElementById('avisoFactura').textContent).toContain('solo modela 2.0TD');
    expect(document.querySelector('.input-validacion[data-field="p1"] input').value).toBe('');
    expect(document.querySelector('.input-validacion[data-field="consumoPunta"] input').value).toBe('');
  });

  it('Aplicar factura acepta 370 días y potencias positivas por debajo de 0,5 kW', async () => {
    document.getElementById('formValidacionFactura').innerHTML = `
      <div class="input-validacion" data-field="p1"><input id="val_p1" value="0,1"></div>
      <div class="input-validacion" data-field="p2"><input id="val_p2" value="0,4"></div>
      <div class="input-validacion" data-field="dias"><input id="val_dias" value="370"></div>
      <div class="input-validacion" data-field="consumoPunta"><input id="val_consumoPunta" value="100"></div>
      <div class="input-validacion" data-field="consumoLlano"><input id="val_consumoLlano" value="50"></div>
      <div class="input-validacion" data-field="consumoValle"><input id="val_consumoValle" value="25"></div>
    `;
    window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    document.getElementById('btnAplicarFactura').click();

    expect(document.getElementById('p1').value).toBe('0,1');
    expect(document.getElementById('p2').value).toBe('0,4');
    expect(document.getElementById('dias').value).toBe('370');
    expect(global.toast).not.toHaveBeenCalledWith(expect.stringContaining('Revisa los campos'), 'err');
  });

  it('Aplicar factura rechaza días decimales y no los copia al formulario principal', async () => {
    document.getElementById('formValidacionFactura').innerHTML = `
      <div class="input-validacion" data-field="p1"><input id="val_p1" value="3,45"></div>
      <div class="input-validacion" data-field="p2"><input id="val_p2" value="4,60"></div>
      <div class="input-validacion" data-field="dias"><input id="val_dias" value="30,5"></div>
      <div class="input-validacion" data-field="consumoPunta"><input id="val_consumoPunta" value="100"></div>
      <div class="input-validacion" data-field="consumoLlano"><input id="val_consumoLlano" value="50"></div>
      <div class="input-validacion" data-field="consumoValle"><input id="val_consumoValle" value="25"></div>
    `;
    window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };
    document.getElementById('dias').value = '30';

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    document.getElementById('btnAplicarFactura').click();

    expect(document.querySelector('.input-validacion[data-field="dias"]').classList.contains('err')).toBe(true);
    expect(document.getElementById('dias').value).toBe('30');
    expect(global.toast).toHaveBeenCalledWith(expect.stringContaining('Revisa los campos'), 'err');
  });

  it('Aplicar factura acepta P1 = 0 kW cuando P2 es positiva (caso 2.0TD recarga VE)', async () => {
    document.getElementById('formValidacionFactura').innerHTML = `
      <div class="input-validacion" data-field="p1"><input id="val_p1" value="0"></div>
      <div class="input-validacion" data-field="p2"><input id="val_p2" value="7,4"></div>
      <div class="input-validacion" data-field="dias"><input id="val_dias" value="30"></div>
      <div class="input-validacion" data-field="consumoPunta"><input id="val_consumoPunta" value="100"></div>
      <div class="input-validacion" data-field="consumoLlano"><input id="val_consumoLlano" value="50"></div>
      <div class="input-validacion" data-field="consumoValle"><input id="val_consumoValle" value="25"></div>
    `;
    window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    document.getElementById('btnAplicarFactura').click();

    expect(document.getElementById('p1').value).toBe('0');
    expect(document.getElementById('p2').value).toBe('7,4');
    expect(global.toast).not.toHaveBeenCalledWith(expect.stringContaining('Revisa los campos'), 'err');
  });

  it('Aplicar factura conserva un periodo con consumo 0/0/0 kWh', async () => {
    document.getElementById('formValidacionFactura').innerHTML = `
      <div class="input-validacion" data-field="p1"><input id="val_p1" value="3,45"></div>
      <div class="input-validacion" data-field="p2"><input id="val_p2" value="3,45"></div>
      <div class="input-validacion" data-field="dias"><input id="val_dias" value="30"></div>
      <div class="input-validacion" data-field="consumoPunta"><input id="val_consumoPunta" value="0"></div>
      <div class="input-validacion" data-field="consumoLlano"><input id="val_consumoLlano" value="0"></div>
      <div class="input-validacion" data-field="consumoValle"><input id="val_consumoValle" value="0"></div>
    `;
    window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    document.getElementById('btnAplicarFactura').click();

    expect(document.getElementById('cPunta').value).toBe('0');
    expect(document.getElementById('cLlano').value).toBe('0');
    expect(document.getElementById('cValle').value).toBe('0');
    expect(global.toast).not.toHaveBeenCalledWith(expect.stringContaining('Revisa los campos'), 'err');
  });

  it('Aplicar factura rechaza potencias fuera de 2.0TD (>15 kW)', async () => {
    document.getElementById('formValidacionFactura').innerHTML = `
      <div class="input-validacion" data-field="p1"><input id="val_p1" value="15,01"></div>
      <div class="input-validacion" data-field="p2"><input id="val_p2" value="3,45"></div>
      <div class="input-validacion" data-field="dias"><input id="val_dias" value="30"></div>
      <div class="input-validacion" data-field="consumoPunta"><input id="val_consumoPunta" value="100"></div>
      <div class="input-validacion" data-field="consumoLlano"><input id="val_consumoLlano" value="50"></div>
      <div class="input-validacion" data-field="consumoValle"><input id="val_consumoValle" value="25"></div>
    `;
    window.LF_CONFIG = { POTENCIA_MAX_KW: 15 };

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    document.getElementById('btnAplicarFactura').click();

    expect(document.querySelector('.input-validacion[data-field="p1"]').classList.contains('err')).toBe(true);
    expect(global.toast).toHaveBeenCalledWith(expect.stringContaining('Revisa los campos'), 'err');
  });

  it('No borra el modo CSV previo si aplicar factura falla la validación', async () => {
    document.getElementById('formValidacionFactura').innerHTML = `
      <div class="input-validacion" data-field="p1"><input id="val_p1" value=""></div>
      <div class="input-validacion" data-field="p2"><input id="val_p2" value="3,45"></div>
      <div class="input-validacion" data-field="dias"><input id="val_dias" value="30"></div>
      <div class="input-validacion" data-field="consumoPunta"><input id="val_consumoPunta" value="100"></div>
      <div class="input-validacion" data-field="consumoLlano"><input id="val_consumoLlano" value="50"></div>
      <div class="input-validacion" data-field="consumoValle"><input id="val_consumoValle" value="25"></div>
    `;

    const curve = [{ fecha: new Date('2025-01-01T00:00:00'), hora: 1, kwh: 1 }];
    const ref = { dias: 30, cPunta: 100, cLlano: 50, cValle: 25 };
    const clearCsvImportState = vi.fn(() => {
      window.LF.consumosHorarios = null;
      window.LF.csvConsumosRef = null;
      window.LF.pvpcPeriodoCSV = false;
    });

    window.LF = {
      consumosHorarios: curve,
      csvConsumosRef: ref,
      pvpcPeriodoCSV: true,
      clearCsvImportState
    };

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    if (window.__LF_bindFacturaParser) {
      window.__LF_bindFacturaParser();
    }

    document.getElementById('btnAplicarFactura').click();

    expect(clearCsvImportState).not.toHaveBeenCalled();
    expect(window.LF.consumosHorarios).toBe(curve);
    expect(window.LF.csvConsumosRef).toBe(ref);
    expect(window.LF.pvpcPeriodoCSV).toBe(true);
    expect(document.querySelector('.input-validacion[data-field="p1"]').classList.contains('err')).toBe(true);
  });

  describe('Autocalculo tras aplicar factura de 100% confianza (14/08/2026)', () => {
    // Mismo texto de la factura DISA (ya probada arriba): produce p1/p2/dias/consumoPunta/
    // Llano/Valle no nulos, es decir 6/6 campos detectados = 100% de confianza.
    async function subirFacturaAltaConfianza() {
      const padding = Array(10).fill({ str: "relleno de texto para validacion de longitud minima", transform: [0,0,0,0, 0, 0] });
      const mockTextItems = [
        { str: "Factura", transform: [0,0,0,0, 10, 100] },
        { str: "DISA Energía Eléctrica", transform: [0,0,0,0, 60, 100] },
        { str: "disagrupo.es", transform: [0,0,0,0, 10, 90] },
        { str: "Término Potencia", transform: [0,0,0,0, 10, 70] },
        { str: "P1", transform: [0,0,0,0, 10, 60] },
        { str: "3,450", transform: [0,0,0,0, 35, 60] },
        { str: "kW", transform: [0,0,0,0, 70, 60] },
        { str: "x", transform: [0,0,0,0, 90, 60] },
        { str: "29", transform: [0,0,0,0, 105, 60] },
        { str: "Días", transform: [0,0,0,0, 125, 60] },
        { str: "x", transform: [0,0,0,0, 155, 60] },
        { str: "P3", transform: [0,0,0,0, 10, 50] },
        { str: "3,450", transform: [0,0,0,0, 35, 50] },
        { str: "kW", transform: [0,0,0,0, 70, 50] },
        { str: "x", transform: [0,0,0,0, 90, 50] },
        { str: "29", transform: [0,0,0,0, 105, 50] },
        { str: "Días", transform: [0,0,0,0, 125, 50] },
        { str: "x", transform: [0,0,0,0, 155, 50] },
        { str: "Término Energía", transform: [0,0,0,0, 10, 40] },
        { str: "P1", transform: [0,0,0,0, 10, 30] },
        { str: "346", transform: [0,0,0,0, 35, 30] },
        { str: "kWh", transform: [0,0,0,0, 65, 30] },
        { str: "P2", transform: [0,0,0,0, 90, 30] },
        { str: "310", transform: [0,0,0,0, 115, 30] },
        { str: "kWh", transform: [0,0,0,0, 145, 30] },
        { str: "P3", transform: [0,0,0,0, 170, 30] },
        { str: "313", transform: [0,0,0,0, 195, 30] },
        { str: "kWh", transform: [0,0,0,0, 225, 30] },
        ...padding
      ];

      window.pdfjsLib.getDocument.mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({ items: mockTextItems }),
            cleanup: () => {},
            getViewport: () => ({ width: 100, height: 100 }),
            render: () => ({ promise: Promise.resolve() })
          }),
          cleanup: () => {},
          destroy: () => {}
        })
      });

      await import('../js/factura-parsers.js');
      await import('../js/factura.js');
      if (window.__LF_bindFacturaParser) window.__LF_bindFacturaParser();

      const fileInput = document.getElementById('fileInputFactura');
      const mockFile = new File(['dummy content'], 'factura-disa.pdf', { type: 'application/pdf' });
      mockFile.arrayBuffer = async () => new ArrayBuffer(10);
      const event = new Event('change', { bubbles: true });
      Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
      fileInput.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 500));

      expect(document.getElementById('confianzaBadge').textContent).toContain('100%');
    }

    it('sin estado previo, autocalcula (regresion)', async () => {
      await subirFacturaAltaConfianza();

      document.getElementById('btnAplicarFactura').click();

      expect(window.runCalculation).toHaveBeenCalled();
    });

    it('"Comparar mi tarifa" activado con campos AUN VACIOS bloquea el autocalculo', async () => {
      await subirFacturaAltaConfianza();
      document.getElementById('compararMiTarifa').checked = true;
      // mtPunta..mtP2 quedan vacios a proposito: el checkbox por si solo ya debe bloquear.

      document.getElementById('btnAplicarFactura').click();

      expect(window.runCalculation).not.toHaveBeenCalled();
      expect(window.setStatus).toHaveBeenCalledWith(expect.stringContaining('Mi tarifa'), 'idle');
    });

    it('"Comparar mi tarifa" activado con precios YA rellenados tambien bloquea (no los mezcla)', async () => {
      await subirFacturaAltaConfianza();
      document.getElementById('compararMiTarifa').checked = true;
      document.getElementById('mtPunta').value = '0,15';
      document.getElementById('mtP1').value = '0,08';

      document.getElementById('btnAplicarFactura').click();

      expect(window.runCalculation).not.toHaveBeenCalled();
      expect(window.setStatus).toHaveBeenCalledWith(expect.stringContaining('Mi tarifa'), 'idle');
    });

    it('solar activo con excedentes/saldo BV de un periodo anterior bloquea el autocalculo', async () => {
      await subirFacturaAltaConfianza();
      document.getElementById('solarOn').checked = true;
      document.getElementById('exTotal').value = '150';
      document.getElementById('bvSaldo').value = '20';

      document.getElementById('btnAplicarFactura').click();

      expect(window.runCalculation).not.toHaveBeenCalled();
      expect(window.setStatus).toHaveBeenCalledWith(expect.stringContaining('excedentes'), 'idle');
    });

    // 15/08/2026, residual detectado por ChatGPT (novena ronda, 4a revision): __LF_applyValues()
    // asigna P1/P2/dias/consumos con el.value = ... directamente, sin disparar 'input', asi que
    // ni markPending() ni state.generation se enteraban de este cambio economico. Si ya habia
    // un calculo en vuelo con los valores VIEJOS, runCalculation() se descartaba en silencio por
    // __LF_CALC_INFLIGHT y el calculo antiguo terminaba limpiando "pending" como si el resultado
    // siguiera vigente, aunque el formulario ya mostrara los datos nuevos de la factura.
    it('aplicar factura bumpea markPending() aunque autocalcule (regresion 15/08/2026)', async () => {
      await subirFacturaAltaConfianza();

      document.getElementById('btnAplicarFactura').click();

      expect(window.runCalculation).toHaveBeenCalled();
      expect(window.markPending).toHaveBeenCalled();
    });

    it('aplicar factura bumpea markPending() incluso cuando el autocalculo queda bloqueado (15/08/2026)', async () => {
      await subirFacturaAltaConfianza();
      document.getElementById('compararMiTarifa').checked = true;

      document.getElementById('btnAplicarFactura').click();

      expect(window.runCalculation).not.toHaveBeenCalled();
      expect(window.markPending).toHaveBeenCalled();
    });
  });
});
