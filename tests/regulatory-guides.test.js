/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
  return normalizeWhitespace(String(value || '').replace(/<[^>]+>/g, ' '));
}

function readGuideText(relPath) {
  return stripHtml(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

describe('Guide regulatory guardrails', () => {
  it('documents the conditional June end of the temporary 10% electricity VAT', () => {
    const facturaGuide = readGuideText('guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html');

    expect(facturaGuide).toContain('si en abril la variación del IPC de la electricidad no supera en más de un 15%');
    expect(facturaGuide).toContain('esa rebaja dejará de aplicarse en junio');
  });

  it('keeps the PVPC eligibility requirements complete', () => {
    const pvpcGuide = readGuideText('guias/pvpc-vs-mercado-libre-cuando-te-conviene-cada-uno.html');

    expect(pvpcGuide).toContain('tensiones no superiores a 1 kV');
    expect(pvpcGuide).toContain('potencia contratada menor o igual a 10 kW en cada uno de los periodos horarios existentes');
    expect(pvpcGuide).toContain('volumen de negocio anual o balance general anual no supera los 2 millones');
    expect(pvpcGuide).not.toContain('menos de 10 trabajadores Y facturación anual menor de 2 millones');
  });

  it('keeps the power guide aligned with the official P1/P2 structure in 2.0TD', () => {
    const potenciaGuide = readGuideText('guias/que-potencia-contratar-segun-tu-casa-y-tus-habitos.html');

    expect(potenciaGuide).toContain('P1 (punta+llano laborable)');
    expect(potenciaGuide).toContain('P2 (valle): Coincide con 0h-8h y también con sábados, domingos y festivos nacionales que computen como valle');
    expect(potenciaGuide).not.toContain('P1 (día):');
    expect(potenciaGuide).not.toContain('P2 (resto + noche):');
  });

  it('keeps the P1/P2 FAQ aligned with the official valley period definition', () => {
    const periodosGuide = readGuideText('guias/que-es-p1-p2-y-p3-en-tu-factura.html');

    expect(periodosGuide).toContain('P1 agrupa las horas laborables de punta y llano');
    expect(periodosGuide).toContain('P2 coincide con el valle (0h a 8h, más sábados, domingos y festivos nacionales que computen como valle)');
  });
});
