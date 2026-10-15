# anvar

Un instrumento para tocar en vivo, en ámbar, entre el ocaso y el amanecer.

anvar es la interfaz; el sonido lo pone [tatum](https://github.com/sebasusnik/tatum),
el sinte de Seba (Sebastián Usnik): música escrita como texto, que se puede cambiar
mientras suena. anvar usa tatum tal cual, sin modificarlo, y le pone encima una
UI/UX propia.

## Usarlo

La forma fácil, sin instalar nada: **https://claude.ai/artifact/LzzYgo1reSmC3yArpPqcqj**

## Abrirlo en la Mac (para desarrollo)

La primera vez:

```
git clone --recurse-submodules https://github.com/rawwwpower/anvar
cd anvar
```

Cada vez que lo quieras usar:

```
./scripts/serve.sh
```

y abrí **http://localhost:8000/web/** en el navegador. Tocá ▶ (o la barra
espaciadora) para despertar el sol.

No hace falta instalar Rust para usar ni para diseñar la UI: el motor ya viene
compilado en `web/engine/anvar.wasm`.

### Qué se puede hacer hoy

- Elegir un tema de los ejemplos de tatum y tocarlo.
- Editar la partitura a la derecha y aplicar con **⌘↵**: entra en el próximo
  compás sin cortar el sonido. Si tiene un error, se marca la línea y sigue
  sonando la última versión buena.
- Mover el tempo y el volumen/paneo de cada pista (doble click en el paneo lo
  centra).

## Cómo está armado

```
anvar/
├── web/                  la app: lo que se diseña
│   ├── index.html
│   ├── style.css         la paleta ámbar vive en :root
│   ├── app.js            la UI
│   └── engine/           el puente con el motor (no hace falta tocarlo para diseñar)
│       ├── anvar.js            la clase Engine: init, load, start, stop, tempo, pistas
│       ├── anvar-processor.js  el AudioWorklet donde suena
│       ├── measure-worker.js   mide el volumen de cada tema en segundo plano
│       ├── glue.js
│       └── anvar.wasm          el motor compilado (commiteado)
├── engine/               el motor de anvar en Rust: tatum-core + lo que la UI necesita
├── tatum/                el repo de Seba, como submódulo. No se edita.
└── scripts/
    ├── serve.sh          sirve la app en localhost
    ├── update-tatum.sh   trae lo nuevo de Seba y recompila
    └── build-engine.sh   recompila web/engine/anvar.wasm
```

`engine/` existe porque el WASM que trae tatum mide el volumen del tema al
cargarlo, renderizándolo entero: en el navegador eso traba el audio entre 20 y
40 segundos. El motor de anvar es el mismo puente pero hace esa medición en un
Worker aparte, así el tema arranca al toque.

## Traer lo nuevo de Seba

tatum está fijado a una versión exacta (un commit). Para actualizarlo hace falta
Rust una sola vez:

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
```

y después, cada vez:

```
./scripts/update-tatum.sh
```

Trae los cambios, recompila el motor y te dice qué commitear. Probá que anvar
siga sonando antes de commitear.

## Licencia

tatum es de Seba, bajo MIT o Apache-2.0 (ver `tatum/LICENSE-MIT` y
`tatum/LICENSE-APACHE`). `engine/` está basado en `tatum/wasm` y
`web/engine/anvar-processor.js` en `tatum/wasm/examples/worklet/`, bajo esas
mismas licencias.
