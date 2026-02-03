// INP debug (solo cuando ?debug=1 o lf_debug=1)
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__LF_INP_DEBUG_ACTIVE) return;

  let debug = false;
  try {
    const params = new URLSearchParams(location.search);
    debug = params.get('debug') === '1' ||
      localStorage.getItem('lf_debug') === '1' ||
      window.__LF_DEBUG === true;
  } catch (_) {}

  if (!debug) return;
  window.__LF_DEBUG = true;

  if (typeof PerformanceObserver === 'undefined') return;
  if (typeof window.addEventListener !== 'function') return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

  window.__LF_INP_DEBUG_ACTIVE = true;

  let worst = { duration: 0, entry: null };

  const IGNORE_NAMES = new Set([
    'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointermove',
    'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove',
    'scroll', 'wheel', 'touchmove'
  ]);

  const isInteraction = (entry) => {
    const name = String(entry?.name || '');
    if (IGNORE_NAMES.has(name)) return false;
    if (entry?.interactionId && entry.interactionId > 0) return true;
    return name === 'click' || name === 'pointerdown' || name === 'pointerup' ||
      name === 'keydown' || name === 'touchstart';
  };

  const describeTarget = (target) => {
    if (!target) return '';
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    const id = target.id ? `#${target.id}` : '';
    const cls = target.className && typeof target.className === 'string'
      ? `.${target.className.trim().split(/\s+/)[0]}`
      : '';
    return `${tag}${id || cls}`.trim();
  };

  const updateWorst = (entry) => {
    const dur = Number(entry?.duration || 0);
    if (dur <= worst.duration) return;
    worst = { duration: dur, entry };
  };

  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!isInteraction(entry)) continue;
        updateWorst(entry);
      }
    });
    po.observe({ type: 'event', durationThreshold: 40, buffered: true });
  } catch (_) {
    // No-op en navegadores antiguos
  }

  let logged = false;
  const logWorst = () => {
    if (logged || !worst.entry) return;
    logged = true;
    const e = worst.entry;
    const name = e.name || 'interaction';
    const target = describeTarget(e.target);
    const duration = Math.round(worst.duration);
    console.log(`[INP][debug] peor interacción: ${duration} ms (${name}${target ? ' en ' + target : ''})`);
  };

  window.addEventListener('pagehide', logWorst, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') logWorst();
  });
})();
