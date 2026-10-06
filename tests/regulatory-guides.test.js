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
  // RDL 25/2026 (BOE-A-2026-20265, 30/09/2026): octubre sin rebaja; arts. 18-21 dejan una
  // salvaguarda para noviembre (IPC de electricidad de septiembre) y diciembre (IPC de
  // octubre): IVA 10% e IEE 0,5% solo si la variacion anual supera el 15%.
  it('documents October at the general rates and the November/December safeguard', () => {
    const facturaGuide = readGuideText('guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html');

    expect(facturaGuide).toContain('el IVA de la luz es el general del 21% y lo sigue siendo en octubre');
    expect(facturaGuide).toContain('el RDL 25/2026 (BOE de 30/09/2026) no prevé rebaja para octubre');
    expect(facturaGuide).toContain('supera el 15% en septiembre (para noviembre) o en octubre (para diciembre)');
    expect(facturaGuide).toContain('21% de agosto a octubre de 2026');
    expect(facturaGuide).not.toContain('mientras no se publique una prórroga');
    expect(facturaGuide).not.toContain('21% en agosto y septiembre de 2026)');
    expect(facturaGuide).not.toContain('pendiente de la condición legal de IPC para septiembre');
  });

  // RD 897/2017 art. 6.3: el descuento se aplica a todos los terminos del PVPC.
  it('does not describe the bono social discount as energy-only', () => {
    const facturaGuide = readGuideText('guias/como-leer-tu-factura-de-la-luz-paso-a-paso.html');

    expect(facturaGuide).toContain('se aplica al término de potencia y al de energía');
    expect(facturaGuide).not.toContain('línea de descuento sobre la energía');
  });

  // RD 88/2026 art. 28.3: penalizacion solo "cuando esta cause danos al comercializador", tope del 5%.
  // El "directo" y la carga de la prueba son de la Directiva 2019/944 art. 12.3, que el RD incorpora
  // (DF 6.a): se citan con esa atribucion, no como texto del RD.
  it('attributes each termination penalty limit to its own source', () => {
    for (const rel of [
      'guias/como-cambiar-de-compania-sin-cortes-y-sin-que-te-li-en.html',
      'guias/la-letra-pequena-topes-de-kwh-cuotas-descuentos-y-permanencias.html',
    ]) {
      const guide = readGuideText(rel);
      expect(guide).toContain('causa daños a la comercializadora');
      expect(guide).toContain('pérdida económica directa');
      expect(guide).toContain('Directiva europea que incorpora esa regla');
      expect(guide).not.toContain('daño económico directo');
    }
  });

  // DA 58.3 LIRPF: sistemas de recarga instalados "en un inmueble de su propiedad".
  it('states the ownership requirement of the charging point IRPF deduction', () => {
    const recargaGuide = readGuideText('guias/instalar-punto-recarga-garaje-comunitario.html');

    expect(recargaGuide).toContain('instalados en un inmueble de tu propiedad');
  });

  it('keeps the PVPC eligibility requirements complete', () => {
    const pvpcGuide = readGuideText('guias/pvpc-vs-mercado-libre-cuando-te-conviene-cada-uno.html');

    expect(pvpcGuide).toContain('tensiones no superiores a 1 kV');
    expect(pvpcGuide).toContain('potencia contratada menor o igual a 10 kW en cada uno de los periodos horarios existentes');
    expect(pvpcGuide).toContain('volumen de negocio anual o balance general anual no supera los 2 millones');
    expect(pvpcGuide).not.toContain('menos de 10 trabajadores Y facturación anual menor de 2 millones');
    // La COR que fue de EDP (Baser) pertenece hoy a TotalEnergies, como lista la guia del bono social.
    expect(pvpcGuide).not.toMatch(/comercializadoras de referencia \([^)]*\bEDP\b/);
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

  it('keeps complaint deadlines scoped by recipient, subject and contracted power', () => {
    const complaintGuide = readGuideText('guias/como-reclamar-a-comercializadora-distribuidora.html');

    expect(complaintGuide).toContain('artículo 55.3 del Reglamento aprobado por el RD 88/2026');
    expect(complaintGuide).toContain('artículo 103.2.D del RD 1955/2000');
    expect(complaintGuide).toContain('5 días hábiles si reclamas a la distribuidora por la medida del consumo, facturas emitidas o cortes indebidos y tienes menos de 15 kW contratados');
    expect(complaintGuide).toContain('15 días hábiles en los demás casos');
    expect(complaintGuide).toContain('Si no obtengo resolución satisfactoria dentro del plazo legal aplicable');
    expect(complaintGuide).not.toContain('Las compañías tienen un plazo máximo de 15 días hábiles para responder');
  });
});
