#!/usr/bin/env node
/**
 * Genera `tests/fixtures/factura-sintetica.pdf`, la fixture que usa
 * `tests/pdfjs-real.test.js` para ejercitar el PDF.js vendorizado de verdad.
 *
 * La fixture es DELIBERADAMENTE sintetica y no contiene ningun dato personal:
 * no procede de ninguna factura real, el CUPS es todo ceros y el resto de
 * valores son inventados. Se genera con este script en vez de adjuntar un PDF
 * de origen desconocido para que cualquiera pueda auditar exactamente que hay
 * dentro del binario que se commitea.
 *
 * Se escribe como PDF 1.4 sin comprimir y con fuente base-14 (Helvetica), asi
 * que el contenido es legible en texto plano dentro del propio fichero y no
 * incrusta ni tipografias ni metadatos.
 *
 * Uso: node scripts/make-pdf-fixture.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '..', 'tests', 'fixtures', 'factura-sintetica.pdf');

// Cada bloque es una linea de texto posicionada. El test afirma sobre estas
// mismas cadenas: si se tocan aqui, hay que tocarlas alli.
const TEXT_LINES = [
  [14, 720, 'FACTURA DE PRUEBA - DOCUMENTO SINTETICO'],
  [11, 690, 'Periodo de facturacion: 01/01/2026 - 31/01/2026'],
  [11, 670, 'CUPS: ES0000000000000000XX'],
  [11, 650, 'Potencia contratada P1: 4,600 kW'],
  [11, 630, 'Consumo total: 250 kWh'],
  [11, 610, 'Importe total: 62,50 EUR']
];

const content = TEXT_LINES
  .map(([size, y, text]) => ['BT', `/F1 ${size} Tf`, `72 ${y} Td`, `(${text}) Tj`, 'ET'].join('\n'))
  .join('\n') + '\n';

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${content.length} >>\nstream\n${content}endstream`
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, index) => {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefOffset = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
offsets.forEach((offset) => { pdf += String(offset).padStart(10, '0') + ' 00000 n \n'; });
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, pdf, 'latin1');
process.stdout.write(`fixture escrita: ${outPath} (${pdf.length} bytes)\n`);
