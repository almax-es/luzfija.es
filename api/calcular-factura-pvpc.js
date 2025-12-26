// api/calcular-factura-pvpc.js
// Endpoint que SUSTITUYE completamente al de CMNC
// Calcula factura PVPC completa con datos de ESIOS + peajes + cargos + impuestos

// ==================== CONSTANTES 2025 ====================

const PEAJES_2025 = {
  energia: { p1: 0.034234, p2: 0.016540, p3: 0.000079 },
  potencia: { p1p2: 22.958932, p3: 0.442165 }
};

const CARGOS_2025 = {
  energia: { 
    p1: 0.010166 + 0.001027,  // cargo + pago capacidad
    p2: 0.004640 + 0.000435,
    p3: 0.000256 + 0.000024
  },
  potencia: 3.113073
};

const IMPUESTOS = {
  electrico: 0.051127,      // 5,1127%
  iva_peninsula: 0.21,       // 21%
  igic_electricidad_vivienda: 0.00,  // 0% Canarias vivienda ≤10kW
  igic_electricidad_otros: 0.03,     // 3% Canarias otros
  igic_contador: 0.07,       // 7% Canarias contador
  ipsi: 0.01                 // 1% Ceuta/Melilla
};

const ALQUILER_CONTADOR = 0.81;  // €/mes (aprox)

// Mapeo zona -> indicador ESIOS
const ZONA_ESIOS = {
  1: { indicador: 1001, geo_id: 8741, nombre: 'Peninsula' },
  2: { indicador: 1003, geo_id: 8742, nombre: 'Canarias' },
  3: { indicador: 1001, geo_id: 8743, nombre: 'Baleares' },
  4: { indicador: 1002, geo_id: 8744, nombre: 'Ceuta' },
  5: { indicador: 1002, geo_id: 8745, nombre: 'Melilla' }
};

// ==================== FUNCIONES AUXILIARES ====================

function parseFecha(fecha) {
  // Convierte "DD/MM/YYYY" a Date
  const [dia, mes, anio] = fecha.split('/');
  return new Date(anio, mes - 1, dia);
}

function formatFechaESIOS(fecha) {
  // Formato ISO para ESIOS: "2025-01-01T00:00:00+01:00"
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00+01:00`;
}

function calcularDias(fechaInicio, fechaFin) {
  const inicio = parseFecha(fechaInicio);
  const fin = parseFecha(fechaFin);
  return Math.ceil((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
}

// Determina periodo horario (P1/P2/P3) según fecha y hora
function getPeriodo(fecha, hora) {
  const dia = fecha.getDay(); // 0=domingo, 6=sábado
  
  // P3 (valle): fines de semana + festivos (simplificado) + noche
  if (dia === 0 || dia === 6) return 'p3';
  if (hora >= 0 && hora < 8) return 'p3';
  
  // P1 (punta): L-V 10-14h y 18-22h
  if (hora >= 10 && hora < 14) return 'p1';
  if (hora >= 18 && hora < 22) return 'p1';
  
  // P2 (llano): resto
  return 'p2';
}

async function obtenerPreciosESIOS(fechaInicio, fechaFin, zona) {
  const config = ZONA_ESIOS[zona];
  if (!config) throw new Error(`Zona inválida: ${zona}`);
  
  const url = `https://api.esios.ree.es/indicators/${config.indicador}`;
  const params = new URLSearchParams({
    start_date: formatFechaESIOS(parseFecha(fechaInicio)),
    end_date: formatFechaESIOS(parseFecha(fechaFin)),
    geo_ids: config.geo_id
  });
  
  const response = await fetch(`${url}?${params}`, {
    headers: {
      'Accept': 'application/json; application/vnd.esios-api-v2+json',
      'x-api-key': '0f2b02fb6201ec3591c3e19337bbaabecf92e899919fb3117b0e3f69904b653b'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Error ESIOS: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Convertir €/MWh a €/kWh y organizar por fecha/hora
  const precios = {};
  data.indicator.values.forEach(v => {
    if (v.geo_id === config.geo_id) {
      const fecha = new Date(v.datetime_utc);
      const clave = fecha.toISOString().split('T')[0];
      const hora = fecha.getUTCHours() + 1; // Ajuste zona horaria
      
      if (!precios[clave]) precios[clave] = {};
      precios[clave][hora] = v.value / 1000; // €/MWh -> €/kWh
    }
  });
  
  return precios;
}

function calcularFactura(params) {
  const {
    precios_pvpc,
    consumos_p1, consumos_p2, consumos_p3,
    potencia_p1, potencia_p2,
    dias,
    zona,
    es_vivienda = true
  } = params;
  
  // 1. TÉRMINO DE ENERGÍA
  const consumo_total = {
    p1: consumos_p1 || 0,
    p2: consumos_p2 || 0,
    p3: consumos_p3 || 0
  };
  
  // Calcular precio medio PVPC por periodo (simplificado)
  // En producción, deberías calcular el precio exacto hora a hora
  let precio_medio_pvpc = {
    p1: 0.15,  // Valores por defecto si no hay precios
    p2: 0.12,
    p3: 0.08
  };
  
  // Si hay precios ESIOS, calcular media real
  if (precios_pvpc && Object.keys(precios_pvpc).length > 0) {
    const todas_horas = Object.values(precios_pvpc).flatMap(dia => Object.values(dia));
    const suma = todas_horas.reduce((a, b) => a + b, 0);
    const media = suma / todas_horas.length;
    
    // Aplicar distribución típica P1/P2/P3 sobre la media
    precio_medio_pvpc = {
      p1: media * 1.25,  // Punta ~25% más caro
      p2: media,         // Llano = media
      p3: media * 0.67   // Valle ~33% más barato
    };
  }
  
  // Precio total por periodo = PVPC + peajes + cargos
  const precio_total = {
    p1: precio_medio_pvpc.p1 + PEAJES_2025.energia.p1 + CARGOS_2025.energia.p1,
    p2: precio_medio_pvpc.p2 + PEAJES_2025.energia.p2 + CARGOS_2025.energia.p2,
    p3: precio_medio_pvpc.p3 + PEAJES_2025.energia.p3 + CARGOS_2025.energia.p3
  };
  
  const coste_energia = {
    p1: consumo_total.p1 * precio_total.p1,
    p2: consumo_total.p2 * precio_total.p2,
    p3: consumo_total.p3 * precio_total.p3
  };
  
  const total_energia = coste_energia.p1 + coste_energia.p2 + coste_energia.p3;
  
  // 2. TÉRMINO DE POTENCIA
  const coste_potencia_p1p2 = (potencia_p1 / 365) * dias * (PEAJES_2025.potencia.p1p2 + CARGOS_2025.potencia);
  const coste_potencia_p3 = (potencia_p2 / 365) * dias * PEAJES_2025.potencia.p3;
  const total_potencia = coste_potencia_p1p2 + coste_potencia_p3;
  
  // 3. ALQUILER CONTADOR
  const coste_alquiler = (ALQUILER_CONTADOR / 30) * dias;
  
  // 4. SUBTOTAL ANTES DE IMPUESTOS
  const subtotal = total_energia + total_potencia + coste_alquiler;
  
  // 5. IMPUESTO ELÉCTRICO (5,1127%)
  const impuesto_electrico = subtotal * IMPUESTOS.electrico;
  
  // 6. BASE IMPONIBLE
  const base_imponible = subtotal + impuesto_electrico;
  
  // 7. IVA / IGIC / IPSI (según zona)
  let impuesto_final = 0;
  let nombre_impuesto = 'iva';
  
  switch (parseInt(zona)) {
    case 1: // Península
    case 3: // Baleares
      impuesto_final = base_imponible * IMPUESTOS.iva_peninsula;
      nombre_impuesto = 'iva';
      break;
      
    case 2: // Canarias
      const base_sin_contador = base_imponible - coste_alquiler;
      if (es_vivienda && potencia_p1 <= 10) {
        // Vivienda ≤10kW: 0% electricidad + 7% contador
        impuesto_final = coste_alquiler * IMPUESTOS.igic_contador;
      } else {
        // Otros: 3% electricidad + 7% contador
        impuesto_final = (base_sin_contador * IMPUESTOS.igic_electricidad_otros) + 
                        (coste_alquiler * IMPUESTOS.igic_contador);
      }
      nombre_impuesto = 'igic';
      break;
      
    case 4: // Ceuta
    case 5: // Melilla
      impuesto_final = base_imponible * IMPUESTOS.ipsi;
      nombre_impuesto = 'ipsi';
      break;
  }
  
  // 8. TOTAL FACTURA
  const total_factura = base_imponible + impuesto_final;
  
  // 9. FORMATO COMPATIBLE CON CMNC
  return {
    precioPunta: precio_total.p1,
    precioLlano: precio_total.p2,
    precioValle: precio_total.p3,
    terminoFijo: parseFloat(total_potencia.toFixed(2)),
    terminoVariable: parseFloat(total_energia.toFixed(2)),
    bonoSocial: 0,
    impuestoElectrico: parseFloat(impuesto_electrico.toFixed(2)),
    equipoMedida: parseFloat(coste_alquiler.toFixed(2)),
    [nombre_impuesto]: parseFloat(impuesto_final.toFixed(2)),
    iva: nombre_impuesto === 'iva' ? parseFloat(impuesto_final.toFixed(2)) : 0,
    totalFactura: parseFloat(total_factura.toFixed(2)),
    // Extras para debugging
    _debug: {
      consumos: consumo_total,
      precios_medios_pvpc: precio_medio_pvpc,
      base_imponible: parseFloat(base_imponible.toFixed(2)),
      zona: ZONA_ESIOS[zona]?.nombre
    }
  };
}

// ==================== HANDLER PRINCIPAL ====================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const {
      fecha_inicio,
      fecha_fin,
      consumo_p1 = 0,
      consumo_p2 = 0,
      consumo_p3 = 0,
      potencia_p1 = 3.45,
      potencia_p2 = 3.45,
      zona = 1,
      es_vivienda = 'true'
    } = req.method === 'GET' ? req.query : req.body;
    
    // Validaciones
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: 'Faltan parámetros: fecha_inicio y fecha_fin son obligatorios'
      });
    }
    
    // Calcular días
    const dias = calcularDias(fecha_inicio, fecha_fin);
    
    // Obtener precios PVPC de ESIOS
    const precios_pvpc = await obtenerPreciosESIOS(fecha_inicio, fecha_fin, zona);
    
    // Calcular factura completa
    const factura = calcularFactura({
      precios_pvpc,
      consumos_p1: parseFloat(consumo_p1),
      consumos_p2: parseFloat(consumo_p2),
      consumos_p3: parseFloat(consumo_p3),
      potencia_p1: parseFloat(potencia_p1),
      potencia_p2: parseFloat(potencia_p2),
      dias,
      zona: parseInt(zona),
      es_vivienda: es_vivienda === 'true' || es_vivienda === true
    });
    
    // Añadir metadatos
    factura.rangoFechas = {
      inicio: fecha_inicio,
      fin: fecha_fin
    };
    
    // Cache headers (cumple requisitos REE)
    const ahora = new Date();
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    manana.setHours(0, 1, 0, 0);
    const segundos_hasta_medianoche = Math.floor((manana - ahora) / 1000);
    
    res.setHeader('Cache-Control', `public, s-maxage=${segundos_hasta_medianoche}, stale-while-revalidate=300`);
    
    return res.status(200).json(factura);
    
  } catch (error) {
    console.error('Error en calcular-factura-pvpc:', error);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
