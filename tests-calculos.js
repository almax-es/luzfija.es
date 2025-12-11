(function(){
  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || "Assertion failed");
    }
  }

  function nearlyEqual(a, b, epsilon) {
    if (epsilon === undefined) epsilon = 1e-9;
    return Math.abs(a - b) <= epsilon;
  }

  // --- Tests numéricos básicos ---

  function testAsNumber() {
    console.group("Test asNumber");
    assert(nearlyEqual(asNumber("3,45"), 3.45), 'asNumber("3,45") debe ser 3.45');
    assert(nearlyEqual(asNumber("1.234,56"), 1234.56), 'asNumber("1.234,56") debe ser 1234.56');
    assert(nearlyEqual(asNumber("1,234.56"), 1234.56), 'asNumber("1,234.56") debe ser 1234.56');
    assert(nearlyEqual(asNumber("1234"), 1234), 'asNumber("1234") debe ser 1234');
    assert(nearlyEqual(asNumber("  7  "), 7), 'asNumber("  7  ") debe ser 7');
    assert(nearlyEqual(asNumber(5.5), 5.5), 'asNumber(5.5) debe devolver 5.5');
    assert(nearlyEqual(asNumber("no es número", 0), 0), 'asNumber("no es número", 0) debe devolver fallback 0');
    console.groupEnd();
  }

  function testParseEuro() {
    console.group("Test parseEuro");
    assert(nearlyEqual(parseEuro("0,1041 €/kWh"), 0.1041), 'parseEuro("0,1041 €/kWh") debe ser 0.1041');
    assert(nearlyEqual(parseEuro("1.234,56 €"), 1234.56), 'parseEuro("1.234,56 €") debe ser 1234.56');
    assert(nearlyEqual(parseEuro("12,50"), 12.5), 'parseEuro("12,50") debe ser 12.5');
    assert(nearlyEqual(parseEuro(0.21), 0.21), 'parseEuro(0.21) debe devolver 0.21');
    console.groupEnd();
  }

  function testParseNum() {
    console.group("Test parseNum");
    assert(nearlyEqual(parseNum("3,45"), 3.45), 'parseNum("3,45") debe ser 3.45');
    assert(nearlyEqual(parseNum("1.234,56"), 1234.56), 'parseNum("1.234,56") debe ser 1234.56');
    assert(nearlyEqual(parseNum("1,234.56"), 1234.56), 'parseNum("1,234.56") debe ser 1234.56');
    assert(nearlyEqual(parseNum("1234"), 1234), 'parseNum("1234") debe ser 1234');
    assert(nearlyEqual(parseNum("  7  "), 7), 'parseNum("  7  ") debe ser 7');
    assert(nearlyEqual(parseNum(5.5), 5.5), 'parseNum(5.5) debe devolver 5.5');
    assert(nearlyEqual(parseNum("no es número"), 0), 'parseNum("no es número") debe devolver 0');
    console.groupEnd();
  }

  function testClampNonNeg() {
    console.group("Test clampNonNeg");
    assert(nearlyEqual(clampNonNeg(-5), 0), "clampNonNeg(-5) debe ser 0");
    assert(nearlyEqual(clampNonNeg(0), 0), "clampNonNeg(0) debe ser 0");
    assert(nearlyEqual(clampNonNeg(3.5), 3.5), "clampNonNeg(3.5) debe ser 3.5");
    assert(nearlyEqual(clampNonNeg("4.2"), 4.2), 'clampNonNeg("4.2") debe ser 4.2');
    assert(nearlyEqual(clampNonNeg(null), 0), "clampNonNeg(null) debe ser 0");
    assert(nearlyEqual(clampNonNeg(undefined), 0), "clampNonNeg(undefined) debe ser 0");
    assert(nearlyEqual(clampNonNeg("no"), 0), 'clampNonNeg("no") debe ser 0');
    console.groupEnd();
  }

  function testClamp01to365Days() {
    console.group("Test clamp01to365Days");
    assert(clamp01to365Days(0) === 30, "0 debe devolver 30 (valor por defecto)");
    assert(clamp01to365Days(-10) === 1, "-10 debe devolver 1");
    assert(clamp01to365Days(1) === 1, "1 debe devolver 1");
    assert(clamp01to365Days(365) === 365, "365 debe devolver 365");
    assert(clamp01to365Days(400) === 365, "400 debe devolver 365");
    assert(clamp01to365Days(1.9) === 1, "1.9 debe truncarse a 1");
    assert(clamp01to365Days("10") === 10, '"10" debe devolverse como 10');
    assert(clamp01to365Days("no") === 30, '"no" debe devolver 30 (no finito -> por defecto)');
    console.groupEnd();
  }

  function testRound2() {
    console.group("Test round2");
    assert(nearlyEqual(round2(1.234), 1.23), "round2(1.234) debe ser 1.23");
    assert(nearlyEqual(round2(1.235), 1.24), "round2(1.235) debe ser 1.24");
    assert(nearlyEqual(round2(-1.234), -1.23), "round2(-1.234) debe ser -1.23");
    assert(nearlyEqual(round2(-1.235), -1.24), "round2(-1.235) debe ser -1.24");
    assert(nearlyEqual(round2(1.005), 1.01), "round2(1.005) debe ser 1.01");
    console.groupEnd();
  }

  function testFormatMoney() {
    console.group("Test formatMoney");
    assert(formatMoney(1) === "1,00 €", "formatMoney(1) debe ser '1,00 €'");
    assert(formatMoney(1.2) === "1,20 €", "formatMoney(1.2) debe ser '1,20 €'");
    assert(formatMoney(1.234) === "1,23 €", "formatMoney(1.234) debe ser '1,23 €'");
    assert(formatMoney(0) === "0,00 €", "formatMoney(0) debe ser '0,00 €'");
    console.groupEnd();
  }

  // --- Tests de helpers de texto ---

  function testEscapeHtml() {
    console.group("Test escapeHtml");
    assert(escapeHtml("hola") === "hola", 'escapeHtml("hola") debe ser "hola"');
    var input = '<b>&\"\\'</b>';
    var expected = '&lt;b&gt;&amp;&quot;&#039;&lt;/b&gt;';
    assert(escapeHtml(input) === expected, "escapeHtml debe escapar correctamente & < > \\\" '");
    console.groupEnd();
  }

  function testAsBool() {
    console.group("Test asBool");
    assert(asBool(true) === true, "asBool(true) debe ser true");
    assert(asBool(false) === false, "asBool(false) debe ser false");
    assert(asBool("true") === true, 'asBool("true") debe ser true');
    assert(asBool("1") === true, 'asBool("1") debe ser true');
    assert(asBool("si") === true, 'asBool("si") debe ser true');
    assert(asBool("sí") === true, 'asBool("sí") debe ser true');
    assert(asBool("yes") === true, 'asBool("yes") debe ser true');
    assert(asBool("false") === false, 'asBool("false") debe ser false');
    assert(asBool("0") === false, 'asBool("0") debe ser false');
    assert(asBool("no") === false, 'asBool("no") debe ser false');
    assert(asBool(undefined, true) === true, "asBool(undefined, true) debe devolver fallback true");
    assert(asBool("cualquier cosa", false) === false, 'asBool("cualquier cosa", false) debe devolver fallback false');
    console.groupEnd();
  }

  function testFormatValueForDisplay() {
    console.group("Test formatValueForDisplay");
    assert(formatValueForDisplay(1.23) === "1,23", "1.23 debe mostrarse como '1,23'");
    assert(formatValueForDisplay("1,23") === "1,23", '"1,23" debe mantenerse igual');
    assert(formatValueForDisplay("5") === "5", '"5" debe mantenerse igual');
    assert(formatValueForDisplay(null) === null, "null debe devolverse tal cual");
    assert(formatValueForDisplay("") === "", "'' debe devolverse tal cual");
    console.groupEnd();
  }

  // --- Tests helpers PVPC de texto y URL ---

  function testStripHtml() {
    console.group("Test stripHtml");
    assert(stripHtml("<b>Hola</b> mundo") === "Hola mundo", 'stripHtml("<b>Hola</b> mundo") debe ser "Hola mundo"');
    assert(stripHtml("<p>uno<br>dos</p>") === "unodos", 'stripHtml("<p>uno<br>dos</p>") debe ser "unodos"');
    console.groupEnd();
  }

  function testParsePrecioFromTexto() {
    console.group("Test parsePrecioFromTexto");
    var texto1 = "Tarifa X\\nPrecio: 0,1041 €";
    assert(nearlyEqual(parsePrecioFromTexto(texto1, "Precio"), 0.1041), "Debe extraer 0,1041 € como 0.1041");
    var texto2 = "<b>Precio</b>: 1.234,56 €";
    assert(nearlyEqual(parsePrecioFromTexto(texto2, "Precio"), 1234.56), "Debe extraer 1.234,56 € como 1234.56");
    var texto3 = "Sin precio aquí";
    assert(parsePrecioFromTexto(texto3, "Precio") === null, "Si no hay precio coincidente debe devolver null");
    console.groupEnd();
  }

  function testNormalizeProxyBase() {
    console.group("Test normalizeProxyBase");
    assert(normalizeProxyBase("") === "", "Cadena vacía debe devolver ''");
    assert(normalizeProxyBase("   ") === "", "Espacios deben devolver ''");
    assert(normalizeProxyBase("https://proxy.test/pvpc?url=") === "https://proxy.test/pvpc?url=", "Si ya termina en url= debe mantenerse");
    assert(normalizeProxyBase("https://proxy.test/pvpc?foo=1") === "https://proxy.test/pvpc?foo=1&url=", "Si tiene ? sin url= debe añadir &url=");
    assert(normalizeProxyBase("https://proxy.test/pvpc?foo=1&") === "https://proxy.test/pvpc?foo=1&url=", "Si termina en & debe añadir url= sin & extra");
    assert(normalizeProxyBase("https://proxy.test/pvpc") === "https://proxy.test/pvpc?url=", "Sin ?, debe añadir ?url=");
    assert(normalizeProxyBase("https://proxy.test/pvpc/") === "https://proxy.test/pvpc/?url=", "Con / final, debe añadir ?url=");
    console.groupEnd();
  }

  function testPvpcSignatureFromValues() {
    console.group("Test pvpcSignatureFromValues");
    // Mismo input normalizado -> misma firma
    var s1 = pvpcSignatureFromValues({ dias: -5, p1: 3.4567, zonaFiscal: "Península" });
    var s2 = pvpcSignatureFromValues({ dias: 0, p1: 3.4567, zonaFiscal: "península" });
    var s3 = pvpcSignatureFromValues({ dias: 1, p1: 3.4567, zonaFiscal: "PENÍNSULA" });
    assert(s1 === s2 && s2 === s3, "La firma debe ser estable para días fuera de rango y zonaFiscal equivalente");

    // Cambiar zonaFiscal/casos Canarias debe cambiar la firma
    var s4 = pvpcSignatureFromValues({ dias: 30, p1: 3.4567, zonaFiscal: "Península" });
    var s5 = pvpcSignatureFromValues({ dias: 30, p1: 3.4567, zonaFiscal: "Canarias", viviendaCanarias: true });
    assert(s4 !== s5, "Firmas distintas para Península vs Canarias vivienda");

    // Cambios en los precios deben cambiar la firma
    var s6 = pvpcSignatureFromValues({ dias: 30, p1: 3.4567, p2: 3.4567, cPunta: 0.1, cLlano: 0.08, cValle: 0.05, zonaFiscal: "Península" });
    var s7 = pvpcSignatureFromValues({ dias: 30, p1: 3.4568, p2: 3.4567, cPunta: 0.1, cLlano: 0.08, cValle: 0.05, zonaFiscal: "Península" });
    assert(s6 !== s7, "Firmas distintas cuando cambia p1 (tras redondeo a 4 decimales)");
    console.groupEnd();
  }

  // --- Tests helpers PVPC de fechas ---

  function manualYMD(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function testStartOfDayLocalAndAddDays() {
    console.group("Test startOfDayLocal / addDays");
    var d = new Date(2024, 0, 10, 15, 30); // 10 enero 2024 15:30
    var sod = startOfDayLocal(d);
    assert(sod.getFullYear() === 2024 && sod.getMonth() === 0 && sod.getDate() === 10, "startOfDayLocal debe mantener año/mes/día");
    assert(sod.getHours() === 0 && sod.getMinutes() === 0 && sod.getSeconds() === 0 && sod.getMilliseconds() === 0, "startOfDayLocal debe poner hora 00:00:00.000");

    var plus5 = addDays(new Date(2024, 0, 10), 5);
    assert(plus5.getFullYear() === 2024 && plus5.getMonth() === 0 && plus5.getDate() === 15, "addDays debe sumar 5 días (10 -> 15 enero)");
    console.groupEnd();
  }

  function testFormatYMDAndAnchorDate() {
    console.group("Test formatYMD / getPvpcAnchorDate");
    var d = new Date(2024, 0, 5); // 5 enero 2024
    var ymd = formatYMD(d);
    assert(ymd === "2024-01-05", "formatYMD(5 enero 2024) debe ser '2024-01-05'");

    // Anchor date: AYER en formato YYYY-MM-DD
    var today = new Date();
    var expected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    expected.setDate(expected.getDate() - 1);
    var expectedStr = manualYMD(expected);
    var anchor = getPvpcAnchorDate();
    assert(anchor === expectedStr, "getPvpcAnchorDate debe devolver ayer formateado como YYYY-MM-DD");
    console.groupEnd();
  }

  function runAllTests() {
    var outputEl = document.getElementById("lf-tests-output");
    var lines = [];
    function push(msg) {
      lines.push(msg);
      console.log(msg);
    }

    var allOk = true;

    function run(name, fn) {
      try {
        fn();
        push("✓ " + name + " OK");
      } catch (e) {
        allOk = false;
        console.error("✗ " + name + " FAILED", e);
        push("✗ " + name + " FAILED: " + e.message);
      }
    }

    // asNumber
    if (typeof asNumber !== "function") {
      allOk = false;
      push("✗ asNumber no está definido (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("asNumber", testAsNumber);
    }

    // parseEuro
    if (typeof parseEuro !== "function") {
      allOk = false;
      push("✗ parseEuro no está definido (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("parseEuro", testParseEuro);
    }

    // parseNum
    if (typeof parseNum !== "function") {
      allOk = false;
      push("✗ parseNum no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("parseNum", testParseNum);
    }

    // clampNonNeg
    if (typeof clampNonNeg !== "function") {
      allOk = false;
      push("✗ clampNonNeg no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("clampNonNeg", testClampNonNeg);
    }

    // clamp01to365Days
    if (typeof clamp01to365Days !== "function") {
      allOk = false;
      push("✗ clamp01to365Days no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("clamp01to365Days", testClamp01to365Days);
    }

    // round2
    if (typeof round2 !== "function") {
      allOk = false;
      push("✗ round2 no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("round2", testRound2);
    }

    // formatMoney
    if (typeof formatMoney !== "function") {
      allOk = false;
      push("✗ formatMoney no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("formatMoney", testFormatMoney);
    }

    // escapeHtml
    if (typeof escapeHtml !== "function") {
      allOk = false;
      push("✗ escapeHtml no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("escapeHtml", testEscapeHtml);
    }

    // asBool
    if (typeof asBool !== "function") {
      allOk = false;
      push("✗ asBool no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("asBool", testAsBool);
    }

    // formatValueForDisplay
    if (typeof formatValueForDisplay !== "function") {
      allOk = false;
      push("✗ formatValueForDisplay no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("formatValueForDisplay", testFormatValueForDisplay);
    }

    // stripHtml
    if (typeof stripHtml !== "function") {
      allOk = false;
      push("✗ stripHtml no está definido (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("stripHtml", testStripHtml);
    }

    // parsePrecioFromTexto
    if (typeof parsePrecioFromTexto !== "function") {
      allOk = false;
      push("✗ parsePrecioFromTexto no está definido (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("parsePrecioFromTexto", testParsePrecioFromTexto);
    }

    // normalizeProxyBase
    if (typeof normalizeProxyBase !== "function") {
      allOk = false;
      push("✗ normalizeProxyBase no está definido (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("normalizeProxyBase", testNormalizeProxyBase);
    }

    // pvpcSignatureFromValues
    if (typeof pvpcSignatureFromValues !== "function") {
      allOk = false;
      push("✗ pvpcSignatureFromValues no está definido (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("pvpcSignatureFromValues", testPvpcSignatureFromValues);
    }

    // startOfDayLocal / addDays
    if (typeof startOfDayLocal !== "function" || typeof addDays !== "function") {
      allOk = false;
      push("✗ startOfDayLocal/addDays no están definidos (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("startOfDayLocal/addDays", testStartOfDayLocalAndAddDays);
    }

    // formatYMD / getPvpcAnchorDate
    if (typeof formatYMD !== "function" || typeof getPvpcAnchorDate !== "function") {
      allOk = false;
      push("✗ formatYMD/getPvpcAnchorDate no están definidos (¿se ha cargado pvpc.js correctamente?)");
    } else {
      run("formatYMD/getPvpcAnchorDate", testFormatYMDAndAnchorDate);
    }

    if (outputEl) {
      outputEl.textContent = lines.join("\n") + "\n\n" + (allOk
        ? "✅ Todos los tests han pasado"
        : "⚠️ Algún test ha fallado (mira la consola para más detalles)");
    }
  }

  window.addEventListener("load", runAllTests);
})();