/**
 * Test de verificación para el caso de HORA 25 (cambio horario de octubre)
 *
 * Ejecutar en la consola del navegador después de cargar lf-csv-utils.js:
 *
 * > await import('./tests/hora25-test.js')
 *
 * O copiar y pegar esta función directamente en la consola.
 */

(function testHora25() {
  console.log('🧪 Iniciando test de HORA 25 (cambio horario octubre)...\n');

  // Verificar que lf-csv-utils está cargado
  if (!window.LF || !window.LF.csvUtils || !window.LF.csvUtils.getPeriodoHorarioCSV) {
    console.error('❌ ERROR: window.LF.csvUtils.getPeriodoHorarioCSV no está disponible');
    console.error('   Asegúrate de cargar lf-csv-utils.js primero');
    return;
  }

  const getPeriodoHorarioCSV = window.LF.csvUtils.getPeriodoHorarioCSV;

  // Test 1: Hora normal (hora 3 = 02:00-03:00 en día laborable)
  const fecha1 = new Date(2024, 9, 28); // Lunes 28 octubre 2024 (laborable)
  const periodo1 = getPeriodoHorarioCSV(fecha1, 3);
  const esperado1 = 'P3'; // Valle (0-8h)

  console.log('Test 1: Hora normal (hora 3)');
  console.log(`  Fecha: ${fecha1.toLocaleDateString('es-ES')}`);
  console.log(`  Resultado: ${periodo1}`);
  console.log(`  Esperado: ${esperado1}`);
  console.log(`  ✅ ${periodo1 === esperado1 ? 'PASADO' : '❌ FALLADO'}\n`);

  // Test 2: HORA 25 (cambio horario octubre: hora 25 = 02:00-03:00)
  const fecha2 = new Date(2024, 9, 27); // Domingo 27 octubre 2024 (cambio horario)
  const periodo2 = getPeriodoHorarioCSV(fecha2, 25);
  const esperado2 = 'P3'; // Valle (debe mapearse a 02:00-03:00 = valle)

  console.log('Test 2: HORA 25 (cambio horario octubre)');
  console.log(`  Fecha: ${fecha2.toLocaleDateString('es-ES')}`);
  console.log(`  Hora: 25 (cambio horario)`);
  console.log(`  Resultado: ${periodo2}`);
  console.log(`  Esperado: ${esperado2}`);
  console.log(`  ✅ ${periodo2 === esperado2 ? 'PASADO' : '❌ FALLADO'}\n`);

  // Test 3: Hora punta (hora 20 = 19:00-20:00 en laborable)
  const fecha3 = new Date(2024, 9, 28); // Lunes 28 octubre 2024 (laborable)
  const periodo3 = getPeriodoHorarioCSV(fecha3, 20);
  const esperado3 = 'P1'; // Punta (18-22h)

  console.log('Test 3: Hora punta (hora 20)');
  console.log(`  Fecha: ${fecha3.toLocaleDateString('es-ES')}`);
  console.log(`  Resultado: ${periodo3}`);
  console.log(`  Esperado: ${esperado3}`);
  console.log(`  ✅ ${periodo3 === esperado3 ? 'PASADO' : '❌ FALLADO'}\n`);

  // Test 4: Fin de semana (debería ser siempre P3)
  const fecha4 = new Date(2024, 9, 26); // Sábado 26 octubre 2024
  const periodo4 = getPeriodoHorarioCSV(fecha4, 20);
  const esperado4 = 'P3'; // Valle (fin de semana)

  console.log('Test 4: Fin de semana (sábado hora 20)');
  console.log(`  Fecha: ${fecha4.toLocaleDateString('es-ES')}`);
  console.log(`  Resultado: ${periodo4}`);
  console.log(`  Esperado: ${esperado4}`);
  console.log(`  ✅ ${periodo4 === esperado4 ? 'PASADO' : '❌ FALLADO'}\n`);

  // Resumen
  const tests = [
    periodo1 === esperado1,
    periodo2 === esperado2,
    periodo3 === esperado3,
    periodo4 === esperado4
  ];
  const pasados = tests.filter(t => t).length;
  const total = tests.length;

  console.log('═══════════════════════════════════════');
  console.log(`📊 Resumen: ${pasados}/${total} tests pasados`);

  if (pasados === total) {
    console.log('✅ TODOS LOS TESTS PASARON');
    console.log('   El manejo de hora 25 funciona correctamente');
  } else {
    console.error('❌ ALGUNOS TESTS FALLARON');
    console.error('   Revisa la implementación de getPeriodoHorarioCSV');
  }
  console.log('═══════════════════════════════════════\n');

  return { pasados, total, exito: pasados === total };
})();
