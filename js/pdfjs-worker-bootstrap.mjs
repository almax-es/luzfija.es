/**
 * @license PolyForm-Shield-1.0.0
 * Required Notice: Copyright (c) 2026 Luis Oscar Soler Bernal / LuzFija.es
 * This software is licensed under the PolyForm Shield License 1.0.0.
 * See the LICENSE file in the repository root for full terms.
 */

function installPromiseWithResolversShim(){
  if (typeof Promise.withResolvers === 'function') return;

  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function withResolvers() {
      let resolve;
      let reject;
      const promise = new this((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    }
  });
}

function installMapGetOrInsertComputedShim(){
  if (typeof Map.prototype.getOrInsertComputed === 'function') return;

  const mapHas = Map.prototype.has;
  const mapGet = Map.prototype.get;
  const mapSet = Map.prototype.set;
  const brandCheckKey = Symbol('lf-map-brand-check');

  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function getOrInsertComputed(key, callback) {
      mapHas.call(this, brandCheckKey);
      if (typeof callback !== 'function') {
        throw new TypeError('callback must be callable');
      }

      const canonicalKey = key === 0 ? 0 : key;
      if (mapHas.call(this, canonicalKey)) return mapGet.call(this, canonicalKey);

      const value = Reflect.apply(callback, undefined, [canonicalKey]);
      mapSet.call(this, canonicalKey, value);
      return value;
    }
  });
}

// Este modulo sirve tanto como Worker real como para el fallback fake-worker:
// los shims se instalan antes de evaluar el vendor y se conserva la exportacion
// que PDF.js espera cuando no puede crear un Worker dedicado.
installPromiseWithResolversShim();
installMapGetOrInsertComputedShim();

const bootstrapUrl = new URL(import.meta.url);
const vendorWorkerUrl = new URL('../vendor/pdfjs/pdf.worker.min.mjs', bootstrapUrl);
vendorWorkerUrl.search = bootstrapUrl.search;
vendorWorkerUrl.hash = '';
const workerModule = await import(vendorWorkerUrl.href);

export const WorkerMessageHandler = workerModule.WorkerMessageHandler;
