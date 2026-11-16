/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

window.BVSim = window.BVSim || {};

(function () {
  'use strict';

  // ===== IMPORTAR UTILIDADES CSV =====
  const {
    parseNumberFlexible,
    parseNumberFlexibleCSV,
    ymdLocal,
    buildImportError,
    assertXlsxSheetWithinLimits,
    assertRelevantXlsxFormulasResolved,
    validateCsvSpanFromRecords,
    applyEdgeStitchPlan
  } = window.LF.csvUtils || {};

  // El simulador solar es el unico flujo donde una columna de excedentes sin reconocer
  // invalida el resultado entero: se bloquea en vez de importar con excedentes=0.
  const UNMAPPED_SOLAR_POLICY = 'error';

  // ===== LAZY LOAD XLSX =====
  let xlsxLoading = null;

  // Misma cascada de identidad de build que js/tracking.js. Se resuelve en la
  // evaluacion sincrona del script a proposito: dentro de ensureXLSX() (lazy,
  // tras un gesto del usuario) document.currentScript ya vale null.
  const XLSX_BUILD_ID = (() => {
    try {
      if (typeof window.__LF_BUILD_ID === 'string' && window.__LF_BUILD_ID.trim()) {
        return window.__LF_BUILD_ID.trim();
      }
      const cs = document.currentScript && document.currentScript.src ? String(document.currentScript.src) : '';
      if (cs) return new URL(cs, location.href).searchParams.get('v') || '';
    } catch (_) {}
    return '';
  })();

  // El vendor debe arrastrar el ?v= del build como el resto de assets: sin el,
  // un cliente puede seguir ejecutando la copia anterior de SheetJS tras un
  // despliegue que la actualice. La ruta relativa se conserva tal cual: `../../`
  // sobre document.baseURI queda clampada a la raiz del sitio.
  function xlsxVendorUrl() {
    const url = new URL('../../vendor/xlsx/xlsx.full.min.js', document.baseURI);
    if (XLSX_BUILD_ID) url.searchParams.set('v', XLSX_BUILD_ID);
    return url.toString();
  }

  async function ensureXLSX() {
    if (typeof XLSX !== 'undefined') return;
    if (xlsxLoading) return xlsxLoading;

    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = xlsxVendorUrl();
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Error al cargar librería XLSX'));
      document.head.appendChild(script);
    });
    xlsxLoading = xlsxLoading.catch(err => { xlsxLoading = null; throw err; });

    return xlsxLoading;
  }

  // ===== PARSEO CSV =====
  function parseCSVConsumos(fileContent, zona = null) {
    const { parseCSVToRows, parseEnergyTableRows } = window.LF.csvUtils || {};
    if (typeof parseCSVToRows !== 'function' || typeof parseEnergyTableRows !== 'function') {
      throw new Error('No se pudo cargar el parser de CSV (lf-csv-utils.js faltante)');
    }

    const { rows, separator, headerRowIndex } = parseCSVToRows(fileContent);
    // parseEnergyTableRows devuelve { records: [...], warnings: [...] }
    // records tiene formato: { fecha, hora, kwh, excedente, autoconsumo, periodo, esReal }
    return parseEnergyTableRows(rows, {
      parseNumber: parseNumberFlexibleCSV,
      separator,
      headerRowIndex,
      zonaFiscal: zona, // Pasar zona para clasificar periodos correctamente (BV)
      unmappedSolarPolicy: UNMAPPED_SOLAR_POLICY
    });
  }

  // ===== PARSEO XLSX =====
  async function parseXLSXConsumos(fileBuffer, zona = null) {
    await ensureXLSX();

    // sheets: 0 evita que XLSX.read() parsee (y materialice en memoria) hojas que este
    // codigo nunca va a leer: solo se consume la primera. Sin esto, una segunda hoja con
    // muchas celdas reales ya se ha parseado antes de que el guard de dimensiones pueda
    // rechazar nada.
    // cellNF: true conserva el formato de cada celda; sin el, xlsxRowsFromSheet no puede
    // distinguir una fecha de un numero (ronda 39, lf-csv-utils.js).
    const workbook = XLSX.read(fileBuffer, { type: 'array', sheets: 0, sheetStubs: true, cellNF: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    // Fail-closed: si el guard de dimensiones no esta disponible (p. ej. un futuro error de
    // orden de scripts), no se procesa el XLSX sin haberlo comprobado.
    if (typeof assertXlsxSheetWithinLimits !== 'function') {
      throw buildImportError('No se pudo validar el archivo Excel; inténtalo de nuevo.');
    }
    if (typeof assertRelevantXlsxFormulasResolved !== 'function') {
      throw buildImportError('No se pudo validar las fórmulas del archivo Excel; inténtalo de nuevo.');
    }
    assertXlsxSheetWithinLimits(firstSheet, XLSX);
    const rowsFromSheet = window.LF.csvUtils?.xlsxRowsFromSheet;
    const data = typeof rowsFromSheet === 'function'
      ? rowsFromSheet(firstSheet, XLSX, { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) })
      : XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false });

    if (!data || data.length < 2) {
      throw buildImportError('Archivo Excel vacío o formato no reconocido.');
    }

    const {
      parseEnergyTableRows,
      guessEnergyHeaderRow,
      bestEnergyHeaderCandidate,
      findHourlyMatrixHeaderRow,
      parseHourlyMatrixRows
    } = window.LF.csvUtils || {};
    if (typeof parseEnergyTableRows !== 'function' || typeof guessEnergyHeaderRow !== 'function'
      || typeof findHourlyMatrixHeaderRow !== 'function' || typeof parseHourlyMatrixRows !== 'function') {
      throw new Error('No se pudo cargar el parser de Excel');
    }

    // --- Matriz horaria (E-REDES y similares) ---
    // Implementacion compartida en lf-csv-utils.js: antes estaba duplicada aqui sin
    // validar negativos, texto ni el limite de 10.000 kWh.
    const matrixHeaderRow = findHourlyMatrixHeaderRow(data);
    if (matrixHeaderRow !== -1) {
      assertRelevantXlsxFormulasResolved(firstSheet, data, matrixHeaderRow, { format: 'matrix' });
      // computePeriodo:false a proposito. bucketizeByMonth respeta record.periodo si viene
      // relleno (salvo Ceuta/Melilla), y aqui todavia no se conoce la zona definitiva de la
      // simulacion: precalcularlo dejaria el periodo mal si el usuario simula otra zona.
      return parseHourlyMatrixRows(data, matrixHeaderRow, {
        parseNumber: parseNumberFlexible,
        computePeriodo: false
      });
    }

    // Formato estándar (columnas)
    const headerRow = guessEnergyHeaderRow(data);
    if (headerRow === -1) {
      // Se adjunta la mejor fila candidata para que el mensaje diga qué columnas se vieron
      // en vez de "(sin cabeceras)". Nunca viaja a analítica.
      throw buildImportError('No se encontró la fila de cabecera en el Excel.', {
        headersNorm: bestEnergyHeaderCandidate(data)
      });
    }

    assertRelevantXlsxFormulasResolved(firstSheet, data, headerRow);

    return parseEnergyTableRows(data, {
      headerRowIndex: headerRow,
      parseNumber: parseNumberFlexible,
      zonaFiscal: zona, // Pasar zona para clasificar periodos correctamente (BV)
      unmappedSolarPolicy: UNMAPPED_SOLAR_POLICY
    });
  }

  // ===== UTILIDAD DE FORMATO =====
  function ymLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function buildMeta(records, hasExcedenteColumn, hasAutoconsumoColumn, isDatadisMonthly = false) {
    let minDate = null;
    let maxDate = null;
    const months = new Set();

    records.forEach((record) => {
      const fecha = record.fecha;
      if (!fecha) return;

      if (!minDate || fecha < minDate) minDate = fecha;
      if (!maxDate || fecha > maxDate) maxDate = fecha;

      const monthKey = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      months.add(monthKey);
    });

    return {
      rows: records.length,
      start: minDate ? ymdLocal(minDate) : '',
      end: maxDate ? ymdLocal(maxDate) : '',
      months: months.size,
      hasExcedenteColumn: Boolean(hasExcedenteColumn),
      hasAutoconsumoColumn: Boolean(hasAutoconsumoColumn),
      isDatadisMonthly: Boolean(isDatadisMonthly)
    };
  }

  /**
   * Vertido sin publicar en un fichero que si lo trae en otros dias (analizarVertidoPublicado).
   * Simularlo con 0 kWh vertidos quita compensacion y saldo de BV justo a las tarifas que mejor
   * pagan los excedentes: altera el ranking, no solo el importe.
   * - Tramo FINAL sin vertido (dias posteriores al ultimo con algun vertido publicado, sea un mes
   *   entero o la segunda mitad del ultimo): se descarta. Es lo que la distribuidora aun no ha
   *   publicado; la importacion desde Datadis tampoco simula esos meses. El simulador ya admite un
   *   ultimo mes con menos dias (potencia, cargos y cuota BV van por dias con datos).
   * - Meses enteros sin vertido al principio o en medio: se simulan con 0 kWh vertidos y se avisan
   *   por su nombre (pueden ser anteriores a la instalacion o una averia real; el fichero no permite
   *   distinguirlo), diciendo que el ranking depende de ese supuesto.
   */
  function revisarVertidoPublicado(parsed, records, warnings) {
    const { analizarVertidoPublicado, rehacerAvisoVertidoVacio, listaMesesTexto, rangoFechasTexto, AVISO_VERTIDO_COLUMNA_VACIA } = window.LF.csvUtils || {};
    // Columna de vertido vacia entera: aqui, y solo aqui, la tabla mensual permite completarlo.
    const iColumnaVacia = AVISO_VERTIDO_COLUMNA_VACIA ? warnings.indexOf(AVISO_VERTIDO_COLUMNA_VACIA) : -1;
    if (iColumnaVacia !== -1) {
      warnings[iColumnaVacia] = `${AVISO_VERTIDO_COLUMNA_VACIA} Si sabes cuántos kWh vertiste cada mes, puedes introducirlos a mano en la tabla mensual.`;
    }
    if (typeof analizarVertidoPublicado !== 'function') return records;
    const an = analizarVertidoPublicado(parsed && parsed.exportCoberturaDias);
    if (!an || (!an.finales && !an.otros.length)) return records;
    rehacerAvisoVertidoVacio(warnings, parsed.exportEmptyWarning, an.sueltas);

    let resultado = records;
    if (an.finales) {
      resultado = records.filter((r) => r && r.fecha instanceof Date && ymdLocal(r.fecha) <= an.ultimoDia);
      const uno = an.finales.dias === 1;
      const diasParciales = an.finales.diasParciales || [];
      const detalleParciales = diasParciales.map(({ fecha, hora }) =>
        `${rangoFechasTexto(fecha, fecha, { mayuscula: true })} solo trae la energía vertida hasta las ${String(hora).padStart(2, '0')}:00.`
      ).join(' ');
      const detalle = detalleParciales ? ` ${detalleParciales}` : '';
      const recuentoDias = ` (${an.finales.dias} ${uno ? 'día' : 'días'})`;
      // Como en la home: "no toda" solo si algun dia del tramo trae parte del vertido.
      const faltaParte = diasParciales.length > 0;
      warnings.unshift(
        `✂️ Se descarta ${rangoFechasTexto(an.finales.desde, an.finales.hasta)}${recuentoDias}: tu fichero trae el consumo de ${uno ? 'ese día' : 'esos días'}, ` +
        `pero no ${faltaParte ? 'toda la' : 'la'} energía vertida, que la distribuidora aún no ha publicado.${detalle} Simular${uno ? 'lo' : 'los'} con 0 kWh vertidos ` +
        `restaría compensación a las tarifas que mejor pagan los excedentes y cambiaría el ranking.\n` +
        `Se simula ${rangoFechasTexto(an.primerDia, an.ultimoDia)}. Cuando se publique, vuelve a descargar el fichero.`
      );
    }
    if (an.otros.length) {
      const uno = an.otros.length === 1;
      warnings.push(
        `${listaMesesTexto(an.otros, { mayuscula: true })} no ${uno ? 'trae' : 'traen'} energía vertida en tu fichero: se ${uno ? 'simula' : 'simulan'} con 0 kWh vertidos. ` +
        `Si ya tenías las placas funcionando, falta la compensación de ${uno ? 'ese mes' : 'esos meses'} y el orden del ranking puede cambiar.`
      );
    }
    return resultado;
  }

  // ===== INTERFAZ PÚBLICA =====
  /**
   * Importa archivo CSV/XLSX con datos de consumo.
   * @param {File} file - Archivo a importar
   * @param {string} zona - Zona CNMC ('Península'|'Canarias'|'CeutaMelilla'). Opcional.
   * @returns {Promise<Object>} {ok, records, warnings, error}
   */
  window.BVSim.importFile = async function (file, zona = null) {
    if (!file) {
      return { ok: false, error: 'No se ha seleccionado ningún archivo.' };
    }

    // Validar tamaño (máximo 10 MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = Math.round(file.size / 1024 / 1024);
      return {
        ok: false,
        error: `El archivo es demasiado grande (${sizeMB} MB). El tamaño máximo permitido es 10 MB.`
      };
    }

    const extension = file.name.split('.').pop().toLowerCase();

    // Validar MIME type para mayor seguridad
    if (extension === 'csv') {
      if (file.type && !file.type.includes('text/') && !file.type.includes('application/')) {
        // Warning: algunos CSV vienen con mime type vacío o excel, permitimos si la extensión es csv
        // return { ok: false, error: 'El archivo no parece ser un CSV válido.' };
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      // Permitir validación laxa de mime para excel
    } else {
      return { ok: false, error: 'Formato no soportado. Solo CSV y Excel (.xlsx, .xls).' };
    }

    try {
      let parsed;

      if (extension === 'csv') {
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(new Error('Error al leer el archivo CSV'));
          reader.readAsText(file);
        });
        parsed = parseCSVConsumos(content, zona);
      } else {
        const buffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(new Error('Error al leer el archivo Excel'));
          reader.readAsArrayBuffer(file);
        });
        parsed = await parseXLSXConsumos(buffer, zona);
      }

      let records = Array.isArray(parsed.records) ? parsed.records : [];
      if (records.length === 0) {
        const message = buildImportError
          ? buildImportError('El archivo no contiene datos de consumo válidos o reconocibles.').message
          : 'El archivo no contiene datos de consumo válidos o reconocibles.';
        return { ok: false, error: message };
      }

      const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
      // Antes de validar el periodo: un tramo final descartado aqui no debe contar para el cosido
      // de 13 meses ni para el descarte por cobertura.
      records = revisarVertidoPublicado(parsed, records, warnings);
      parsed.records = records;
      let stitchPlan = null;
      if (typeof validateCsvSpanFromRecords === 'function') {
        // Comparador solar: acepta hasta 12 meses; si llegan 13, cose los dos extremos.
        const spanCheck = validateCsvSpanFromRecords(records, {
          maxDays: 370,
          requireExactly12Months: true,  // ← Modo solar: máximo 13 meses, ajuste a 12 si procede
          coverageThreshold: 80,         // ← 80% mínimo de cobertura por mes
          isDatadisMonthly: parsed.isDatadisMonthly || false
        });

        if (!spanCheck.ok) {
          return { ok: false, error: spanCheck.error };
        }

        // Cosido de los dos tramos del mismo mes natural (año que empieza a mitad de mes).
        // El recorte se aplica aqui, sobre los registros horarios, porque este mismo array
        // alimenta la traza que valora los excedentes indexados hora a hora: recortar solo al
        // agregar por mes dejaria la traza con dias duplicados.
        if (spanCheck.stitch && typeof applyEdgeStitchPlan === 'function') {
          const stitched = applyEdgeStitchPlan(records, spanCheck.stitch);
          if (!Array.isArray(stitched) || stitched.length === 0) {
            return {
              ok: false,
              error: 'Tras componer el mes partido en dos tramos, no quedan registros válidos para procesar.'
            };
          }
          parsed.records = stitched;
          stitchPlan = spanCheck.stitch;
          if (spanCheck.warning) warnings.push(spanCheck.warning);
        }

        // Aplicar filtro de meses si es necesario
        if (Array.isArray(spanCheck.monthsToDrop) && spanCheck.monthsToDrop.length > 0) {
          const monthsToDrop = new Set(spanCheck.monthsToDrop);
          const filtered = records.filter((record) => {
            const fecha = record && record.fecha;
            if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return false;
            return !monthsToDrop.has(ymLocal(fecha));
          });
          if (filtered.length === 0) {
            return {
              ok: false,
              error: 'Tras aplicar el recorte a 12 meses, no quedan registros válidos para procesar.'
            };
          }
          parsed.records = filtered;
          if (spanCheck.warning) warnings.push(spanCheck.warning);
        }
      }

      const filteredRecords = Array.isArray(parsed.records) ? parsed.records : [];
      const meta = buildMeta(filteredRecords, parsed.hasExcedenteColumn, parsed.hasAutoconsumoColumn, parsed.isDatadisMonthly || false);
      if (stitchPlan) meta.stitch = stitchPlan;

      return {
        ok: true,
        records: filteredRecords,
        meta,
        warnings
      };
    } catch (error) {
      console.error('Error importando fichero:', error);
      return {
        ok: false,
        error: error?.message || 'Error al procesar el archivo.'
      };
    }
  };
})();
