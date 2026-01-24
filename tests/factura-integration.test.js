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
    
    // Mock PDF.js
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      VerbosityLevel: { ERRORS: 0 },
      getDocument: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Debe procesar un PDF simulado y rellenar el formulario correctamente', async () => {
    // 2. Mockear el contenido del PDF
    const mockTextItems = [
      // Y=100: Cabecera
      { str: "Factura", transform: [0,0,0,0, 10, 100] },
      { str: "Endesa", transform: [0,0,0,0, 60, 100] },
      
      // Y=80: Periodo
      { str: "Periodo:", transform: [0,0,0,0, 10, 80] },
      { str: "01/01/2025", transform: [0,0,0,0, 60, 80] },
      { str: "al", transform: [0,0,0,0, 120, 80] },
      { str: "31/01/2025", transform: [0,0,0,0, 140, 80] },

      // Y=60: Potencias
      { str: "Potencia", transform: [0,0,0,0, 10, 60] },
      { str: "Punta:", transform: [0,0,0,0, 60, 60] },
      { str: "3,45", transform: [0,0,0,0, 100, 60] }, // Valor esperado P1
      { str: "kW", transform: [0,0,0,0, 140, 60] },
      { str: "Valle:", transform: [0,0,0,0, 160, 60] },
      { str: "4,00", transform: [0,0,0,0, 200, 60] }, // Valor esperado P2
      { str: "kW", transform: [0,0,0,0, 240, 60] },

      // Y=40: Consumos
      { str: "Energía", transform: [0,0,0,0, 10, 40] },
      { str: "Punta", transform: [0,0,0,0, 50, 40] },
      { str: "120,50", transform: [0,0,0,0, 100, 40] }, // Valor esperado Consumo P1
      { str: "kWh", transform: [0,0,0,0, 140, 40] },
    ];

    // Configurar el mock de getDocument para devolver estos items
    window.pdfjsLib.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({
          getTextContent: () => Promise.resolve({ items: mockTextItems }),
          cleanup: () => {},
          getViewport: () => ({ width: 100, height: 100 }) // Dummy
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
    // Como no tenemos acceso a la promesa interna de processPdf, esperamos un poco
    await new Promise(r => setTimeout(r, 100));

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
});
