import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

// Simulamos entorno mínimo
const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const formatMoney = (n) => (Number.isFinite(n) ? n.toFixed(2) : '0.00') + ' €';

global.window = {
  LF: {
    el: { tbody: document.createElement('tbody'), emptyBox: document.createElement('div'), table: document.createElement('table') },
    state: { rows: [], filter: 'all', sort: { key: 'totalNum', dir: 'asc' } },
    escapeHtml,
    formatMoney,
    // Mocks
    createSuccessParticles: vi.fn(),
    initTooltips: vi.fn(),
    bindTooltipElement: vi.fn(),
    updateSortIcons: vi.fn(),
    renderTopChart: vi.fn(),
    renderPvpcInfo: vi.fn(),
    // Helpers
    $: (id) => document.getElementById(id),
    rowTipoBadge: (t) => t,
    formatVsWithBar: (v) => v,
    applyFilters: (r) => r,
    applySort: (r) => r,
    yieldControl: async () => {} // No-op
  },
  document: window.document
};

// Cargar el código de renderizado real para probar su resistencia
const renderCode = fs.readFileSync(path.resolve(__dirname, '../js/lf-render.js'), 'utf8');
const renderFn = new Function('window', renderCode);
renderFn(global.window);

describe('Seguridad e Integridad de Datos (Security Tests)', () => {

  beforeEach(() => {
    // Limpiar DOM
    window.document.body.innerHTML = '<table id="table"><tbody id="tbody"></tbody></table><div id="emptyBox" class="is-hidden"></div>';
    window.LF.el.tbody = document.getElementById('tbody');
    window.LF.el.table = document.getElementById('table');
    window.LF.el.emptyBox = document.getElementById('emptyBox');
    
    // Reset estado
    window.LF.state.rows = [];
  });

  it('XSS: Debe escapar nombres de tarifas maliciosos', async () => {
    const maliciousRow = {
      nombre: '<script>alert("XSS")</script>',
      totalNum: 100,
      total: '100 €'
    };
    
    window.LF.state.rows = [maliciousRow];
    await window.LF.renderTable();

    const html = window.LF.el.tbody.innerHTML;
    
    // Verificamos que NO contenga el script ejecutable
    expect(html).not.toContain('<script>alert("XSS")</script>');
    // Verificamos que SÍ contenga la versión escapada
    expect(html).toContain('&lt;script&gt;alert("XSS")&lt;/script&gt;');
  });

  it.each([
    '"><img src=x onerror=alert(1)>',
    '</span><script>window.__promoPwned = true;<\/script>',
    "' onmouseover='alert(1)",
    '<svg onload=alert(1)>'
  ])('XSS: Debe escapar el texto de promocion (%s)', async (payload) => {
    window.LF.state.rows = [{
      nombre: 'Tarifa con oferta',
      promo: payload,
      totalNum: 100,
      total: '100 €'
    }];
    await window.LF.renderTable();

    const tbody = window.LF.el.tbody;
    // El badge debe existir: el payload no puede impedir que se pinte la etiqueta.
    const badge = tbody.querySelector('.promo-badge');
    expect(badge).not.toBeNull();

    // Y no debe haber ganado ningun nodo ejecutable ni manejador inline.
    expect(tbody.querySelector('img, script, svg')).toBeNull();
    expect(tbody.querySelector('[onerror], [onload], [onmouseover]')).toBeNull();
    expect(window.__promoPwned).toBeUndefined();

    // El texto sobrevive como dato en data-tip, que es lo que leera el tooltip.
    expect(badge.getAttribute('data-tip')).toBe(payload);
  });

  it('XSS: Debe bloquear URLs maliciosas en el botón "Ver oferta"', async () => {
    const maliciousRow = {
      nombre: 'Tarifa Segura',
      webUrl: 'javascript:alert(1)', // Vector de ataque típico
      totalNum: 100,
      total: '100 €'
    };
    
    window.LF.state.rows = [maliciousRow];
    await window.LF.renderTable();

    const link = window.LF.el.tbody.querySelector('a.web');
    // Un esquema peligroso debe bloquear el enlace completamente
    expect(link).toBeNull();
    
    // NOTA: Para mitigar esto, se debería usar una función isValidUrl o CSP.
    // Este test sirve de "canary": si alguien inyecta esto, el navegador lo ejecutará si el usuario hace clic.
    // Vamos a verificar que al menos el atributo title se escapa.
    maliciousRow.webUrl = '"> <img src=x onerror=alert(1)>';
    window.LF.state.rows = [maliciousRow];
    await window.LF.renderTable();
    
    const html = window.LF.el.tbody.innerHTML;
    // JSDOM devuelve el atributo href con las entidades (&quot;) intactas o decodificadas según el parser.
    // Lo CRÍTICO es que la cadena <img no esté "suelta" como tag HTML ejecutable.
    // Verificamos que NO exista el tag img parseado en el DOM
    expect(window.LF.el.tbody.querySelector('img')).toBeNull();
    
    // Verificamos que el href contenga la cadena escapada o al menos que no haya roto el atributo
    // El payload original era: "> <img...
    // Si se escapa bien, el href debe empezar por "&quot;>..." o similar, conteniendo el ataque DENTRO.
    const linkMalicioso = window.LF.el.tbody.querySelector('a.web');
    // URL inválida → no debe renderizarse el enlace
    expect(linkMalicioso).toBeNull();
  });

  it('Robustez: Debe manejar tarifas con campos undefined/null sin explotar', async () => {
    const corruptRow = {
      nombre: null, // Debería ser string
      totalNum: undefined, // Debería ser number
      total: null, // Debería ser string
      potencia: undefined,
      consumo: undefined
    };
    
    window.LF.state.rows = [corruptRow];
    
    // No debe lanzar excepción. toThrow() espera recibir una funcion para invocarla
    // y comprobar si ELLA lanza; aplicado sobre .resolves (el valor ya resuelto, no
    // una funcion) no invoca nada y el matcher queda vacio, pase lo que pase
    // internamente. resolves.toBeUndefined() si protege de verdad: exige que la
    // promesa resuelva sin rechazar y que su valor sea el esperado (renderTable no
    // devuelve nada).
    await expect(window.LF.renderTable()).resolves.toBeUndefined();
    
    const html = window.LF.el.tbody.innerHTML;
    // Verificamos que se renderizó algo (fila vacía o con guiones)
    expect(html).toContain('<tr');
    expect(html).toContain('</td>'); // Celdas cerradas
  });

  it('Integridad: Un state.rows null degrada a tabla vacía sin lanzar', async () => {
    window.LF.state.rows = null; // Estado interno corrupto

    // toThrow() espera una funcion sincrona; aplicado sobre .resolves (el valor YA
    // resuelto) no ejecuta nada. resolves.toBeUndefined() exige que la promesa
    // resuelva sin rechazar (renderTable no devuelve nada).
    await expect(window.LF.renderTable()).resolves.toBeUndefined();

    expect(window.LF.el.tbody.children).toHaveLength(0);
    expect(window.LF.el.table.classList.contains('show')).toBe(false);
    expect(window.LF.el.emptyBox.classList.contains('show')).toBe(true);
  });

});
