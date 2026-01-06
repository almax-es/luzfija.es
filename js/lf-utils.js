// ===== LuzFija: Utilidades base =====
// Funciones puras sin dependencias externas

(function() {
  'use strict';

  // ===== DEBUG MODE =====
  try {
    const params = new URLSearchParams(location.search);
    const debug = params.get('debug') === '1' || localStorage.getItem('lf_debug') === '1';
    window.__LF_DEBUG = Boolean(debug);
  } catch (e) {
    window.__LF_DEBUG = false;
  }

  // Helper: log solo si debug está activo
  function lfDbg(...args) {
    if (window.__LF_DEBUG && typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(...args);
    }
  }

  // ===== PARSEO DE NÚMEROS =====
  function parseNum(str) {
    if (str === null || str === undefined) return 0;
    if (typeof str === 'number') return Number.isFinite(str) ? str : 0;
    let s = String(str).trim().replace(/\s/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) {
      const lc = s.lastIndexOf(',');
      const ld = s.lastIndexOf('.');
      if (lc > ld) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    s = s.replace(/[^\d.-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  // ===== ESCAPE HTML =====
  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ===== FORMATEO =====
  function formatMoney(n) {
    return n.toFixed(2).replace('.', ',') + ' €';
  }

  function formatValueForDisplay(val) {
    if (val == null || val === '') return val;
    const str = String(val);
    if (str.includes(',')) return str;
    if (str.includes('.')) return str.replace('.', ',');
    return str;
  }

  // ===== CLAMPING =====
  function clamp01to365Days(raw) {
    const d = Math.trunc(raw);
    if (!Number.isFinite(d) || d === 0) return 30;
    return Math.min(365, Math.max(1, d));
  }

  function clampNonNeg(n) {
    return Math.max(0, Number(n) || 0);
  }

  // ===== REDONDEO =====
  /* Redondeo a 2 decimales (como Excel ROUND(...,2)) */
  function round2(x) {
    return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  }

  // ===== BOOLEANOS =====
  function asBool(val, fallback = false) {
    if (val === undefined || val === null) return fallback;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    return fallback;
  }

  // ===== CLIPBOARD =====
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
    return true;
  }

  // ===== RIPPLE EFFECT =====
  function createRipple(b, e) {
    const rect = b.getBoundingClientRect();
    const s = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - s / 2;
    const y = e.clientY - rect.top - s / 2;
    b.style.position = 'relative';
    b.style.overflow = 'hidden';

    const colors = [
      'rgba(139, 92, 246, 0.4)',
      'rgba(236, 72, 153, 0.3)',
      'rgba(245, 158, 11, 0.2)'
    ];
    const delays = [0, 100, 200];

    colors.forEach((color, i) => {
      setTimeout(() => {
        const r = document.createElement('span');
        r.style.cssText = `position:absolute;width:${s}px;height:${s}px;border-radius:50%;background:${color};left:${x}px;top:${y}px;pointer-events:none;animation:rippleExpand 0.8s ease-out;`;
        b.appendChild(r);
        setTimeout(() => r.remove(), 800);
      }, delays[i]);
    });
  }

  // ===== SUCCESS PARTICLES =====
  function createSuccessParticles(element) {
    const colors = ['#8B5CF6', '#EC4899', '#F59E0B', '#22C55E'];
    const particleCount = 12;

    for (let i = 0; i < particleCount; i++) {
      setTimeout(() => {
        const particle = document.createElement('div');
        particle.className = 'success-particle';
        particle.style.cssText = `
          left: 50%;
          top: 50%;
          background: ${colors[i % colors.length]};
          --tx: ${(Math.random() - 0.5) * 200}px;
          animation-delay: ${i * 0.05}s;
        `;
        element.style.position = 'relative';
        element.appendChild(particle);
        setTimeout(() => particle.remove(), 1100);
      }, i * 50);
    }
  }

  // ===== COUNTER ANIMATION =====
  function animateCounter(element, finalText) {
    const match = finalText.match(/[\d,.]+/);
    if (!match) {
      element.textContent = finalText;
      return;
    }

    const numStr = match[0].replace(',', '.');
    const finalNum = parseFloat(numStr);
    if (isNaN(finalNum)) {
      element.textContent = finalText;
      return;
    }

    const duration = 800;
    const steps = 30;
    const stepDuration = duration / steps;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentNum = finalNum * easeProgress;

      const formatted = currentNum.toFixed(2).replace('.', ',');
      element.textContent = finalText.replace(match[0], formatted);

      if (currentStep >= steps) {
        clearInterval(interval);
        element.textContent = finalText;
      }
    }, stepDuration);
  }

  // ===== EXPORTAR AL GLOBAL =====
  window.lfDbg = lfDbg;
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    parseNum,
    escapeHtml,
    formatMoney,
    formatValueForDisplay,
    clamp01to365Days,
    clampNonNeg,
    round2,
    asBool,
    copyText,
    createRipple,
    createSuccessParticles,
    animateCounter
  });

})();
