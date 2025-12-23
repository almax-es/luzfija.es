#!/bin/bash

# Bloque de favicons a añadir
FAVICON_BLOCK='  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
  <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="mask-icon" href="/favicon.svg" color="#8B5CF6">'

# Procesar todos los HTML que NO tienen favicon
for file in *.html guias/*.html; do
  # Saltar archivos especiales
  if [[ "$file" == "google60cc5bcefe636a81.html" ]]; then
    continue
  fi
  
  # Solo procesar si NO tiene favicon
  if ! grep -q "favicon" "$file"; then
    echo "Añadiendo favicon a: $file"
    
    # Buscar la línea con <title> y añadir después
    awk -v favicons="$FAVICON_BLOCK" '
      /<title>/ {
        print
        print favicons
        next
      }
      {print}
    ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  fi
done

echo "✅ Proceso completado"
