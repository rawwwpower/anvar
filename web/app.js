import { Engine } from "./engine/anvar.js";

// Temas de ejemplo que vienen con tatum (tatum/examples/).
const SONGS = [
  ["deephouse", "Deep house"],
  ["dub_techno", "Dub techno"],
  ["detroit", "Detroit"],
  ["chillwave_dream", "Chillwave"],
  ["synthwave_chill", "Synthwave"],
  ["acid_arp", "Acid"],
  ["liquid_dnb", "Liquid DnB"],
  ["breaks", "Breaks"],
  ["dark_techno", "Dark techno"],
];

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const engine = new Engine();

let ready = false;
let playing = false;
let lastBeat = -1;
let lastSwaps = 0;
let beatEnergy = 0;

// ── temas ─────────────────────────────────────────

for (const [file, label] of SONGS) {
  $("song").append(new Option(label, file));
}

// En el repo los temas se leen del submódulo; en la versión publicada en
// claude.ai vienen copiados en songs/ (ver scripts/build-artifact.sh).
const SONG_DIRS = ["songs/", "../tatum/examples/"];

async function fetchSong(file) {
  for (const dir of SONG_DIRS) {
    const res = await fetch(`${dir}${file}.synth`).catch(() => null);
    if (res?.ok) return res.text();
  }
  throw new Error(`no encontré el tema ${file} (¿falta git submodule update --init?)`);
}

function tempoFrom(source) {
  const m = source.match(/^\s*tempo\s+(\d+(?:\.\d+)?)/m);
  return m ? Number(m[1]) : 120;
}

function showTempo(bpm) {
  $("tempo").value = bpm;
  $("bpm").textContent = Math.round(bpm);
  paintRange($("tempo"));
}

async function pickSong(file) {
  try {
    const source = await fetchSong(file);
    $("source").value = source;
    showTempo(tempoFrom(source));
    if (ready) await apply({ newSong: true });
  } catch (err) {
    status(String(err.message ?? err), "err");
  }
}

// ── motor ─────────────────────────────────────────

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = `status ${kind}`;
}

// Carga la partitura. Al cambiar de tema, primero fija su volumen: sin eso
// tatum lo mediría ahí mismo y trabaría el audio.
async function apply({ newSong = false } = {}) {
  const source = $("source").value;
  if (newSong) {
    engine.levelFor(source).then((gain) => {
      if (!Number.isFinite(gain)) return;
      if ($("status").textContent.startsWith("midiendo")) status("listo", "ok");
    });
  }
  const res = await engine.load(source);
  if (res.ok) {
    const measuring = newSong && !engine.measured(source);
    status(measuring ? "midiendo el volumen del tema…" : playing ? "entra en el próximo compás" : "listo", measuring ? "" : "ok");
    // Sonando, el tema nuevo entra en el próximo compás: las pistas se
    // vuelven a leer cuando el motor avisa que cambió (ver onStep).
    if (!playing) await renderTracks();
  } else {
    status(res.errors.map((e) => `línea ${e.line}: ${e.msg}`).join("\n"), "err");
  }
  return res.ok;
}

async function togglePlay() {
  try {
    if (!ready) {
      status("despertando el motor…");
      await engine.init();
      engine.onStep = onStep;
      ready = true;
      if (!(await apply({ newSong: true }))) return;
    }
    if (playing) {
      engine.stop();
      setPlaying(false);
    } else {
      await engine.start();
      setPlaying(true);
    }
  } catch (err) {
    status(`no pude arrancar el audio: ${err.message ?? err}`, "err");
  }
}

function setPlaying(on) {
  playing = on;
  root.style.setProperty("--rise", on ? 1 : 0);
  $("playIcon").setAttribute("d", on ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z");
  $("play").setAttribute("aria-label", on ? "Parar" : "Tocar");
  if (!on) {
    $("bar").textContent = "—";
    lastBeat = -1;
    for (const i of $("beats").children) i.classList.remove("on");
  }
}

// tatum cuenta en tatums: 16 por compás de 4/4, 4 por tiempo.
function onStep({ step, running, swaps }) {
  if (swaps !== lastSwaps) {
    lastSwaps = swaps;
    renderTracks();
  }
  if (!playing || !running) return;
  const beat = Math.floor(step / 4);
  if (beat === lastBeat) return;
  lastBeat = beat;
  beatEnergy = 1;
  $("bar").textContent = `compás ${Math.floor(step / 16) + 1}`;
  [...$("beats").children].forEach((el, i) => el.classList.toggle("on", i === beat % 4));
}

// ── pistas ────────────────────────────────────────

async function renderTracks() {
  const tracks = await engine.tracks();
  const list = $("tracks");
  list.replaceChildren();
  tracks.forEach((t, idx) => {
    const li = document.createElement("li");
    li.className = "track";
    li.innerHTML = `
      <span class="dot"></span>
      <span class="name"></span>
      <input type="range" class="level" min="0" max="1.5" step="0.01" aria-label="volumen">
      <input type="range" class="pan" min="-1" max="1" step="0.01" aria-label="paneo">`;
    const name = li.querySelector(".name");
    name.textContent = t.name;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = t.kind;
    name.append(kind);

    const level = li.querySelector(".level");
    const pan = li.querySelector(".pan");
    const dot = li.querySelector(".dot");
    level.value = t.level;
    pan.value = t.pan;
    const sync = () => {
      dot.style.setProperty("--lvl", Math.min(1, 0.2 + level.value / 1.5));
      paintRange(level);
      paintRange(pan);
    };
    level.oninput = () => { engine.setLevel(idx, Number(level.value)); sync(); };
    pan.oninput = () => { engine.setPan(idx, Number(pan.value)); sync(); };
    pan.ondblclick = () => { pan.value = 0; pan.oninput(); };
    sync();
    list.append(li);
  });
}

function paintRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

// ── el mar: el reflejo del sol tiembla con el sonido ──

const sea = $("sea");
const ctx2d = sea.getContext("2d");
let bins = null;

function drawSea() {
  const dpr = window.devicePixelRatio || 1;
  const w = sea.clientWidth * dpr;
  const h = sea.clientHeight * dpr;
  if (sea.width !== w || sea.height !== h) { sea.width = w; sea.height = h; }
  ctx2d.clearRect(0, 0, w, h);

  const rise = playing ? 1 : 0.15;
  if (engine.analyser) {
    bins ??= new Uint8Array(engine.analyser.frequencyBinCount);
    engine.analyser.getByteFrequencyData(bins);
  }

  const rows = 22;
  for (let r = 0; r < rows; r++) {
    const depth = r / rows;
    // filas de arriba = graves, abajo = agudos
    const bin = bins ? bins[Math.floor(Math.pow(depth, 2) * bins.length * 0.5) + 2] / 255 : 0;
    const half = w * (0.16 - depth * 0.08) * (0.35 + rise * 0.4 + bin * 0.6);
    const y = (depth + 0.5 / rows) * h;
    const wobble = Math.sin(performance.now() / 600 + r * 1.7) * w * 0.006;
    ctx2d.strokeStyle = `rgba(255, ${170 + depth * 40}, ${40 + depth * 60}, ${(1 - depth) * (0.25 + rise * 0.5)})`;
    ctx2d.lineWidth = Math.max(1, (1 - depth) * 3 * dpr);
    ctx2d.beginPath();
    ctx2d.moveTo(w / 2 - half + wobble, y);
    ctx2d.lineTo(w / 2 + half + wobble, y);
    ctx2d.stroke();
  }

  beatEnergy *= 0.9;
  root.style.setProperty("--beat", beatEnergy.toFixed(3));
  requestAnimationFrame(drawSea);
}

// ── eventos ───────────────────────────────────────

$("play").onclick = togglePlay;
$("song").onchange = (e) => pickSong(e.target.value);
$("tempo").oninput = (e) => {
  showTempo(Number(e.target.value));
  if (ready) engine.setTempo(Number(e.target.value));
};
$("source").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    if (ready) apply();
    else togglePlay();
  }
  if (e.key === "Tab") {
    e.preventDefault();
    e.target.setRangeText("    ", e.target.selectionStart, e.target.selectionEnd, "end");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    togglePlay();
  }
});

pickSong(SONGS[0][0]);
requestAnimationFrame(drawSea);
