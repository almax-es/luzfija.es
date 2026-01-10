// ===== LuzFija: Motor de Cálculo =====
// Usa LF_CONFIG para valores regulados

(function() {
  'use strict';

  const {
    state,
    parseNum, clampNonNeg, round2, formatMoney,
    __LF_getFiscalContext, getInputValues
  } = window.LF;

  // Referencia a configuración
  const CFG = window.LF_CONFIG;

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
    const isCanarias = fiscal.esCanarias;
    const isCeutaMelilla = fiscal.esCeutaMelilla;
    
    const cachedTarifas = window.LF.cachedTarifas;
    if (!cachedTarifas.length) return;

    // Valores de configuración
    const bonoSocialAnual = CFG.bonoSocial.eurosAnuales;
    const ieePorc = CFG.iee.porcentaje;
    const ieeMinKwh = CFG.iee.minimoEurosKwh;
    const alquilerMes = CFG.alquilerContador.eurosMes;

    // Impuestos por territorio
    const terr = CFG.getTerritorio(fiscal.zona);
    const impuestos = terr.impuestos;

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
        const tarifaAcceso = round2(bonoSocialAnual / 365 * dias);

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
        const consumoTotalKwh = cPunta + cLlano + cValle;
        const impuestoElec = round2(Math.max((ieePorc / 100) * sumaBase, consumoTotalKwh * ieeMinKwh));
        const alquilerContador = round2(dias * alquilerMes * 12 / 365);

        // ═══════════════════════════════════════════════════════════════
        // CÁLCULO POR TERRITORIO
        // ═══════════════════════════════════════════════════════════════

        if (isCanarias) {
          // ─────────────────────────────────────────────────────────────
          // CANARIAS: IGIC (0% vivienda ≤10kW, 3% otros, 7% contador)
          // ─────────────────────────────────────────────────────────────
          const baseEnergiaCan = sumaBase;
          const igicEnergia = fiscal.usoFiscal === 'vivienda' 
            ? 0 
            : round2((baseEnergiaCan + impuestoElec) * impuestos.energiaOtros);
          const igicContador = round2(alquilerContador * impuestos.contador);
          const impuestosNum = tarifaAdj + impuestoElec + igicEnergia + igicContador + alquilerContador;
          const totalBase = round2(baseEnergiaCan + impuestoElec + igicEnergia + alquilerContador + igicContador);

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
            territorio: 'canarias',
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

        } else if (isCeutaMelilla) {
          // ─────────────────────────────────────────────────────────────
          // CEUTA Y MELILLA: IPSI (1% energía, 4% contador)
          // Ley 8/1991 Art. 18
          // ─────────────────────────────────────────────────────────────
          const baseIPSI = sumaBase + impuestoElec;
          const ipsiEnergia = round2(baseIPSI * impuestos.energia);
          const ipsiContador = round2(alquilerContador * impuestos.contador);
          const impuestosNum = tarifaAdj + impuestoElec + ipsiEnergia + ipsiContador + alquilerContador;
          const totalBase = round2(sumaBase + impuestoElec + ipsiEnergia + alquilerContador + ipsiContador);

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
            territorio: 'ceutamelilla',
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
          // ─────────────────────────────────────────────────────────────
          // PENÍNSULA Y BALEARES: IVA 21%
          // ─────────────────────────────────────────────────────────────
          const ivaBase = pot + consAdj + tarifaAdj + impuestoElec + alquilerContador;
          const ivaPorc = impuestos.energia;
          const ivaCuota = round2(ivaBase * ivaPorc);
          const impuestosNum = tarifaAdj + impuestoElec + alquilerContador + ivaCuota;
          const totalBase = round2(ivaBase + ivaCuota);

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
            iva: ivaCuota,
            territorio: 'peninsula',
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

    // ⭐ SUN CLUB: Calcular si está marcado
    const sunClubOn = document.getElementById('csvCalcularSunClub')?.checked;
    console.log('[Sun Club] Checkbox marcado:', sunClubOn);
    
    if (sunClubOn) {
      const resultadoSunClub = calcularSunClub(values || getInputValues());
      window.LF.sunClubResult = resultadoSunClub;
      console.log('[Sun Club] Resultado guardado en window.LF.sunClubResult:', resultadoSunClub);
    } else {
      window.LF.sunClubResult = null;
      console.log('[Sun Club] Checkbox no marcado, resultado = null');
    }

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

  // ===== CALCULAR SUN CLUB =====
  function calcularSunClub(values) {
    console.log('[Sun Club] Iniciando cálculo...', values);
    
    if (!window.LF_TARIFAS_ESPECIALES || !window.LF_TARIFAS_ESPECIALES.sunClub.activa) {
      console.warn('[Sun Club] No está configurada o no está activa');
      return null;
    }
    
    if (!window.LF || !window.LF.consumosHorarios || window.LF.consumosHorarios.length === 0) {
      console.warn('[Sun Club] No hay datos horarios del CSV. Necesitas subir un CSV primero.');
      console.log('[Sun Club] window.LF:', window.LF);
      console.log('[Sun Club] consumosHorarios:', window.LF?.consumosHorarios);
      return null;
    }
    
    const SUN_CLUB = window.LF_TARIFAS_ESPECIALES.sunClub;
    const { p1, p2, dias, zonaFiscal, viviendaCanarias } = values;
    
    // Calcular kWh en horas solares desde CSV
    let kwhSolares = 0;
    let kwhNormales = 0;
    
    window.LF.consumosHorarios.forEach(c => {
      const horaInicio24h = c.hora - 1; // Convertir formato CNMC a hora inicio
      const kwh = c.kwh || 0;
      
      if (horaInicio24h >= SUN_CLUB.horaInicio && horaInicio24h < SUN_CLUB.horaFin) {
        kwhSolares += kwh;
      } else {
        kwhNormales += kwh;
      }
    });
    
    const consumoTotalKwh = kwhSolares + kwhNormales;
    if (consumoTotalKwh === 0) return null;
    
    // Precios
    const precioEnergia = SUN_CLUB.precios.energia;
    
    // Cálculo consumo (todo se paga al mismo precio base)
    const consumoBase = consumoTotalKwh * precioEnergia;
    
    // Crédito descuento (45% sobre horas solares)
    const creditoDescuento = round2(kwhSolares * precioEnergia * (SUN_CLUB.descuentoPct / 100));
    
    // Potencia
    const potencia = round2((p1 * dias * SUN_CLUB.precios.p1) + (p2 * dias * SUN_CLUB.precios.p2));
    
    // Contexto fiscal
    const fiscal = __LF_getFiscalContext({ 
      p1, p2, dias, 
      cPunta: precioEnergia, 
      cLlano: precioEnergia, 
      cValle: precioEnergia, 
      zonaFiscal, 
      viviendaCanarias 
    });
    
    // Configuración
    const CFG = window.LF_CONFIG;
    const bonoSocialAnual = CFG.bonoSocial.eurosAnuales;
    const tarifaAcceso = round2(bonoSocialAnual / 365 * dias);
    const sumaBase = potencia + consumoBase + tarifaAcceso;
    const impuestoElec = round2(Math.max((CFG.iee.porcentaje / 100) * sumaBase, consumoTotalKwh * CFG.iee.minimoEurosKwh));
    const alquilerContador = round2(dias * CFG.alquilerContador.eurosMes * 12 / 365);
    
    // Impuestos por territorio
    const terr = CFG.getTerritorio(fiscal.zona);
    const impuestos = terr.impuestos;
    
    let totalAPagar;
    let impuestosTotal;
    
    if (fiscal.esCanarias) {
      const igicEnergia = fiscal.usoFiscal === 'vivienda' 
        ? 0 
        : round2((sumaBase + impuestoElec) * impuestos.energiaOtros);
      const igicContador = round2(alquilerContador * impuestos.contador);
      impuestosTotal = tarifaAcceso + impuestoElec + igicEnergia + igicContador + alquilerContador;
      totalAPagar = round2(sumaBase + impuestoElec + igicEnergia + alquilerContador + igicContador);
    } else if (fiscal.esCeutaMelilla) {
      const ipsiEnergia = round2((sumaBase + impuestoElec) * impuestos.energia);
      const ipsiContador = round2(alquilerContador * impuestos.contador);
      impuestosTotal = tarifaAcceso + impuestoElec + ipsiEnergia + ipsiContador + alquilerContador;
      totalAPagar = round2(sumaBase + impuestoElec + ipsiEnergia + alquilerContador + ipsiContador);
    } else {
      const ivaBase = potencia + consumoBase + tarifaAcceso + impuestoElec + alquilerContador;
      const ivaCuota = round2(ivaBase * impuestos.energia);
      impuestosTotal = tarifaAcceso + impuestoElec + alquilerContador + ivaCuota;
      totalAPagar = round2(ivaBase + ivaCuota);
    }
    
    const pctSolares = (kwhSolares / consumoTotalKwh) * 100;
    
    const resultado = {
      nombre: SUN_CLUB.nombre,
      aPagar: totalAPagar,
      potencia: potencia,
      consumo: round2(consumoBase),
      impuestos: impuestosTotal,
      credito: creditoDescuento,
      kwhSolares: kwhSolares,
      kwhNormales: kwhNormales,
      kwhTotal: consumoTotalKwh,
      pctSolares: pctSolares,
      web: SUN_CLUB.web
    };
    
    console.log('[Sun Club] ✅ Cálculo completado:', resultado);
    return resultado;
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    getFvExcPrice,
    calculateLocal,
    calcularSunClub
  });

  window.calculateLocal = calculateLocal;

})();
