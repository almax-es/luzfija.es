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
        <div id="uploadAreaFactura"></div>
        <input type="file" id="fileInputFactura" />
        <button id="btnSubirFactura"></button>
        <button id="btnAplicarFactura"></button>
        <div id="loaderFactura" style="display:none"></div>
        <div id="resultadoFactura" style="display:none"></div>
        <div id="confianzaBadge"></div>
        <div id="companiaDetectada"></div>
        <div id="nombreCompania"></div>
        <div id="avisoFactura"></div>
        <form id="formValidacionFactura"></form>
      </div>
    `;
    
    // Resetear estado global si existe
    window.__LF_facturaParserLoaded = false;
    window.__LF_lastFile = null;
    window.__LF_DEBUG = true; // ACTIVAR DEBUG
    
    // Mock PDF.js
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      VerbosityLevel: { ERRORS: 0 },
      getDocument: vi.fn()
    };

    // Mock jsQR para evitar carga de script externo que cuelga JSDOM
    window.jsQR = vi.fn(() => null); // Retorna null (no QR encontrado)
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
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
    expect(getVal('dias')).toBe('30'); // 01/01 a 31/01 son 30 o 31 días según lógica interna (inclusive vs diff)
    // Nota: El parser interno suele calcular dias = diff ms / day_ms. 
    // 31-1 = 30 días. A veces suma 1. Verifiquemos qué sale.
    
    expect(getVal('consumoPunta')).toBe('120,5');
    
    // Verificar compañía
    const cia = document.getElementById('nombreCompania');
    expect(cia.textContent).toContain('Endesa');
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

    // Valores del QR (no los del texto PDF)
    expect(getVal('p1')).toBe('3,45');
    expect(getVal('p2')).toBe('2,2');
    expect(getVal('dias')).toBe('29');
    expect(getVal('consumoPunta')).toBe('111');
    expect(getVal('consumoLlano')).toBe('222');
    expect(getVal('consumoValle')).toBe('333');
  });
});
