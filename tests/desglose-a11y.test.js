import { describe, it, expect } from 'vitest';

// Setup del entorno JSDOM simulado (mismo patrón que tests/desglose.test.js)
document.body.innerHTML = '<div></div>';

window.lfDbg = () => {}; // Mock debug function
window.LF = window.LF || {};
import '../js/lf-config.js';

// Cargar el script a testear
import '../js/desglose-calculo.js';
import '../js/desglose-render.js';
import '../js/desglose-factura.js';

describe('Desglose de Factura — accesibilidad del modal (js/desglose-factura.js)', () => {
  const Desglose = window.__LF_DesgloseFactura;

  const datosMinimos = {
    nombreTarifa: 'Tarifa de prueba',
    potenciaP1: 4, potenciaP2: 4, dias: 30,
    precioP1: 0.1, precioP2: 0.1,
    consumoPunta: 100, consumoLlano: 0, consumoValle: 0,
    precioPunta: 0.1, precioLlano: 0.1, precioValle: 0.1,
    zonaFiscal: 'Península',
    fechaFin: '20/03/2026',
    solarOn: false
  };

  function dispatchTab(target, { shiftKey = false } = {}) {
    const evt = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    (target || document).dispatchEvent(evt);
    return evt;
  }

  it('init() crea el modal con role de diálogo, aria-modal, aria-hidden inicial y nombre accesible', () => {
    Desglose.init();

    const modal = Desglose.modal;
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-hidden')).toBe('true');
    expect(modal.getAttribute('tabindex')).toBe('-1');

    const labelledbyId = modal.getAttribute('aria-labelledby');
    expect(labelledbyId).toBeTruthy();
    const titulo = modal.querySelector(`#${labelledbyId}`);
    expect(titulo).toBeTruthy();
    expect(titulo.textContent).toContain('Desglose de la factura');
  });

  it('abrir() hace visible el modal (aria-hidden=false), mueve el foco al botón cerrar y recuerda el foco previo', () => {
    Desglose.init();

    const opener = document.createElement('button');
    opener.textContent = 'Abrir desglose';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    Desglose.abrir(datosMinimos);

    expect(Desglose.modal.getAttribute('aria-hidden')).toBe('false');
    expect(Desglose._lastFocusedEl).toBe(opener);
    expect(document.activeElement).toBe(Desglose.modal.querySelector('.desglose-close'));

    Desglose.cerrar();
    opener.remove();
  });

  it('cerrar() oculta el modal (aria-hidden=true) y devuelve el foco al elemento que lo abrió', () => {
    Desglose.init();

    const opener = document.createElement('button');
    opener.textContent = 'Abrir desglose';
    document.body.appendChild(opener);
    opener.focus();

    Desglose.abrir(datosMinimos);
    Desglose.cerrar();

    expect(Desglose.modal.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(opener);
    expect(Desglose._lastFocusedEl).toBeNull();

    opener.remove();
  });

  it('Tab atrapa el foco dentro del modal: envuelve del último focuseable al primero', () => {
    Desglose.init();
    Desglose.abrir(datosMinimos);

    // El único focuseable inicial es el botón cerrar; añadimos un segundo
    // focuseable dinámico dentro de .desglose-body para probar el wrap real
    // (Opción B: trampa genérica, no asume que solo existe un botón).
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Más info';
    Desglose.modal.querySelector('.desglose-body').appendChild(link);

    const closeBtn = Desglose.modal.querySelector('.desglose-close');

    link.focus();
    expect(document.activeElement).toBe(link);
    const evtForward = dispatchTab(document, { shiftKey: false });
    expect(evtForward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    closeBtn.focus();
    const evtBackward = dispatchTab(document, { shiftKey: true });
    expect(evtBackward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link);

    Desglose.cerrar();
  });

  it('Tab no hace nada especial cuando el modal está cerrado (no atrapa foco fuera de un diálogo activo)', () => {
    Desglose.init();
    expect(Desglose.modal.classList.contains('active')).toBe(false);

    const outside = document.createElement('button');
    outside.textContent = 'Fuera del modal';
    document.body.appendChild(outside);
    outside.focus();

    const evt = dispatchTab(document, { shiftKey: false });
    expect(evt.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);

    outside.remove();
  });
});
