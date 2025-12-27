#!/bin/bash
# Script para generar hashes SRI (Subresource Integrity)
# Este script descarga las librerías desde CDN y calcula sus hashes SHA-384
# Ejecutar ANTES de desplegar en producción

echo "==========================================
Generando hashes SRI para librerías CDN
=========================================="

# Arrays de URLs
declare -a urls=(
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js"
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js"
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
)

# Crear directorio temporal
TMP_DIR=$(mktemp -d)
echo "Directorio temporal: $TMP_DIR"
echo ""

# Procesar cada URL
for url in "${urls[@]}"; do
  filename=$(basename "$url" | sed 's/[?&].*//')
  echo "📥 Descargando: $url"
  
  if curl -sL "$url" -o "$TMP_DIR/$filename"; then
    # Calcular hash SHA-384
    hash=$(openssl dgst -sha384 -binary "$TMP_DIR/$filename" | openssl base64 -A)
    
    echo "✅ $filename"
    echo "   integrity=\"sha384-$hash\""
    echo "   crossorigin=\"anonymous\""
    echo ""
  else
    echo "❌ Error descargando: $url"
    echo ""
  fi
done

echo "=========================================="
echo "INSTRUCCIONES:"
echo "=========================================="
echo ""
echo "Los archivos YA TIENEN crossorigin='anonymous' añadido."
echo "Para añadir los hashes SRI completos:"
echo ""
echo "1. En factura.js, línea ~29 (función __LF_loadScript):"
echo "   Añadir después de s.crossOrigin = 'anonymous':"
echo "   if (src.includes('pdf.min.js')) s.integrity = 'sha384-[HASH]';"
echo ""
echo "2. En factura.js, línea ~673 (carga de jsQR):"
echo "   script.integrity = 'sha384-[HASH]';"
echo ""
echo "3. En factura.js, línea ~1407 (carga de tesseract):"
echo "   s.integrity = 'sha384-[HASH]';"
echo ""
echo "4. En app.js, línea ~60 (carga de SheetJS):"
echo "   script.integrity = 'sha384-[HASH]';"
echo ""
echo "NOTA: SRI es OPCIONAL pero recomendado para producción."
echo "      crossorigin='anonymous' YA ESTÁ APLICADO."
echo ""

# Limpiar
rm -rf "$TMP_DIR"
