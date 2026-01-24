import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// 1. Mock básico de window y document
global.window = {
  LF: {},
  location: { search: '?utm_source=test' },
  __ALMAX_THEME_KEY: 'test_theme_key'
};

// Mock document.getElementById
// Devuelve un objeto fake { id, value, textContent... } para que no falle al asignar
const mockElement = (id) => ({ id, value: '', textContent: '', className: '', style: {} });
global.document = {
  getElementById: vi.fn((id) => mockElement(id))
};

// 2. Cargar el script
// lf-state.js es una IIFE que usa window y document directamente
const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-state.js'), 'utf8');
const fn = new Function('window', 'document', code);

// Ejecutar el script (esto poblará window.LF)
fn(global.window, global.document);

describe('Gestión de Estado (lf-state.js)', () => {
  const LF = global.window.LF;

  it('Debe exportar constantes globales en window.LF', () => {
    expect(LF.JSON_URL).toBe('tarifas.json');
    expect(LF.LS_KEY).toBe('almax_comparador_v6_inputs');
    expect(LF.THEME_KEY).toBe('test_theme_key');
    expect(LF.DEFAULTS).toBeDefined();
    expect(LF.DEFAULTS.p1).toBe('3,45');
  });

  it('Debe procesar parámetros de URL (SERVER_PARAMS)', () => {
    // Simulamos ?utm_source=test en el setup
    expect(LF.SERVER_PARAMS).toBeDefined();
    expect(LF.SERVER_PARAMS['utm_source']).toBe('test');
  });

  it('Debe inicializar el objeto de estado (state)', () => {
    expect(LF.state).toBeDefined();
    expect(LF.state.filter).toBe('all');
    expect(LF.state.rows).toEqual([]);
  });

  it('Debe inicializar referencias DOM con initElements()', () => {
    // initElements se exporta, así que podemos llamarla
    // El script NO la llama automáticamente al inicio (probablemente espera a DOMContentLoaded en otro sitio)
    // Pero espera... lf-state.js define la funcion pero NO la llama.
    // Solo la exporta.
    
    expect(typeof LF.initElements).toBe('function');

    LF.initElements();

    // Debería haber llamado a document.getElementById un montón de veces
    expect(global.document.getElementById).toHaveBeenCalled();
    
    // Y window.LF.el debería estar poblado
    expect(LF.el).toBeDefined();
    expect(LF.el.btnCalc).toBeDefined();
    expect(LF.el.btnCalc.id).toBe('btnCalc');
    expect(LF.el.inputs.p1).toBeDefined();
  });

  it('Debe tener getters y setters para variables internas', () => {
    // cachedTarifas
    LF.cachedTarifas = ['test'];
    expect(LF.cachedTarifas).toEqual(['test']);

    // baseTarifasCache
    LF.baseTarifasCache = ['base'];
    expect(LF.baseTarifasCache).toEqual(['base']);

    // __LF_tarifasMeta
    LF.__LF_tarifasMeta = { meta: 1 };
    expect(LF.__LF_tarifasMeta).toEqual({ meta: 1 });
  });

});
