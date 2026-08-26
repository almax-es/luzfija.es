/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

// ===== LuzFija: Renderizado =====
// Tabla, chart, KPIs, filtros, ordenación
// OPTIMIZADO PARA INP: Renderizado chunked de tabla (v2026-01-09)

(function() {
  'use strict';

  const {
    el, state, $,
    escapeHtml, formatMoney,
    setStatus, animateCounter, createSuccessParticles,
    initTooltips, bindTooltipElement
  } = window.LF;

  const numComa = (n, dec = 2) => Number(n).toFixed(dec).replace('.', ',');

  // ===== URL SAFE =====
  // Delegación perezosa en el sanitizador canónico window.LF.safeUrl (js/lf-utils.js).
  // Perezosa a propósito: algunos tests montan window.LF parcial antes de cargar
  // lf-utils.js. Si no está disponible, mejor omitir el enlace que arriesgar.
  function safeUrl(raw) {
    const lf = window.LF;
    return (lf && typeof lf.safeUrl === 'function') ? lf.safeUrl(raw) : '';
  }

  // ===== BADGES =====
  function rowTipoBadge(t) {
    const s = String(t || '').trim();
    if (s === '1P') return `<span class="badge b1">1P</span>`;
    if (s === '3P') return `<span class="badge b3">3P</span>`;
    return `<span class="badge">${escapeHtml(s || '—')}</span>`;
  }

  function formatVsWithBar(v, _vn) {
    const s = String(v ?? '').trim();
    if (!s || s === '—' || s === '0' || s === '0,00' || s === '0 €' || s === '0,00 €') {
      return '<span class="vs-text zero">—</span>';
    }
    const pos = s.startsWith('+');
    const c = pos ? 'pos' : 'neg';
    return `<span class="vs-text ${c}">${escapeHtml(s)}</span>`;
  }

  // ===== ATAJO MOVIL A "MI TARIFA" =====
  // En movil cada fila es una tarjeta alta, asi que una tarifa en la posicion 57
  // obliga a un scroll largo. Este chip resume la fila real (posicion, total y
  // diferencia) y aparece solo cuando esa fila queda fuera de pantalla.
  // No toca el ranking, no recalcula nada y no duplica el dato: lo refleja.
  const MI_TARIFA_MQ = '(max-width: 768px)';
  let __miTarifaObserver = null;
  let __miTarifaLastInfo = null; // para rehacer el chip al rotar o redimensionar
  let __miTarifaFlashTimer = 0;  // sin esto, dos clics seguidos se pisan el destello

  function miTarifaChipEls() {
    const chip = document.getElementById('miTarifaChip');
    if (!chip) return null;
    return {
      chip,
      rank: document.getElementById('miTarifaChipRank'),
      total: document.getElementById('miTarifaChipTotal'),
      diff: document.getElementById('miTarifaChipDiff')
    };
  }

  function hideMiTarifaChip() {
    detachMiTarifaObserver();
    const els = miTarifaChipEls();
    if (!els) return;
    els.chip.hidden = true;
    els.chip.classList.remove('is-visible');
  }

  function resetMiTarifaChip() {
    __miTarifaLastInfo = null;
    hideMiTarifaChip();
  }

  // Los datos del chip se actualizan ANTES de repintar el tbody (se conocen ya,
  // salen del array ordenado) y el observer se reengancha DESPUES, cuando la
  // fila nueva existe. Separarlo en dos pasos evita las dos unicas formas de
  // equivocarse aqui: mostrar el rank del calculo anterior, o hacer parpadear el
  // chip en cada cambio de filtro (medido: 136 ms de hueco si se oculta y se
  // vuelve a mostrar).

  // `info` = { rank, total, vsMejor }, tomado de la fila ya calculada.
  function updateMiTarifaChipData(info) {
    __miTarifaLastInfo = info || null;
    const els = miTarifaChipEls();
    if (!els) return false;

    // Sin tarifa propia, sin puesto/total comparable, o en escritorio, el chip
    // no existe para el usuario. Una fila solar no calculable sigue pintandose,
    // pero mostrar solo "Mi tarifa" con los tres datos vacios seria una promesa
    // de resumen que no puede cumplir.
    const mqOk = typeof window.matchMedia === 'function' && window.matchMedia(MI_TARIFA_MQ).matches;
    if (!info || !info.rank || !info.total || !mqOk) { hideMiTarifaChip(); return false; }

    // textContent en todo: los valores ya vienen formateados y nunca como HTML.
    els.rank.textContent = info.rank ? '#' + info.rank : '';
    els.total.textContent = info.total || '';

    const vs = String(info.vsMejor == null ? '' : info.vsMejor).trim();
    const esVacio = !vs || vs === '—' || vs === '0' || vs === '0,00' || vs === '0 €' || vs === '0,00 €';
    els.diff.textContent = esVacio ? '' : vs;
    els.diff.classList.remove('is-pos', 'is-neg', 'is-zero');
    if (!esVacio) els.diff.classList.add(vs.startsWith('+') ? 'is-pos' : 'is-neg');

    const partes = ['Mi tarifa'];
    if (info.rank) partes.push('posicion ' + info.rank);
    if (info.total) partes.push(info.total);
    if (!esVacio) partes.push(vs + ' respecto a la primera');
    els.chip.setAttribute('aria-label', 'Ir a mi tarifa en el ranking: ' + partes.join(', '));

    els.chip.hidden = false;
    return true;
  }

  // Deja de vigilar la fila ANTES de que el repintado la desprenda del DOM.
  // Si no, el navegador emite un ultimo callback con isIntersecting=false sobre
  // la fila ya desprendida y el chip se enciende indebidamente. En modo normal el
  // fundido de 220 ms lo disimula (medido: opacidad maxima 0), pero con
  // `prefers-reduced-motion` la transicion es instantanea y aparece un destello
  // REAL de 44 ms a opacidad 1 en cada cambio de filtro u orden. Medido en Chrome.
  function detachMiTarifaObserver() {
    if (__miTarifaObserver) { __miTarifaObserver.disconnect(); __miTarifaObserver = null; }
  }

  // Reengancha el observer a la fila recien pintada. Sin esto el chip se quedaria
  // vigilando una fila ya desechada y no volveria a aparecer ni desaparecer.
  function attachMiTarifaObserver() {
    detachMiTarifaObserver();
    const els = miTarifaChipEls();
    if (!els || els.chip.hidden) return;

    const row = el.tbody && el.tbody.querySelector('.custom-tariff-highlight');
    if (!row) { hideMiTarifaChip(); return; }

    // IntersectionObserver en vez de escuchar scroll: cero coste por frame.
    if (typeof window.IntersectionObserver !== 'function') {
      // Sin soporte, mejor no mostrar nada que mostrarlo siempre encima.
      hideMiTarifaChip();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      // disconnect() deja de observar, pero no es una barrera contra callbacks
      // que el navegador ya hubiera encolado. Solo el observer vigente puede
      // cambiar la visibilidad del chip.
      if (__miTarifaObserver !== observer) return;
      const e = entries[0];
      if (!e || e.target !== row || !row.isConnected) return;
      els.chip.classList.toggle('is-visible', !e.isIntersecting);
    }, { threshold: 0 });
    __miTarifaObserver = observer;
    observer.observe(row);
  }

  function syncMiTarifaChip(info) {
    if (updateMiTarifaChipData(info)) attachMiTarifaObserver();
  }

  function initMiTarifaChip() {
    const els = miTarifaChipEls();
    if (!els) return;

    // Al cruzar el breakpoint (rotar el movil, redimensionar) hay que rehacer el
    // chip: el CSS ya lo oculta en escritorio, pero el atributo `hidden` y el
    // observer se quedarian pegados del estado anterior.
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia(MI_TARIFA_MQ);
      const onChange = () => syncMiTarifaChip(__miTarifaLastInfo);
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange); // Safari antiguo
    }

    const irAMiTarifa = () => {
      const row = el.tbody && el.tbody.querySelector('.custom-tariff-highlight');
      if (!row) return;

      // El salto es deliberadamente inmediato. En movil, un desplazamiento suave
      // de decenas de tarjetas puede ser cancelado por el scroll inercial que el
      // usuario acaba de hacer para llegar al chip. `behavior: auto` por si solo
      // no basta: esta pagina declara `html { scroll-behavior: smooth }` y `auto`
      // respeta ese valor CSS. Se neutraliza solo durante esta operacion tanto en
      // <html> como en <body>; scrollIntoView elige el scroller real y los estilos
      // inline originales se restauran sin dejar estado global.
      const rootStyle = document.documentElement && document.documentElement.style;
      const bodyStyle = document.body && document.body.style;
      const rootScrollBehavior = rootStyle ? rootStyle.scrollBehavior : '';
      const bodyScrollBehavior = bodyStyle ? bodyStyle.scrollBehavior : '';
      try {
        if (rootStyle) rootStyle.scrollBehavior = 'auto';
        if (bodyStyle) bodyStyle.scrollBehavior = 'auto';

        // Traspasar el foco ANTES de desplazar. Al llegar a la fila el chip se
        // oculta (pasa a visibility:hidden) y quien navegue con teclado o lector
        // se quedaria sin foco en mitad de la pagina. `preventScroll` evita que el
        // navegador haga su propio salto antes del scrollIntoView.
        const destino = row.querySelector('.tarifa-cell[tabindex], .tarifa-cell') || row;
        if (typeof destino.focus === 'function') {
          try { destino.focus({ preventScroll: true }); } catch { destino.focus(); }
        }

        row.scrollIntoView({ behavior: 'auto', block: 'center' });
      } finally {
        if (rootStyle) rootStyle.scrollBehavior = rootScrollBehavior;
        if (bodyStyle) bodyStyle.scrollBehavior = bodyScrollBehavior;
      }

      // Cancelar el temporizador anterior: si no, el destello de un clic previo
      // retira antes de tiempo el del clic actual.
      if (__miTarifaFlashTimer) window.clearTimeout(__miTarifaFlashTimer);
      row.classList.remove('mi-tarifa-flash');
      // Reflow para poder relanzar la animacion si ya se habia aplicado antes.
      void row.offsetWidth;
      row.classList.add('mi-tarifa-flash');
      __miTarifaFlashTimer = window.setTimeout(() => {
        row.classList.remove('mi-tarifa-flash');
        __miTarifaFlashTimer = 0;
      }, 1300);
    };

    els.chip.addEventListener('click', irAMiTarifa);
  }

  // ===== FILTROS Y ORDENACIÓN =====
  function applyFilters(r) {
    const f = state.filter;
    return r.filter(x => (f === 'all' || String(x.tipo || '') === f));
  }

  function applySort(r) {
    const { key, dir } = state.sort;
    const asc = dir === 'asc';
    const c = r.slice();
    
    c.sort((a, b) => {
      const aNoComparable = a.solarNoCalculable
        || a.pvpcNotComputable
        || a.dataUnavailable
        || a.total === '—'
        || !Number.isFinite(Number(a.totalNum));
      const bNoComparable = b.solarNoCalculable
        || b.pvpcNotComputable
        || b.dataUnavailable
        || b.total === '—'
        || !Number.isFinite(Number(b.totalNum));
      if (aNoComparable !== bNoComparable) return aNoComparable ? 1 : -1;

      const va = a[key], vb = b[key];
      
      if (key === 'nombre') {
        const sa = String(va || '').toLowerCase(), sb = String(vb || '').toLowerCase();
        if (sa > sb) return asc ? 1 : -1;
        if (sa < sb) return asc ? -1 : 1;
        return 0;
      }
      
      const na = Number(va) || 0, nb = Number(vb) || 0;
      if (na > nb) return asc ? 1 : -1;
      if (na < nb) return asc ? -1 : 1;

      // Desempate
      if (key === 'totalNum') {
        const bvA = Number(a.fvBvSaldoFin) || 0;
        const bvB = Number(b.fvBvSaldoFin) || 0;
        if (bvA !== bvB) return bvB - bvA;
      }

      return 0;
    });
    
    return c;
  }

  function updateSortIcons() {
    ['nombre', 'potenciaNum', 'consumoNum', 'impuestosNum', 'totalNum', 'vsMejorNum'].forEach(k => {
      const i = $('si_' + k);
      const th = document.querySelector(`th[data-sort="${k}"]`);
      if (!i || !th) return;
      
      if (state.sort.key !== k) {
        i.textContent = '';
        th.setAttribute('aria-sort', 'none');
        return;
      }
      
      i.textContent = state.sort.dir === 'asc' ? '▲' : '▼';
      th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    });
  }

  // Una fila ocupa puesto en el ranking solo si su total es un numero real.
  // Criterio unico: lo usan la celda de posicion y el chip de "Mi tarifa", que
  // deben coincidir siempre.
  function tieneRankingPosition(r) {
    return Number.isFinite(Number(r.totalNum))
      && !r.solarNoCalculable
      && !r.pvpcNotComputable
      && !r.dataUnavailable
      && r.total !== '—';
  }

  // ===== RENDER TABLE OPTIMIZADO (CHUNKED + SEGURO) =====
  let __lf_tableRenderTimer = null;
  let __lf_renderInProgress = false;
  let __lf_currentRenderToken = 0;
  let __lf_resultsAnnounceTimer = null;

  async function renderTable() {
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const f = applyFilters(rows);
    // Filtrar PVPC no computable (potencia > 10 kW)
    const fFiltered = f.filter(r => !r.pvpcNotComputable);
    const s = applySort(fFiltered);

    if (s.length === 0) {
      // Un render anterior puede seguir suspendido en yieldControl(). Hay que
      // invalidarlo tambien cuando el nuevo resultado esta vacio; de lo contrario
      // podria reanudar y volver a insertar filas que ya no pertenecen al filtro.
      clearTimeout(__lf_tableRenderTimer);
      __lf_currentRenderToken++;
      __lf_renderInProgress = false;
      // El observer debe soltarse antes de desprender la fila observada. Esto
      // tambien aplica al vaciado total: disconnect() despues de replaceChildren
      // no impide que llegue el ultimo callback de la fila ya retirada.
      resetMiTarifaChip();
      el.tbody.replaceChildren();
      el.table.classList.remove('show');
      el.emptyBox.classList.add('show');
      return;
    }

    clearTimeout(__lf_tableRenderTimer);
    
    // SEGURIDAD: Cancelar render anterior si existe
    if (__lf_renderInProgress) {
      __lf_currentRenderToken++;
      __lf_renderInProgress = false;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    const myToken = ++__lf_currentRenderToken;
    __lf_renderInProgress = true;

    // OPTIMIZACIÓN INP: Renderizar en chunks de 10 filas
    const CHUNK_SIZE = 10;
    
    el.emptyBox.classList.remove('show');
    el.table.classList.add('show');

    // --- PRE-CÁLCULO AVISOS POR LÍMITES DE CONSUMO ---
    // Obtenemos valores del DOM para calcular si se cumplen requisitos de contratación
    // El chip es un ESPEJO de la fila, y sus datos ya se conocen aqui: salen del
    // array ya ordenado, antes de pintar nada. Se actualizan ANTES de vaciar el
    // tbody para que nunca se vean cifras del calculo anterior (ni las reviva una
    // rotacion a mitad de render). El observer se reengancha al final, cuando la
    // fila nueva existe. Ocultar y volver a mostrar seria lo simple, pero deja un
    // hueco medido de 136 ms en cada cambio de filtro u orden.
    const idxMiTarifa = s.findIndex(r => r.esPersonalizada);
    const miTarifaInfo = idxMiTarifa === -1 ? null : (() => {
      const r = s[idxMiTarifa];
      const conPuesto = tieneRankingPosition(r);
      return {
        rank: conPuesto ? String(idxMiTarifa + 1) : '',
        total: conPuesto ? String(r.total || '') : '',
        vsMejor: r.vsMejor
      };
    })();
    updateMiTarifaChipData(miTarifaInfo);
    // Soltar la fila vieja antes de desprenderla (ver detachMiTarifaObserver).
    detachMiTarifaObserver();

    // Limpiar tbody existente
    el.tbody.replaceChildren();

    // Renderizar en chunks con yields
    for (let chunkStart = 0; chunkStart < s.length; chunkStart += CHUNK_SIZE) {
      // Verificar si este render fue cancelado
      if (myToken !== __lf_currentRenderToken || !__lf_renderInProgress) {
        return;
      }

      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, s.length);
      const frag = document.createDocumentFragment();
      
      for (let idx = chunkStart; idx < chunkEnd; idx++) {
        const r = s[idx];
        const tr = document.createElement('tr');
        if (r.esMejor) tr.classList.add('best');
        if (r.esPersonalizada) tr.classList.add('custom-tariff-highlight');

        const nombreBase = r.nombre || '';
        tr.dataset.tarifaNombre = nombreBase;
        tr.dataset.esPvpc = r.esPVPC ? '1' : '0';
        if (r.fvExcRaw !== undefined && r.fvExcRaw !== null) tr.dataset.fvExcRaw = String(r.fvExcRaw);
        if (Number.isFinite(Number(r.fvPriceUsed))) tr.dataset.fvPriceUsed = String(r.fvPriceUsed);
        tr.dataset.fvPriceSource = r.fvPriceSource || r.precioExcSource || (r.fvExcRaw === -1 ? 'reference-0.02' : 'fixed');
        if (Number.isFinite(Number(r.ssaaNum))) tr.dataset.ssaaNum = String(r.ssaaNum);
        if (Number.isFinite(Number(r.ssaaRate))) tr.dataset.ssaaRate = String(r.ssaaRate);
        if (r.ssaaMonth) tr.dataset.ssaaMonth = String(r.ssaaMonth);
        
        // --- AVISO COMPENSACIÓN PARCIAL (tope ENERGIA_PARCIAL) ---
        let compParcialIcon = '';
        if (r.fvTope === 'ENERGIA_PARCIAL' && r.fvApplied) {
          const bc = Number(r.fvBaseCompensable) || 0;
          const pt = Number(r.fvPeajesTotal) || 0;
          const consBruto = Math.round((Number(r.consumoNum) + Number(r.fvCredit1 || 0)) * 100) / 100;
          const pctPura = consBruto > 0 ? Math.round(bc / consBruto * 100) : 0;

          let cpTip = `❗ COMPENSACIÓN PARCIAL\n\n`;
          if (bc > 0 && pt > 0) {
            cpTip += `Tu consumo cuesta ${numComa(consBruto)} €.\n`;
            cpTip += `De eso, ${numComa(pt)} € son peajes y cargos regulados.\n\n`;
            cpTip += `Solo se puede compensar sobre ${numComa(bc)} € de energía pura (${pctPura}% del total).\n\n`;
          } else {
            cpTip += `Esta tarifa solo compensa sobre el coste de la energía sin peajes ni cargos.\n\n`;
          }
          cpTip += `El cálculo mostrado ya refleja esta limitación.`;
          compParcialIcon = `<span class="tooltip te-warn-icon" data-tip="${escapeHtml(cpTip)}" role="button" tabindex="0" aria-label="Aviso compensación parcial" style="margin-left:4px; color:var(--danger); cursor:help; font-size:1.1em;">❗</span>`;
        }

        // Guardar metaPvpc para desglose si es PVPC
        if (r.esPVPC && r.metaPvpc) {
          tr.dataset.metaPvpc = JSON.stringify(r.metaPvpc);
        }

        const safeWebUrl = safeUrl(r.webUrl);
        const w = safeWebUrl && safeWebUrl !== '#'
          ? `<a class="web" href="${escapeHtml(safeWebUrl)}" target="_blank" rel="noopener nofollow" referrerpolicy="origin" title="Abrir web" aria-label="Abrir oferta de ${escapeHtml(nombreBase)}">` +
            `<span class="web-icon" aria-hidden="true">🔗</span>` +
            `<span class="web-text">Ver oferta</span>` +
            `</a>`
          : r.esPersonalizada ? '' : '';

        const nombreWarn = r.dataUnavailable
          ? `<span class="pvpc-warn" title="${escapeHtml(r.dataUnavailableReason || 'Datos temporales no disponibles para calcular esta tarifa')}">⚠</span>`
          : r.solarNoCalculable
          ? `<span class="pvpc-warn" title="${escapeHtml(r.solarNoCalculableReason || 'PVPC no comparable con solar en este ranking')}">⚠</span>`
          : r.pvpcNotComputable
          ? `<span class="pvpc-warn" title="PVPC no disponible para esta configuración">⚠</span>`
          : (r.pvpcWarning ? ' ⚠' : '');

        const requisitosTooltip = r.requisitos
          ? `<span class="tooltip requisitos-icon" data-tip="${escapeHtml(r.requisitos)}" role="button" tabindex="0" aria-label="Requisitos de contratación" style="margin-left:4px; color:var(--warn); cursor:help;">i</span>`
          : '';

        // Promocion: beneficio que NO esta incluido en el precio de la fila.
        // Se destaca con etiqueta propia porque el icono "i" pasa desapercibido.
        // aria-label corto a proposito: el texto de la promo ya lo aporta el tooltip
        // via aria-describedby (lf-tooltips.js), y duplicarlo lo hace sonar dos veces.
        // La clase "tooltip" es estructural, no cosmetica: la delegacion de
        // desglose-integration.js la excluye para que pulsar la etiqueta no abra el modal.
        const promoBadge = r.promo
          ? `<span class="tooltip promo-badge" data-tip="${escapeHtml(r.promo)}" role="button" tabindex="0" aria-label="Promoción disponible"><span aria-hidden="true">🎁</span>OFERTA</span>`
          : '';

        // FV Icon
        let fvIcon = '';
        let solarDetails = '';
        const precioExc = Number(r.fvPriceUsed || 0);
        const exKwh = Number(r.fvExKwh || 0);
        const credit1 = Number(r.fvCredit1 || 0);
        const credit2 = Number(r.fvCredit2 || 0);
        const bvSaldoFin = r.fvBvSaldoFin;
        const excNoCompensable = Number(r.fvExcedenteNoCompensable || 0);
        const fvCosteBV = Number(r.fvCosteBV || 0);

        const isBV = r.fvTipo && r.fvTipo.includes('BV');
        const bvSaldoFinNum = Number(bvSaldoFin);
        const totalNumValue = Number(r.totalNum);
        // Un 0 es un importe VALIDO, no una ausencia: cuando la BV acumulada cubre la
        // factura entera el usuario paga 0 €, mientras que totalNum sigue siendo positivo
        // porque el ranking no atribuye a la tarifa el saldo heredado de meses anteriores
        // (ARQUITECTURA-CALCULOS.md: totalPagar vs totalReal). Con `||` ese cero caia a
        // totalNum y "Pagas este mes" mostraba el coste de ranking. El fallback a totalNum
        // se reserva a fvTotalFinal ausente/no finito, con el mismo criterio explicito de
        // null/undefined que usa bvSaldoFin justo debajo.
        const fvTotalFinalRaw = r.fvTotalFinal;
        const fvTotalFinalNum = Number(fvTotalFinalRaw);
        const hasFvTotalFinal = fvTotalFinalRaw !== null
          && fvTotalFinalRaw !== undefined
          && fvTotalFinalRaw !== ''
          && Number.isFinite(fvTotalFinalNum);
        const totalFinal = hasFvTotalFinal
          ? fvTotalFinalNum
          : (Number.isFinite(totalNumValue) ? totalNumValue : 0);
        const totalRanking = Number(r.totalNum) || 0;
        const bvPagasFmt = formatMoney(totalFinal);
        const bvRankingFmt = formatMoney(totalRanking);
        const showBvSaldoInTotal = isBV
          && bvSaldoFin !== null
          && bvSaldoFin !== undefined
          && Number.isFinite(bvSaldoFinNum)
          && bvSaldoFinNum > 0
          && Number.isFinite(totalNumValue)
          && Math.abs(totalNumValue) < 0.005;

        if (r.fvApplied && credit1 > 0) {
          const parts = [];
          
          if (isBV && (credit2 > 0 || bvSaldoFin !== null)) {
            parts.push(credit2 > 0
              ? `💰 Pagas este mes: ${bvPagasFmt} (usando BV acumulada)`
              : `💰 Pagas este mes: ${bvPagasFmt}`);
            parts.push(`🏆 Ranking (coste real): ${bvRankingFmt} (sin BV del pasado)`);
            
            if (bvSaldoFin !== null && bvSaldoFin !== undefined) {
              parts.push(`🔋 Saldo BV final: ${numComa(bvSaldoFin)} € (disponible para el próximo mes)`);
            }
            
            parts.push(`---`);
          }
          
          parts.push(`☀️ Excedentes vertidos: ${numComa(exKwh)} kWh`);
          parts.push(`💰 Precio compensación: ${numComa(precioExc, 3)} €/kWh`);
          if (r.fvExcRaw === -1) parts.push(`ℹ️ Referencia orientativa: el precio real varía según las horas exactas de vertido`);
          parts.push(`✅ Compensado este mes: ${numComa(credit1)} € (descontado de tu consumo de energía)`);
          if (fvCosteBV > 0) parts.push(`🔋 Cuota BV: ${numComa(fvCosteBV)} € incluida en el total`);
          if (excNoCompensable > 0) parts.push(`⚠️ No aplicado en factura por peajes/cargos: ${numComa(excNoCompensable)} €`);
          if (credit2 > 0) parts.push(`🔋 BV usada: ${numComa(credit2)} € (ahorros de meses anteriores aplicados ahora)`);
          
          const tip = parts.join('\n');
          fvIcon = `<span class="tooltip fv-icon fv-ranking" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Detalle FV y Ranking">☀️</span>`;
          solarDetails = `<div class="solar-details">☀️ ${escapeHtml(parts.join(' • '))}</div>`;
        } else if (bvSaldoFin !== null && bvSaldoFin !== undefined && r.fvTipo && r.fvTipo.includes('BV')) {
          const parts = [];
          if (credit2 > 0) parts.push(`🔋 BV usada: ${numComa(credit2)} € (ahorros de meses anteriores aplicados ahora)`);
          if (fvCosteBV > 0) parts.push(`🔋 Cuota BV: ${numComa(fvCosteBV)} € incluida en el total`);
          parts.push(`🔋 Saldo BV final: ${numComa(bvSaldoFin)} € (disponible para el próximo mes)`);
          const tip = parts.join('\n');
          fvIcon = `<span class="tooltip fv-icon" data-tip="${escapeHtml(tip)}" role="button" tabindex="0" aria-label="Detalle BV">🔋</span>`;
          solarDetails = `<div class="solar-details">🔋 ${escapeHtml(parts.join(' • '))}</div>`;
        }

        const icons = `<span class="tarifa-icons">${fvIcon || ""}${compParcialIcon || ""}${requisitosTooltip || ""}${nombreWarn || ""}</span>`;

        const hasRankingPosition = tieneRankingPosition(r);
        const rankCell = hasRankingPosition ? String(idx + 1) : '—';
        const rankBadge = hasRankingPosition ? `#${idx + 1}` : '—';
        const badgeRow = `<div class="tarifa-badges" aria-hidden="true">` +
          `<span class="badge rank">${rankBadge}</span>` +
          `${rowTipoBadge(r.tipo)}` +
          `</div>`;

        const canOpenDesglose = hasRankingPosition;
        const unavailableReason = r.dataUnavailableReason || r.solarNoCalculableReason || '';
        const tarifaCellAttrs = canOpenDesglose
          ? `class="tarifa-cell" title="${escapeHtml(nombreBase)}" role="button" tabindex="0" aria-label="Ver desglose de ${escapeHtml(nombreBase)}"`
          : `class="tarifa-cell" title="${escapeHtml(unavailableReason || nombreBase)}" aria-disabled="true"`;
        const totalCellAttrs = canOpenDesglose
          ? `class="total-cell" role="button" tabindex="0" title="${isBV ? `Clic para ver desglose completo • Pagas: ${escapeHtml(bvPagasFmt)} • Ranking: ${escapeHtml(bvRankingFmt)}` : `Clic para ver desglose completo de la factura`}"`
          : `class="total-cell" aria-disabled="true" title="${escapeHtml(unavailableReason || 'No hay desglose disponible para esta fila')}"`;

        const nombreDisplay =
          `${badgeRow}` +
          `<div class="tarifa-title">` +
          `<span class="tarifa-nombre">${escapeHtml(nombreBase)}</span>` +
          `${icons}` +
          `${promoBadge}` +
          `</div>` +
          `${solarDetails || ""}`;
        const totalAmountAttrs = isBV ? ` data-pagas="${escapeHtml(bvPagasFmt)}" data-ranking="${escapeHtml(bvRankingFmt)}"` : "";
        const totalAmountHtml = showBvSaldoInTotal
          ? `<strong class="total-price total-price--with-bv js-total-amount"${totalAmountAttrs}><span>${escapeHtml(r.total)}</span><span class="total-bv-saldo">BV +${escapeHtml(formatMoney(bvSaldoFinNum))}</span></strong>`
          : `<strong class="total-price js-total-amount"${totalAmountAttrs}>${escapeHtml(r.total)}</strong>`;

        tr.innerHTML =
          `<td>${rankCell}</td>` +
          `<td ${tarifaCellAttrs}>${nombreDisplay}</td>` +
          `<td>${escapeHtml(r.potencia)}</td>` +
          `<td>${escapeHtml(r.consumo)}</td>` +
          `<td>${escapeHtml(r.impuestos)}</td>` +
          `<td ${totalCellAttrs}><span class="total-pill">${totalAmountHtml}${canOpenDesglose ? '<span class="desglose-icon" aria-hidden="true">💡</span>' : ''}</span></td>` +
          `<td>${formatVsWithBar(r.vsMejor, r.vsMejorNum)}</td>` +
          `<td style="text-align:center">${rowTipoBadge(r.tipo)}</td>` +
          `<td style="text-align:center">${w}</td>`;

        frag.appendChild(tr);
      }

      el.tbody.appendChild(frag);

      // Yield al navegador después de cada chunk (excepto el último)
      if (chunkEnd < s.length) {
        await window.LF.yieldControl();
      }
    }

    // Verificar una última vez antes de finalizar
    if (myToken !== __lf_currentRenderToken) {
      return;
    }

    __lf_renderInProgress = false;

    // Diferir binding de tooltips al siguiente frame (INP: no bloquear tras render)
    requestAnimationFrame(() => {
      if (myToken !== __lf_currentRenderToken) return;
      el.tbody.querySelectorAll('.te-warn-icon').forEach(t => bindTooltipElement(t));
      el.tbody.querySelectorAll('.requisitos-icon').forEach(t => bindTooltipElement(t));
      el.tbody.querySelectorAll('.promo-badge').forEach(t => bindTooltipElement(t));
      el.tbody.querySelectorAll('.fv-icon').forEach(t => bindTooltipElement(t));
      updateSortIcons();
      // Los datos ya se pusieron antes de repintar; aqui solo hay que volver a
      // vigilar la fila nueva.
      attachMiTarifaObserver();
    });
  }

  // ===== RENDER TOP CHART =====
  function renderTopChart() {
    const c = document.getElementById('chartTop');
    const body = document.getElementById('chartTopBody');
    if (!c || !body) return;

    const rows = (state.rows || []).filter(r => !r.pvpcNotComputable && !r.solarNoCalculable && !r.dataUnavailable && r.total !== '—');
    if (!rows.length) {
      c.classList.remove('show');
      body.innerHTML = '';
      return;
    }

    const sorted = rows.slice().sort((a, b) => a.totalNum - b.totalNum).slice(0, 5);
    const max = sorted[sorted.length - 1].totalNum || 1;

    const frag = document.createDocumentFragment();
    sorted.forEach((r, idx) => {
      const row = document.createElement('div');
      row.className = 'chartTop-row';
      if (idx === 0) row.classList.add('best');

      const pct = Math.max(5, Math.round((r.totalNum / max) * 100));

      row.innerHTML = `
        <div class="chartTop-name" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre)}</div>
        <div class="chartTop-barTrack"><div class="chartTop-barFill" data-width="${pct}%"></div></div>
        <div class="chartTop-value">${escapeHtml(r.total || '')}</div>
      `;
      frag.appendChild(row);
    });

    body.replaceChildren(frag);
    c.style.display = '';
    c.classList.add('show');

    requestAnimationFrame(() => {
      body.querySelectorAll('.chartTop-barFill').forEach(bar => {
        const w = bar.getAttribute('data-width') || '0%';
        bar.style.width = w;
      });
    });
  }

  // ===== RENDER PVPC INFO =====
  function renderPvpcInfo() {
    const div = el.pvpcInfo;
    if (!div) return;

    const warningEl = document.getElementById('pvpc-warning-canarias-potencia');
    if (warningEl) {
      warningEl.style.display = window.pvpcPotenciaExcedida ? 'block' : 'none';
    }

    if (!window.pvpcLastMeta) {
      div.style.display = 'none';
      div.textContent = '';
      return;
    }

    const fmt = (n) => {
      if (!Number.isFinite(n)) return '—';
      let s = n.toFixed(6);
      s = s.replace(/0+$/, '').replace(/\.$/, '');
      s = s.replace('.', ',');
      return `${s} €/kWh`;
    };

    const rango = window.pvpcLastMeta.rangoFechas ? `Periodo oficial: ${window.pvpcLastMeta.rangoFechas.inicio} - ${window.pvpcLastMeta.rangoFechas.fin}` : '';
    const fecha = window.pvpcLastMeta.fechaConsulta ? new Date(window.pvpcLastMeta.fechaConsulta) : null;
    const coverage = window.pvpcLastMeta.pvpcCoverage;
    const coverageWarning = coverage?.hasMissingPrices
      ? coverage.mode === 'hybrid'
        ? `Cobertura horaria parcial: ${coverage.hoursWithPrice} de ${coverage.hoursWithPrice + coverage.hoursWithoutPrice} horas con precio; el ${numComa(coverage.missingKwhShare * 100, 1)}% de la energía se ha estimado con medias P1/P2/P3.`
        : `Sin cobertura horaria suficiente: ${coverage.hoursWithoutPrice} de ${coverage.hoursWithPrice + coverage.hoursWithoutPrice} horas sin precio. El consumo se ha valorado con medias P1/P2/P3.`
      : '';

    const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    const fechaTxt = fecha ? fecha.toLocaleString('es-ES', dateOptions) : '-';

    div.style.display = 'block';
    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:900; color:var(--text); font-size:13px;">
          PVPC (tarifa regulada)
	          <span class="tooltip"
	                data-tip="Fuente: REE/ESIOS (indicador PVPC 1001). Proyecto independiente (no afiliado). El PVPC mostrado es una estimación orientativa basada en tus datos y en medias horarias por periodo; puede diferir de la CNMC por perfiles de consumo y redondeos."
                role="button"
                tabindex="0"
                aria-label="Información sobre PVPC">
            i
          </span>
        </div>
        <div style="font-size:11px; color:var(--muted2);">${escapeHtml(fechaTxt)}</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-top:8px;">
        <div style="display:flex; flex-direction:column; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); padding:6px 10px; border-radius:8px;">
          <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(239,68,68,1); font-weight:800;">Punta (P1)</span>
          <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(window.pvpcLastMeta.precioPunta)}</span>
        </div>
        <div style="display:flex; flex-direction:column; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); padding:6px 10px; border-radius:8px;">
          <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(245,158,11,1); font-weight:800;">Llano (P2)</span>
          <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(window.pvpcLastMeta.precioLlano)}</span>
        </div>
        <div style="display:flex; flex-direction:column; background:rgba(34,197,94,.1); border:1px solid rgba(34,197,94,.3); padding:6px 10px; border-radius:8px;">
          <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:rgba(34,197,94,1); font-weight:800;">Valle (P3)</span>
          <span style="font-family:var(--mono); font-weight:700; font-size:13px;">${fmt(window.pvpcLastMeta.precioValle)}</span>
        </div>
      </div>
      ${coverageWarning ? `<div role="status" style="margin-top:8px; padding:7px 9px; border-radius:8px; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); color:var(--text); font-size:11px;">${escapeHtml(coverageWarning)}</div>` : ''}
      ${rango ? `<div style="margin-top:8px; font-size:11px; color:var(--muted2); text-align:right;">${escapeHtml(rango)}</div>` : ''}
    `;
    
    initTooltips();
  }

  function announceResultsSummary(d) {
    const live = el.resultsLiveStatus || document.getElementById('resultsLiveStatus');
    if (!live) return;

    const rowsShown = applyFilters(state.rows || []).filter(tieneRankingPosition).length;
    const resumen = d?.resumen || {};
    const tarifaLabel = rowsShown === 1 ? 'tarifa' : 'tarifas';
    const parts = rowsShown > 0
      ? [`Resultados actualizados: ${rowsShown} ${tarifaLabel} en el ranking.`]
      : ['Resultados actualizados: no hay tarifas para mostrar con el filtro actual.'];

    if (resumen.mejor && resumen.mejor !== '—') parts.push(`Tarifa más barata: ${resumen.mejor}.`);
    if (resumen.precio && resumen.precio !== '—') parts.push(`Coste más bajo con impuestos: ${resumen.precio}.`);

    const excluidas = d?.limitesConsumo?.excluidas || [];
    if (excluidas.length) parts.push(`${excluidas.length} ${excluidas.length === 1 ? 'tarifa excluida' : 'tarifas excluidas'} por requisitos de consumo.`);

    live.textContent = '';
    if (__lf_resultsAnnounceTimer) clearTimeout(__lf_resultsAnnounceTimer);
    __lf_resultsAnnounceTimer = setTimeout(() => {
      live.textContent = parts.join(' ');
      __lf_resultsAnnounceTimer = null;
    }, 0);
  }

  // ===== RENDER ALL =====
  // ===== AVISO SOLAR (HOME) =====
  // El ranking de la home estima los excedentes con el total del periodo;
  // si el cálculo renderizado es solar, se recomienda el Simulador Solar.
  // Depende del modo con que se calculó (state.lastRenderSolarOn), no del
  // checkbox actual del formulario, para no desincronizarse de los resultados.
  function renderSolarHomeNotice() {
    const notice = document.getElementById('solarHomeEstimatorNotice');
    if (!notice) return;
    notice.hidden = !state.lastRenderSolarOn;
  }

  function formatKwh(n) {
    return Math.round(Number(n) || 0).toLocaleString('es-ES') + ' kWh';
  }

  function renderConsumoLimitsNotice(info) {
    const notice = document.getElementById('consumoLimitsNotice');
    if (!notice) return;
    const restoreToggleFocus = Boolean(state.focusAnnualConsumptionEstimateToggle);
    state.focusAnnualConsumptionEstimateToggle = false;
    notice.setAttribute('role', 'note');
    notice.setAttribute('aria-label', 'Límites y estimación anual de consumo');
    const excluded = Array.isArray(info?.excluidas) ? info.excluidas : [];
    const excludedReal = Array.isArray(info?.excluidasReales)
      ? info.excluidasReales
      : excluded.filter((item) => item?.origen !== 'estimacion');
    const excludedEstimated = Array.isArray(info?.excluidasEstimadas) ? info.excluidasEstimadas : [];
    const hasUsefulEstimate = Boolean(
      info?.estimateAvailable
      && Number.isFinite(info?.estimatedAnnualKwh)
      && excludedEstimated.length
    );
    notice.replaceChildren();
    notice.hidden = excludedReal.length === 0 && !hasUsefulEstimate;
    if (notice.hidden) return;

    if (excludedReal.length) {
      const lead = document.createElement('p');
      const countLabel = excludedReal.length === 1 ? 'tarifa incompatible' : 'tarifas incompatibles';
      const strong = document.createElement('strong');
      strong.textContent = `⚠️ ${excludedReal.length} ${countLabel} excluida${excludedReal.length === 1 ? '' : 's'} del ranking.`;
      lead.append(strong, ` Tus datos ya registran ${formatKwh(info.consumoKwh)} y no cumplen ${excludedReal.length === 1 ? 'su requisito' : 'sus requisitos'} de consumo.`);
      notice.appendChild(lead);
    }

    if (hasUsefulEstimate) {
      const estimate = document.createElement('div');
      estimate.className = 'consumo-estimate-choice';
      const text = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = info.estimateApplied
        ? `Estimación anual aplicada: ${formatKwh(info.estimatedAnnualKwh)}/año.`
        : `Estimación anual orientativa: ${formatKwh(info.estimatedAnnualKwh)}/año.`;
      text.append(
        strong,
        ` Se basa en ${formatKwh(info.consumoKwh)} registrados durante ${Math.round(info.coveredDays)} ${Math.round(info.coveredDays) === 1 ? 'día' : 'días'}.`
      );

      const help = document.createElement('p');
      help.className = 'consumo-estimate-help';
      const shortPeriodWarning = Number(info.coveredDays) < 28
        ? ' Con menos de 28 días, puede variar todavía más.'
        : '';
      const estimateEffect = info.estimateApplied
        ? `${excludedEstimated.length} ${excludedEstimated.length === 1 ? 'tarifa se ha excluido' : 'tarifas se han excluido'} por esta estimación. Puedes volver a mostrarlas cuando quieras.`
        : `Es una aproximación. Si la activas, ${excludedEstimated.length} ${excludedEstimated.length === 1 ? 'tarifa dejará' : 'tarifas dejarán'} de mostrarse por sus límites anuales.`;
      help.textContent = `La época del año puede cambiar mucho tu consumo, especialmente si usas calefacción o aire acondicionado.${shortPeriodWarning} ${estimateEffect}`;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'consumo-estimate-toggle';
      toggle.dataset.enabled = info.estimateApplied ? 'false' : 'true';
      toggle.textContent = info.estimateApplied
        ? 'Volver a mostrar esas tarifas'
        : 'Aplicar límites con esta estimación';
      toggle.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('lf:annual-consumption-estimate-change', {
          detail: { enabled: toggle.dataset.enabled === 'true' }
        }));
      });
      estimate.append(text, help, toggle);
      notice.appendChild(estimate);
    }

    const listed = [...excludedReal, ...excludedEstimated];
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = info?.estimateApplied
      ? 'Ver tarifas excluidas y por qué'
      : (excludedReal.length ? 'Ver tarifas excluidas o afectadas' : 'Ver qué tarifas cambiarían');
    const list = document.createElement('ul');
    listed.forEach((item) => {
      const entry = document.createElement('li');
      const name = String(item?.tarifa?.nombre || 'Tarifa sin nombre');
      const requirement = `admite como máximo ${formatKwh(item.limiteKwh)} al año`;
      const source = item?.origen === 'estimacion' ? ' Según la estimación anual.' : '';
      entry.textContent = `${name}: ${requirement}.${source}`;
      list.appendChild(entry);
    });
    details.append(summary, list);
    notice.appendChild(details);

    if (restoreToggleFocus) {
      const toggle = notice.querySelector('.consumo-estimate-toggle');
      requestAnimationFrame(() => toggle?.focus({ preventScroll: true }));
    }
  }

  function dispatchResultsReady(rowsCount) {
    if (!Number.isFinite(rowsCount) || rowsCount <= 0) return;
    try {
      document.dispatchEvent(new CustomEvent('lf:results-ready', {
        detail: {
          origin: 'home',
          rows: rowsCount
        }
      }));
    } catch (_) {}
  }

  function renderAll(d) {
    if (!d || !d.success) {
      setStatus('Error de cálculo', 'err');
      window.LF.toast('Error al calcular', 'err');
      return;
    }

    state.pending = false;
    state.lastRenderSolarOn = Boolean(d.solarOn);
    setStatus('Resultados actualizados', 'ok');

    const r = d.resumen || {};
    if (r.mejor) animateCounter(el.kpiBest, r.mejor);
    if (r.precio) animateCounter(el.kpiPrice, r.precio);

    const seoFold = document.getElementById('info');
    if (seoFold) seoFold.classList.add('show');
    el.heroKpis.classList.add('show');
    createSuccessParticles(el.heroKpis);

    // Mostrar sección de resultados
    const seccionResultados = document.getElementById('seccionResultados');
    const esPrimeraVez = seccionResultados && !seccionResultados.classList.contains('visible');
    if (seccionResultados && esPrimeraVez) {
      seccionResultados.classList.add('visible');

      const gridContainer = document.querySelector('.grid');
      if (gridContainer) {
        gridContainer.classList.add('has-results');
      }
    }

    const s = d.stats;
    if (s) {
      el.statMin.textContent = s.precioMin;
      el.statAvg.textContent = s.precioMedio;
      el.statMax.textContent = s.precioMax;
      el.statsBar.classList.add('show');
    }

    state.rows = Array.isArray(d.resultados) ? d.resultados : [];
    el.toolbar.classList.add('show');

    renderSolarHomeNotice();
    renderConsumoLimitsNotice(d.limitesConsumo);
    renderTopChart();
    renderPvpcInfo();

    // Esperar a que la tabla termine de renderizarse antes de hacer scroll,
    // para evitar que el scroll salte al final mientras el DOM crece.
    const renderDone = renderTable().then(() => {
      announceResultsSummary(d);
      dispatchResultsReady(el.tbody ? el.tbody.querySelectorAll('tr').length : 0);
      if (seccionResultados) {
        seccionResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    if (window.innerWidth < 1100) {
      const sb = $('scrollToResults');
      sb.style.display = 'block';
      setTimeout(() => sb.style.display = 'none', 5000);
    }

    return renderDone;
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    rowTipoBadge,
    formatVsWithBar,
    applyFilters,
    applySort,
    updateSortIcons,
    renderTable,
    renderTopChart,
    renderPvpcInfo,
    renderSolarHomeNotice,
    renderAll,
    initMiTarifaChip,
    hideMiTarifaChip,
    resetMiTarifaChip,
    cancelRender: () => {
      __lf_renderInProgress = false;
    }
  });

  window.renderTable = renderTable;
  window.renderAll = renderAll;
  window.updateSortIcons = updateSortIcons;

})();
