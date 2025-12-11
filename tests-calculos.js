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

    if (typeof asNumber !== "function") {
      allOk = false;
      push("✗ asNumber no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("asNumber", testAsNumber);
    }

    if (typeof parseEuro !== "function") {
      allOk = false;
      push("✗ parseEuro no está definido (¿se ha cargado app.js correctamente?)");
    } else {
      run("parseEuro", testParseEuro);
    }

    if (outputEl) {
      outputEl.textContent = lines.join("\n") + "\n\n" + (allOk
        ? "✅ Todos los tests han pasado"
        : "⚠️ Algún test ha fallado (mira la consola para más detalles)");
    }
  }

  window.addEventListener("load", runAllTests);
})();
