# Politica de seguridad

## Como informar de una vulnerabilidad

Usa el reporte privado de GitHub: pestana **Security** del repositorio ->
**Report a vulnerability**. Tambien puedes escribir a hola@luzfija.es.

No abras una issue publica para vulnerabilidades sin corregir.

Incluye, si puedes: URL o fichero afectado, pasos para reproducirlo, navegador
y version, e impacto esperado.

## Alcance

LuzFija.es es un sitio estatico servido desde GitHub Pages, sin backend propio
ni cuentas de usuario. Todo el calculo, la lectura de facturas PDF y la
importacion de CSV/XLSX ocurren en el navegador del usuario.

Dentro del alcance:

- XSS o ejecucion de codigo en cualquier pagina de `luzfija.es`.
- Fugas de datos de la factura, del CSV/XLSX o de la importacion de Datadis
  fuera del navegador del usuario (incluida la analitica).
- Saltos de la CSP o de la proteccion anti-iframe (`js/frame-guard.js`).
- Problemas en los workflows de GitHub Actions o en la cadena de suministro
  (`vendor/`, dependencias npm).

Fuera del alcance:

- Cabeceras HTTP que GitHub Pages no permite configurar.
- Endurecimiento de CSP en paginas editoriales que no procesan datos del
  usuario (guias, paginas legales).
- Informes automaticos sin una prueba de impacto real.

## Respuesta

Es un proyecto mantenido por una sola persona y sin animo de lucro. Se acusa
recibo en cuanto sea posible y se prioriza segun el impacto real. No hay
programa de recompensas.
