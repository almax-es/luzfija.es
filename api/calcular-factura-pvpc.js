// api/calcular-factura-pvpc.js
// Replica EXACTA de cálculos CMNC 2025

// ==================== VALORES EXACTOS CMNC 2025 ====================

// PEAJES + CARGOS ENERGÍA (€/kWh) - Valores TOTALES oficiales APPA 2025
const PEAJES_CARGOS_ENERGIA = {
  p1: 0.092539,  // Punta
  p2: 0.028201,  // Llano
  p3: 0.002994   // Valle
};

// PEAJES + CARGOS POTENCIA (€/kW/año) - Valores TOTALES CMNC
const PEAJES_CARGOS_POTENCIA = {
  p1: 26.93055,   // Punta (P1+P2 agrupados)
  p2: 0.697588    // Valle (P3)
};

// MARGEN COMERCIALIZACIÓN (tarifa PVPC regulada)
const MARGEN_COMERCIALIZACION = 3.113;  // €/kW/año

// OTROS
const FINANCIACION_BONO_SOCIAL = 0.0127424301;  // €/día (2025)
const ALQUILER_CONTADOR = 0.81;  // €/mes
const IMPUESTO_ELECTRICO = 0.051127;  // 5,1127%
const IVA = 0.21;  // 21%

// ESIOS
const ZONA_ESIOS = {
  1: { indicador: 1001, geo_id: 8741 },  // Península
  2: { indicador: 1003, geo_id: 8742 },  // Canarias
  3: { indicador: 1001, geo_id: 8743 },  // Baleares
  4: { indicador: 1002, geo_id: 8744 },  // Ceuta
  5: { indicador: 1002, geo_id: 8745 }   // Melilla
};

// ==================== FUNCIONES ====================

function parseFecha(fecha) {
  const [dia, mes, anio] = fecha.split('/');
  return new Date(anio, mes - 1, dia);
}

function formatFechaESIOS(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00+01:00`;
}

function getPeriodo(fecha, hora) {
  const dia = fecha.getDay();
  if (dia === 0 || dia === 6) return 'p3';  // Fin de semana
  if (hora >= 0 && hora < 8) return 'p3';    // Noche
  if ((hora >= 10 && hora < 14) || (hora >= 18 && hora < 22)) return 'p1';  // Punta
  return 'p2';  // Llano
}

async function obtenerPVPC(fechaInicio, fechaFin, zona) {
  const config = ZONA_ESIOS[zona];
  const url = `https://api.esios.ree.es/indicators/${config.indicador}`;
  const params = new URLSearchParams({
    start_date: formatFechaESIOS(parseFecha(fechaInicio)),
    end_date: formatFechaESIOS(parseFecha(fechaFin)),
    geo_ids: config.geo_id
  });
  
  const res = await fetch(`${url}?${params}`, {
    headers: {
      'Accept': 'application/json; application/vnd.esios-api-v2+json',
      'x-api-key': process.env.ESIOS_API_KEY
    }
  });
  
  if (!res.ok) throw new Error(`ESIOS error: ${res.status}`);
  
  const data = await res.json();
  const precios = {};
  
  data.indicator.values.forEach(v => {
    if (v.geo_id === config.geo_id) {
      const fecha = new Date(v.datetime_utc);
      const clave = fecha.toISOString().split('T')[0];
      const hora = fecha.getUTCHours() + 1;
      if (!precios[clave]) precios[clave] = {};
      precios[clave][hora] = v.value / 1000;  // €/MWh → €/kWh
    }
  });
  
  return precios;
}

function calcularPreciosPVPCPorPeriodo(precios_pvpc) {
  const horas_periodo = { p1: [], p2: [], p3: [] };
  
  Object.keys(precios_pvpc).forEach(fechaStr => {
    const [y, m, d] = fechaStr.split('-');
    const fecha = new Date(y, m - 1, d);
    
    Object.keys(precios_pvpc[fechaStr]).forEach(h => {
      const periodo = getPeriodo(fecha, parseInt(h));
      horas_periodo[periodo].push(precios_pvpc[fechaStr][h]);
    });
  });
  
  const medias = {};
  ['p1', 'p2', 'p3'].forEach(p => {
    if (horas_periodo[p].length > 0) {
      medias[p] = horas_periodo[p].reduce((a, b) => a + b, 0) / horas_periodo[p].length;
    } else {
      medias[p] = 0.12;  // Fallback
    }
  });
  
  return medias;
}

function calcular(params) {
  const {
    pvpc_medias,
    consumo_p1, consumo_p2, consumo_p3,
    potencia_p1, potencia_p2,
    dias
  } = params;
  
  // 1. TÉRMINO VARIABLE (energía)
  const coste_energia_p1 = consumo_p1 * (pvpc_medias.p1 + PEAJES_CARGOS_ENERGIA.p1);
  const coste_energia_p2 = consumo_p2 * (pvpc_medias.p2 + PEAJES_CARGOS_ENERGIA.p2);
  const coste_energia_p3 = consumo_p3 * (pvpc_medias.p3 + PEAJES_CARGOS_ENERGIA.p3);
  const termino_variable = coste_energia_p1 + coste_energia_p2 + coste_energia_p3;
  
  // 2. TÉRMINO FIJO (potencia + margen)
  const coste_pot_p1 = (potencia_p1 / 365) * dias * PEAJES_CARGOS_POTENCIA.p1;
  const coste_pot_p2 = (potencia_p2 / 365) * dias * PEAJES_CARGOS_POTENCIA.p2;
  const margen = (potencia_p1 / 365) * dias * MARGEN_COMERCIALIZACION;
  const termino_fijo = coste_pot_p1 + coste_pot_p2 + margen;
  
  // 3. FINANCIACIÓN BONO SOCIAL
  const bono_social = FINANCIACION_BONO_SOCIAL * dias;
  
  // 4. ALQUILER CONTADOR
  const equipo_medida = (ALQUILER_CONTADOR / 30) * dias;
  
  // 5. IMPUESTO ELÉCTRICO
  const subtotal = termino_fijo + termino_variable + bono_social + equipo_medida;
  const impuesto_electrico = subtotal * IMPUESTO_ELECTRICO;
  
  // 6. IVA
  const base_imponible = subtotal + impuesto_electrico;
  const iva = base_imponible * IVA;
  
  // 7. TOTAL
  const total = base_imponible + iva;
  
  // PRECIOS FINALES TODO INCLUIDO (para mostrar)
  const precio_punta = pvpc_medias.p1 + PEAJES_CARGOS_ENERGIA.p1;
  const precio_llano = pvpc_medias.p2 + PEAJES_CARGOS_ENERGIA.p2;
  const precio_valle = pvpc_medias.p3 + PEAJES_CARGOS_ENERGIA.p3;
  
  return {
    precioPunta: parseFloat(precio_punta.toFixed(6)),
    precioLlano: parseFloat(precio_llano.toFixed(6)),
    precioValle: parseFloat(precio_valle.toFixed(6)),
    terminoFijo: parseFloat(termino_fijo.toFixed(2)),
    terminoVariable: parseFloat(termino_variable.toFixed(2)),
    bonoSocial: parseFloat(bono_social.toFixed(2)),
    impuestoElectrico: parseFloat(impuesto_electrico.toFixed(2)),
    equipoMedida: parseFloat(equipo_medida.toFixed(2)),
    iva: parseFloat(iva.toFixed(2)),
    totalFactura: parseFloat(total.toFixed(2))
  };
}

// ==================== HANDLER ====================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const {
      fecha_inicio,
      fecha_fin,
      consumo_p1 = 0,
      consumo_p2 = 0,
      consumo_p3 = 0,
      potencia_p1 = 3.45,
      potencia_p2 = 3.45,
      zona = 1
    } = req.query;
    
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }
    
    const inicio = parseFecha(fecha_inicio);
    const fin = parseFecha(fecha_fin);
    const dias = Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
    
    const precios_pvpc = await obtenerPVPC(fecha_inicio, fecha_fin, zona);
    const pvpc_medias = calcularPreciosPVPCPorPeriodo(precios_pvpc);
    
    const resultado = calcular({
      pvpc_medias,
      consumo_p1: parseFloat(consumo_p1),
      consumo_p2: parseFloat(consumo_p2),
      consumo_p3: parseFloat(consumo_p3),
      potencia_p1: parseFloat(potencia_p1),
      potencia_p2: parseFloat(potencia_p2),
      dias
    });
    
    resultado.rangoFechas = { inicio: fecha_inicio, fin: fecha_fin };
    
    // Cache 24h
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
