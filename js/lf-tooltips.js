// ===== LuzFija: Sistema de Tooltips =====

(function() {
  'use strict';

  const { el } = window.LF;

  let activeTooltip = null;
  let tooltipPinned = false;
  let tooltipRaf = null;

  function positionTooltip(target) {
    if (!target) return;
    if (tooltipRaf) cancelAnimationFrame(tooltipRaf);
    
    tooltipRaf = requestAnimationFrame(() => {
      // Verificar si el elemento todavía está visible en viewport
      const rect = target.getBoundingClientRect();
      const isVisible = rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth;

      // Si el elemento salió del viewport y no está pinned, ocultar tooltip
      if (!isVisible && !tooltipPinned) {
        hideTooltip(true);
        return;
      }

      const tip = target.getAttribute('data-tip') || '';
      el.globalTooltip.textContent = tip;
      el.globalTooltip.style.display = 'block';
      el.globalTooltip.style.visibility = 'hidden';
      el.globalTooltip.style.opacity = '0';
      el.globalTooltip.setAttribute('aria-hidden', tip ? 'false' : 'true');
      
      const ttRect = el.globalTooltip.getBoundingClientRect();
      let top = rect.top - ttRect.height - 10;
      if (top < 8) top = rect.bottom + 10;
      
      let left = rect.left + rect.width / 2 - ttRect.width / 2;
      const maxLeft = window.innerWidth - ttRect.width - 8;
      left = Math.max(8, Math.min(maxLeft, left));
      
      // Evitar que el tooltip se salga por abajo/arriba en pantallas pequeñas
      const maxTop = window.innerHeight - ttRect.height - 8;
      top = Math.max(8, Math.min(maxTop, top));
      
      el.globalTooltip.style.top = `${top}px`;
      el.globalTooltip.style.left = `${left}px`;
      el.globalTooltip.style.visibility = 'visible';
      el.globalTooltip.style.opacity = '1';
    });
  }

  function hideTooltip(force = false) {
    if (!force && tooltipPinned) return;
    el.globalTooltip.style.display = 'none';
    el.globalTooltip.setAttribute('aria-hidden', 'true');
    activeTooltip = null;
    tooltipPinned = false;
  }

  function openTooltip(target) {
    activeTooltip = target;
    positionTooltip(target);
  }

  // Bind tooltip element de forma idempotente
  function bindTooltipElement(t) {
    if (!t || t.__LF_TT_BOUND) return;
    t.__LF_TT_BOUND = true;
    
    t.addEventListener('mouseenter', () => {
      tooltipPinned = false;
      openTooltip(t);
    }, { passive: true });
    
    t.addEventListener('mouseleave', () => {
      if (tooltipPinned && activeTooltip === t) return;
      hideTooltip();
    }, { passive: true });
    
    t.addEventListener('focus', () => {
      tooltipPinned = false;
      openTooltip(t);
    });
    
    t.addEventListener('blur', () => hideTooltip(true));
    
    t.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (activeTooltip === t && tooltipPinned) {
        hideTooltip(true);
        return;
      }
      tooltipPinned = true;
      openTooltip(t);
    });
    
    t.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        t.click();
      }
    });
  }

  function initTooltips() {
    document.querySelectorAll('.tooltip').forEach(bindTooltipElement);

    if (!document.__LF_TT_GLOBAL_BOUND) {
      document.__LF_TT_GLOBAL_BOUND = true;
      
      document.addEventListener('click', (evt) => {
        if (!tooltipPinned) return;
        if (!evt.target.closest('.tooltip')) hideTooltip(true);
      });

      window.addEventListener('scroll', () => {
        if (activeTooltip) positionTooltip(activeTooltip);
      }, { capture: true, passive: true });
      
      window.addEventListener('resize', () => {
        if (activeTooltip) positionTooltip(activeTooltip);
      }, { passive: true });
      
      document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') hideTooltip(true);
      });
    }
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    initTooltips,
    bindTooltipElement,
    hideTooltip
  });

  // Compatibilidad
  window.initTooltips = initTooltips;
  window.bindTooltipElement = bindTooltipElement;

})();
