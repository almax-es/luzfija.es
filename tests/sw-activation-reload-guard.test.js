import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('SW activation reload guard', () => {
  it('lf-sw-update.js auto-reloads per SW version, deferring instead of blocking permanently', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../js/lf-sw-update.js'), 'utf8');
    // Guard anti-bucle por version real del SW (CACHE_VERSION via GET_VERSION),
    // no por build ID de pagina (window.__LF_BUILD_ID no se define en ningun HTML).
    expect(code).toMatch(/sessionStorage\.getItem\(SW_RELOADED_VERSION_KEY\)/);
    expect(code).toMatch(/sessionStorage\.setItem\(SW_RELOADED_VERSION_KEY/);
    expect(code).toMatch(/postMessage\(\{ type: 'GET_VERSION' \}/);
    // Limpieza de la clave antigua (bloqueaba todas las recargas tras la primera).
    expect(code).toMatch(/sessionStorage\.removeItem\(SW_LEGACY_RELOAD_KEY\)/);
    // La supresion es SOLO al entrar (pagina recien cargada), nunca permanente:
    // la condicion correcta es "recien cargada -> no recargar", no al reves.
    expect(code).toMatch(/Date\.now\(\)\s*<\s*swLoadSuppressUntil/);
    expect(code).not.toMatch(/Date\.now\(\)\s*>\s*.*deadline/i);
    // Bloqueo por interaccion como ventana deslizante, no flag permanente.
    expect(code).toMatch(/SW_INTERACTION_IDLE_MS/);
    expect(code).toMatch(/lastInteractionAt/);
    expect(code).not.toMatch(/\bswReloadBlocked\b/);
    // Re-evaluacion diferida: una recarga pendiente se reintenta, no se pierde.
    expect(code).toMatch(/tryReloadOnStale\('visible'\)/);
    expect(code).toMatch(/tryReloadOnStale\('interval'\)/);
    expect(code).toMatch(/document\.visibilityState\s*===\s*'hidden'/);
    expect(code).toMatch(/pointerdown/);
    expect(code).toMatch(/touchstart/);
    expect(code).toMatch(/controllerchange/);
    expect(code).toMatch(/window\.location\.reload\(\);/);
    // El flag permanente que silenciaba controllerchange posteriores no debe volver.
    expect(code).not.toMatch(/\bswActivationHandled\b/);
  });

  // La lógica del SW update vive SOLO en js/lf-sw-update.js: los consumidores
  // delegan y no deben reintroducir copias propias (regresión de duplicación).
  [
    { relPath: '../js/lf-app.js', swUrl: "'sw.js'" },
    { relPath: '../js/shell-lite.js', swUrl: "'/sw.js'" }
  ].forEach(({ relPath, swUrl }) => {
    it(path.basename(relPath) + ' delega en window.LF.initSwUpdate sin lógica propia de SW update', () => {
      const code = fs.readFileSync(path.resolve(__dirname, relPath), 'utf8');
      expect(code).toMatch(/LF\.initSwUpdate\(/);
      expect(code).toContain('swUrl: ' + swUrl);
      expect(code).not.toMatch(/controllerchange/);
      expect(code).not.toMatch(/SKIP_WAITING/);
      expect(code).not.toMatch(/updatefound/);
    });
  });
});
