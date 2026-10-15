//! El motor de anvar.
//!
//! Es el mismo puente que `tatum/wasm` (el planner y el player de
//! `tatum_core::live`, cruzando textos y buffers hacia JavaScript), con dos
//! cosas que anvar necesita y ese crate no expone:
//!
//! - `measure_gain`: mide el volumen de un tema sin tocarlo. tatum lo hace
//!   adentro del primer `load_source`, renderizando el tema entero; en el
//!   navegador eso son 20-40 segundos con el hilo de audio trabado. anvar lo
//!   corre en un Web Worker aparte y el sonido arranca enseguida.
//! - `set_output_gain`: aplica esa medición al tema que está sonando y a los
//!   que se carguen después.
//!
//! Todo lo musical vive en tatum-core; acá no se decide nada del sonido.

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use tatum_core::live::{LivePlanner, LivePlayer};
use tatum_core::song_engine::SongEngine;
use tatum_core::BLOCK_SIZE;
use wasm_bindgen::prelude::*;

/// Reserva `len` bytes en la memoria del módulo, para que JavaScript escriba
/// ahí un texto antes de pasárselo al motor.
#[wasm_bindgen]
pub fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Libera lo que reservó `alloc`.
/// # Safety
/// `ptr` y `len` tienen que venir de una llamada a `alloc`.
#[wasm_bindgen]
pub unsafe fn free(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
}

/// # Safety
/// `ptr`/`len` describen UTF-8 válido dentro de la memoria del módulo.
unsafe fn text<'a>(ptr: *const u8, len: usize) -> &'a str {
    unsafe { core::str::from_utf8_unchecked(core::slice::from_raw_parts(ptr, len)) }
}

/// La ganancia con la que tatum haría sonar este tema: lo renderiza entero,
/// mide su loudness y la lleva al nivel de salida común. NaN si no compila.
/// # Safety
/// `ptr`/`len` describen UTF-8 válido dentro de la memoria del módulo.
#[wasm_bindgen]
pub unsafe fn measure_gain(ptr: *const u8, len: usize) -> f32 {
    let source = unsafe { text(ptr, len) };
    let Ok(ast) = tatum_core::dsl::parse(source) else { return f32::NAN };
    let Ok(compiled) = tatum_core::dsl::compiler::compile(&ast) else { return f32::NAN };
    tatum_core::output::gain_for(SongEngine::loudness(&compiled))
}

static OK_JSON: &[u8] = br#"{"ok":true}"#;

#[wasm_bindgen]
pub struct Anvar {
    planner: LivePlanner,
    player: LivePlayer,
    out_buf: Vec<f32>,
    result_buf: Vec<u8>,
}

impl Default for Anvar {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Anvar {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            planner: LivePlanner::new(),
            player: LivePlayer::new(),
            out_buf: vec![0.0; BLOCK_SIZE * 2],
            result_buf: Vec::new(),
        }
    }

    /// La ganancia de salida, para lo que suena y lo que venga. Hay que
    /// llamarla antes del primer `load_source`: sin ella, tatum la mide ahí
    /// mismo y traba el audio.
    pub fn set_output_gain(&mut self, gain: f32) {
        self.planner.set_output_gain(gain);
        if let Some(engine) = self.player.engine_mut() {
            engine.set_output_gain(gain);
        }
    }

    /// Carga un texto .synth: los valores cambian al instante, lo demás en el
    /// próximo compás. Devuelve un JSON `{ok, errors?}` (largo: `result_len`).
    /// # Safety
    /// `ptr`/`len` describen UTF-8 válido dentro de la memoria del módulo.
    pub unsafe fn load_source(&mut self, ptr: *const u8, len: usize) -> *const u8 {
        let source = unsafe { text(ptr, len) };
        match self.planner.plan(source, self.player.generation()) {
            Ok(plan) => {
                self.player.apply(plan);
                self.result_buf.clear();
                self.result_buf.extend_from_slice(OK_JSON);
            }
            Err(err) => self.result_buf = err.to_json().into_bytes(),
        }
        self.result_buf.as_ptr()
    }

    pub fn result_len(&self) -> usize {
        self.result_buf.len()
    }

    /// Rinde `num_frames` (hasta 128) frames estéreo intercalados.
    pub fn process(&mut self, num_frames: usize) -> *const f32 {
        let len = num_frames.min(BLOCK_SIZE);
        let mut l = [0.0f32; BLOCK_SIZE];
        let mut r = [0.0f32; BLOCK_SIZE];
        self.player.process(&mut l[..len], &mut r[..len]);
        // El worklet tiene un solo hilo: un motor retirado se libera acá.
        while self.player.take_retired().is_some() {}
        for i in 0..len {
            self.out_buf[i * 2] = l[i];
            self.out_buf[i * 2 + 1] = r[i];
        }
        self.out_buf.as_ptr()
    }

    pub fn start(&mut self) {
        self.player.start();
    }

    pub fn stop(&mut self) {
        self.player.stop();
    }

    pub fn running(&self) -> bool {
        self.player.running()
    }

    /// Cuántas veces entró un tema (o una versión) nuevo desde que arrancó:
    /// cuando cambia, la UI vuelve a leer las pistas.
    pub fn swaps(&self) -> u32 {
        self.player.swaps()
    }

    /// El tatum (paso de 1/16) global en el que va el tema.
    pub fn current_step(&self) -> usize {
        self.player.engine().map_or(0, |e| e.global_step())
    }

    /// JSON `[{name, kind, level, pan}]` de las pistas (largo: `result_len`).
    pub fn track_info(&mut self) -> *const u8 {
        let mut json = String::from("[");
        if let Some(e) = self.player.engine() {
            for i in 0..e.track_count() {
                if i > 0 {
                    json.push(',');
                }
                json.push_str(&alloc::format!(
                    r#"{{"name":"{}","kind":"{}","level":{:.3},"pan":{:.3}}}"#,
                    e.track_name(i),
                    e.track_kind(i),
                    e.track_level(i),
                    e.track_pan(i),
                ));
            }
        }
        json.push(']');
        self.result_buf = json.into_bytes();
        self.result_buf.as_ptr()
    }

    pub fn set_track_level(&mut self, idx: usize, level: f32) {
        if let Some(e) = self.player.engine_mut() {
            e.set_track_level(idx, level);
        }
    }

    pub fn set_track_pan(&mut self, idx: usize, pan: f32) {
        if let Some(e) = self.player.engine_mut() {
            e.set_track_pan(idx, pan);
        }
    }

    pub fn set_tempo(&mut self, bpm: f32) {
        if let Some(e) = self.player.engine_mut() {
            e.set_tempo(bpm);
        }
    }

    pub fn set_track_pattern(&mut self, track_idx: usize, pattern_idx: usize) {
        if let Some(e) = self.player.engine_mut() {
            e.set_track_pattern(track_idx, pattern_idx);
        }
    }
}
