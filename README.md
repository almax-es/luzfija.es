# LuzFija.es

Suite frontend avanzada para analizar la factura eléctrica en España: comparador principal, observatorio PVPC, simulador solar/BV, guías y alertas regulatorias. Gratis, sin registro, con cálculo local en navegador y sin monetización del ranking: no hay referidos, comisiones, publicidad, lead gen ni acuerdos comerciales que alteren resultados.

- Web: `https://luzfija.es`
- Comparador principal: `https://luzfija.es/`
- Observatorio PVPC: `https://luzfija.es/estadisticas/`
- Comparador tarifas solares (BV): `https://luzfija.es/comparador-tarifas-solares.html`
- Qué hace y cómo funciona: `https://luzfija.es/como-funciona-luzfija.html`
- Guías: `https://luzfija.es/guías.html`
- Contacto: `hola@luzfija.es`

Si eres una IA o entras al repo por primera vez, empieza por `AGENTS.md` y `CAPACIDADES-WEB.md`.

## Licencia Y Uso

LuzFija.es es un proyecto `source-available`: el código está publicado para transparencia, auditoría y colaboración, pero no es una licencia open source permisiva tipo MIT.

- Código fuente: PolyForm Shield License 1.0.0, ver `LICENSE`. No se permite usarlo para proporcionar productos o servicios que compitan con LuzFija.es.
- Contenido, guías, documentación, microcopy, diseño y datasets curados: todos los derechos reservados, ver `CONTENT-LICENSE.md`.
- Fuentes oficiales y datos de terceros conservan sus propios derechos; LuzFija.es protege su selección, normalización, estructura, comentarios, comparaciones y trabajo de curación.
- Para permisos comerciales, integraciones, republicación o usos competitivos: `hola@luzfija.es`.

Las versiones anteriores del repositorio pudieron publicarse bajo otros términos. Esta licencia aplica desde la versión que introduce este cambio en adelante, sin revocar permisos concedidos válidamente para versiones previas.

## Estado Actual (2026-05-13)

- 34 páginas HTML públicas:
  - 9 en raíz.
  - 1 en `estadisticas/`.
  - 24 en `guías/` (indice + 23 guías).
- 30 módulos JavaScript en `js/` (incluye `js/bv/`).
- 19.249 líneas JS aproximadas.
- 47 tarifas en `tarifas.json`.
- Suite de tests Vitest con 49 archivos y 312 casos.

## Qué Incluye La Web (Inventario Completo)

### 1. Comparador Principal (`/`)

- Compara tarifas 1P y 3P del mercado libre.
- Incluye PVPC estimado en el ranking (datos horarios oficiales ya publicados en dataset local).
- Limite de modelo PVPC: no computable cuando potencia contratada > 10 kW.
- Soporta:
  - discriminación horaria,
  - placas solares,
  - compensación de excedentes,
  - batería virtual,
  - bono social,
  - tarifa personalizada del usuario.
- Extrae datos de factura PDF (texto + QR + OCR opcional).
- Importa consumos desde CSV/XLSX (incluye clasificación P1/P2/P3 y soporte formatos distribuidoras).
- Modal de aplicación CSV con opción de aplicar solo consumos o consumos+excedentes.
- Incluye análisis específico de Octopus Sun Club al aplicar CSV con curva horaria.
- Tabla con filtros, ordenación por columnas, top 5 visual y modal de desglose.
- Menú de utilidades:
  - compartir configuración por URL,
  - refrescar tarifas,
  - limpiar cache,
  - reset de formulario.
- Botón de instalación PWA cuando el navegador expone `beforeinstallprompt`.

### 2. Observatorio PVPC (`/estadisticas/`)

- Selector de tipo de dato: `pvpc` o `surplus`.
- Selector geografia (8741..8745), año y mes.
- KPIs dinámicos (ultimo día, medias/ extremos, rolling 12m, YoY).
- Graficos:
  - evolución (diaria o mensual),
  - perfil horario promedio,
  - comparativa multianual por chips.
- Importador CSV/XLSX de excedentes del usuario con:
  - KPIs anuales,
  - tabla mensual con energía/precio/importe,
  - tramo horario principal (80% del vertido),
  - hora pico.
- Esta sección CSV se habilita en modo `surplus`.

### 3. Simulador BV Independiente (`/comparador-tarifas-solares.html`)

- Simulación mes a mes con datos reales de autoconsumo.
- Modo hibrido:
  - importas CSV/XLSX,
  - se auto-rellena tabla manual mensual,
  - puedes editar y simular escenarios.
- Ranking anual:
  - orden por coste anual pagado,
  - desempate por mayor saldo BV final.
- Desglose completo por tarifa en desktop (tabla) y móvil (tarjetas).
- Persistencia local avanzada:
  - autoguardado tabla manual,
  - export/import JSON de backup,
  - reset de datos manuales,
  - tarifa personalizada propia del simulador con guardado local.

### 4. Contenido Y Soporte

- `guías.html` + 23 guías educativas.
- Landings de apoyo:
  - `como-funciona-luzfija.html`
  - `calcular-factura-luz.html`
  - `comparar-pvpc-tarifa-fija.html`
  - `404.html` con enlaces rápidos y buscador hacia guías.
  - `aviso-legal.html` y `privacidad.html` (incluye opt-out de analítica GoatCounter).

## Documentación De Referencia

### Inventario funcional (fuente de verdad)

- `CAPACIDADES-WEB.md`:
  - mapa página por página,
  - flujos completos de usuario,
  - capacidades para asistentes IA,
  - reglas anti-lagunas.

### Contexto para agentes y mantenimiento

- `AGENTS.md`:
  - mapa rapido del producto y del código,
  - invariantes que no se deben romper,
  - rutas de lectura para auditorias y cambios,
  - recordatorios para evitar falsos positivos.
- `MANTENIMIENTO-NORMATIVO.md`:
  - checklist de normativa, datos vivos, fuentes oficiales, cadencias de revisión e impacto en código/guías.

### Calculo y normativa

- `ARQUITECTURA-CALCULOS.md`
- `CALC-FAQS.md`

### Esquemas de datos

- `JSON-SCHEMA.md`
- `PVPC-SCHEMA.md`

### Simulador BV

- `SIMULADOR-BV.md`

### Documento para asistentes IA

- `llms.txt` (referencia pública breve para asistentes)
- `llms-full.txt` (referencia pública ampliada para asistentes)

## Arquitectura Técnica

- Stack: HTML + CSS + Vanilla JS modular.
- Hosting: GitHub Pages (sitio estatico).
- Dependencias autoalojadas en `vendor/`:
  - PDF.js (lazy),
  - Tesseract (lazy),
  - jsQR,
  - SheetJS/xlsx (lazy),
  - Chart.js.
- Sin backend para cálculos: todo se ejecuta en cliente.

### Datasets versionados

- `tarifas.json` (ofertas comerciales).
- `/data/pvpc/` (REE/ESIOS indicador 1001).
- `/data/surplus/` (REE/ESIOS indicador 1739).

Notas de tarifas:

- `fv.exc` es el precio de excedentes en €/kWh; `-1` significa precio indexado y la web calcula con una estimacion operativa de 0,030 €/kWh mostrando aviso visible.
- La columna privada `Activa` de la Excel no se pública en JSON: `no` excluye una tarifa de `tarifas.json` y del post de Facebook, pero el validador privado la sigue revisando.

## PWA, Cache Y Offline

- Service Worker en `sw.js` con versionado por despliegue (`CACHE_VERSION`).
- Precache en dos niveles:
  - `CORE_ASSETS` (obligatorio).
  - `ASSETS` opcionales best-effort.
- Estrategias de cache:
  - HTML: network-first.
  - `tarifas.json`: network-only (sin cache para evitar datos obsoletos).
  - datasets PVPC/surplus: network-first.
  - resto de recursos: stale-while-revalidate.
- Cliente con actualización agresiva de SW para aplicar nuevas versiones rápidamente.

## Privacidad Y Seguridad

- Procesamiento local para:
  - cálculos,
  - parsing CSV,
  - parsing PDF/QR/OCR.
- Politica de minimización:
  - no hay registro obligatorio,
  - no se envían facturas a backend propio.
- Analitica con GoatCounter (sin cookies de terceros), con opt-out de usuario.
- CSP por página + sanitización en renderizado dinámico + validación de URL segura.

## Testing

Ejecutar:

```bash
npm test
```

Cobertura principal:

- motor de cálculo e impuestos,
- PVPC y cache,
- importadores CSV/XLSX,
- factura PDF + QR/OCR,
- desglose e integraciones UI,
- seguridad URL/XSS,
- privacidad/tracking.

## Mantenimiento De Datos

- Actualizaciones de datasets PVPC/surplus via GitHub Actions.
- Checklist completo de normativa, fuentes y cadencias en `MANTENIMIENTO-NORMATIVO.md`.
- Recomendación operativa:
  - mantener `tarifas.json` actualizado con fecha `updatedAt`,
  - usar `Activa=no` en la Excel para retirar temporalmente tarifas sin borrar su fila,
  - revisar antes del 30/06/2026 el IVA reducido temporal: tras el RDL 10/2026 el umbral operativo es potencia inferior o igual a 10 kW,
  - validar cambios con `npm test` antes de publicar.
