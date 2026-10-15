/**
 * Mide el volumen de un tema en segundo plano. tatum lo renderiza entero para
 * eso (decenas de segundos en el navegador); hacerlo acá deja libre el hilo de
 * audio y la página.
 *
 * Recibe { bytes } (el texto .synth en UTF-8) y responde { gain }:
 * gain es NaN si el tema no compila.
 */
import { instantiate } from "./glue.js";

const ready = fetch(new URL("anvar.wasm", import.meta.url))
  .then((r) => r.arrayBuffer())
  .then(instantiate);

self.onmessage = async ({ data }) => {
  const wasm = await ready;
  const src = new Uint8Array(data.bytes);
  const ptr = wasm.alloc(src.length) >>> 0;
  new Uint8Array(wasm.memory.buffer, ptr, src.length).set(src);
  const gain = wasm.measure_gain(ptr, src.length);
  wasm.free(ptr, src.length);
  self.postMessage({ gain });
};
