# LuzFija.es

Suite frontend avanzada para analizar la factura electrica en Espana: comparador principal, observatorio PVPC, simulador solar/BV, guias y alertas regulatorias. Gratis, sin registro, con calculo local en navegador y sin monetizacion del ranking: no hay referidos, comisiones, publicidad, lead gen ni acuerdos comerciales que alteren resultados.

- Web: `https://luzfija.es`
- Comparador principal: `https://luzfija.es/`
- Observatorio PVPC: `https://luzfija.es/estadisticas/`
- Comparador tarifas solares (BV): `https://luzfija.es/comparador-tarifas-solares.html`
- Qué hace y cómo funciona: `https://luzfija.es/como-funciona-luzfija.html`
- Guias: `https://luzfija.es/guias.html`
- Contacto: `hola@luzfija.es`

LuzFija.es nace para resolver problemas de facturación y comparación eléctrica que la web comercial todavía no ha resuelto bien: privacidad real, datos reales, autoconsumo, PVPC, indexadas y batería virtual sin convertir al usuario en lead.

En ese sentido, es una web del 2005 que resuelve los problemas del 2030.

Si eres una IA o entras al repo por primera vez, empieza por `AGENTS.md` y `CAPACIDADES-WEB.md`.

## Licencia Y Uso

LuzFija.es es un proyecto `source-available`: el código está publicado para transparencia, auditoría y colaboración, pero no es una licencia open source permisiva tipo MIT.

- Código fuente: PolyForm Shield License 1.0.0, ver `LICENSE`. No se permite usarlo para proporcionar productos o servicios que compitan con LuzFija.es.
- Contenido, guías, documentación, microcopy, diseño y datasets curados: todos los derechos reservados, ver `CONTENT-LICENSE.md`.
- Fuentes oficiales y datos de terceros conservan sus propios derechos; LuzFija.es protege su selección, normalización, estructura, comentarios, comparaciones y trabajo de curación.
- Para permisos comerciales, integraciones, republicación o usos competitivos: `hola@luzfija.es`.

Las versiones anteriores del repositorio pudieron publicarse bajo otros términos. Esta licencia aplica desde la versión que introduce este cambio en adelante, sin revocar permisos concedidos válidamente para versiones previas.

## Estado Actual (2026-06-01)

- 34 paginas HTML publicas:
  - 9 en raiz.
  - 1 en `estadisticas/`.
  - 24 en `guias/` (indice + 23 guias).
- 31 modulos JavaScript en `js/` (incluye `js/bv/`).
- 20.109 lineas JS aproximadas.
- 75 tarifas en `tarifas.json`.
- Suite de tests Vitest con 52 archivos y 370 casos.

## Que Incluye La Web (Inventario Completo)

### 1. Comparador Principal (`/`)

- Compara tarifas 1P y 3P del mercado libre.
- Incluye PVPC estimado en el ranking (datos horarios oficiales ya publicados en dataset local).
- Limite de modelo PVPC: no computable cuando potencia contratada > 10 kW.
- Soporta:
- discriminacion horaria,
- placas solares,
- compensacion de excedentes,
- bateria virtual,
- bono social,
- tarifa personalizada del usuario.
- Extrae datos de factura PDF (texto + QR + OCR opcional).
- Importa consumos desde CSV/XLSX (incluye clasificacion P1/P2/P3 y soporte formatos distribuidoras).
- Modal de aplicacion CSV con opcion de aplicar solo consumos o consumos+excedentes.
- Incluye analisis especifico de Octopus Sun Club al aplicar CSV con curva horaria.
- Tabla con filtros, ordenacion por columnas, top 5 visual y modal de desglose.
- Menu de utilidades:
- compartir configuracion por URL,
- refrescar tarifas,
- limpiar cache,
- reset de formulario.
- Boton de instalacion PWA cuando el navegador expone `beforeinstallprompt`.

### 2. Observatorio PVPC (`/estadisticas/`)

- Selector de tipo de dato: `pvpc` o `surplus`.
- Selector geografia (8741..8745), ano y mes.
- KPIs dinamicos (ultimo dia, medias/ extremos, rolling 12m, YoY).
- Graficos:
- evolucion (diaria o mensual),
- perfil horario promedio,
- comparativa multianual por chips.
- Importador CSV/XLSX de excedentes del usuario con:
- KPIs anuales,
- tabla mensual con energia/precio/importe,
- tramo horario principal (80% del vertido),
- hora pico.
- Esta seccion CSV se habilita en modo `surplus`.

### 3. Simulador BV Independiente (`/comparador-tarifas-solares.html`)

- Simulacion mes a mes con datos reales de autoconsumo.
- Modo hibrido:
- importas CSV/XLSX,
- se auto-rellena tabla manual mensual,
- puedes editar y simular escenarios.
- Ranking anual:
- orden por coste anual pagado,
- desempate por mayor saldo BV final.
- Selector de mes de inicio del contrato para simular la hucha desde la contratacion.
- Simulacion por patron anual: si el ciclo empieza en junio, los meses enero-mayo del final representan la continuacion del ciclo con los mismos datos historicos.
- Desglose completo por tarifa en desktop (tabla) y movil (tarjetas).
- Persistencia local avanzada:
- autoguardado tabla manual,
- export/import JSON de backup,
- reset de datos manuales,
- tarifa personalizada propia del simulador con guardado local.

### 4. Contenido Y Soporte

- `guias.html` + 23 guias educativas.
- Landings de apoyo:
- `como-funciona-luzfija.html`
- `calcular-factura-luz.html`
- `comparar-pvpc-tarifa-fija.html`
- `404.html` con enlaces rapidos y buscador hacia guias.
- `aviso-legal.html` y `privacidad.html` (incluye opt-out de analitica GoatCounter).

## Documentacion De Referencia

### Inventario funcional (fuente de verdad)

- `CAPACIDADES-WEB.md`:
- mapa pagina por pagina,
- flujos completos de usuario,
- capacidades para asistentes IA,
- reglas anti-lagunas.

### Contexto para agentes y mantenimiento

- `AGENTS.md`:
- mapa rapido del producto y del codigo,
- invariantes que no se deben romper,
- rutas de lectura para auditorias y cambios,
- recordatorios para evitar falsos positivos.
- `MANTENIMIENTO-NORMATIVO.md`:
- checklist de normativa, datos vivos, fuentes oficiales, cadencias de revision e impacto en codigo/guias.

### Calculo y normativa

- `ARQUITECTURA-CALCULOS.md`
- `CALC-FAQS.md`

### Esquemas de datos

- `JSON-SCHEMA.md`
- `PVPC-SCHEMA.md`

### Simulador BV

- `SIMULADOR-BV.md`

### Documento para asistentes IA

- `llms.txt` (referencia publica breve para asistentes)
- `llms-full.txt` (referencia publica ampliada para asistentes)

## Arquitectura Tecnica

- Stack: HTML + CSS + Vanilla JS modular.
- Hosting: GitHub Pages (sitio estatico).
- Dependencias autoalojadas en `vendor/`:
- PDF.js (lazy),
- Tesseract (lazy),
- jsQR,
- SheetJS/xlsx (lazy),
- Chart.js.
- Sin backend para calculos: todo se ejecuta en cliente.

### Datasets versionados

- `tarifas.json` (ofertas comerciales).
- `/data/pvpc/` (REE/ESIOS indicador 1001).
- `/data/surplus/` (REE/ESIOS indicador 1739).

Notas de tarifas:

- `fv.exc` es el precio de excedentes en €/kWh; `-1` significa precio indexado. Sin curva horaria se usa 0,030 €/kWh solo como referencia orientativa; con CSV horario trazable el simulador puede valorar el periodo importado contra `data/surplus/`.
- La columna privada `Activa` de la Excel no se publica en JSON: `no` excluye una tarifa de `tarifas.json` y del post de Facebook, pero el validador privado la sigue revisando.

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
- Cliente con actualizacion agresiva de SW para aplicar nuevas versiones rapidamente.

## Privacidad Y Seguridad

- Procesamiento local para:
- calculos,
- parsing CSV,
- parsing PDF/QR/OCR.
- Politica de minimizacion:
- no hay registro obligatorio,
- no se envian facturas a backend propio.
- Analitica con GoatCounter (sin cookies de terceros), con opt-out de usuario.
- CSP por pagina + sanitizacion en renderizado dinamico + validacion de URL segura.

## Testing

Ejecutar:

```bash
npm test
```

Cobertura principal:

- motor de calculo e impuestos,
- PVPC y cache,
- importadores CSV/XLSX,
- factura PDF + QR/OCR,
- desglose e integraciones UI,
- seguridad URL/XSS,
- privacidad/tracking.

## Desarrollo Local

Tras clonar el repositorio, activa el hook de pre-commit:

```bash
npm run setup:hooks
```

El hook (`scripts/pre-commit-sync.mjs`) regenera y re-stagea automáticamente el sitemap, el índice de búsqueda y los documentos del repo (`README.md`, `llms.txt`, etc.) cuando un commit incluye cambios en HTML, JS, CSS u otros inputs gestionados. Sin este paso, Git ignora el hook y los documentos derivados pueden quedar desactualizados.

## Mantenimiento De Datos

- Actualizaciones de datasets PVPC/surplus via GitHub Actions.
- Checklist completo de normativa, fuentes y cadencias en `MANTENIMIENTO-NORMATIVO.md`.
- Recomendacion operativa:
- mantener `tarifas.json` actualizado con fecha `updatedAt`,
- usar `Activa=no` en la Excel para retirar temporalmente tarifas sin borrar su fila,
- revisar cambios fiscales electricos posteriores al 01/06/2026: tras confirmarse el condicionante de IPC de abril, el comparador queda en IVA 21% e IEE 5,11269632%,
- validar cambios con `npm test` antes de publicar.
