// ===== LuzFija: Motor de Cálculo =====

(function() {
  'use strict';

  const {
    state,
    parseNum, clampNonNeg, round2, formatMoney,
    __LF_getFiscalContext, getInputValues
  } = window.LF;

  // ===== PRECIO EXCEDENTES =====
  function getFvExcPrice(fv) {
    if (!fv) return 0;
    const raw = fv.exc;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
    if (typeof raw === 'string' && raw.toUpperCase() === 'INDEXADA') return null;
    return 0;
  }

  // ===== CÁLCULO LOCAL =====
  async function calculateLocal(values) {
    const { p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias, solarOn, exTotal, bvSaldo } = values || getInputValues();
    
    const fiscal = __LF_getFiscalContext({ p1, p2, dias, cPunta, cLlano, cValle, zonaFiscal, viviendaCanarias });
    const isCanarias = fiscal.zona === 'canarias';
    
    const cachedTarifas = window.LF.cachedTarifas;
    if (!cachedTarifas.length) return;

    // OPTIMIZACIÓN INP: Calcular en chunks de 8 tarifas
    const CHUNK_SIZE = 8;
    const resultados = [];

    for (let chunkStart = 0; chunkStart < cachedTarifas.length; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, cachedTarifas.length);

      for (let index = chunkStart; index < chunkEnd; index++) {
        const t = cachedTarifas[index];

        if (t.esPVPC && t.pvpcNotComputable) {
          resultados.push({
            ...t,
            posicion: index + 1,
            potenciaNum: 0,
            potencia: '—',
            consumoNum: 0,
            consumo: '—',
            impuestosNum: 0,
            impuestos: '—',
            totalNum: Number.POSITIVE_INFINITY,
            total: '—',
            webUrl: t.web,
            solarNoCalculable: solarOn
          });
          continue;
        }

        if (t.esPVPC && t.metaPvpc) {
          const m = t.metaPvpc;
          const potenciaNum = m.terminoFijo;
          const consumoNum = m.terminoVariable;
          const impuestosNum = (m.bonoSocial || 0) + m.impuestoElectrico + m.equipoMedida + m.iva;
          const totalNum = m.totalFactura;
          resultados.push({
            ...t,
            posicion: index + 1,
            potenciaNum,
            potencia: formatMoney(potenciaNum),
            consumoNum,
            consumo: formatMoney(consumoNum),
            impuestosNum,
            impuestos: formatMoney(impuestosNum),
            totalNum,
            total: formatMoney(totalNum),
            webUrl: t.web,
            solarNoCalculable: solarOn
          });
          continue;
        }

        const pot = round2((p1 * dias * t.p1) + (p2 * dias * t.p2));
        const cons = round2((cPunta * t.cPunta) + (cLlano * t.cLlano) + (cValle * t.cValle));
        const tarifaAcceso = round2(6.979247 / 365 * dias);

        let consAdj = cons;
        let tarifaAdj = tarifaAcceso;
        let credit1 = 0;
        let credit2 = 0;
        let excedenteSobranteEur = 0;
        let precioExc = 0;
        let exKwh = 0;
        let bvSaldoFin = null;
        const fv = t.fv;
        let fvApplied = false;

        let solarNoCalculable = false;
        if (solarOn && t.esPVPC) {
          solarNoCalculable = true;
        } else if (solarOn && !t.esPVPC) {
          exKwh = clampNonNeg(exTotal);
          if (fv && fv.tipo !== 'NO COMPENSA') {
            precioExc = getFvExcPrice(fv);
            if (precioExc === null) {
              solarNoCalculable = true;
            } else if (exKwh > 0 && precioExc > 0) {
              fvApplied = true;
              const creditoPotencial = round2(exKwh * precioExc);
              const baseCompensable = cons;
              credit1 = Math.min(creditoPotencial, baseCompensable);
              consAdj = round2(Math.max(0, cons - credit1));
              excedenteSobranteEur = Math.max(0, creditoPotencial - credit1);
            }
          }
        }

        const sumaBase = pot + consAdj + tarifaAdj;
        const impuestoElec = round2(Math.max((5.11269632 / 100) * sumaBase, (cPunta + cLlano + cValle) * 0.001));
        const margen = isCanarias ? 0 : round2(dias * 0.026667);
        const baseEnergia = sumaBase + margen;
        const subtotal = baseEnergia + impuestoElec;
        const ivaBase = pot + consAdj + tarifaAdj + impuestoElec + margen;

        if (isCanarias) {
          const alquilerContador = dias * (0.81 / 30);
          const igicBase = fiscal.usoFiscal === 'vivienda' ? 0 : (baseEnergia + impuestoElec) * 0.03;
          const igicContador = alquilerContador * 0.07;
          const impuestosNum = impuestoElec + igicBase + igicContador;
          const totalBase = baseEnergia + impuestoElec + igicBase + igicContador + alquilerContador;

          let totalFinal = totalBase;
          if (solarOn && fv && fv.bv && fv.tipo === 'SIMPLE + BV') {
            let disponible = bvSaldo;
            credit2 = Math.min(clampNonNeg(disponible), totalBase);
            bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bvSaldo - credit2));
            totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
          }

          const totalNum = solarOn && fv && fv.bv
            ? round2(Math.max(0, totalBase - excedenteSobranteEur))
            : totalBase;
            
          resultados.push({
            ...t,
            posicion: index + 1,
            potenciaNum: pot,
            potencia: formatMoney(pot),
            consumoNum: consAdj,
            consumo: formatMoney(consAdj),
            impuestosNum: impuestosNum,
            impuestos: formatMoney(impuestosNum),
            totalNum,
            total: formatMoney(totalNum),
            webUrl: t.web,
            iva: 0,
            fvTipo: fv ? fv.tipo || null : null,
            fvExcRaw: fv ? fv.exc : null,
            fvRegla: fv ? fv.reglaBV || null : null,
            fvApplied,
            fvExKwh: exKwh,
            fvPriceUsed: precioExc,
            fvCredit1: credit1,
            fvCredit2: credit2,
            fvBvSaldoFin: bvSaldoFin,
            fvExcedenteSobrante: excedenteSobranteEur,
            fvTotalFinal: totalFinal,
            solarNoCalculable
          });
        } else {
          // Península
          const ivaPorc = 0.21;
          const ivaCuota = round2(ivaBase * ivaPorc);
          const alquilerContador = dias * (0.81 / 30);
          const ivaContador = round2(alquilerContador * ivaPorc);
          const impuestosNum = impuestoElec + ivaCuota + ivaContador;
          const totalBase = baseEnergia + impuestoElec + ivaCuota + alquilerContador + ivaContador;

          let totalFinal = totalBase;
          if (solarOn && fv && fv.bv && fv.tipo === 'SIMPLE + BV') {
            let disponible = bvSaldo;
            credit2 = Math.min(clampNonNeg(disponible), totalBase);
            bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bvSaldo - credit2));
            totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
          }

          const totalNum = solarOn && fv && fv.bv
            ? round2(Math.max(0, totalBase - excedenteSobranteEur))
            : totalBase;
            
          resultados.push({
            ...t,
            posicion: index + 1,
            potenciaNum: pot,
            potencia: formatMoney(pot),
            consumoNum: consAdj,
            consumo: formatMoney(consAdj),
            impuestosNum: impuestosNum,
            impuestos: formatMoney(impuestosNum),
            totalNum,
            total: formatMoney(totalNum),
            webUrl: t.web,
            iva: ivaCuota + ivaContador,
            fvTipo: fv ? fv.tipo || null : null,
            fvExcRaw: fv ? fv.exc : null,
            fvRegla: fv ? fv.reglaBV || null : null,
            fvApplied,
            fvExKwh: exKwh,
            fvPriceUsed: precioExc,
            fvCredit1: credit1,
            fvCredit2: credit2,
            fvBvSaldoFin: bvSaldoFin,
            fvExcedenteSobrante: excedenteSobranteEur,
            fvTotalFinal: totalFinal,
            solarNoCalculable
          });
        }
      }

      // Yield al navegador después de cada chunk
      if (chunkEnd < cachedTarifas.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Ordenar resultados
    resultados.sort((a, b) => {
      const diff = a.totalNum - b.totalNum;
      if (Math.abs(Math.round(diff * 100) / 100) < 0.01) {
        const bvA = Number(a.fvBvSaldoFin) || 0;
        const bvB = Number(b.fvBvSaldoFin) || 0;
        return bvB - bvA;
      }
      return diff;
    });

    // Filtrar tarifas que requieren FV si usuario no tiene solar
    let resultadosFiltrados = resultados;
    if (!solarOn) {
      resultadosFiltrados = resultados.filter(r => !r.requiereFV);
    }

    const firstValida = resultadosFiltrados.find(r => Number.isFinite(r.totalNum)) || resultadosFiltrados[0];
    const bestPrice = firstValida ? firstValida.totalNum : 0;
    
    let processed = resultadosFiltrados.map((r, i) => {
      const esMejor = firstValida ? r === firstValida : i === 0;
      const diff = (Number.isFinite(r.totalNum) && Number.isFinite(bestPrice)) ? (r.totalNum - bestPrice) : Number.POSITIVE_INFINITY;
      return {
        ...r,
        posicion: i + 1,
        esMejor,
        vsMejorNum: diff,
        vsMejor: esMejor ? '—' : (Number.isFinite(diff) ? '+' + formatMoney(diff) : '—')
      };
    });

    const preciosValidos = processed.filter(r => Number.isFinite(r.totalNum)).map(r => r.totalNum);
    const min = preciosValidos.length ? Math.min(...preciosValidos) : null;
    const max = preciosValidos.length ? Math.max(...preciosValidos) : null;
    const avg = preciosValidos.length ? (preciosValidos.reduce((a, b) => a + b, 0) / preciosValidos.length) : null;

    window.LF.renderAll({
      success: true,
      resumen: {
        mejor: firstValida ? firstValida.nombre : (processed[0]?.nombre || '—'),
        precio: (firstValida && Number.isFinite(firstValida.totalNum)) ? formatMoney(firstValida.totalNum) : '—'
      },
      stats: preciosValidos.length ? {
        precioMin: formatMoney(min),
        precioMax: formatMoney(max),
        precioMedio: formatMoney(avg)
      } : null,
      resultados: processed
    });
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    getFvExcPrice,
    calculateLocal
  });

  window.calculateLocal = calculateLocal;

})();
