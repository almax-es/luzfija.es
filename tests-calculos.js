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

  // --- Tests de helpers de texto ---

  function testEscapeHtml() {
    console.group("Test escapeHtml");
    assert(escapeHtml("hola") === "hola", 'escapeHtml("hola") debe ser "hola"');
    var input = '<b>&"\'</b>';
    var expected = '&lt;b&gt;&amp;&quot;&#039;&lt;/b&gt;';
    assert(escapeHtml(input) === expected, "escapeHtml debe escapar correctamente & < > \" '");
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

  function testStripHtml() {
    console.group("Test stripHtml");
    assert(stripHtml("<b>Hola</b> mundo") === "Hola mundo", 'stripHtml("<b>Hola</b> mundo") debe ser "Hola mundo"');
    assert(stripHtml("<p>uno<br>dos</p>") === "unodos", 'stripHtml("<p>uno<br>dos</p>") debe ser "unodos"');
    console.groupEnd();
  }

  function testParsePrecioFromTexto() {
    console.group("Test parsePrecioFromTexto");
    var texto1 = "Tarifa X\nPrecio: 0,1041 €";
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

    if (outputEl) {
      outputEl.textContent = lines.join("\n") + "\n\n" + (allOk
        ? "✅ Todos los tests han pasado"
        : "⚠️ Algún test ha fallado (mira la consola para más detalles)");
    }
  }

  window.addEventListener("load", runAllTests);
})();