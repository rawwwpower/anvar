# CLAUDE.md

anvar es el proyecto de Ana (Ana Varela): una UI/UX propia para tocar en vivo, en
ámbar, con objetos que recuerdan al amanecer y al ocaso. El sonido es
[tatum](https://github.com/sebasusnik/tatum), el sinte de Seba. Hablarle a Ana en
castellano rioplatense; es diseñadora, así que explicar lo técnico sin jerga.

## Reglas

- **`tatum/` no se edita nunca.** Es un submódulo con el repo de Seba, fijado a
  un commit. Ana lo consume, no le contribuye: nada de PRs, issues ni forks hacia
  `sebasusnik/tatum`. Si algo de tatum no alcanza, se resuelve en `engine/` (Rust,
  usando `tatum-core` como librería) o en `web/engine/`.
- Para traer cambios de Seba: `./scripts/update-tatum.sh`, verificar que suene y
  commitear `tatum` + `engine/Cargo.lock` + `web/engine/anvar.wasm`.
- `web/engine/anvar.wasm` se commitea compilado, así Ana diseña sin instalar Rust.
  Cualquier cambio en `engine/` o en `tatum/` → `./scripts/build-engine.sh` y
  commitear el `.wasm` nuevo.
- `wasm-bindgen` está fijado (`=0.2.128`) en `engine/Cargo.toml`; el
  `wasm-bindgen-cli` instalado tiene que ser exactamente esa versión.

## La versión online (cómo la usa Ana)

Ana no instala nada: usa anvar desde https://claude.ai/artifact/LzzYgo1reSmC3yArpPqcqj.
Después de cambiar `web/`, correr `./scripts/build-artifact.sh` (arma `dist/` con
los temas copiados adentro) y republicar ese artifact con todos los archivos de
`dist/`. Terminar la respuesta con ese link.

## Cómo funciona

- `web/` es estática, sin build: HTML/CSS/JS de módulos. Se sirve con
  `./scripts/serve.sh` (desde la raíz, porque lee los ejemplos de
  `tatum/examples/`) y se abre en `http://localhost:8000/web/`.
- `web/engine/anvar.js` (clase `Engine`) es todo lo que la UI necesita del motor.
  El audio corre en `anvar-processor.js` (AudioWorklet, 44.1 kHz).
- **El volumen**: tatum normaliza cada tema renderizándolo entero (20-40 s en
  WASM). Si el planner no tiene ganancia, lo hace en el primer `load_source` y
  traba el hilo de audio. Por eso `Engine.levelFor()` siempre fija una ganancia
  *antes* de cargar: la cacheada, o una provisoria (1.0) mientras
  `measure-worker.js` mide la real en otro hilo.
- Un tema cargado mientras suena entra en el próximo compás. La UI se entera por
  `swaps` en el mensaje `step` y ahí vuelve a leer las pistas.

## Probar

No hay tests. Para verificar un cambio: servir la app y abrirla con Playwright
(Chromium headless con `--autoplay-policy=no-user-gesture-required`), tocar ▶ y
revisar que avance el compás, aparezcan las pistas y que un error de sintaxis no
corte el audio.
