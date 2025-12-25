// ============================================================================
// API ENDPOINT: Extracción de QR con OCR
// Ruta sugerida: /api/extract-qr
// ============================================================================

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

/**
 * Extrae el QR de un PDF usando texto + OCR
 * @param {Buffer} pdfBuffer - Buffer del PDF
 * @returns {Promise<Object>} - {success, method, qr_url, data}
 */
async function extractQRFromPDF(pdfBuffer) {
  const tempDir = path.join(os.tmpdir(), `qr_extract_${Date.now()}`);
  const pdfPath = path.join(tempDir, 'factura.pdf');
  
  try {
    // Crear directorio temporal
    await fs.mkdir(tempDir, { recursive: true });
    
    // Guardar PDF
    await fs.writeFile(pdfPath, pdfBuffer);
    
    // PASO 1: Buscar URL en texto del PDF
    console.log('[QR] Paso 1: Buscando URL en texto...');
    try {
      const { stdout: texto } = await execAsync(`pdftotext "${pdfPath}" -`);
      
      const urlPattern = /https:\/\/comparador\.cnmc\.gob\.es\/comparador\/QRE\?[^\s"'\n]+/;
      const match = texto.match(urlPattern);
      
      if (match) {
        console.log('[QR] ✅ URL encontrada en TEXTO');
        const qrUrl = match[0];
        const data = parseQRData(qrUrl);
        
        // Limpiar
        await fs.rm(tempDir, { recursive: true, force: true });
        
        return {
          success: true,
          method: 'TEXTO',
          qr_url: qrUrl,
          data: data
        };
      }
    } catch (err) {
      console.log('[QR] ⚠️ Error buscando en texto:', err.message);
    }
    
    // PASO 2: OCR de imágenes del PDF
    console.log('[QR] Paso 2: Escaneando imágenes...');
    
    // Convertir PDF a imágenes (alta resolución para mejor OCR)
    await execAsync(`pdftoppm -png -r 400 "${pdfPath}" "${tempDir}/page"`);
    
    // Listar imágenes generadas
    const files = await fs.readdir(tempDir);
    const imageFiles = files.filter(f => f.endsWith('.png')).sort();
    
    // Escanear cada imagen
    for (const imgFile of imageFiles) {
      const imgPath = path.join(tempDir, imgFile);
      console.log(`[QR] Escaneando ${imgFile}...`);
      
      try {
        const { stdout: qrData } = await execAsync(`zbarimg --raw "${imgPath}"`);
        const qrUrl = qrData.trim();
        
        if (qrUrl && qrUrl.includes('comparador.cnmc.gob.es')) {
          console.log(`[QR] ✅ QR encontrado en imagen: ${imgFile}`);
          const data = parseQRData(qrUrl);
          
          // Limpiar
          await fs.rm(tempDir, { recursive: true, force: true });
          
          return {
            success: true,
            method: 'OCR',
            qr_url: qrUrl,
            data: data
          };
        }
      } catch (err) {
        // No hay QR en esta imagen, continuar
        continue;
      }
    }
    
    // No se encontró QR
    console.log('[QR] ❌ No se encontró QR en el PDF');
    
    // Limpiar
    await fs.rm(tempDir, { recursive: true, force: true });
    
    return {
      success: false,
      method: null,
      qr_url: null,
      data: null
    };
    
  } catch (error) {
    console.error('[QR] Error durante extracción:', error);
    
    // Limpiar en caso de error
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      // Ignorar errores de limpieza
    }
    
    return {
      success: false,
      error: error.message,
      method: null,
      qr_url: null,
      data: null
    };
  }
}

/**
 * Parsea la URL del QR y extrae los datos
 */
function parseQRData(qrUrl) {
  try {
    const url = new URL(qrUrl);
    const params = url.searchParams;
    
    const p1 = params.get('pP1');
    const p2 = params.get('pP2');
    const cfP1 = params.get('cfP1');
    const cfP2 = params.get('cfP2');
    const cfP3 = params.get('cfP3');
    const fechaInicio = params.get('iniF');
    const fechaFin = params.get('finF');
    
    // Validar campos obligatorios
    if (!p1 || !p2 || !cfP1 || !cfP2 || !cfP3) {
      return null;
    }
    
    // Calcular días
    let dias = null;
    if (fechaInicio && fechaFin) {
      const inicio = new Date(fechaInicio);
      const fin = new Date(fechaFin);
      dias = Math.floor((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    }
    
    return {
      potencia1: parseFloat(p1),
      potencia2: parseFloat(p2),
      consumoPunta: parseFloat(cfP1),
      consumoLlano: parseFloat(cfP2),
      consumoValle: parseFloat(cfP3),
      dias: dias,
      confianza: 100,
      fuenteDatos: 'QR',
      cups: params.get('cups') || null,
      fechaInicio: fechaInicio,
      fechaFin: fechaFin,
      importeTotal: params.get('imp') ? parseFloat(params.get('imp')) : null
    };
    
  } catch (error) {
    console.error('[QR] Error parseando URL:', error);
    return null;
  }
}

// ============================================================================
// EXPRESS ENDPOINT (ejemplo de integración)
// ============================================================================

/**
 * Endpoint POST /api/extract-qr
 * 
 * Body: multipart/form-data con archivo PDF
 * 
 * Response:
 * {
 *   success: true,
 *   method: 'OCR' | 'TEXTO',
 *   qr_url: 'https://...',
 *   data: { potencia1, potencia2, consumos, etc. }
 * }
 */
async function handleExtractQR(req, res) {
  try {
    // req.file viene de multer o similar
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionó archivo PDF'
      });
    }
    
    const pdfBuffer = req.file.buffer;
    const result = await extractQRFromPDF(pdfBuffer);
    
    return res.json(result);
    
  } catch (error) {
    console.error('[API] Error en /api/extract-qr:', error);
    return res.status(500).json({
      success: false,
      error: 'Error procesando PDF'
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  extractQRFromPDF,
  parseQRData,
  handleExtractQR
};

// ============================================================================
// EJEMPLO DE USO CON EXPRESS
// ============================================================================

/*
const express = require('express');
const multer = require('multer');
const { handleExtractQR } = require('./qr-extractor');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/extract-qr', upload.single('factura'), handleExtractQR);

app.listen(3000, () => {
  console.log('API QR Extractor escuchando en puerto 3000');
});
*/
