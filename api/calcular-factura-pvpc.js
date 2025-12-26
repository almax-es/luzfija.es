// api/calcular-factura-pvpc.js
// CMNC EXACTO

const PEAJES_CARGOS_ENERGIA = { p1: 0.092539, p2: 0.028201, p3: 0.002994 };
const PEAJES_CARGOS_POTENCIA = { p1: 26.93055, p2: 0.697588 };
const MARGEN_COMERCIALIZACION = 3.113;
const FINANCIACION_BONO_SOCIAL = 0.0127424301;
const ALQUILER_CONTADOR = 0.81;
const IMPUESTO_ELECTRICO = 0.051127;
const IVA = 0.21;

const ZONA_ESIOS = {
  1: { indicador: 1001, geo_id: 8741 },
  2: { indicador: 1003, geo_id: 8742 },
  3: { indicador: 1001, geo_id: 8743 },
  4: { indicador: 1002, geo_id: 8744 },
  5: { indicador: 1002, geo_id: 8745 }
};

function parseFecha(f) {
  const [d, m, y] = f.split('/');
  return new Date(y, m - 1, d);
}

function formatFechaESIOS(f) {
  const y = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, '0');
  const d = String(f.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00+01:00`;
}

function getPeriodo(fecha, hora) {
  const dia = fecha.getDay();
  if (dia === 0 || dia === 6) return 'p3';
  if (hora >= 0 && hora < 8) return 'p3';
  if ((hora >= 10 && hora < 14) || (hora >= 18 && hora < 22)) return 'p1';
  return 'p2';
}

async function obtenerPVPC(fi, ff, zona) {
  const cfg = ZONA_ESIOS[zona];
  const url = `https://api.esios.ree.es/indicators/${cfg.indicador}`;
  const params = new URLSearchParams({
    start_date: formatFechaESIOS(parseFecha(fi)),
    end_date: formatFechaESIOS(parseFecha(ff)),
    geo_ids: cfg.geo_id
  });
  
  const res = await fetch(`${url}?${params}`, {
    headers: {
      'Accept': 'application/json; application/vnd.esios-api-v2+json',
      'x-api-key': process.env.ESIOS_API_KEY
    }
  });
  
  if (!res.ok) throw new Error(`ESIOS: ${res.status}`);
  
  const data = await res.json();
  const precios = {};
  
  data.indicator.values.forEach(v => {
    if (v.geo_id === cfg.geo_id) {
      const fecha = new Date(v.datetime_utc);
      const clave = fecha.toISOString().split('T')[0];
      const hora = fecha.getUTCHours() + 1;
      if (!precios[clave]) precios[clave] = {};
      precios[clave][hora] = v.value / 1000;
    }
  });
  
  return precios;
}

function calcularPVPCMedios(precios_pvpc) {
  const horas = { p1: [], p2: [], p3: [] };
  let todas = [];
  
  Object.keys(precios_pvpc).forEach(fechaStr => {
    const [y, m, d] = fechaStr.split('-');
    const fecha = new Date(y, m - 1, d);
    
    Object.keys(precios_pvpc[fechaStr]).forEach(h => {
      const valor = precios_pvpc[fechaStr][h];
      const periodo = getPeriodo(fecha, parseInt(h));
      horas[periodo].push(valor);
      todas.push(valor);
    });
  });
  
  const medias = {};
  ['p1', 'p2', 'p3'].forEach(p => {
    medias[p] = horas[p].length > 0 
      ? horas[p].reduce((a, b) => a + b, 0) / horas[p].length
      : 0.12;
  });
  
  const media_total = todas.length > 0
    ? todas.reduce((a, b) => a + b, 0) / todas.length
    : 0.12;
  
  return { p1: medias.p1, p2: medias.p2, p3: medias.p3, total: media_total };
}

function calcular(params) {
  const {
    pvpc,
    c1, c2, c3,
    pot1, pot2,
    dias
  } = params;
  
  // 1. TÉRMINO VARIABLE
  // CMNC: peajes por periodo + PVPC medio total
  const consumo_total = c1 + c2 + c3;
  const coste_peajes_p1 = c1 * PEAJES_CARGOS_ENERGIA.p1;
  const coste_peajes_p2 = c2 * PEAJES_CARGOS_ENERGIA.p2;
  const coste_peajes_p3 = c3 * PEAJES_CARGOS_ENERGIA.p3;
  const coste_peajes_total = coste_peajes_p1 + coste_peajes_p2 + coste_peajes_p3;
  const coste_pvpc_total = consumo_total * pvpc.total;
  const termino_variable = coste_peajes_total + coste_pvpc_total;
  
  // 2. TÉRMINO FIJO
  const pot_p1 = (pot1 / 365) * dias * PEAJES_CARGOS_POTENCIA.p1;
  const pot_p2 = (pot2 / 365) * dias * PEAJES_CARGOS_POTENCIA.p2;
  const margen = (pot1 / 365) * dias * MARGEN_COMERCIALIZACION;
  const termino_fijo = pot_p1 + pot_p2 + margen;
  
  // 3. OTROS
  const bono = FINANCIACION_BONO_SOCIAL * dias;
  const contador = (ALQUILER_CONTADOR / 30) * dias;
  
  // 4. IMPUESTOS
  const subtotal = termino_fijo + termino_variable + bono + contador;
  const imp_elec = subtotal * IMPUESTO_ELECTRICO;
  const base = subtotal + imp_elec;
  const iva = base * IVA;
  const total = base + iva;
  
  // 5. PRECIOS PARA MOSTRAR (PVPC periodo + peajes periodo)
  const precio_p1 = pvpc.p1 + PEAJES_CARGOS_ENERGIA.p1;
  const precio_p2 = pvpc.p2 + PEAJES_CARGOS_ENERGIA.p2;
  const precio_p3 = pvpc.p3 + PEAJES_CARGOS_ENERGIA.p3;
  
  return {
    precioPunta: parseFloat(precio_p1.toFixed(6)),
    precioLlano: parseFloat(precio_p2.toFixed(6)),
    precioValle: parseFloat(precio_p3.toFixed(6)),
    terminoFijo: parseFloat(termino_fijo.toFixed(2)),
    terminoVariable: parseFloat(termino_variable.toFixed(2)),
    bonoSocial: parseFloat(bono.toFixed(2)),
    impuestoElectrico: parseFloat(imp_elec.toFixed(2)),
    equipoMedida: parseFloat(contador.toFixed(2)),
    iva: parseFloat(iva.toFixed(2)),
    totalFactura: parseFloat(total.toFixed(2))
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const {
      fecha_inicio, fecha_fin,
      consumo_p1 = 0, consumo_p2 = 0, consumo_p3 = 0,
      potencia_p1 = 3.45, potencia_p2 = 3.45,
      zona = 1
    } = req.query;
    
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }
    
    const inicio = parseFecha(fecha_inicio);
    const fin = parseFecha(fecha_fin);
    const dias = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    
    const precios_pvpc = await obtenerPVPC(fecha_inicio, fecha_fin, zona);
    const pvpc_medios = calcularPVPCMedios(precios_pvpc);
    
    const resultado = calcular({
      pvpc: pvpc_medios,
      c1: parseFloat(consumo_p1),
      c2: parseFloat(consumo_p2),
      c3: parseFloat(consumo_p3),
      pot1: parseFloat(potencia_p1),
      pot2: parseFloat(potencia_p2),
      dias
    });
    
    resultado.rangoFechas = { inicio: fecha_inicio, fin: fecha_fin };
    
    const ahora = new Date();
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    manana.setHours(0, 1, 0, 0);
    const segs = Math.floor((manana - ahora) / 1000);
    res.setHeader('Cache-Control', `public, s-maxage=${segs}`);
    
    return res.status(200).json(resultado);
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
