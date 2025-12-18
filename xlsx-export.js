// ===== EXPORTACIÓN XLSX SUPER VISUAL =====
// Genera un archivo Excel profesional con formato, colores y gráficos
// Usa ExcelJS (CDN): https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js

async function exportarXLSXVisual() {
  const valores = (typeof getInputValues === 'function' ? getInputValues() : {}) || {};
  const signature = valores && typeof signatureFromValues === 'function' ? signatureFromValues(valores) : null;
  if ((state.pending === true) || (signature && state.lastSignature !== signature)) {
    if (typeof calculate === 'function') {
      await calculate(true, false);
    }
  }

  // Verificar que hay datos
  if (!state.rows || state.rows.length === 0) {
    toast('Pulsa Calcular', 'err');
    return;
  }

  // Mostrar loading
  toast('Generando Excel... ⏳', 'info');

  try {
    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LuzFija.es';
    workbook.created = new Date();
    
    // Obtener valores actuales
    const consumoTotal = (parseFloat(valores.cPunta||0) + parseFloat(valores.cLlano||0) + parseFloat(valores.cValle||0)).toFixed(2);
    
    // ==========================================
    // HOJA 1: RESUMEN EJECUTIVO
    // ==========================================
    const hojaResumen = workbook.addWorksheet('📊 Resumen', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }]
    });
    
    // Ancho de columnas
    hojaResumen.columns = [
      { width: 30 },
      { width: 20 }
    ];
    
    // HEADER PRINCIPAL
    const tituloRow = hojaResumen.addRow(['COMPARADOR DE TARIFAS ELÉCTRICAS', '']);
    tituloRow.font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    tituloRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF8B5CF6' } // Violeta
    };
    tituloRow.height = 30;
    tituloRow.alignment = { vertical: 'middle', horizontal: 'left' };
    hojaResumen.mergeCells('A1:B1');
    
    const subtituloRow = hojaResumen.addRow(['LuzFija.es - Proyecto gratuito y sin publicidad', '']);
    subtituloRow.font = { size: 11, italic: true, color: { argb: 'FF6B7280' } };
    subtituloRow.alignment = { horizontal: 'left' };
    hojaResumen.mergeCells('A2:B2');
    
    const fechaRow = hojaResumen.addRow(['Fecha:', new Date().toLocaleDateString('es-ES', { 
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })]);
    fechaRow.font = { size: 10, color: { argb: 'FF6B7280' } };
    
    hojaResumen.addRow([]); // Espacio
    
    // SECCIÓN: TUS DATOS
    const tusDatosRow = hojaResumen.addRow(['TUS DATOS DE CÁLCULO', '']);
    tusDatosRow.font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
    tusDatosRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' }
    };
    hojaResumen.mergeCells(`A${tusDatosRow.number}:B${tusDatosRow.number}`);
    
    const datosUsuario = [
      ['Potencia P1', valores.p1 + ' kW'],
      ['Potencia P2', valores.p2 + ' kW'],
      ['Días de facturación', valores.dias + ' días'],
      ['Consumo Punta', valores.cPunta + ' kWh'],
      ['Consumo Llano', valores.cLlano + ' kWh'],
      ['Consumo Valle', valores.cValle + ' kWh'],
      ['Consumo TOTAL', consumoTotal + ' kWh'],
      ['Zona fiscal', valores.zonaFiscal || 'Península']
    ];

    // CORRECCIÓN: Usar exTotal en vez de exPunta/exLlano/exValle
    if (valores && valores.solarOn) {
      const excedentesKwh = parseFloat(valores.exTotal || 0).toFixed(2);
      const bvSaldo = parseFloat(valores.bvSaldo || 0).toFixed(2);
      
      datosUsuario.push(['⚡ Placas solares', 'SÍ']);
      datosUsuario.push(['Excedentes totales', excedentesKwh + ' kWh']);
      datosUsuario.push(['Saldo Batería Virtual', bvSaldo + ' €']);
    } else {
      datosUsuario.push(['⚡ Placas solares', 'NO']);
    }
    
    datosUsuario.forEach(([label, value]) => {
      const row = hojaResumen.addRow([label, value]);
      row.font = { size: 11 };
      row.getCell(1).font = { size: 11, bold: true };
      row.getCell(2).alignment = { horizontal: 'right' };
    });
    
    hojaResumen.addRow([]); // Espacio
    
    // SECCIÓN: RESULTADOS
    const resultadosRow = hojaResumen.addRow(['RESULTADOS DEL ANÁLISIS', '']);
    resultadosRow.font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
    resultadosRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' }
    };
    hojaResumen.mergeCells(`A${resultadosRow.number}:B${resultadosRow.number}`);
    
    const mejorTarifa = state.rows[0];
    const peorTarifa = state.rows[state.rows.length - 1];
    const precioMin = parseFloat(mejorTarifa?.total?.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
    const precioMax = parseFloat(peorTarifa?.total?.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
    const ahorroMax = (precioMax - precioMin).toFixed(2).replace('.', ',');
    
    const resultados = [
      ['Tarifas analizadas', state.rows.length + ' tarifas'],
      ['Mejor opción', mejorTarifa?.nombre || 'N/A'],
      ['Precio más bajo', mejorTarifa?.total || 'N/A'],
      ['Precio más alto', peorTarifa?.total || 'N/A'],
      ['Ahorro potencial', ahorroMax + ' €/mes']
    ];
    
    resultados.forEach(([label, value]) => {
      const row = hojaResumen.addRow([label, value]);
      row.font = { size: 11 };
      row.getCell(1).font = { size: 11, bold: true };
      row.getCell(2).alignment = { horizontal: 'right' };
      
      // Destacar mejor opción en verde
      if (label === 'Mejor opción') {
        row.getCell(2).font = { size: 12, bold: true, color: { argb: 'FF059669' } };
      }
      // Destacar ahorro en verde grande
      if (label === 'Ahorro potencial') {
        row.getCell(2).font = { size: 14, bold: true, color: { argb: 'FF059669' } };
      }
    });
    
    // AÑADIR ADVERTENCIA SI HAY SOLAR
    if (valores && valores.solarOn) {
      hojaResumen.addRow([]); // Espacio
      const avisoRow = hojaResumen.addRow(['⚠️ NOTA IMPORTANTE: PLACAS SOLARES', '']);
      avisoRow.font = { size: 12, bold: true, color: { argb: 'FFF59E0B' } };
      avisoRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' }
      };
      hojaResumen.mergeCells(`A${avisoRow.number}:B${avisoRow.number}`);
      
      const avisoTexto = hojaResumen.addRow(['Las tarifas marcadas como "No calculable" son PVPC o indexadas.', '']);
      avisoTexto.font = { size: 10, italic: true };
      hojaResumen.mergeCells(`A${avisoTexto.number}:B${avisoTexto.number}`);
      
      const avisoTexto2 = hojaResumen.addRow(['Para estas tarifas, el precio real depende del pool horario.', '']);
      avisoTexto2.font = { size: 10, italic: true };
      hojaResumen.mergeCells(`A${avisoTexto2.number}:B${avisoTexto2.number}`);
    }
    
    // ==========================================
    // HOJA 2: RANKING COMPLETO
    // ==========================================
    const hojaRanking = workbook.addWorksheet('🏆 Ranking Completo', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });
    
    // Definir columnas (AÑADIDA COLUMNA SOLAR)
    const columnas = [
      { header: 'Pos', key: 'pos', width: 6 },
      { header: 'Tarifa', key: 'tarifa', width: 30 },
      { header: 'Tipo', key: 'tipo', width: 8 },
      { header: 'Potencia', key: 'potencia', width: 12 },
      { header: 'Consumo', key: 'consumo', width: 12 },
      { header: 'Impuestos', key: 'impuestos', width: 12 },
      { header: 'TOTAL', key: 'total', width: 12 },
      { header: 'Ahorro vs Mejor', key: 'ahorro', width: 15 },
      { header: '% Dif', key: 'porcentaje', width: 8 },
      { header: 'Requisitos', key: 'requisitos', width: 40 }
    ];
    
    // Si hay solar, añadir columna
    if (valores && valores.solarOn) {
      columnas.splice(3, 0, { header: 'Solar', key: 'solar', width: 12 });
    }
    
    hojaRanking.columns = columnas;
    
    // Estilo del header
    const headerRow = hojaRanking.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' } // Índigo
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;
    
    // Añadir datos
    state.rows.forEach((r, index) => {
      const mejorPrecio = parseFloat(state.rows[0]?.total?.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const precioActual = parseFloat(r.total?.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const porcentajeDif = mejorPrecio > 0 ? (((precioActual - mejorPrecio) / mejorPrecio) * 100).toFixed(1) : '0';
      const tarifaOrig = cachedTarifas.find(t => t.nombre === r.nombre);
      
      const datosRow = {
        pos: r.posicion,
        tarifa: r.nombre,
        tipo: r.tipo,
        potencia: r.potencia || 'N/A',
        consumo: r.consumo || 'N/A',
        impuestos: r.impuestos || 'N/A',
        total: r.total,
        ahorro: r.vsMejor || '0,00 €',
        porcentaje: porcentajeDif + '%',
        requisitos: tarifaOrig?.requisitos || 'Sin requisitos especiales'
      };
      
      // Añadir info solar si aplica
      if (valores && valores.solarOn) {
        if (r.solarNoCalculable) {
          datosRow.solar = '⚠️ No calculable';
        } else {
          datosRow.solar = '✅ OK';
        }
      }
      
      const row = hojaRanking.addRow(datosRow);
      
      // Alinear números a la derecha
      const colsNumericas = valores && valores.solarOn ? [5, 6, 7, 8, 9, 10] : [4, 5, 6, 7, 8, 9];
      colsNumericas.forEach(col => {
        row.getCell(col).alignment = { horizontal: 'right' };
      });
      
      // Colorear filas alternadas
      if (index % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF9FAFB' }
        };
      }
      
      // Destacar la mejor tarifa (primera fila)
      if (index === 0) {
        row.font = { bold: true };
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD1FAE5' } // Verde claro
        };
        const colTotal = valores && valores.solarOn ? 8 : 7;
        row.getCell(colTotal).font = { bold: true, color: { argb: 'FF059669' }, size: 12 };
      }
      
      // Marcar tarifas no calculables en amarillo
      if (valores && valores.solarOn && r.solarNoCalculable) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF3C7' } // Amarillo claro
        };
      }
      
      // Destacar top 3 con medallas
      if (index < 3) {
        const medallas = ['🥇', '🥈', '🥉'];
        row.getCell(1).value = medallas[index];
        row.getCell(1).alignment = { horizontal: 'center' };
      }
    });
    
    // Añadir filtros automáticos
    const numColumnas = valores && valores.solarOn ? 11 : 10;
    hojaRanking.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: state.rows.length + 1, column: numColumnas }
    };
    
    // Bordes a toda la tabla
    const tablaBorde = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };
    
    for (let i = 1; i <= state.rows.length + 1; i++) {
      const row = hojaRanking.getRow(i);
      for (let j = 1; j <= numColumnas; j++) {
        row.getCell(j).border = tablaBorde;
      }
    }
    
    // ==========================================
    // HOJA 3: GRÁFICO COMPARATIVO (Top 10)
    // ==========================================
    const hojaGrafico = workbook.addWorksheet('📈 Comparativa Visual');
    
    hojaGrafico.addRow(['Top 10 Tarifas más Económicas']).font = { 
      size: 16, 
      bold: true 
    };
    hojaGrafico.addRow([]);
    
    hojaGrafico.columns = [
      { width: 30 },
      { width: 15 }
    ];
    
    const headerGrafico = hojaGrafico.addRow(['Tarifa', 'Precio Total (€)']);
    headerGrafico.font = { bold: true };
    headerGrafico.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };
    headerGrafico.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    
    // Añadir top 10 para el gráfico
    const top10 = state.rows.slice(0, Math.min(10, state.rows.length));
    top10.forEach((r, index) => {
      const precioNum = parseFloat(r.total?.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
      const row = hojaGrafico.addRow([r.nombre, precioNum]);
      
      // Barra de progreso visual con formato condicional
      row.getCell(2).numFmt = '#,##0.00 "€"';
      
      if (index === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD1FAE5' }
        };
      }
      
      // Marcar tarifas no calculables
      if (valores && valores.solarOn && r.solarNoCalculable) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF3C7' }
        };
      }
    });
    
    // ==========================================
    // GENERAR ARCHIVO
    // ==========================================
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const solarSuffix = valores && valores.solarOn ? '_solar' : '';
    const nombreArchivo = `luzfija_${valores.p1}kW_${valores.dias}d${solarSuffix}_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    link.href = url;
    link.download = nombreArchivo;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast('✅ Excel descargado con éxito');
    
  } catch (error) {
    console.error('Error generando Excel:', error);
    toast('❌ Error al generar Excel', 'err');
  }
}

// Reemplazar el evento del botón de exportar
el.btnExport.addEventListener('click', (e) => {
  createRipple(el.btnExport, e);
  toggleMenu(false);
  exportarXLSXVisual();
});
