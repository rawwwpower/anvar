/**
 * AudioWorklet: corre el motor de tatum en el hilo de audio.
 *
 * Basado en tatum/wasm/examples/worklet/tatum-processor.js, con los arreglos
 * que ese README marca como pendientes:
 *   - Las funciones que importa el .wasm se resuelven por nombre parcial, no
 *     por el hash de wasm-bindgen, así no se rompe cuando tatum lo actualiza.
 *   - Los resultados (JSON) viajan como bytes y se decodifican en la página,
 *     donde hay TextDecoder: los mensajes de error con acentos llegan bien.
 *   - Los textos que se cargan se liberan después (free).
 *
 * Mensajes de la página: init-wasm, set-output-gain, load-source, transport, set-tempo,
 * set-track-level, set-track-pan, set-track-pattern, get-track-info.
 * Mensajes a la página: ready, error, dsl-result, track-info,
 * step ({ step, running, swaps }).
 */

class AnvarProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasm = null;
    this.ptr = 0;
    this.frames = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  // Copia de instantiate() en glue.js (ver ahí por qué está duplicada).
  init(bytes) {
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
    this.wasm = wasm;
    this.ptr = wasm.anvar_new() >>> 0;
  }

  // Copia bytes a la memoria del motor y devuelve el puntero.
  write(bytes) {
    const p = this.wasm.alloc(bytes.length) >>> 0;
    new Uint8Array(this.wasm.memory.buffer, p, bytes.length).set(bytes);
    return p;
  }

  // Copia el último resultado JSON del motor (lo decodifica la página).
  result(p) {
    const len = this.wasm.anvar_result_len(this.ptr) >>> 0;
    return new Uint8Array(this.wasm.memory.buffer, p >>> 0, len).slice();
  }

  onMessage(msg) {
    if (msg.type === "init-wasm") {
      try {
        this.init(msg.bytes);
        this.port.postMessage({ type: "ready" });
      } catch (err) {
        this.port.postMessage({ type: "error", message: String(err) });
      }
      return;
    }
    const w = this.wasm;
    if (!w) return;

    try {
      this.handle(w, msg);
    } catch (err) {
      this.port.postMessage({ type: "error", message: String(err), during: msg.type });
    }
  }

  handle(w, msg) {
    switch (msg.type) {
      case "load-source": {
        const src = new Uint8Array(msg.bytes);
        const p = this.write(src);
        const res = w.anvar_load_source(this.ptr, p, src.length);
        this.port.postMessage({ type: "dsl-result", bytes: this.result(res) });
        w.free(p, src.length);
        break;
      }
      case "transport":
        if (msg.action === "start") w.anvar_start(this.ptr);
        else w.anvar_stop(this.ptr);
        break;
      case "set-output-gain":
        w.anvar_set_output_gain(this.ptr, msg.value);
        break;
      case "set-tempo":
        w.anvar_set_tempo(this.ptr, msg.value);
        break;
      case "set-track-level":
        w.anvar_set_track_level(this.ptr, msg.idx, msg.value);
        break;
      case "set-track-pan":
        w.anvar_set_track_pan(this.ptr, msg.idx, msg.value);
        break;
      case "set-track-pattern":
        w.anvar_set_track_pattern(this.ptr, msg.idx, msg.patternIdx);
        break;
      case "get-track-info": {
        const res = w.anvar_track_info(this.ptr);
        this.port.postMessage({ type: "track-info", bytes: this.result(res) });
        break;
      }
    }
  }

  process(_inputs, outputs) {
    const w = this.wasm;
    const [left, right] = outputs[0] ?? [];
    if (!w || !left || !right) return true;

    // El motor rinde de a 128 frames como máximo.
    for (let done = 0; done < left.length; done += 128) {
      const n = Math.min(128, left.length - done);
      try {
        const p = w.anvar_process(this.ptr, n) >>> 0;
        const mem = new Float32Array(w.memory.buffer, p, n * 2);
        for (let i = 0; i < n; i++) {
          const l = mem[i * 2], r = mem[i * 2 + 1];
          left[done + i] = Number.isFinite(l) ? l : 0;
          right[done + i] = Number.isFinite(r) ? r : 0;
        }
      } catch {
        left.fill(0, done, done + n);
        right.fill(0, done, done + n);
      }
    }

    if (++this.frames % 8 === 0) {
      this.port.postMessage({
        type: "step",
        step: w.anvar_current_step(this.ptr) >>> 0,
        running: !!w.anvar_running(this.ptr),
        swaps: w.anvar_swaps(this.ptr) >>> 0,
      });
    }
    return true;
  }
}

registerProcessor("anvar-processor", AnvarProcessor);
