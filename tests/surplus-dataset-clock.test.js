import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guardia sobre los datos publicados de excedentes (indicador 1739). Cada zona se guarda en su
// hora civil, porque los consumidores cruzan la hora LOCAL de la curva del usuario con la
// etiqueta horaria del fichero. Hasta la ronda 46, data/surplus/8742 iba en hora peninsular y
// cada hora canaria se valoraba con el precio de la anterior. El workflow diario reescribe
// estos ficheros: si el generador vuelve a forzar otro reloj, este test lo para.

const ROOT = path.resolve(__dirname, '..', 'data', 'surplus');
const RELOJ = { 8741: 'Europe/Madrid', 8742: 'Atlantic/Canary', 8743: 'Europe/Madrid', 8744: 'Europe/Madrid', 8745: 'Europe/Madrid' };
const MES = /^\d{4}-\d{2}\.json$/;

const formateadores = new Map();
const fechaLocal = (ts, timeZone) => {
  if (!formateadores.has(timeZone)) {
    formateadores.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }));
  }
  return formateadores.get(timeZone).format(new Date(ts * 1000));
};
// Recorre ~46.000 horas por zona: con la suite completa en paralelo pasa de los 5 s por defecto.
const TIMEOUT = 60000;

function puntosDe(geo) {
  const dir = path.join(ROOT, String(geo));
  const puntos = new Map();
  const ficheros = fs.readdirSync(dir).filter((f) => MES.test(f)).map((f) => ({
    nombre: f,
    datos: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  }));
  for (const { datos } of ficheros) {
    for (const filas of Object.values(datos.days)) for (const [ts, precio] of filas) puntos.set(ts, precio);
  }
  return { ficheros, puntos };
}

describe('data/surplus: cada zona en su reloj civil', () => {
  it.each(Object.entries(RELOJ))('geo %s declara %s y cada hora cae en su dia local', (geo, reloj) => {
    const indice = JSON.parse(fs.readFileSync(path.join(ROOT, geo, 'index.json'), 'utf8'));
    expect(indice.timezone).toBe(reloj);
    const { ficheros } = puntosDe(geo);
    expect(ficheros.length).toBeGreaterThan(0);
    const fueraDeDia = [];
    for (const { nombre, datos } of ficheros) {
      expect(datos.timezone, nombre).toBe(reloj);
      for (const [dia, filas] of Object.entries(datos.days)) {
        expect(dia.slice(0, 7), nombre).toBe(nombre.slice(0, 7));
        for (const [ts] of filas) if (fechaLocal(ts, reloj) !== dia) fueraDeDia.push(`${nombre} ${dia} ${ts}`);
      }
    }
    expect(fueraDeDia).toEqual([]);
  }, TIMEOUT);

  it('el indice general declara el mismo reloj por zona', () => {
    const general = JSON.parse(fs.readFileSync(path.join(ROOT, 'index.json'), 'utf8'));
    for (const { geo_id: geo, timezone } of general.geos) expect(timezone, String(geo)).toBe(RELOJ[geo]);
  });

  it('8742 es la serie nacional: mismo precio que 8741 en el mismo instante', () => {
    const canarias = puntosDe(8742).puntos;
    const peninsula = puntosDe(8741).puntos;
    let comunes = 0;
    const distintos = [];
    for (const [ts, precio] of canarias) {
      if (!peninsula.has(ts)) continue;
      comunes += 1;
      if (peninsula.get(ts) !== precio) distintos.push(ts);
    }
    expect(comunes).toBeGreaterThan(canarias.size - 48);
    expect(distintos).toEqual([]);
  }, TIMEOUT);
});
