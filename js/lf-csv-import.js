// ===== LuzFija: CSV/XLSX Import =====
// Importación de archivos de consumo de distribuidoras

(function() {
  'use strict';

  const { toast, formatMoney, round2 } = window.LF;

  // ===== LAZY LOAD XLSX =====
  let xlsxLoading = null;

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    if (xlsxLoading) return xlsxLoading;

    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/xlsx/xlsx.full.min.js', document.baseURI).toString();
      script.onload = () => {
        lfDbg('[XLSX] Librería cargada bajo demanda');
        resolve();
      };
      script.onerror = () => reject(new Error('Error al cargar librería XLSX'));
      document.head.appendChild(script);
    });

    return xlsxLoading;
  }

  // ===== PARSEO CSV =====
  // Normalización robusta de celdas CSV (BOM, comillas y formatos numéricos ES/EN).
  // E-REDES (Portugal) suele exportar CSV con separador ';' y números entrecomillados con coma decimal.
  function stripBomAndTrim(v) {
    return String(v ?? '').replace(/^\uFEFF/, '').trim();
  }

  function stripOuterQuotes(v) {
    let s = stripBomAndTrim(v);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  function parseNumberFlexibleCSV(v) {
    const s0 = stripOuterQuotes(v);
    if (!s0) return NaN;

    const hasComma = s0.includes(',');
    const hasDot = s0.includes('.');
    let norm = s0;

    // Maneja 1.234,56 (ES) y 1,234.56 (US)
    if (hasComma && hasDot) {
      if (s0.lastIndexOf(',') > s0.lastIndexOf('.')) {
        norm = s0.replace(/\./g, '').replace(',', '.');
      } else {
        norm = s0.replace(/,/g, '');
      }
    } else if (hasComma && !hasDot) {
      norm = s0.replace(',', '.');
    }

    return Number(norm);
  }

  function parseCSVConsumos(fileContent) {
    const lines = String(fileContent || '').split('\n');
    if (lines.length < 2) throw new Error('CSV vacío o inválido');

    const header = stripBomAndTrim(lines[0]).toLowerCase();
    const isIberdrolaCliente = header.includes('consumo wh') && header.includes('generacion wh');
    const isFormatoEspanol = header.includes('ae_kwh') || header.includes('consumo_kwh') || header.includes('energiavertida_kwh');

    if (!isFormatoEspanol && !isIberdrolaCliente) {
      throw new Error('Formato CSV no reconocido. Se esperaba el formato estándar de distribuidoras españolas o Datadis');
    }

    if (isIberdrolaCliente) {
      return parseCSVIberdrolaCliente(lines);
    }

    const tieneSolar = header.includes('as_kwh') || header.includes('energiavertida_kwh');
    const tieneAutoconsumo = header.includes('ae_autocons_kwh') || header.includes('energiaautoconsumida_kwh');
    const consumos = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(';');
      if (cols.length < 4) continue;

      const fechaStr = stripOuterQuotes(cols[1]);
      const hora = parseInt(stripOuterQuotes(cols[2]), 10);
      const kwhStr = stripOuterQuotes(cols[3]);
      const excedenteStr = tieneSolar ? cols[4] : null;
      const autoconsumoStr = tieneAutoconsumo ? cols[5] : null;
      
      let idxEstado = 4;
      if (tieneSolar) idxEstado++;
      if (tieneAutoconsumo) idxEstado++;
      
      const estadoStr = (idxEstado < cols.length) ? stripOuterQuotes(cols[idxEstado]) : '';
      const esReal = estadoStr === 'R';

      if (!kwhStr || kwhStr.trim() === '') continue;

      const kwh = parseNumberFlexibleCSV(kwhStr);
      if (isNaN(kwh)) continue;

      let excedente = 0;
      if (excedenteStr && excedenteStr.trim() !== '') {
        const exc = parseNumberFlexibleCSV(excedenteStr);
        if (!isNaN(exc)) excedente = exc;
      }

      let autoconsumo = 0;
      if (autoconsumoStr && autoconsumoStr.trim() !== '') {
        const auto = parseNumberFlexibleCSV(autoconsumoStr);
        if (!isNaN(auto)) autoconsumo = auto;
      }

      const [dia, mes, año] = String(fechaStr || '').split('/').map(Number);
      const fecha = new Date(año, mes - 1, dia);
      if (isNaN(fecha.getTime())) continue;

      consumos.push({ fecha, hora, kwh, excedente, autoconsumo, esReal });
    }

    return consumos;
  }

  function parseCSVIberdrolaCliente(lines) {
    const consumos = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',');
      if (cols.length < 6) continue;

      const fechaHoraStr = stripOuterQuotes(cols[1]);
      const consumoWhStr = stripOuterQuotes(cols[4]);
      const generacionWhStr = stripOuterQuotes(cols[5]);

      if (!fechaHoraStr || !consumoWhStr) continue;

      const [fechaParte, horaParte] = fechaHoraStr.split(' ');
      if (!fechaParte || !horaParte) continue;

      const [año, mes, dia] = fechaParte.split('/').map(Number);
      const horaNum = parseInt(horaParte.split(':')[0]);
      const fecha = new Date(año, mes - 1, dia);
      if (isNaN(fecha.getTime())) continue;

      const hora = horaNum + 1;
      const consumoWh = parseNumberFlexibleCSV(consumoWhStr);
      if (isNaN(consumoWh)) continue;
      const kwh = consumoWh / 1000;

      let excedente = 0;
      if (generacionWhStr && generacionWhStr.trim() !== '') {
        const generacionWh = parseNumberFlexibleCSV(generacionWhStr);
        if (!isNaN(generacionWh)) excedente = generacionWh / 1000;
      }

      consumos.push({ fecha, hora, kwh, excedente, autoconsumo: 0, esReal: true });
    }

    return consumos;
  }

  // ===== PARSEO XLSX =====
  async function parseXLSXConsumos(fileBuffer) {
    await ensureXLSX();

    const workbook = XLSX.read(fileBuffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

    if (data.length < 2) {
      throw new Error('Archivo Excel vacío o formato no reconocido');
    }

    // --- Soporte adicional: Excel en formato matriz (Fecha + H01..H24) ---
    // Formato observado en E-REDES (distribuidora Portugal) y exportaciones similares: una fila por día
    // y 24 columnas H01..H24 con kWh por hora.
    // Este bloque lo detecta y lo transforma al mismo formato interno (24 registros por día) sin afectar al
    // import existente basado en columnas FECHA/CONSUMO/GENERACION.
    function isHourlyMatrixHeaderRow(row) {
      if (!Array.isArray(row)) return false;
      for (let h = 1; h <= 24; h++) {
        const expected = `H${String(h).padStart(2, '0')}`;
        const got = String(row[h] ?? '').trim().toUpperCase();
        if (got !== expected) return false;
      }
      return true;
    }

    function parseDateFlexible(value) {
      if (value instanceof Date && !isNaN(value.getTime())) return value;

      const s = String(value ?? '').trim();
      if (!s) return null;

      // Acepta: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd (opcionalmente con hora, que ignoramos)
      const firstToken = s.split(' ')[0];

      let m = firstToken.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m) {
        const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
        const dt = new Date(y, mo - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
      }

      m = firstToken.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (m) {
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        const dt = new Date(y, mo - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
      }

      // Último recurso: Date.parse (depende del navegador, usar con cautela)
      const dt = new Date(firstToken);
      return isNaN(dt.getTime()) ? null : dt;
    }

    function parseNumberFlexible(value) {
      if (typeof value === 'number') return value;

      const s = String(value ?? '').trim();
      if (!s) return NaN;

      const hasComma = s.includes(',');
      const hasDot = s.includes('.');
      let norm = s;

      // Maneja 1.234,56 (ES) y 1,234.56 (US)
      if (hasComma && hasDot) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
          norm = s.replace(/\./g, '').replace(',', '.');
        } else {
          norm = s.replace(/,/g, '');
        }
      } else if (hasComma && !hasDot) {
        norm = s.replace(',', '.');
      }

      return Number(norm);
    }

    function parseXLSXConsumosMatriz(data, headerRow) {
      const consumos = [];

      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 2) continue;

        const fecha = parseDateFlexible(row[0]);
        if (!fecha) continue;

        for (let h = 1; h <= 24; h++) {
          let kwh = parseNumberFlexible(row[h]);
          if (!Number.isFinite(kwh)) kwh = 0;

          const periodoCalculado = getPeriodoHorarioCSV(fecha, h);

          consumos.push({
            fecha,
            hora: h,          // H01 => 1 (00:00-01:00) ... H24 => 24 (23:00-24:00)
            kwh,              // el fichero matriz suele venir en kWh por hora
            excedente: 0,
            autoconsumo: 0,
            periodo: periodoCalculado,
            esReal: true
          });
        }
      }

      return consumos;
    }

    // Intenta detectar matriz horaria en las primeras filas (típicamente la cabecera está en la fila 1)
    let matrixHeaderRow = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      if (isHourlyMatrixHeaderRow(data[i])) {
        matrixHeaderRow = i;
        break;
      }
    }
    if (matrixHeaderRow !== -1) {
      return parseXLSXConsumosMatriz(data, matrixHeaderRow);
    }


    let headerRow = -1;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      if (row && row.some(cell => {
        const cellStr = String(cell).toUpperCase();
        return cellStr.includes('FECHA-HORA') || cellStr.includes('FECHA');
      })) {
        headerRow = i;
        break;
      }
    }

    if (headerRow === -1) {
      throw new Error('No se encontró la fila de cabecera en el Excel');
    }

    const headers = data[headerRow];
    if (!headers || headers.length < 4) {
      throw new Error('Formato Excel no reconocido');
    }

    const colFechaHora = headers.findIndex(h => String(h).toUpperCase().includes('FECHA'));
    const colPeriodo = headers.findIndex(h => {
      const hStr = String(h).toUpperCase();
      return hStr.includes('PERIODO') && hStr.includes('TARIFARIO');
    });
    const colConsumo = headers.findIndex(h => String(h).toUpperCase().includes('CONSUMO'));
    const colGeneracion = headers.findIndex(h => String(h).toUpperCase().includes('GENERACION'));

    if (colFechaHora === -1 || colConsumo === -1 || colGeneracion === -1) {
      throw new Error('No se encontraron las columnas necesarias en el Excel');
    }

    const consumos = [];

    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 4) continue;

      const fechaHoraStr = row[colFechaHora];
      const periodoTarifario = colPeriodo !== -1 ? String(row[colPeriodo] || '').trim() : '';
      const consumoWh = parseFloat(row[colConsumo]) || 0;
      const generacionWh = parseFloat(row[colGeneracion]) || 0;

      if (!fechaHoraStr) continue;

      const [fechaStr, horaStr] = String(fechaHoraStr).split(' ');
      if (!fechaStr || !horaStr) continue;

      const [año, mes, dia] = fechaStr.split('/').map(Number);
      const horaXLSX = parseInt(horaStr.split(':')[0]);
      const horaCNMC = horaXLSX + 1;

      const fecha = new Date(año, mes - 1, dia);
      if (isNaN(fecha.getTime())) continue;

      const consumoKwh = consumoWh / 1000;
      const generacionKwh = generacionWh / 1000;

      let periodoCalculado = null;
      if (periodoTarifario) {
        const pUpper = periodoTarifario.toUpperCase();
        if (pUpper.includes('PUNTA') || pUpper === 'P1') periodoCalculado = 'P1';
        else if (pUpper.includes('LLANO') || pUpper === 'P2') periodoCalculado = 'P2';
        else if (pUpper.includes('VALLE') || pUpper === 'P3') periodoCalculado = 'P3';
      }

      consumos.push({
        fecha,
        hora: horaCNMC,
        kwh: consumoKwh,
        excedente: generacionKwh,
        autoconsumo: 0,
        periodo: periodoCalculado,
        esReal: true
      });
    }

    return consumos;
  }

  // ===== FESTIVOS Y PERIODOS =====
  function calcularViernesSanto(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const pascua = new Date(year, month - 1, day);
    const viernesSanto = new Date(pascua);
    viernesSanto.setDate(pascua.getDate() - 2);

    const mes = String(viernesSanto.getMonth() + 1).padStart(2, '0');
    const dia = String(viernesSanto.getDate()).padStart(2, '0');
    return `${year}-${mes}-${dia}`;
  }

  function getFestivosNacionales(year) {
    return [
      `${year}-01-01`, `${year}-01-06`,
      calcularViernesSanto(year),
      `${year}-05-01`, `${year}-08-15`, `${year}-10-12`,
      `${year}-11-01`, `${year}-12-06`, `${year}-12-08`, `${year}-12-25`
    ];
  }

  function getPeriodoHorarioCSV(fecha, hora) {
    const diaSemana = fecha.getDay();
    const esFinde = diaSemana === 0 || diaSemana === 6;

    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    const fechaStr = `${year}-${month}-${day}`;

    const festivosNacionales = getFestivosNacionales(year);
    const esFestivo = festivosNacionales.includes(fechaStr);

    if (esFinde || esFestivo) return 'P3';

    const horaInicio = hora - 1;
    if (horaInicio >= 0 && horaInicio < 8) return 'P3';
    if ((horaInicio >= 10 && horaInicio < 14) || (horaInicio >= 18 && horaInicio < 22)) return 'P1';
    return 'P2';
  }

  function ymdLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ===== CLASIFICAR CONSUMOS =====
  function clasificarConsumosPorPeriodo(consumos) {
    const totales = {
      P1: 0, P2: 0, P3: 0,
      excedentesP1: 0, excedentesP2: 0, excedentesP3: 0,
      autoconsumoP1: 0, autoconsumoP2: 0, autoconsumoP3: 0
    };
    const diasUnicos = new Set();
    let datosReales = 0;
    let datosEstimados = 0;

    consumos.forEach(c => {
      const periodo = c.periodo || getPeriodoHorarioCSV(c.fecha, c.hora);
      totales[periodo] += c.kwh || 0;

      if (c.excedente) totales[`excedentes${periodo}`] += c.excedente;
      if (c.autoconsumo) totales[`autoconsumo${periodo}`] += c.autoconsumo;

      const fechaKey = ymdLocal(c.fecha);
      diasUnicos.add(fechaKey);

      if (c.esReal) datosReales++;
      else datosEstimados++;
    });

    const totalKwh = totales.P1 + totales.P2 + totales.P3;
    const totalExcedentes = totales.excedentesP1 + totales.excedentesP2 + totales.excedentesP3;
    const totalAutoconsumo = totales.autoconsumoP1 + totales.autoconsumoP2 + totales.autoconsumoP3;
    const tieneExcedentes = totalExcedentes > 0;

    return {
      punta: round2(totales.P1).toFixed(2).replace('.', ','),
      llano: round2(totales.P2).toFixed(2).replace('.', ','),
      valle: round2(totales.P3).toFixed(2).replace('.', ','),
      excedentesPunta: round2(totales.excedentesP1).toFixed(2).replace('.', ','),
      excedentesLlano: round2(totales.excedentesP2).toFixed(2).replace('.', ','),
      excedentesValle: round2(totales.excedentesP3).toFixed(2).replace('.', ','),
      autoconsumoPunta: round2(totales.autoconsumoP1).toFixed(2).replace('.', ','),
      autoconsumoLlano: round2(totales.autoconsumoP2).toFixed(2).replace('.', ','),
      autoconsumoValle: round2(totales.autoconsumoP3).toFixed(2).replace('.', ','),
      dias: diasUnicos.size,
      totalKwh: round2(totalKwh).toFixed(2).replace('.', ','),
      totalExcedentes: round2(totalExcedentes).toFixed(2).replace('.', ','),
      totalAutoconsumo: round2(totalAutoconsumo).toFixed(2).replace('.', ','),
      tieneExcedentes,
      datosReales,
      datosEstimados,
      porcentajes: {
        punta: round2(totales.P1 / totalKwh * 100).toFixed(1).replace('.', ','),
        llano: round2(totales.P2 / totalKwh * 100).toFixed(1).replace('.', ','),
        valle: round2(totales.P3 / totalKwh * 100).toFixed(1).replace('.', ',')
      }
    };
  }

  // ===== PROCESAR ARCHIVOS =====
  async function procesarCSVConsumos(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const consumos = parseCSVConsumos(content);
          if (consumos.length === 0) {
            reject(new Error('No se encontraron datos válidos en el CSV'));
            return;
          }
          
          const resultado = clasificarConsumosPorPeriodo(consumos);
          resultado.formato = 'CSV';
          // ⭐ SUN CLUB: adjuntar consumos horarios (se guardan globalmente solo al aplicar)
          resultado.consumosHorarios = consumos;
          resolve(resultado);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsText(file);
    });
  }

  async function procesarXLSXConsumos(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const buffer = e.target.result;
          const consumos = await parseXLSXConsumos(buffer);
          if (consumos.length === 0) {
            reject(new Error('No se encontraron datos válidos en el Excel'));
            return;
          }
          
          const resultado = clasificarConsumosPorPeriodo(consumos);
          resultado.formato = 'XLSX';
          // ⭐ SUN CLUB: adjuntar consumos horarios (se guardan globalmente solo al aplicar)
          resultado.consumosHorarios = consumos;
          resolve(resultado);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo Excel'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ===== MODAL PREVIEW =====
  function mostrarPreviewCSV(resultado) {
    // ⭐ SUN CLUB: Guardar estado previo (cerrar sin aplicar no cambia nada)
    window.LF = window.LF || {};
    const __prevSunClubEnabled = window.LF.sunClubEnabled === true;
    const __sunClubCheckedAttr = __prevSunClubEnabled ? 'checked' : '';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'false');
    modal.tabIndex = -1;

    // Accesibilidad: restaurar foco + focus trap
    const __csvPrevFocusEl = document.activeElement;
    let __csvFocusTrapCleanup = null;

    const __csvFocusableSelector = [
      'a[href]:not([tabindex="-1"])',
      'button:not([disabled]):not([tabindex="-1"])',
      'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
      'select:not([disabled]):not([tabindex="-1"])',
      'textarea:not([disabled]):not([tabindex="-1"])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    function __csvIsVisible(node){
      if (!node) return false;
      if (node.hasAttribute('disabled')) return false;
      if (node.getAttribute('aria-hidden') === 'true') return false;
      return !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
    }

    function __csvFocusables(){
      return Array.from(modal.querySelectorAll(__csvFocusableSelector)).filter(__csvIsVisible);
    }

    function __csvFocusTrapAttach(){
      if (__csvFocusTrapCleanup) return;
      const onKeyDown = (e) => {
        if (!document.body.contains(modal)) return;
        if (e.key !== 'Tab') return;
        const els = __csvFocusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];

        if (!modal.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }

        if (e.shiftKey && document.activeElement === first){
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last){
          e.preventDefault();
          first.focus();
        }
      };
      modal.addEventListener('keydown', onKeyDown);
      __csvFocusTrapCleanup = () => {
        modal.removeEventListener('keydown', onKeyDown);
        __csvFocusTrapCleanup = null;
      };
    }

    const isLightMode = document.body.classList.contains('light-mode');

    let __csvLocked = false;
    let __csvScrollY = 0;
    
    function __csvLock() {
      if (document.documentElement.style.overflow === 'hidden') return;
      __csvScrollY = window.scrollY || 0;
      document.documentElement.style.overflow = 'hidden';
      __csvLocked = true;
    }
    
    function __csvUnlock() {
      if (!__csvLocked) return;
      document.documentElement.style.overflow = '';
      window.scrollTo(0, __csvScrollY);
      __csvLocked = false;
    }

    const content = document.createElement('div');
    content.className = 'modal-content card';
    content.style.maxWidth = '520px';

    let excedenteHTML = '';
    if (resultado.tieneExcedentes) {
      const excBg = isLightMode ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.12)';
      const excBorder = isLightMode ? 'rgba(217, 119, 6, 0.4)' : 'rgba(217, 119, 6, 0.3)';
      excedenteHTML = `
        <div style="background: ${excBg}; padding: 16px; border-radius: 12px; margin-top: 16px; border: 1px solid ${excBorder};">
          <div style="font-size: 13px; font-weight: 900; margin-bottom: 12px; color: var(--text); display: flex; align-items: center; gap: 6px;">
            ☀️ Excedentes solares detectados
          </div>
          <div style="display: grid; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: var(--muted2);">Total excedentes</span>
              <span style="font-size: 14px; font-weight: 700; color: var(--warn);">${resultado.totalExcedentes} kWh</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
              <div><div style="font-size: 10px; color: var(--muted2); margin-bottom: 2px;">Punta</div><div style="font-size: 12px; font-weight: 700; color: var(--text);">${resultado.excedentesPunta} kWh</div></div>
              <div><div style="font-size: 10px; color: var(--muted2); margin-bottom: 2px;">Llano</div><div style="font-size: 12px; font-weight: 700; color: var(--text);">${resultado.excedentesLlano} kWh</div></div>
              <div><div style="font-size: 10px; color: var(--muted2); margin-bottom: 2px;">Valle</div><div style="font-size: 12px; font-weight: 700; color: var(--text);">${resultado.excedentesValle} kWh</div></div>
            </div>
            ${resultado.totalAutoconsumo !== '0,00' ? `
            <div style="padding-top: 8px; border-top: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: var(--muted2);">Autoconsumo directo</span>
                <span style="font-size: 13px; font-weight: 600; color: var(--text);">${resultado.totalAutoconsumo} kWh</span>
              </div>
            </div>
            ` : ''}
          </div>
          <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); cursor: pointer;">
            <input type="checkbox" id="csvAplicarExcedentes" checked style="cursor: pointer; width: 18px; height: 18px;">
            <span style="font-size: 13px; color: var(--text); font-weight: 600;">☀️ Incluir excedentes en el cálculo</span>
          </label>
        </div>
      `;
    }

    content.innerHTML = `
      <button class="modal-x" id="btnCerrarCSVX" type="button" aria-label="Cerrar">✕</button>
      <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 900; color: var(--text);">
        📊 Consumos detectados${resultado.tieneExcedentes ? ' ☀️' : ''}
      </h3>
      <div style="background: ${isLightMode ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.06)'}; padding: 16px; border-radius: 12px; margin-bottom: 16px; border: 1px solid var(--border);">
        <div style="display: grid; gap: 12px;">
          <div>
            <div style="font-size: 12px; color: var(--muted2); margin-bottom: 4px;">Periodo analizado</div>
            <div style="font-size: 16px; font-weight: 700; color: var(--text);">${resultado.dias} días (${resultado.formato})</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
            <div><div style="font-size: 11px; color: var(--muted2); margin-bottom: 4px;">Punta</div><div style="font-size: 14px; font-weight: 700; color: var(--text);">${resultado.punta} kWh</div><div style="font-size: 10px; color: var(--muted2);">${resultado.porcentajes.punta}%</div></div>
            <div><div style="font-size: 11px; color: var(--muted2); margin-bottom: 4px;">Llano</div><div style="font-size: 14px; font-weight: 700; color: var(--text);">${resultado.llano} kWh</div><div style="font-size: 10px; color: var(--muted2);">${resultado.porcentajes.llano}%</div></div>
            <div><div style="font-size: 11px; color: var(--muted2); margin-bottom: 4px;">Valle</div><div style="font-size: 14px; font-weight: 700; color: var(--text);">${resultado.valle} kWh</div><div style="font-size: 10px; color: var(--muted2);">${resultado.porcentajes.valle}%</div></div>
          </div>
          <div style="padding-top: 12px; border-top: 1px solid var(--border);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: var(--muted2);">Total consumo</span>
              <span style="font-size: 15px; font-weight: 700; color: var(--text);">${resultado.totalKwh} kWh</span>
            </div>
          </div>
          <div style="font-size: 10px; color: var(--muted2); padding-top: 8px; border-top: 1px solid var(--border);">
            ${resultado.datosReales} lecturas reales • ${resultado.datosEstimados} estimadas
          </div>
        </div>
      </div>
      ${excedenteHTML}
      
      <div style="margin-top: 16px; padding: 14px 16px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;">
          <input type="checkbox" id="csvCalcularSunClub" ${__sunClubCheckedAttr} style="cursor: pointer; width: 18px; height: 18px; accent-color: #10b981;">
          <span style="font-size: 14px; color: var(--text); font-weight: 600; flex: 1;">⚡ Calcular Octopus Sun Club</span>
          <span style="font-size: 11px; color: var(--muted2); background: rgba(16, 185, 129, 0.15); padding: 3px 8px; border-radius: 4px; font-weight: 600;">45% dto. 12-18h</span>
        </label>
        <p style="margin: 8px 0 0 28px; font-size: 12px; color: var(--muted2); line-height: 1.4;">
          Se calculará automáticamente con tus datos horarios reales. El descuento se aplica mes siguiente.
        </p>
      </div>
      
      <div style="margin-top: 20px;">
        <button id="btnAplicarCSV" class="btn primary" type="button" style="width: 100%;"><span id="btnAplicarTexto">✓ Aplicar consumos</span></button>
      </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);
    __csvLock();

    // Activar focus trap y llevar foco dentro del modal
    __csvFocusTrapAttach();

    const btnCerrarX = content.querySelector('#btnCerrarCSVX');
    let __csvCloseOnEsc = null;
    let __csvCloseOnBackdrop = null;
    
    const closeCSVModal = () => {
      if (__csvCloseOnEsc) document.removeEventListener('keydown', __csvCloseOnEsc);
      if (__csvCloseOnBackdrop) modal.removeEventListener('click', __csvCloseOnBackdrop);
      if (typeof __csvFocusTrapCleanup === 'function') __csvFocusTrapCleanup();
      __csvUnlock();
      modal.remove();

      // Restaurar foco al elemento previo
      if (__csvPrevFocusEl && __csvPrevFocusEl.focus) {
        __csvPrevFocusEl.focus();
      }
    };
    
    // ⭐ SUN CLUB: Cerrar sin aplicar (X/Escape/backdrop) => no cambia el estado
    const cancelCSVModal = () => {
      window.LF = window.LF || {};
      window.LF.sunClubEnabled = __prevSunClubEnabled;
      closeCSVModal();
    };
    
    
    // ⭐ SUN CLUB: Cerrar con X (sin aplicar)
    btnCerrarX?.addEventListener('click', cancelCSVModal);

    // Foco inicial (botón cerrar)
    setTimeout(() => {
      const target = btnCerrarX || content.querySelector('#btnAplicarCSV') || modal;
      target?.focus?.();
    }, 0);

    const btnAplicar = document.getElementById('btnAplicarCSV');
    const btnAplicarTexto = document.getElementById('btnAplicarTexto');

    if (resultado.tieneExcedentes) {
      const checkboxExcedentes = document.getElementById('csvAplicarExcedentes');
      if (checkboxExcedentes && btnAplicarTexto) {
        btnAplicarTexto.textContent = checkboxExcedentes.checked ? '✓ Aplicar con excedentes' : '✓ Aplicar solo consumos';
        checkboxExcedentes.addEventListener('change', () => {
          btnAplicarTexto.textContent = checkboxExcedentes.checked ? '✓ Aplicar con excedentes' : '✓ Aplicar solo consumos';
        });
      }
    }

    if (btnAplicar) {
      btnAplicar.addEventListener('click', () => {
        const diasInput = document.getElementById('dias');
        const puntaInput = document.getElementById('cPunta');
        const llanoInput = document.getElementById('cLlano');
        const valleInput = document.getElementById('cValle');

        if (diasInput) diasInput.value = resultado.dias;
        if (puntaInput) { puntaInput.value = resultado.punta; puntaInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (llanoInput) { llanoInput.value = resultado.llano; llanoInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (valleInput) { valleInput.value = resultado.valle; valleInput.dispatchEvent(new Event('input', { bubbles: true })); }

        const solarCheckbox = document.getElementById('solarOn');
        let debeAplicarExcedentes = false;
        if (resultado.tieneExcedentes) {
          const checkboxExcedentes = document.getElementById('csvAplicarExcedentes');
          debeAplicarExcedentes = checkboxExcedentes ? checkboxExcedentes.checked : false;
        }

        if (debeAplicarExcedentes) {
          if (solarCheckbox && !solarCheckbox.checked) {
            solarCheckbox.checked = true;
            solarCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
          setTimeout(() => {
            const exTotalInput = document.getElementById('exTotal');
            if (exTotalInput) {
              exTotalInput.value = resultado.totalExcedentes;
              exTotalInput.dispatchEvent(new Event('input', { bubbles: true }));
              setTimeout(() => { if (typeof updateKwhHint === 'function') updateKwhHint(); }, 50);
            }
          }, 100);
        } else {
          if (solarCheckbox && solarCheckbox.checked) {
            solarCheckbox.checked = false;
            solarCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
          setTimeout(() => {
            const exTotalInput = document.getElementById('exTotal');
            if (exTotalInput) { exTotalInput.value = ''; exTotalInput.dispatchEvent(new Event('input', { bubbles: true })); }
          }, 100);
        }

        // ⭐ SUN CLUB: Guardar consumos horarios (solo al aplicar)
        window.LF = window.LF || {};
        window.LF.consumosHorarios = Array.isArray(resultado.consumosHorarios) ? resultado.consumosHorarios : null;

        // ⭐ SUN CLUB: Guardar estado del checkbox antes de cerrar el modal
        const sunClubCheckbox = document.getElementById('csvCalcularSunClub');
        if (sunClubCheckbox) {
          window.LF = window.LF || {};
          window.LF.sunClubEnabled = sunClubCheckbox.checked;
        } else {
          if (window.LF) window.LF.sunClubEnabled = false;
        }

        closeCSVModal();

        if (typeof toast === 'function') {
          toast(debeAplicarExcedentes ? '✓ Consumos y excedentes aplicados' : '✓ Consumos aplicados desde ' + resultado.formato);
        }

        try {
          if (typeof updateKwhHint === 'function') updateKwhHint();
          if (typeof validateInputs === 'function') validateInputs();
          if (typeof saveInputs === 'function') saveInputs();
        } catch (e) {}

        try {
          const bvSaldoInput = document.getElementById('bvSaldo');
          if (bvSaldoInput) { bvSaldoInput.value = '0'; bvSaldoInput.dispatchEvent(new Event('input', { bubbles: true })); }
        } catch (e) {}

        setTimeout(async () => {
          const maxWait = 1000;
          const startTime = Date.now();
          let camposListos = false;

          while (Date.now() - startTime < maxWait && !camposListos) {
            const diasOk = document.getElementById('dias')?.value;
            const puntaOk = document.getElementById('cPunta')?.value;
            const llanoOk = document.getElementById('cLlano')?.value;
            const valleOk = document.getElementById('cValle')?.value;

            if (diasOk && puntaOk && llanoOk && valleOk) {
              if (debeAplicarExcedentes) {
                const exTotalOk = document.getElementById('exTotal')?.value;
                if (exTotalOk) camposListos = true;
              } else {
                camposListos = true;
              }
            }
            if (!camposListos) await new Promise(resolve => setTimeout(resolve, 50));
          }

          try {
            if (typeof hideResultsToInitialState === 'function') hideResultsToInitialState();
            if (typeof setStatus === 'function') setStatus('Calculando...', 'loading');
            if (typeof runCalculation === 'function') runCalculation();
          } catch (e) {}
        }, 150);
      });
    }

    __csvCloseOnEsc = (e) => { if (e.key === 'Escape') cancelCSVModal(); };
    document.addEventListener('keydown', __csvCloseOnEsc);

    __csvCloseOnBackdrop = (e) => { if (e.target === modal) cancelCSVModal(); };
    modal.addEventListener('click', __csvCloseOnBackdrop);
  }

  // ===== INIT CSV IMPORTER =====
  function initCSVImporter() {
    try {
      const actionsCenterContainer = document.querySelector('.actions-center');
      if (!actionsCenterContainer) return;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
      fileInput.style.display = 'none';
      fileInput.id = 'csvConsumoInput';

      const btnCSV = document.createElement('button');
      btnCSV.type = 'button';
      btnCSV.className = 'btn';
      btnCSV.id = 'btnSubirCSV';
      btnCSV.innerHTML = '<span>📊</span><span class="btn-text">Importar CSV</span>';
      btnCSV.title = 'Subir consumo horario (CSV/Excel de tu distribuidora)';
      btnCSV.setAttribute('aria-label', 'Subir consumo horario CSV o Excel');

      btnCSV.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        btnCSV.disabled = true;
        btnCSV.innerHTML = '⏳ Procesando...';

        try {
          let resultado;
          const extension = file.name.split('.').pop().toLowerCase();

          if (extension === 'csv') {
            resultado = await procesarCSVConsumos(file);
          } else if (extension === 'xlsx' || extension === 'xls') {
            resultado = await procesarXLSXConsumos(file);
          } else {
            throw new Error('Formato no soportado. Solo CSV y Excel (.xlsx, .xls)');
          }

          mostrarPreviewCSV(resultado);
          btnCSV.disabled = false;
          btnCSV.innerHTML = '<span>📊</span><span class="btn-text">Importar CSV</span>';
          fileInput.value = '';
        } catch (error) {
          toast(error.message || 'Error al procesar el archivo', 'err');
          btnCSV.disabled = false;
          btnCSV.innerHTML = '<span>📊</span><span class="btn-text">Importar CSV</span>';
          fileInput.value = '';
        }
      });

      document.body.appendChild(fileInput);
      
      const btnSubirFactura = document.getElementById('btnSubirFactura');
      if (btnSubirFactura) {
        btnSubirFactura.after(btnCSV);
      } else {
        actionsCenterContainer.appendChild(btnCSV);
      }
      
      lfDbg('[CSV] Botón de importar CSV añadido');
    } catch (error) {
      lfDbg('[CSV] ERROR CRÍTICO:', error);
    }
  }

  // ===== EXPORTAR =====
  window.LF = window.LF || {};
  Object.assign(window.LF, {
    ensureXLSX,
    initCSVImporter,
    procesarCSVConsumos,
    procesarXLSXConsumos
  });

  window.initCSVImporter = initCSVImporter;
  window.procesarCSVConsumos = procesarCSVConsumos;
  window.procesarXLSXConsumos = procesarXLSXConsumos;
  
  // Exportar helpers para testing
  window.LF.csvHelpers = {
    getPeriodoHorarioCSV,
    getFestivosNacionales,
    parseCSVConsumos
  };

})();
