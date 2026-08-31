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
        <button id="btnOcrFactura"></button>
        <div id="ctaOcrFactura"></div>
        <div id="loaderFactura" tabindex="-1" style="display:none"></div>
        <div id="resultadoFactura" style="display:none"><h3 id="resultadoFacturaTitulo" tabindex="-1">Datos detectados</h3></div>
        <div id="confianzaBadge"></div>
        <div id="fuenteDatosBadge"></div>
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
    delete window.Tesseract;
    
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
    window.LF.applyCustomTarifaPrices = vi.fn(() => true);
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
    delete window.fetch;
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

  it('al cerrar cancela activamente una tarea PDF pendiente y libera privacidad', async () => {
    let rejectLoading;
    const loadingPromise = new Promise((_, reject) => { rejectLoading = reject; });
    const destroy = vi.fn().mockImplementation(() => {
      rejectLoading(new Error('Worker was destroyed'));
      return Promise.resolve();
    });
    window.pdfjsLib.getDocument.mockReturnValue({ promise: loadingPromise, destroy });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const file = new File(['pendiente'], 'factura-pendiente.pdf', { type: 'application/pdf' });
    file.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [file] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 10));

    document.getElementById('btnCancelarFactura').click();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(window.__LF_FACTURA_BUSY).toBe(false);
    expect(window.__LF_PRIVACY_MODE).toBe(false);
  });

  it('limpia la pagina si se cancela mientras getPage sigue pendiente', async () => {
    let resolvePage;
    const pageCleanup = vi.fn().mockResolvedValue();
    const pagePromise = new Promise(resolve => { resolvePage = resolve; });
    const page = {
      getTextContent: vi.fn(),
      getAnnotations: vi.fn(),
      cleanup: pageCleanup
    };
    const destroy = vi.fn().mockImplementation(() => {
      resolvePage(page);
      return Promise.resolve();
    });
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(() => pagePromise), cleanup: vi.fn() }),
      destroy
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const file = new File(['pagina'], 'factura-pagina-pendiente.pdf', { type: 'application/pdf' });
    file.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [file] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 10));

    document.getElementById('btnCancelarFactura').click();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(pageCleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(page.getTextContent).not.toHaveBeenCalled();
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
    // Reproducción del formato real: QRE2 llega como anotación/enlace embebido del PDF,
    // no necesariamente como un fragmento visible de su contenido de texto.
    const qrUrl = "https://comparador.cnmc.gob.es/comparador/QRE2?pP1=3.450&pP2=2.200&cfP1=111&cfP2=222&cfP3=333&iniF=2025-01-01&finF=2025-01-30";

    const mockTextItems = [
      { str: "Factura", transform: [0,0,0,0, 10, 100] },
      { str: "Endesa Energía S.A.", transform: [0,0,0,0, 60, 100] },

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
          getAnnotations: () => Promise.resolve([{ url: qrUrl }]),
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
    // El QR válido es la fuente de verdad: iniF no está incluida y finF sí, luego
    // el periodo estructurado son 29 días aunque el texto visible diga 31.
    expect(getVal('dias')).toBe('29');
    expect(getVal('consumoPunta')).toBe('111');
    expect(getVal('consumoLlano')).toBe('222');
    expect(getVal('consumoValle')).toBe('333');
    expect(document.getElementById('confianzaBadge').textContent).toContain('100%');
    expect(document.getElementById('avisoFactura').textContent).toContain('periodo detectado en el PDF equivale a 31 días');
    expect(document.getElementById('avisoFactura').textContent).toContain('usamos 29 días');
    expect(document.getElementById('fuenteDatosBadge').textContent).toBe('Enlace CNMC + respaldo PDF');
  });

  it('usa el QR Bonpreu como fuente de verdad y muestra la ficha CNMC sin datos personales', async () => {
    const qrUrl = [
      'https://comparador.cnmc.gob.es/comparador/QRE2?',
      'pP1=3&pP2=3&cfP1=89&cfP2=59&cfP3=80',
      '&iniF=2026-07-15&finF=2026-08-14&fFact=2026-08-25',
      '&com=R2-796&tc=E0&tf=N&finContrato=2027-07-15&finPen=0000-00-00',
      '&rev=0&verde=1&imp=45.04&impPot=14.4&impEner=19.54&impSA=0',
      '&finBS=0.74&impOtrosSinIE=0.8&prP1=29.2&prP2=29.2',
      '&prE1=0.0852&prE2=0.0852&prE3=0.0852&pmaxP1=2.748&pmaxP2=3.108',
      '&cups=ES0021000000000000AA&cp=50420'
    ].join('');
    const padding = Array(8).fill({ str: 'relleno de texto de factura para superar el mínimo', transform: [0,0,0,0, 0, 0] });
    const items = [
      { str: 'Adreça de subministrament: Carrer Major 8 - 1ºD', transform: [0,0,0,0, 10, 100] },
      { str: 'Període facturat. Dies: 30', transform: [0,0,0,0, 10, 90] },
      ...padding
    ];

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        commercializers: {
          'R2-796': {
            name: 'BON PREU, SAU',
            phone: '900 500 005',
            website: 'http://www.bonpreuesclat.cat/ingadjement_en'
          }
        }
      })
    });
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items }),
          getAnnotations: () => Promise.resolve([{ url: qrUrl }]),
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

    const mockFile = new File(['bonpreu'], 'factura-bonpreu.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 500));

    const form = document.getElementById('formValidacionFactura');
    const value = field => form.querySelector(`.input-validacion[data-field="${field}"] input`)?.value;
    expect(value('dias')).toBe('30');
    expect(value('p1')).toBe('3');
    expect(value('consumoPunta')).toBe('89');
    expect(document.getElementById('nombreCompania').textContent).toBe('BON PREU, SAU');

    const card = form.querySelector('.qr-factura-info');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Mercado libre · 3 precios de energía');
    expect(card.textContent).toContain('15/07/2026 – 14/08/2026 · 30 días');
    expect(card.textContent).toContain('45,04');
    expect(card.textContent).toContain('PermanenciaNo');
    expect(card.textContent).toContain('Potencia punta0,08 €/kW·día (equivalente a 29,2 €/kW·año del QR CNMC)');
    expect(card.textContent).toContain('Potencia valle0,08 €/kW·día (equivalente a 29,2 €/kW·año del QR CNMC)');
    expect(card.textContent).toContain('900 500 005');
    expect(card.textContent).not.toContain('ES0021000000000000AA');
    expect(card.textContent).not.toContain('50420');
    const importTarifa = card.querySelector('#usarPreciosQrMiTarifa');
    expect(importTarifa).not.toBeNull();
    expect(importTarifa.checked).toBe(false);
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(window.fetch.mock.calls[0][0]).toContain('data/cnmc-commercializers.json');
    expect(document.getElementById('fuenteDatosBadge').textContent).toBe('Enlace CNMC + respaldo PDF');

    importTarifa.checked = true;
    document.getElementById('btnAplicarFactura').click();
    expect(window.LF.applyCustomTarifaPrices).toHaveBeenCalledWith({
      punta: 0.0852,
      llano: 0.0852,
      valle: 0.0852,
      p1: 0.08,
      p2: 0.08
    });
    expect(window.runCalculation).toHaveBeenCalledTimes(1);
    expect(global.toast).toHaveBeenCalledWith('✅ Datos y precios aplicados como “Mi tarifa”', 'ok');
  });

  // El QR declara prE*/prP* SIN descuentos, pero impEner/impPot SI los incorporan
  it('explica en la ficha por qué un contrato QR no representable no ofrece Mi tarifa', async () => {
    const qrUrl = [
      'https://comparador.cnmc.gob.es/comparador/QRE2?',
      'pP1=3&pP2=3&cfP1=89&cfP2=59&cfP3=80',
      '&iniF=2026-07-15&finF=2026-08-14&fFact=2026-08-25',
      '&com=R2-796&tc=A0&tf=N&finContrato=2027-07-15&finPen=0000-00-00',
      '&rev=0&verde=1&imp=45.04&impPot=14.4&impEner=19.54&impSA=0',
      '&finBS=0.74&impOtrosSinIE=0.8&prP1=29.2&prP2=29.2',
      '&prE1=0.0852&prE2=0.0852&prE3=0.0852'
    ].join('');
    const padding = Array(8).fill({ str: 'relleno de texto de factura para superar el mínimo', transform: [0,0,0,0, 0, 0] });
    const items = [
      { str: 'Període facturat. Dies: 30', transform: [0,0,0,0, 10, 90] },
      ...padding
    ];

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commercializers: { 'R2-796': { name: 'BON PREU, SAU' } } })
    });
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items }),
          getAnnotations: () => Promise.resolve([{ url: qrUrl }]),
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

    const mockFile = new File(['indexada'], 'factura-indexada.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 500));

    const card = document.getElementById('formValidacionFactura').querySelector('.qr-factura-info');
    expect(card.querySelector('#usarPreciosQrMiTarifa')).toBeNull();
    const aviso = card.querySelector('.qr-factura-import-aviso');
    expect(aviso).not.toBeNull();
    expect(aviso.getAttribute('role')).toBe('note');
    expect(aviso.dataset.motivo).toBe('tipo-no-representable');
    expect(aviso.classList.contains('qr-factura-import-aviso--info')).toBe(true);
    expect(aviso.textContent).toContain('Esta modalidad no se puede importar como «Mi tarifa»');
    expect(aviso.textContent).toContain('Los consumos y las potencias de la factura sí se pueden aplicar');
  });

  // (Resolucion CNMC, BOE-A-2022-16989). Mirar solo el campo `dto` no basta: la
  // resolucion permite que el descuento venga ya dentro del importe. Aqui el QR es
  // identico al de Bonpreu salvo impEner, rebajado de 19,54 a 15,54: los precios
  // declarados dan 19,43 EUR de energia, un 25% por encima de lo facturado.
  it('no ofrece importar a "Mi tarifa" si la factura aplica un descuento que el QR no refleja', async () => {
    const qrUrl = [
      'https://comparador.cnmc.gob.es/comparador/QRE2?',
      'pP1=3&pP2=3&cfP1=89&cfP2=59&cfP3=80',
      '&iniF=2026-07-15&finF=2026-08-14&fFact=2026-08-25',
      '&com=R2-796&tc=E0&tf=N&finContrato=2027-07-15&finPen=0000-00-00',
      '&rev=0&verde=1&imp=41.04&impPot=14.4&impEner=15.54&impSA=0',
      '&finBS=0.74&impOtrosSinIE=0.8&prP1=29.2&prP2=29.2',
      '&prE1=0.0852&prE2=0.0852&prE3=0.0852&pmaxP1=2.748&pmaxP2=3.108'
    ].join('');
    const padding = Array(8).fill({ str: 'relleno de texto de factura para superar el mínimo', transform: [0,0,0,0, 0, 0] });
    const items = [
      { str: 'Adreça de subministrament: Carrer Major 8 - 1ºD', transform: [0,0,0,0, 10, 100] },
      { str: 'Període facturat. Dies: 30', transform: [0,0,0,0, 10, 90] },
      ...padding
    ];

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commercializers: { 'R2-796': { name: 'BON PREU, SAU' } } })
    });
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items }),
          getAnnotations: () => Promise.resolve([{ url: qrUrl }]),
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

    const mockFile = new File(['descuento'], 'factura-con-descuento.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 500));

    const card = document.getElementById('formValidacionFactura').querySelector('.qr-factura-info');
    expect(card).not.toBeNull();
    // La ficha sigue mostrandose entera: lo que se retira es solo la importacion.
    expect(card.textContent).toContain('BON PREU, SAU');
    expect(card.querySelector('#usarPreciosQrMiTarifa')).toBeNull();
    expect(card.querySelector('.qr-factura-import-aviso')).not.toBeNull();
    expect(card.textContent).toContain('aplica un descuento');
    // Los datos de consumo/potencia del QR SI son validos: no se toca la confianza.
    expect(document.getElementById('confianzaBadge').textContent).toContain('100%');
  });

  // Un corte transitorio de red no puede dejar la pestana sin censo hasta recargar:
  // la promesa fallida se purga para que el siguiente procesamiento reintente.
  // Mismo patron que __pvpcLoadMonth en index-extra.js (auditoria del 10/07/2026).
  it('reintenta el censo CNMC en la siguiente factura si el primer fetch falla', async () => {
    vi.resetModules();
    const qrUrl = [
      'https://comparador.cnmc.gob.es/comparador/QRE2?',
      'pP1=3&pP2=3&cfP1=89&cfP2=59&cfP3=80',
      '&iniF=2026-07-15&finF=2026-08-14&fFact=2026-08-25',
      '&com=R2-796&tc=E0&tf=N&finContrato=2027-07-15&finPen=0000-00-00',
      '&rev=0&verde=1&imp=45.04&impPot=14.4&impEner=19.54&impSA=0',
      '&prP1=29.2&prP2=29.2&prE1=0.0852&prE2=0.0852&prE3=0.0852'
    ].join('');
    const padding = Array(8).fill({ str: 'relleno de texto de factura para superar el mínimo', transform: [0,0,0,0, 0, 0] });
    const items = [
      { str: 'Període facturat. Dies: 30', transform: [0,0,0,0, 10, 90] },
      ...padding
    ];

    let llamadas = 0;
    window.fetch = vi.fn().mockImplementation(() => {
      llamadas += 1;
      if (llamadas === 1) return Promise.reject(new Error('red caida'));
      return Promise.resolve({
        ok: true,
        json: async () => ({ commercializers: { 'R2-796': { name: 'BON PREU, SAU' } } })
      });
    });
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items }),
          getAnnotations: () => Promise.resolve([{ url: qrUrl }]),
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

    const procesar = async nombre => {
      const file = new File([nombre], `${nombre}.pdf`, { type: 'application/pdf' });
      file.arrayBuffer = async () => new ArrayBuffer(10);
      const ev = new Event('change', { bubbles: true });
      Object.defineProperty(ev, 'target', { value: { files: [file] } });
      document.getElementById('fileInputFactura').dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 500));
    };

    await procesar('primera');
    // Primer intento: el censo no carga, la ficha sale sin nombre de comercializadora.
    expect(llamadas).toBe(1);
    expect(document.getElementById('nombreCompania').textContent).not.toBe('BON PREU, SAU');

    await procesar('segunda');
    // Sin la purga del catch, aqui NO habria segundo fetch y el nombre no aparaceria nunca.
    expect(llamadas).toBe(2);
    expect(document.getElementById('nombreCompania').textContent).toBe('BON PREU, SAU');
  });

  // `cambio=1` = cambio de precios DENTRO del periodo facturado (Resolucion CNMC):
  // prE*/prP* traen el precio actualizado, pero impEner/impPot suman los dos tramos.
  // El contraste no puede distinguir eso de un descuento, asi que no debe acusar de
  // descuento a quien solo cambio de precio. Detectado por ChatGPT el 25/08/2026.
  it('no confunde un cambio de precios a mitad de periodo con un descuento', async () => {
    const qrUrl = [
      'https://comparador.cnmc.gob.es/comparador/QRE2?',
      'pP1=3&pP2=3&cfP1=89&cfP2=59&cfP3=80',
      '&iniF=2026-07-15&finF=2026-08-14&fFact=2026-08-25',
      '&com=R2-796&tc=E0&tf=N&cambio=1',
      '&rev=0&verde=1&imp=41.04&impPot=14.4&impEner=15.54&impSA=0',
      '&prP1=29.2&prP2=29.2&prE1=0.0852&prE2=0.0852&prE3=0.0852'
    ].join('');
    const padding = Array(8).fill({ str: 'relleno de texto de factura para superar el mínimo', transform: [0,0,0,0, 0, 0] });
    const items = [
      { str: 'Període facturat. Dies: 30', transform: [0,0,0,0, 10, 90] },
      ...padding
    ];

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commercializers: { 'R2-796': { name: 'BON PREU, SAU' } } })
    });
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items }),
          getAnnotations: () => Promise.resolve([{ url: qrUrl }]),
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

    const mockFile = new File(['cambio'], 'factura-cambio-precios.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 500));

    const card = document.getElementById('formValidacionFactura').querySelector('.qr-factura-info');
    expect(card.querySelector('#usarPreciosQrMiTarifa')).toBeNull();
    const aviso = card.querySelector('.qr-factura-import-aviso');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('cambio de precios a mitad del periodo');
    // Lo importante: NO se le dice al usuario que tiene un descuento.
    expect(aviso.textContent).not.toContain('descuento');
  });

  // Bordes del contraste QR/importes, cerrados el 25/08/2026 tras la revision cruzada.
  // Se ejercita el helper directamente: montar un PDF por caso multiplicaria el tiempo
  // de la suite sin anadir cobertura sobre la regla, que es lo que se quiere fijar.
  describe('coherencia entre precios declarados e importes del QR (bordes)', () => {
    const PRECIOS = { punta: 0.1, llano: 0.1, valle: 0.1, p1: 0.08, p2: 0.08 };
    const base = extra => ({
      consumoPunta: 100, consumoLlano: 100, consumoValle: 100,
      p1: 3, p2: 3, dias: 30,
      qrInfo: {
        fechaInicio: '2026-07-15', fechaFin: '2026-08-14',
        importeEnergia: 30, importePotencia: 14.4,
        ...extra
      }
    });

    const evaluar = datos => window.__LF_facturaQrHelpers.qrPricesMatchDeclaredAmounts(datos, PRECIOS);

    it('acepta el caso limpio', () => {
      expect(evaluar(base()).coherente).toBe(true);
    });

    it('un importe de energia a 0 con energia calculada positiva ES un descuento, no un dato incontrastable', () => {
      const r = evaluar(base({ importeEnergia: 0 }));
      expect(r.coherente).toBe(false);
      expect(r.motivo).toBe('descuento-no-reflejado');
    });

    it('no convierte una magnitud ausente en cero', () => {
      // Sin consumos no hay contraste de energia posible: null, no "0 EUR calculados".
      const datos = { ...base(), consumoPunta: null, consumoLlano: null, consumoValle: null };
      const r = evaluar(datos);
      expect(r.energiaOk).toBeNull();
      expect(r.coherente).toBe(true);
    });

    it('no valida la potencia con dias recuperados del PDF si el QR no trae periodo propio', () => {
      // impPot declarado imposible (100 EUR): si se contrastara, bloquearia. Como el QR
      // no aporta periodo, los dias son del PDF y ese termino queda sin contrastar.
      const datos = base({ fechaInicio: null, fechaFin: null, importePotencia: 100 });
      const r = evaluar(datos);
      expect(r.potenciaOk).toBeNull();
      expect(r.coherente).toBe(true);
    });

    it('un importe ausente no se lee como 0 ni, por tanto, como descuento', () => {
      // Number(null) daria 0 y, frente a 30 EUR calculados, se leeria como descuento.
      // La ausencia de evidencia no puede convertirse en evidencia de descuento.
      const r = evaluar(base({ importeEnergia: null }));
      expect(r.energiaOk).toBeNull();
      expect(r.coherente).toBe(true);
    });

    // La DIRECCION del desvio importa: un descuento solo puede hacer que se facture
    // MENOS de lo que los precios explican. Casos reales del 25/08/2026: Endesa
    // declara mas energia de la calculada, y el QR de Octopus publica prP en
    // EUR/kW/dia en vez de EUR/kW/anyo, lo que hunde el calculo.
    it('no llama descuento a una factura que cobra MAS de lo que los precios explican', () => {
      // calculado 30 EUR < declarado 40 EUR: un descuento haria justo lo contrario.
      const r = evaluar(base({ importeEnergia: 40 }));
      expect(r.coherente).toBe(false);
      expect(r.motivo).toBe('qr-incoherente');
      expect(r.energiaOk).toBe('incoherente');
    });

    it('sigue detectando el descuento cuando se factura MENOS de lo calculado', () => {
      const r = evaluar(base({ importeEnergia: 20 }));
      expect(r.motivo).toBe('descuento-no-reflejado');
      expect(r.energiaOk).toBe('descuento');
    });

    // Plenitude (25/08/2026): impPot solo cuadra con los 32 dias del PDF, no con los
    // 31 que declara el QR. Es la discrepancia de dias ya conocida y avisada aparte,
    // no un descuento: si UNO de los dos recuentos reproduce el importe, vale.
    it('acepta la potencia si cuadra con los dias del PDF aunque no con los del QR', () => {
      // 3 kW x 2 x 0,08 EUR/kW/dia = 0,48 EUR/dia -> 30 dias = 14,4 ; 32 dias = 15,36
      const datos = { ...base({ importePotencia: 15.36 }), dias: 30, diasDetectadosPdf: 32 };
      const r = evaluar(datos);
      expect(r.potenciaOk).toBe('ok');
      expect(r.coherente).toBe(true);
    });

    // Si los periodos son incompatibles (PDF con varias facturas), los dias del PDF
    // son de OTRA factura: no pueden legitimar los precios de esta.
    it('no usa los dias del PDF como recuento alternativo si los periodos son incompatibles', () => {
      const datos = {
        ...base({ importePotencia: 15.36 }),
        dias: 30,
        diasDetectadosPdf: 32,
        periodoQrPdfDiscrepante: true
      };
      const r = evaluar(datos);
      expect(r.potenciaOk).not.toBe('ok');
      expect(r.coherente).toBe(false);
    });

    it('si no cuadra con ninguno de los dos recuentos, sigue bloqueando', () => {
      const datos = { ...base({ importePotencia: 40 }), dias: 30, diasDetectadosPdf: 32 };
      expect(evaluar(datos).coherente).toBe(false);
    });

    it('fija el umbral: 1% pasa y 3% bloquea', () => {
      // energia calculada = 30 EUR exactos
      expect(evaluar(base({ importeEnergia: 30 / 1.01 })).coherente).toBe(true);
      expect(evaluar(base({ importeEnergia: 30 / 1.03 })).coherente).toBe(false);
    });
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

  it('no mezcla campos de dos facturas textuales en páginas distintas ni permite autocálculo', async () => {
    const padding = Array(6).fill({ str: 'relleno de texto para superar el minimo de extraccion', transform: [0,0,0,0, 0, 0] });
    const pages = {
      1: [
        { str: 'Factura suministro A', transform: [0,0,0,0, 10, 100] },
        { str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0, 10, 90] },
        { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0, 10, 80] },
        { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0, 10, 70] },
        ...padding
      ],
      2: [
        { str: 'Factura suministro B', transform: [0,0,0,0, 10, 100] },
        { str: 'Periodo de facturación: del 01/02/2026 al 28/02/2026', transform: [0,0,0,0, 10, 90] },
        { str: 'Potencia contratada P1: 5,75 kW', transform: [0,0,0,0, 10, 80] },
        { str: 'Potencia contratada P2: 6,90 kW', transform: [0,0,0,0, 10, 70] },
        { str: 'Consumo P1: 400 kWh', transform: [0,0,0,0, 10, 60] },
        { str: 'Consumo P2: 500 kWh', transform: [0,0,0,0, 10, 50] },
        { str: 'Consumo P3: 600 kWh', transform: [0,0,0,0, 10, 40] },
        ...padding
      ]
    };
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: (pageNum) => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: pages[pageNum] }),
          getAnnotations: () => Promise.resolve([]), cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() })
        }), cleanup: () => {}
      }), destroy: () => Promise.resolve()
    });
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();
    const mockFile = new File(['dummy'], 'dos-facturas-texto.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(r => setTimeout(r, 500));
    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => form.querySelector(`.input-validacion[data-field="${field}"] input`)?.value ?? null;
    expect(getVal('p1')).toBe(''); expect(getVal('p2')).toBe(''); expect(getVal('dias')).toBe('');
    expect(getVal('consumoPunta')).toBe(''); expect(getVal('consumoLlano')).toBe(''); expect(getVal('consumoValle')).toBe('');
    expect(document.getElementById('confianzaBadge').textContent).toContain('0%');
    expect(document.getElementById('avisoFactura').textContent).toContain('varias facturas');
    expect(document.getElementById('avisoFactura').textContent).not.toContain('puedes leerlo con OCR');
    document.getElementById('btnAplicarFactura').click();
    expect(window.runCalculation).not.toHaveBeenCalled();
  });

  async function processFacturaPages(pages, filename) {
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: Object.keys(pages).length,
        getPage: (pageNum) => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: pages[pageNum] }), getAnnotations: () => Promise.resolve([]), cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() })
        }), cleanup: () => {}
      }), destroy: () => Promise.resolve()
    });
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();
    const file = new File(['dummy'], filename, { type: 'application/pdf' });
    file.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [file] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  function facturaValues() {
    const form = document.getElementById('formValidacionFactura');
    return (field) => form.querySelector(`.input-validacion[data-field="${field}"] input`)?.value ?? null;
  }

  it('LF-FAC-001b bloquea potencias de una factura con reparto completo de otra', async () => {
    const padding = Array(6).fill({ str: 'relleno para superar el minimo de extraccion', transform: [0,0,0,0,0,0] });
    await processFacturaPages({
      1: [{ str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0,0,0] }, ...padding],
      2: [{ str: 'Periodo de facturación: del 01/02/2026 al 28/02/2026', transform: [0,0,0,0,0,0] }, { str: 'Consumo P1: 400 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P2: 500 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P3: 600 kWh', transform: [0,0,0,0,0,0] }, ...padding]
    }, 'lf-fac-001b.pdf');
    const get = facturaValues();
    expect(get('p1')).toBe(''); expect(get('p2')).toBe(''); expect(get('dias')).toBe('');
    expect(get('consumoPunta')).toBe(''); expect(get('consumoLlano')).toBe(''); expect(get('consumoValle')).toBe('');
    expect(document.getElementById('confianzaBadge').textContent).toContain('0%');
    expect(document.getElementById('avisoFactura').textContent).toContain('varias facturas');
    document.getElementById('btnAplicarFactura').click();
    expect(window.runCalculation).not.toHaveBeenCalled();
  });

  it('LF-FAC-001b bloquea el caso simétrico de reparto completo y potencias de periodos distintos', async () => {
    const padding = Array(6).fill({ str: 'relleno para superar el minimo de extraccion', transform: [0,0,0,0,0,0] });
    await processFacturaPages({
      1: [{ str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0,0,0] }, { str: 'Consumo P1: 400 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P2: 500 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P3: 600 kWh', transform: [0,0,0,0,0,0] }, ...padding],
      2: [{ str: 'Periodo de facturación: del 01/02/2026 al 28/02/2026', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0,0,0] }, ...padding]
    }, 'lf-fac-001b-simetrico.pdf');
    const get = facturaValues();
    expect(get('p1')).toBe(''); expect(get('p2')).toBe(''); expect(get('dias')).toBe('');
    expect(get('consumoPunta')).toBe(''); expect(get('consumoLlano')).toBe(''); expect(get('consumoValle')).toBe('');
    expect(document.getElementById('confianzaBadge').textContent).toContain('0%');
    expect(document.getElementById('avisoFactura').textContent).toContain('varias facturas');
    document.getElementById('btnAplicarFactura').click();
    expect(window.runCalculation).not.toHaveBeenCalled();
  });

  it('LF-FAC-001b acepta piezas complementarias de una misma factura', async () => {
    const padding = Array(6).fill({ str: 'relleno para superar el minimo de extraccion', transform: [0,0,0,0,0,0] });
    await processFacturaPages({
      1: [{ str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0,0,0] }, ...padding],
      2: [{ str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0,0,0] }, { str: 'Consumo P1: 100 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P2: 50 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P3: 25 kWh', transform: [0,0,0,0,0,0] }, ...padding]
    }, 'factura-mismo-periodo-piezas-complementarias.pdf');
    const get = facturaValues();
    expect(get('p1')).toBe('3,45'); expect(get('p2')).toBe('4,6');
    expect(get('consumoPunta')).toBe('100'); expect(get('consumoLlano')).toBe('50'); expect(get('consumoValle')).toBe('25');
    expect(document.getElementById('confianzaBadge').textContent).toContain('100%');
    expect(document.getElementById('avisoFactura').textContent).not.toContain('varias facturas');
  });

  it('LF-FAC-001b no bloquea una página histórica incompleta de otro periodo', async () => {
    const padding = Array(6).fill({ str: 'relleno para superar el minimo de extraccion', transform: [0,0,0,0,0,0] });
    await processFacturaPages({
      1: [{ str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0,0,0] }, { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0,0,0] }, { str: 'Consumo P1: 100 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P2: 50 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P3: 25 kWh', transform: [0,0,0,0,0,0] }, ...padding],
      2: [{ str: 'Periodo: del 01/12/2025 al 31/12/2025', transform: [0,0,0,0,0,0] }, { str: 'Consumo P1: 90 kWh', transform: [0,0,0,0,0,0] }, { str: 'Consumo P2: 40 kWh', transform: [0,0,0,0,0,0] }, ...padding]
    }, 'factura-historico-incompleto.pdf');
    const get = facturaValues();
    expect(get('p1')).toBe('3,45'); expect(get('p2')).toBe('4,6');
    expect(get('consumoPunta')).toBe('100'); expect(get('consumoLlano')).toBe('50'); expect(get('consumoValle')).toBe('25');
    expect(document.getElementById('confianzaBadge').textContent).toContain('100%');
    expect(document.getElementById('avisoFactura').textContent).not.toContain('varias facturas');
  });

  it('OCR tampoco mezcla campos de dos facturas escaneadas en páginas distintas', async () => {
    const pages = {
      1: { text: ['FACTURA A', 'Periodo de facturacion: 01/01/2026 - 31/01/2026', 'Potencia contratada Punta: 3,45 kW', 'Potencia contratada Valle: 4,60 kW'].join('\n') },
      2: { text: ['FACTURA B', 'Periodo de facturacion: 01/02/2026 - 28/02/2026', 'Consumo Punta: 400 kWh', 'Consumo Llano: 500 kWh', 'Consumo Valle: 600 kWh'].join('\n') }
    };
    const mockPage = () => ({
      getTextContent: () => Promise.resolve({ items: [] }), getAnnotations: () => Promise.resolve([]), cleanup: () => {},
      getViewport: ({ scale = 1 } = {}) => ({ width: 100 * scale, height: 100 * scale }), render: () => ({ promise: Promise.resolve() })
    });
    window.pdfjsLib.getDocument.mockImplementation(() => ({
      promise: Promise.resolve({ numPages: 2, getPage: (pageNum) => Promise.resolve(mockPage(pageNum)), cleanup: () => {} }), destroy: () => Promise.resolve()
    }));
    const recognize = vi.fn().mockResolvedValueOnce({ data: { text: pages[1].text } }).mockResolvedValueOnce({ data: { text: pages[2].text } });
    const terminate = vi.fn().mockResolvedValue();
    window.Tesseract = { createWorker: vi.fn().mockResolvedValue({ recognize, terminate }) };
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();
    const mockFile = new File(['scan'], 'dos-facturas-ocr.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(r => setTimeout(r, 500));
    document.getElementById('btnOcrFactura').click();
    await new Promise(r => setTimeout(r, 500));
    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => form.querySelector(`.input-validacion[data-field="${field}"] input`)?.value ?? null;
    expect(window.Tesseract.createWorker).toHaveBeenCalledTimes(1);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(getVal('p1')).toBe(''); expect(getVal('p2')).toBe(''); expect(getVal('dias')).toBe('');
    expect(getVal('consumoPunta')).toBe(''); expect(getVal('consumoLlano')).toBe(''); expect(getVal('consumoValle')).toBe('');
    expect(document.getElementById('confianzaBadge').textContent).toContain('0%');
    expect(document.getElementById('avisoFactura').textContent).toContain('varias facturas');
    document.getElementById('btnAplicarFactura').click();
    expect(window.runCalculation).not.toHaveBeenCalled();
  });

  it('no bloquea dos páginas de una misma factura cuando comparten periodo', async () => {
    const padding = Array(6).fill({ str: 'relleno de texto para superar el minimo de extraccion', transform: [0,0,0,0, 0, 0] });
    const pages = {
      1: [
        { str: 'Factura, página 1', transform: [0,0,0,0, 10, 100] },
        { str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0, 10, 90] },
        { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0, 10, 80] },
        { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0, 10, 70] },
        ...padding
      ],
      2: [
        { str: 'Factura, página 2', transform: [0,0,0,0, 10, 100] },
        { str: 'Periodo de facturación: del 01/01/2026 al 31/01/2026', transform: [0,0,0,0, 10, 90] },
        { str: 'Potencia contratada P1: 3,45 kW', transform: [0,0,0,0, 10, 80] },
        { str: 'Potencia contratada P2: 4,60 kW', transform: [0,0,0,0, 10, 70] },
        { str: 'Consumo P1: 100 kWh', transform: [0,0,0,0, 10, 60] },
        { str: 'Consumo P2: 50 kWh', transform: [0,0,0,0, 10, 50] },
        { str: 'Consumo P3: 25 kWh', transform: [0,0,0,0, 10, 40] },
        ...padding
      ]
    };
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: (pageNum) => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: pages[pageNum] }), getAnnotations: () => Promise.resolve([]), cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() })
        }), cleanup: () => {}
      }), destroy: () => Promise.resolve()
    });
    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();
    const mockFile = new File(['dummy'], 'una-factura-dos-paginas.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    document.getElementById('fileInputFactura').dispatchEvent(event);
    await new Promise(r => setTimeout(r, 500));
    const form = document.getElementById('formValidacionFactura');
    const getVal = (field) => form.querySelector(`.input-validacion[data-field="${field}"] input`)?.value ?? null;
    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('4,6');
    expect(getVal('consumoPunta')).toBe('100');
    expect(getVal('consumoLlano')).toBe('50');
    expect(getVal('consumoValle')).toBe('25');
    expect(document.getElementById('avisoFactura').textContent).not.toContain('varias facturas');
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
    expect(document.getElementById('fuenteDatosBadge').textContent).toBe('QR CNMC + respaldo PDF');
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

  // Auditoría temática de importaciones 24/08/2026: integración PDF → formulario.
  // Ronda 15 (27/08/2026): fija el contrato de `__LF_normNum` desde el consumidor, no desde
  // el parser. El modal acepta 0 como valor VALIDO en p1 y en los tres consumos (`< 0` es lo
  // que rechaza; P1 puede ser 0 kW en un segundo suministro). Si `__LF_normNum` devolviera 0
  // en vez de null ante un texto ilegible, ese campo pasaria los guards y se aplicaria en
  // silencio un consumo de cero. Con null, se marca en rojo y no se aplica nada.
  it('un consumo ilegible en el modal marca error y no aplica ningun valor', async () => {
    await processFacturaPages({ 1: [
      { str: 'Potencia contratada P1 4,6 kW', transform: [0,0,0,0, 10, 100] },
      { str: 'Potencia contratada P2 4,6 kW', transform: [0,0,0,0, 10, 90] },
      { str: 'Periodo de facturacion: 30 dias', transform: [0,0,0,0, 10, 80] },
      { str: 'Consumo P1 100 kWh', transform: [0,0,0,0, 10, 70] },
      { str: 'Consumo P2 90 kWh', transform: [0,0,0,0, 10, 60] },
      { str: 'Consumo P3 160 kWh', transform: [0,0,0,0, 10, 50] },
      ...Array(6).fill({ str: 'relleno de texto para superar el minimo del extractor', transform: [0,0,0,0, 0, 0] })
    ] }, 'factura-consumo-ilegible.pdf');

    const form = document.getElementById('formValidacionFactura');
    const campo = (f) => form.querySelector(`.input-validacion[data-field="${f}"] input`);
    // Todo valido salvo el consumo punta, que queda ilegible.
    campo('p1').value = '4,6';
    campo('p2').value = '4,6';
    campo('dias').value = '30';
    campo('consumoPunta').value = 'abc';
    campo('consumoLlano').value = '90';
    campo('consumoValle').value = '160';

    // El formulario principal esta vacio antes de aplicar.
    const principal = (id) => document.getElementById(id).value;
    expect(principal('cPunta')).toBe('');

    document.getElementById('btnAplicarFactura').click();

    // Lo observable es que NO se copia ningun valor al formulario principal: si
    // __LF_normNum devolviera 0 ante "abc", ese campo pasaria los guards del modal
    // (que aceptan 0 como valido) y se aplicaria un consumo de cero en silencio.
    expect(principal('cPunta'), 'no debe copiarse el consumo ilegible').toBe('');
    expect(principal('p1'), 'no debe copiarse NADA si un campo es invalido').toBe('');
    expect(principal('cLlano')).toBe('');
    // Y el campo queda marcado en rojo para que el usuario lo vea.
    const marcado = form.querySelector('.input-validacion[data-field="consumoPunta"]');
    expect(marcado?.className || '').toMatch(/err/i);
  });

  it('una rectificativa deja vacíos los consumos negativos y muestra una advertencia explícita', async () => {
    const line = (str, y) => ({ str, transform: [0, 0, 0, 0, 10, y] });
    const items = [
      line('Factura eléctrica de prueba sintética', 120),
      line('Periodo de facturación: 01/01/2026 - 31/01/2026', 110),
      line('Potencia contratada P1 3,45 kW P2 3,45 kW', 100),
      line('Consumo P1 -100 kWh', 90),
      line('Consumo P2 -20 kWh', 80),
      line('Consumo P3 -30 kWh', 70),
      line('Texto de relleno sintético sin datos personales para superar el mínimo de texto seleccionable.', 60)
    ];

    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items }),
          getAnnotations: () => Promise.resolve([]),
          cleanup: () => {},
          getViewport: ({ scale = 1 } = {}) => ({ width: 100 * scale, height: 100 * scale }),
          render: () => ({ promise: Promise.resolve() })
        }),
        cleanup: () => {}
      }),
      destroy: () => Promise.resolve()
    });

    await import('../js/factura-parsers.js');
    await import('../js/factura.js');
    window.__LF_bindFacturaParser?.();

    const fileInput = document.getElementById('fileInputFactura');
    const mockFile = new File(['synthetic'], 'rectificativa-sintetica.pdf', { type: 'application/pdf' });
    mockFile.arrayBuffer = async () => new ArrayBuffer(10);
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: { files: [mockFile] } });
    fileInput.dispatchEvent(event);

    await new Promise(resolve => setTimeout(resolve, 250));

    expect(document.getElementById('val_consumoPunta')?.value).toBe('');
    expect(document.getElementById('val_consumoLlano')?.value).toBe('');
    expect(document.getElementById('val_consumoValle')?.value).toBe('');
    expect(document.getElementById('avisoFactura')?.textContent).toMatch(/cantidades de consumo negativas/i);
  });
});
