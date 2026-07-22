/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */


/** Ciclo de vida y accesibilidad del modal de desglose. */
(function() {
  'use strict';

  const FOCUSABLE_SELECTOR = 'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

  // No filtramos por offsetWidth/offsetHeight: en JSDOM (tests) el layout real
  // no existe y esos valores siempre son 0, lo que vaciaria la lista incluso
  // con el modal visible. El estado real de ocultamiento pasa por display/visibility.
  function getFocusables(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
      if (el.hidden) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  const Desglose = window.__LF_DesgloseFactura = window.__LF_DesgloseFactura || {};
  Object.assign(Desglose, {
    overlay: null,
    modal: null,
    _openSeq: 0,
    _lastFocusedEl: null,

    init() {
      this.overlay = document.createElement('div');
      this.overlay.className = 'desglose-overlay';

      this.modal = document.createElement('div');
      this.modal.className = 'desglose-modal';
      this.modal.setAttribute('role', 'dialog');
      this.modal.setAttribute('aria-modal', 'true');
      this.modal.setAttribute('aria-hidden', 'true');
      this.modal.setAttribute('aria-labelledby', 'desglose-titulo');
      this.modal.setAttribute('tabindex', '-1');
      this.modal.innerHTML = `
        <div class="desglose-header">
          <h2 id="desglose-titulo">📋 Desglose de la factura</h2>
          <button class="desglose-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="desglose-content">
          <div class="desglose-info">
            <div class="desglose-tarifa"></div>
            <div class="desglose-periodo"></div>
            <div class="desglose-requisitos" style="display:none;"></div>
          </div>
          <div class="desglose-body"></div>
        </div>
      `;

      document.body.appendChild(this.overlay);
      document.body.appendChild(this.modal);

      this.overlay.addEventListener('click', () => this.cerrar());
      this.modal.querySelector('.desglose-close').addEventListener('click', () => this.cerrar());

      document.addEventListener('keydown', (e) => {
        if (!this.modal.classList.contains('active')) return;

        if (e.key === 'Escape') {
          this.cerrar();
          return;
        }

        if (e.key === 'Tab') {
          const focusables = getFocusables(this.modal);
          if (!focusables.length) {
            e.preventDefault();
            this.modal.focus();
            return;
          }
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });

      // `lfDbg` es un global que exporta lf-utils.js. Si ese fichero no llego a
      // cargarse, la referencia desnuda lanzaria ReferenceError y tumbaria el
      // init del modal. Mismo patron defensivo que en lf-csv-utils.js.
      if (typeof lfDbg === 'function') lfDbg('Sistema de desglose de factura inicializado');
    },

    abrir(datos) {
      // Init diferido (mejora INP): no creamos el modal hasta que el usuario lo abre
      if (!this.modal || !this.overlay) this.init();

      // Token para evitar renders tardíos si el usuario cierra rápido o abre otro desglose
      const mySeq = ++this._openSeq;

      this._lastFocusedEl = document.activeElement;

      // Mostrar el modal al instante (primera pintura rápida)
      this.overlay.classList.add('active');
      this.modal.classList.add('active');
      this.modal.setAttribute('aria-hidden', 'false');
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      const body = this.modal.querySelector('.desglose-body');
      if (body) {
        body.innerHTML = `<div style="padding:14px; color: var(--muted); font-weight:700;">Calculando desglose…</div>`;
      }

      const closeBtn = this.modal.querySelector('.desglose-close');
      if (closeBtn) closeBtn.focus(); else this.modal.focus();

      // Dejar que el navegador pinte y luego hacer el trabajo pesado
      setTimeout(() => {
        // Si se cerró o se abrió otro desglose, abortar
        if (mySeq !== this._openSeq) return;
        if (!this.modal || !this.modal.classList.contains('active')) return;
        // `calcularDesglose` y `renderizar` los aportan desglose-calculo.js y
        // desglose-render.js via Object.assign sobre este mismo objeto. Si alguno
        // no llego a cargarse (fallo de red puntual, bloqueador), este objeto
        // existe pero sin esos metodos: sin esta guarda el modal se queda
        // colgado en "Calculando desglose..." y salta un TypeError opaco.
        if (typeof this.calcularDesglose !== 'function' || typeof this.renderizar !== 'function') {
          this.mostrarErrorDeCarga(body);
          return;
        }
        const desglose = this.calcularDesglose(datos);
        this.renderizar(desglose, datos);
      }, 0);
    },

    // Mensaje de fallo de carga con accion de recarga. Sin handlers inline para
    // no depender de 'unsafe-inline' en la CSP.
    mostrarErrorDeCarga(body) {
      if (!body) return;
      body.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding:14px; font-weight:700; line-height:1.5;';

      const msg = document.createElement('p');
      msg.style.cssText = 'margin:0 0 12px;';
      msg.textContent = 'No se pudo cargar el desglose: la página no terminó de descargarse. Recarga para volver a intentarlo.';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Recargar la página';
      btn.addEventListener('click', () => location.reload());

      wrap.appendChild(msg);
      wrap.appendChild(btn);
      body.appendChild(wrap);
    },

    cerrar() {
      // Invalida cualquier render diferido pendiente
      this._openSeq++;
      this.overlay.classList.remove('active');
      this.modal.classList.remove('active');
      this.modal.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';

      if (this._lastFocusedEl && typeof this._lastFocusedEl.focus === 'function') {
        try { this._lastFocusedEl.focus(); } catch { /* elemento ya no focuseable */ }
      }
      this._lastFocusedEl = null;
    },

  });

  // Init diferido: se crea el modal solo al abrir un desglose.

})();
