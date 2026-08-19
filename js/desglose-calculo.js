/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */


/** Cálculo puro del desglose de factura. */
(function() {
  'use strict';

  const round2 = (window.LF_CONFIG && typeof window.LF_CONFIG.round2 === 'function')
    ? window.LF_CONFIG.round2
    : (n) => Math.round(Number(n) * 100) / 100;
  const clampNonNeg = (n) => Math.max(0, n);
  // Normaliza valores numéricos que llegan como string/undefined para evitar NaN y errores de runtime.
  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  const Desglose = window.__LF_DesgloseFactura = window.__LF_DesgloseFactura || {};
  Object.assign(Desglose, {
    calcularDesglose(datos) {
      // ✅ Si es PVPC, usar datos ya calculados
      if (datos.esPVPC && datos.metaPvpc) {
        const meta = datos.metaPvpc;

        const isCanarias = datos.zonaFiscal === 'Canarias';
        const isCeutaMelilla = datos.zonaFiscal === 'CeutaMelilla';

        const pot = safeNum(meta.terminoFijo, 'potencia'); // Peajes+cargos potencia (sin margen)
        const cons = safeNum(meta.terminoVariable, 'consumo');
        const tarifaAcceso = safeNum(meta.bonoSocial, 'tarifaAcceso'); // Financiación bono social
        const margen = safeNum(meta.costeMargenPot, 'margen');

        // Descuento bono social (si procede) ya debe venir aplicado dentro de la meta PVPC (se recalcula en el ranking)
        const bonoSocialDescuentoEur = safeNum(meta.bonoSocialDescuentoEur, 'bonoSocialDescuentoEur');
        const bonoSocialCalc = meta.bonoSocialCalc || null;

        // Base imponible para el Impuesto Eléctrico (ya incluye cualquier descuento del bono social)
        const baseEnergia = Number.isFinite(Number(meta.baseEnergia))
          ? Number(meta.baseEnergia)
          : round2((pot + margen + cons + tarifaAcceso) - bonoSocialDescuentoEur);

        const alquilerContador = Number.isFinite(Number(meta.equipoMedida))
          ? Number(meta.equipoMedida)
          : safeNum(meta.baseContador, 'baseContador');

        const impuestoElec = Number.isFinite(Number(meta.impuestoElectrico))
          ? Number(meta.impuestoElectrico)
          : 0;

        const impuestoEnergia = Number.isFinite(Number(meta.impuestoEnergia))
          ? Number(meta.impuestoEnergia)
          : 0;

        const impuestoContador = Number.isFinite(Number(meta.impuestoContador))
          ? Number(meta.impuestoContador)
          : 0;

        const iva = Number.isFinite(Number(meta.iva)) ? Number(meta.iva) : 0;
        const ivaBase = Number.isFinite(Number(meta.ivaBase)) ? Number(meta.ivaBase) : 0;
        const baseIPSI = Number.isFinite(Number(meta.baseIPSI)) ? Number(meta.baseIPSI) : 0;
        const usoFiscal = meta.usoFiscal || 'otros';

        const totalFactura = Number.isFinite(Number(meta.totalFactura))
          ? Number(meta.totalFactura)
          : round2(baseEnergia + impuestoElec + alquilerContador + impuestoEnergia + impuestoContador);

        // PVPC: no hay FV (solar no calculable aquí)
        const impuestosTotal = Number.isFinite(Number(meta.impuestosTotal))
          ? Number(meta.impuestosTotal)
          : round2(tarifaAcceso + impuestoElec + alquilerContador + impuestoEnergia + impuestoContador);

        return {
          pot: pot,
          margen: margen,
          cons: cons,
          consAdj: cons,
          tarifaAcceso: tarifaAcceso,
          tarifaAdj: tarifaAcceso,
          credit1: 0,
          excedenteSobranteEur: 0,
          sumaBase: baseEnergia,
          impuestoElec: round2(impuestoElec),
          alquilerContador: round2(alquilerContador),
          iva: round2(iva),
          ivaBase: round2(ivaBase),
          baseIPSI: round2(baseIPSI),
          baseEnergia: round2(baseEnergia),
          igicBase: round2(impuestoEnergia),
          igicContador: round2(impuestoContador),
          ipsiEnergia: round2(impuestoEnergia),
          ipsiContador: round2(impuestoContador),
          totalBase: round2(totalFactura),
          totalFinal: round2(totalFactura),
          totalRanking: round2(totalFactura),
          impuestosNum: round2(impuestosTotal),
          isCanarias: isCanarias,
          isCeutaMelilla: isCeutaMelilla,
          isPVPC: true,
          usoFiscal: usoFiscal,
          consumoTotalKwh: round2(safeNum(datos.consumoPunta) + safeNum(datos.consumoLlano) + safeNum(datos.consumoValle)),
          fechaYmd: (window.LF_CONFIG && typeof window.LF_CONFIG.resolveFiscalDateYmd === 'function')
            ? window.LF_CONFIG.resolveFiscalDateYmd(meta.fechaYmd || datos.fechaFin || datos.fechaInicio)
            : undefined,
          bonoSocialDescuentoEur: round2(bonoSocialDescuentoEur),
          bonoSocialProximoMes: safeNum(meta.bonoSocialProximoMes, 'bonoSocialProximoMes'),
          bonoSocialCalc: bonoSocialCalc
        };
      }

      // ✅ Para tarifas normales, calcular como antes
      const {
        potenciaP1 = 0, potenciaP2 = 0, dias = 30,
        precioP1 = 0, precioP2 = 0,
        consumoPunta = 0, consumoLlano = 0, consumoValle = 0,
        precioPunta = 0, precioLlano = 0, precioValle = 0,
        excedentes = 0, precioCompensacion = 0,
        tipoCompensacion = 'SIMPLE', topeCompensacion = 'ENERGIA',
        bateriaVirtual = 0, tieneBV = false,
        precioBV = 0,
        incluyeServiciosAjuste = true, ssaaNum = 0, ssaaRate = 0, ssaaMonth = null,
        zonaFiscal = 'Península', esViviendaCanarias = true, solarOn = false
      } = datos;

      // Configuración centralizada
      const CFG = window.LF_CONFIG;
      const isCanarias = zonaFiscal === 'Canarias';
      const isCeutaMelilla = zonaFiscal === 'CeutaMelilla';
      const potenciaContratada = Math.max(potenciaP1, potenciaP2);
      const fiscal = (CFG && typeof CFG.getFiscalContext === 'function')
        ? CFG.getFiscalContext({
            zona: zonaFiscal,
            potenciaContratada,
            viviendaCanarias: esViviendaCanarias,
            fechaYmd: datos.fechaYmd || datos.fechaFin || datos.fechaInicio
          })
        : null;

      const pot = round2((potenciaP1 * dias * precioP1) + (potenciaP2 * dias * precioP2));
      const consBase = round2((consumoPunta * precioPunta) + (consumoLlano * precioLlano) + (consumoValle * precioValle));
      const ssaa = !incluyeServiciosAjuste
        ? round2(Math.max(0, safeNum(ssaaNum)))
        : 0;
      const cons = round2(consBase + ssaa);
      // La UI conserva la clave tarifaAcceso por compatibilidad, pero el concepto es
      // la financiación del bono social y se calcula desde la regla centralizada.
      const costeBonoSocial = round2(CFG.calcularBonoSocial(dias));
      const tarifaAcceso = costeBonoSocial;

      let consAdj = cons;
      let tarifaAdj = tarifaAcceso;
      let credit1 = 0;
      let excedenteSobranteEur = 0;
      let excedenteNoCompensableEur = 0;
      let baseCompensable = 0;
      let peajesTotal = 0;

      if (solarOn && excedentes > 0 && precioCompensacion > 0 && tipoCompensacion !== 'NO COMPENSA') {
        const exKwh = clampNonNeg(excedentes);
        const creditoPotencial = round2(exKwh * precioCompensacion);

        // Compensación: sobre término de energía completo, o solo energía pura si ENERGIA_PARCIAL
        baseCompensable = cons;
        if (topeCompensacion === 'ENERGIA_PARCIAL') {
          const pc = CFG.peajesCargosEnergia || {};
          peajesTotal = round2(
            consumoPunta * (pc.P1 || 0) + consumoLlano * (pc.P2 || 0) + consumoValle * (pc.P3 || 0)
          );
          baseCompensable = clampNonNeg(cons - peajesTotal);
        }

        credit1 = Math.min(creditoPotencial, baseCompensable);
        consAdj = round2(Math.max(0, cons - credit1));
        const esCompParcial = topeCompensacion === 'ENERGIA_PARCIAL';
        excedenteNoCompensableEur = esCompParcial
          ? round2(Math.max(0, Math.min(creditoPotencial, cons) - credit1))
          : 0;
        excedenteSobranteEur = round2(Math.max(0, creditoPotencial - credit1));
      }

      const sumaBase = pot + consAdj + tarifaAdj;
      const consumoTotalKwh = consumoPunta + consumoLlano + consumoValle;
      const impuestoElec = round2(CFG.calcularIEE(sumaBase, consumoTotalKwh, fiscal?.fechaYmd || datos.fechaYmd || datos.fechaFin || datos.fechaInicio));
      const alquilerContador = round2(dias * CFG.alquilerContador.eurosMes * 12 / 365);
      const bvActivaSimple = Boolean(solarOn && tieneBV && tipoCompensacion === 'SIMPLE + BV');
      const precioBVMensual = Math.max(0, safeNum(precioBV));
      const costeBV = bvActivaSimple && precioBVMensual > 0
        ? round2(precioBVMensual * dias * 12 / 365)
        : 0;
      const taxCalc = CFG.calcularImpuestoIndirecto({
        zona: zonaFiscal,
        usoFiscal: fiscal?.usoFiscal || 'otros',
        baseEnergia: sumaBase,
        impuestoElectrico: impuestoElec,
        baseContador: alquilerContador,
        baseServicios: costeBV,
        potenciaContratada,
        viviendaCanarias: esViviendaCanarias,
        fechaYmd: fiscal?.fechaYmd || datos.fechaYmd || datos.fechaFin || datos.fechaInicio
      });

      let resultado;

      if (isCanarias) {
        // ═══════════════════════════════════════════════════════════════
        // CANARIAS: IGIC (0% vivienda ≤10kW, 3% otros, 7% contador)
        // ═══════════════════════════════════════════════════════════════
        const baseEnergia = sumaBase;
        const usoFiscal = fiscal?.usoFiscal || (esViviendaCanarias && potenciaContratada > 0 && potenciaContratada <= 10 ? 'vivienda' : 'otros');
        const igicBase = round2(taxCalc.impuestoEnergia);
        const igicContador = round2(taxCalc.impuestoContador);
        const impuestoServicios = round2(taxCalc.impuestoServicios || 0);
        const impuestosNum = round2(impuestoElec + igicBase + igicContador + impuestoServicios + costeBV);
        let totalBase = round2(baseEnergia + impuestoElec + igicBase + alquilerContador + igicContador + costeBV + impuestoServicios);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (bvActivaSimple) {
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = bvActivaSimple ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur, excedenteNoCompensableEur,
          sumaBase, impuestoElec, baseEnergia, alquilerContador, igicBase, igicContador,
          impuestoServicios, impuestosNum, totalBase, credit2, bvSaldoFin, totalFinal, totalRanking,
          isCanarias: true, isCeutaMelilla: false, usoFiscal,
          precioBVMensual, costeBV, baseCompensable, peajesTotal,
          consBase, ssaa, ssaaRate: Math.max(0, safeNum(ssaaRate)), ssaaMonth };

      } else if (isCeutaMelilla) {
        // ═══════════════════════════════════════════════════════════════
        // CEUTA Y MELILLA: IPSI (1% energía, 4% contador)
        // Ley 8/1991 Art. 18
        // ═══════════════════════════════════════════════════════════════
        const baseEnergia = sumaBase;
        const baseIPSI = round2(taxCalc.baseIPSI);
        const ipsiEnergia = round2(taxCalc.impuestoEnergia);
        const ipsiContador = round2(taxCalc.impuestoContador);
        const impuestoServicios = round2(taxCalc.impuestoServicios || 0);
        const impuestosNum = round2(impuestoElec + ipsiEnergia + ipsiContador + impuestoServicios + costeBV);
        let totalBase = round2(sumaBase + impuestoElec + ipsiEnergia + alquilerContador + ipsiContador + costeBV + impuestoServicios);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (bvActivaSimple) {
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = bvActivaSimple ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur, excedenteNoCompensableEur,
          sumaBase, impuestoElec, baseEnergia, alquilerContador, baseIPSI, ipsiEnergia, ipsiContador,
          impuestoServicios, impuestosNum, totalBase, credit2, bvSaldoFin, totalFinal, totalRanking,
          isCanarias: false, isCeutaMelilla: true,
          precioBVMensual, costeBV, baseCompensable, peajesTotal,
          consBase, ssaa, ssaaRate: Math.max(0, safeNum(ssaaRate)), ssaaMonth };

      } else {
        // ═══════════════════════════════════════════════════════════════
        // PENÍNSULA Y BALEARES: IVA vigente
        // ═══════════════════════════════════════════════════════════════
        const baseEnergia = sumaBase + impuestoElec + alquilerContador;
        const ivaBase = round2(taxCalc.ivaBase);
        const iva = round2(taxCalc.iva);
        let totalBase = round2(ivaBase + iva);

        let credit2 = 0, bvSaldoFin = null, totalFinal = totalBase;

        if (bvActivaSimple) {
          let disponible = bateriaVirtual;
          credit2 = Math.min(clampNonNeg(disponible), totalBase);
          bvSaldoFin = round2(excedenteSobranteEur + Math.max(0, bateriaVirtual - credit2));
          totalFinal = credit2 > 0 ? round2(Math.max(0, totalBase - credit2)) : totalBase;
        }

        const totalRanking = bvActivaSimple ? round2(Math.max(0, totalBase - excedenteSobranteEur)) : totalBase;
        const impuestosNum = round2(tarifaAdj + impuestoElec + alquilerContador + iva + costeBV);

        resultado = { pot, cons, consAdj, tarifaAcceso, tarifaAdj, credit1, excedenteSobranteEur, excedenteNoCompensableEur,
          sumaBase, impuestoElec, alquilerContador, baseEnergia, ivaBase, iva, impuestosNum,
          totalBase, credit2, bvSaldoFin, totalFinal, totalRanking, isCanarias: false, isCeutaMelilla: false,
          precioBVMensual, costeBV, baseCompensable, peajesTotal,
          consBase, ssaa, ssaaRate: Math.max(0, safeNum(ssaaRate)), ssaaMonth };
      }

      resultado.consumoTotalKwh = round2(consumoTotalKwh);
      resultado.fechaYmd = fiscal?.fechaYmd || (CFG && typeof CFG.resolveFiscalDateYmd === 'function'
        ? CFG.resolveFiscalDateYmd(datos.fechaYmd || datos.fechaFin || datos.fechaInicio)
        : undefined);
      return resultado;
    },

  });

})();
