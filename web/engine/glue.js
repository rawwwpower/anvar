/**
 * Arma lo que el .wasm de anvar le pide a JavaScript al instanciarse. Las
 * funciones se reconocen por nombre parcial y no por el hash que les pone
 * wasm-bindgen, así una actualización no las rompe.
 *
 * anvar-processor.js tiene una copia de esta función: los AudioWorklets no
 * pueden importar módulos en todos los navegadores. Si cambiás una, cambiá
 * la otra.
 */
export function instantiate(bytes) {
  const module = new WebAssembly.Module(bytes);
  let wasm;
  const glue = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    const fns = (glue[imp.module] ??= {});
    if (imp.name.includes("memory")) {
      fns[imp.name] = () => wasm.memory;
    } else if (imp.name.includes("throw")) {
      fns[imp.name] = (ptr, len) => {
        throw new Error(String.fromCharCode(...new Uint8Array(wasm.memory.buffer, ptr, len)));
      };
    } else if (imp.name.includes("init_externref_table")) {
      fns[imp.name] = () => {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      };
    } else {
      throw new Error(`el motor pide una función que anvar no conoce: ${imp.name}`);
    }
  }
  wasm = new WebAssembly.Instance(module, glue).exports;
  wasm.__wbindgen_start?.();
  return wasm;
}
