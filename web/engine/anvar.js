/**
 * Puente entre la página y el motor de anvar (tatum por dentro), que suena en
 * un AudioWorklet. Toda la UI habla con el motor a través de esta clase.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const json = (bytes) => JSON.parse(decoder.decode(bytes));

// Mientras se mide el volumen real del tema, suena con esta ganancia. Los
// ejemplos de tatum miden entre 0.9 y 1.6: el ajuste posterior es de pocos dB.
const PROVISIONAL_GAIN = 1.0;
const GAIN_CACHE = "anvar.gains";

export class Engine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.pending = new Map(); // tipo de respuesta -> resolve
    this.onStep = () => {};
    this.worker = null;
    this.measuring = null; // { key, promise, resolve } del tema que se mide
  }

  /** Arranca el audio. Tiene que llamarse desde un click (regla del navegador). */
  async init() {
    if (this.ctx) return;
    const base = new URL(".", import.meta.url);
    // tatum trabaja a 44.1 kHz.
    this.ctx = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(new URL("anvar-processor.js", base));
    this.node = new AudioWorkletNode(this.ctx, "anvar-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.node.connect(this.analyser).connect(this.ctx.destination);

    this.node.port.onmessage = ({ data }) => {
      if (data.type === "step") return this.onStep(data);
      const resolve = this.pending.get(data.type);
      if (resolve) {
        for (const [k, r] of this.pending) if (r === resolve) this.pending.delete(k);
        resolve(data);
      }
    };

    const bytes = await (await fetch(new URL("anvar.wasm", base))).arrayBuffer();
    const res = await this.request("init-wasm", { bytes }, ["ready", "error"]);
    if (res.type === "error") throw new Error(res.message);
  }

  request(type, payload = {}, replies) {
    return new Promise((resolve) => {
      for (const r of replies) this.pending.set(r, resolve);
      this.node.port.postMessage({ type, ...payload });
    });
  }

  send(type, payload = {}) {
    this.node?.port.postMessage({ type, ...payload });
  }

  /**
   * Carga un texto .synth. Si está sonando, el cambio entra en el próximo
   * compás. Devuelve { ok, errors?: [{ line, col, msg }] }.
   */
  async load(source) {
    const bytes = encoder.encode(source).buffer;
    const res = await this.request("load-source", { bytes }, ["dsl-result", "error"]);
    if (res.type === "error") throw new Error(res.message);
    return json(res.bytes);
  }

  /**
   * Fija el volumen de salida para un tema: al instante el que ya se midió
   * antes, y si no, uno provisorio hasta que el Worker termine de medirlo.
   * Devuelve una promesa que se cumple cuando suena con la ganancia real.
   */
  async levelFor(source) {
    const key = hash(source);
    const cached = readCache()[key];
    if (cached) {
      this.send("set-output-gain", { value: cached });
      return cached;
    }
    this.send("set-output-gain", { value: PROVISIONAL_GAIN });
    const gain = await this.measure(source, key);
    if (Number.isFinite(gain)) {
      this.send("set-output-gain", { value: gain });
      writeCache(key, gain);
    }
    return gain;
  }

  /** ¿Ya se conoce el volumen real de este texto? */
  measured(source) {
    return hash(source) in readCache();
  }

  /**
   * Mide un tema en el Worker. Si se pide otro antes de que termine, la
   * medición vieja se descarta (NaN): solo importa el tema que suena.
   */
  measure(source, key = hash(source)) {
    if (this.measuring?.key === key) return this.measuring.promise;
    if (this.measuring) {
      this.worker.terminate();
      this.worker = null;
      this.measuring.resolve(NaN);
    }
    this.worker ??= new Worker(new URL("measure-worker.js", import.meta.url), { type: "module" });
    const job = { key };
    job.promise = new Promise((resolve) => {
      job.resolve = resolve;
      this.worker.onmessage = ({ data }) => resolve(data.gain);
      this.worker.postMessage({ bytes: encoder.encode(source).buffer });
    }).finally(() => {
      if (this.measuring === job) this.measuring = null;
    });
    this.measuring = job;
    return job.promise;
  }

  /** [{ name, kind, level, pan }] de cada pista del tema cargado. */
  async tracks() {
    const res = await this.request("get-track-info", {}, ["track-info"]);
    return json(res.bytes);
  }

  async start() {
    await this.ctx.resume();
    this.send("transport", { action: "start" });
  }
  stop() { this.send("transport", { action: "stop" }); }
  setTempo(bpm) { this.send("set-tempo", { value: bpm }); }
  setLevel(idx, value) { this.send("set-track-level", { idx, value }); }
  setPan(idx, value) { this.send("set-track-pan", { idx, value }); }
}

// FNV-1a: alcanza para reconocer un texto que ya se midió.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(GAIN_CACHE)) ?? {}; } catch { return {}; }
}

function writeCache(key, gain) {
  try {
    localStorage.setItem(GAIN_CACHE, JSON.stringify({ ...readCache(), [key]: gain }));
  } catch { /* sin localStorage se vuelve a medir la próxima vez */ }
}
