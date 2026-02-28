import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * @vitest-environment jsdom
 */

const goatSenderCode = fs.readFileSync(path.resolve(__dirname, '../vendor/goatcounter/count.js'), 'utf8');

function bootstrapSender() {
  window.goatcounter = {
    no_onload: true,
    no_events: true,
    allow_local: true,
    allow_frame: true,
    endpoint: 'https://luzfija.goatcounter.com/count'
  };
  const fn = new Function(goatSenderCode);
  fn();
}

function lastBeaconUrl() {
  const calls = navigator.sendBeacon.mock.calls;
  const last = calls[calls.length - 1];
  return last ? String(last[0] || '') : '';
}

function queryParam(url, key) {
  try {
    return new URL(url).searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

beforeEach(() => {
  document.head.innerHTML = '<script data-goatcounter="https://luzfija.goatcounter.com/count"></script>';
  document.body.innerHTML = '';
  delete window.goatcounter;
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: vi.fn().mockReturnValue(true)
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GoatCounter sender legacy remap', () => {
  it('reclasifica payload legacy currentYear', () => {
    bootstrapSender();

    window.goatcounter.count({
      path: 'error-promise',
      title: 'Promise reject: currentYear is not defined event',
      event: true
    });

    const url = lastBeaconUrl();
    expect(queryParam(url, 'p')).toBe('error-legacy-filtrado');
    expect(queryParam(url, 't')).toContain('tipo:currentyear-stale');
  });

  it('reclasifica variantes legacy aunque cambie formato de path/title', () => {
    bootstrapSender();

    window.goatcounter.count({
      path: '/error-promise/?from=old',
      title: 'currentYear is undefined',
      event: true
    });

    const url = lastBeaconUrl();
    expect(queryParam(url, 'p')).toBe('error-legacy-filtrado');
    expect(queryParam(url, 't')).toContain('tipo:currentyear-stale');
  });

  it('mantiene payload normal sin reclasificar', () => {
    bootstrapSender();

    window.goatcounter.count({
      path: 'calculo-realizado',
      title: 'Usuario calculó tarifas',
      event: true
    });

    const url = lastBeaconUrl();
    expect(queryParam(url, 'p')).toBe('calculo-realizado');
    expect(queryParam(url, 't')).toBe('Usuario calculó tarifas');
  });

  it('no reclasifica coincidencias parciales de texto', () => {
    bootstrapSender();

    window.goatcounter.count({
      path: 'error-javascript',
      title: 'currentYear helper inicializado correctamente',
      event: true
    });

    const url = lastBeaconUrl();
    expect(queryParam(url, 'p')).toBe('error-javascript');
    expect(queryParam(url, 't')).toBe('currentYear helper inicializado correctamente');
  });

  it('no reclasifica currentYear si no es evento de error legacy', () => {
    bootstrapSender();

    window.goatcounter.count({
      path: 'calculo-realizado',
      title: 'currentYear is not defined',
      event: true
    });

    const url = lastBeaconUrl();
    expect(queryParam(url, 'p')).toBe('calculo-realizado');
    expect(queryParam(url, 't')).toBe('currentYear is not defined');
  });
});
