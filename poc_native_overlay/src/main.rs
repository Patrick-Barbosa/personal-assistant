//! Copernico — Native Win32 Layered Window Overlay
//! 
//! Renderiza o SVG REAL do CopernicoSun com as 12 pétalas dinâmicas,
//! blooming radial, glow suave e etiqueta com texto nítido.
//! 
//! 100% nativo no Windows DWM com resvg/tiny-skia:
//! - Impossível ter tela branca
//! - Canal Alpha real por pixel
//! - ~60 FPS com menos de 10 MB de RAM
//! - Zero dependência de WebView2 ou Chromium

use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, Ordering};
use std::time::{Duration, Instant};

use std::sync::Arc;
use resvg::tiny_skia::Pixmap;
use resvg::usvg::{self, fontdb};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC, HBRUSH,
    BLENDFUNCTION, AC_SRC_ALPHA, AC_SRC_OVER,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;

#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(uPeriod: u32) -> u32;
    fn timeEndPeriod(uPeriod: u32) -> u32;
}

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    VK_ESCAPE, VK_NUMPAD0, VK_NUMPAD1, VK_NUMPAD2, VK_NUMPAD3, VK_NUMPAD4, VK_NUMPAD5, VK_NUMPAD6, VK_SPACE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetCursorPos, PeekMessageW, PostQuitMessage,
    RegisterClassW, SetWindowPos, ShowWindow, TranslateMessage, UpdateLayeredWindow,
    HCURSOR, HICON, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_NOSIZE, SW_SHOW, ULW_ALPHA,
    WM_DESTROY, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_QUIT,
    WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

const WIDTH: i32 = 136;
const HEIGHT: i32 = 136;

#[derive(Clone, Copy, PartialEq)]
enum OverlayMode {
    Speaking = 0,   // Branco (saudação / agente falando)
    Listening = 1,  // Âmbar (escutando usuário)
    Processing = 2, // Ciano (pensando)
}

impl OverlayMode {
    fn from_u8(v: u8) -> Self {
        match v % 3 {
            0 => OverlayMode::Speaking,
            1 => OverlayMode::Listening,
            _ => OverlayMode::Processing,
        }
    }

    fn to_u8(self) -> u8 {
        self as u8
    }

    fn name(&self) -> &'static str {
        match self {
            OverlayMode::Speaking => "Falando...",
            OverlayMode::Listening => "Ouvindo...",
            OverlayMode::Processing => "Pensando...",
        }
    }

    fn next(&self) -> Self {
        match self {
            OverlayMode::Speaking => OverlayMode::Listening,
            OverlayMode::Listening => OverlayMode::Processing,
            OverlayMode::Processing => OverlayMode::Speaking,
        }
    }
}

static DRAGGING: AtomicBool = AtomicBool::new(false);
static DRAG_OFFSET_X: AtomicI32 = AtomicI32::new(0);
static DRAG_OFFSET_Y: AtomicI32 = AtomicI32::new(0);
static CURRENT_POS_X: AtomicI32 = AtomicI32::new(8);
static CURRENT_POS_Y: AtomicI32 = AtomicI32::new(8);
static CURRENT_MODE_RAW: AtomicU8 = AtomicU8::new(1); // Default: Listening
static AUDIO_RMS_BITS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static TARGET_FPS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(180); // Default: 180 FPS!

fn get_current_mode() -> OverlayMode {
    OverlayMode::from_u8(CURRENT_MODE_RAW.load(Ordering::Relaxed))
}

fn set_current_mode(mode: OverlayMode) {
    CURRENT_MODE_RAW.store(mode.to_u8(), Ordering::Relaxed);
}

/// Simula a escrita de áudio RMS vindo da thread de captura/playback do Rust
fn write_audio_rms(rms: f32) {
    AUDIO_RMS_BITS.store(rms.to_bits(), Ordering::Relaxed);
}

fn read_audio_rms() -> f32 {
    f32::from_bits(AUDIO_RMS_BITS.load(Ordering::Relaxed))
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN => {
            let mut pt = POINT { x: 0, y: 0 };
            GetCursorPos(&mut pt);
            DRAGGING.store(true, Ordering::Relaxed);
            DRAG_OFFSET_X.store(pt.x - CURRENT_POS_X.load(Ordering::Relaxed), Ordering::Relaxed);
            DRAG_OFFSET_Y.store(pt.y - CURRENT_POS_Y.load(Ordering::Relaxed), Ordering::Relaxed);
            0
        }
        WM_MOUSEMOVE => {
            if DRAGGING.load(Ordering::Relaxed) {
                let mut pt = POINT { x: 0, y: 0 };
                GetCursorPos(&mut pt);
                let new_x = pt.x - DRAG_OFFSET_X.load(Ordering::Relaxed);
                let new_y = pt.y - DRAG_OFFSET_Y.load(Ordering::Relaxed);
                CURRENT_POS_X.store(new_x, Ordering::Relaxed);
                CURRENT_POS_Y.store(new_y, Ordering::Relaxed);
                SetWindowPos(
                    hwnd,
                    0,
                    new_x,
                    new_y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            0
        }
        WM_LBUTTONUP => {
            if DRAGGING.swap(false, Ordering::Relaxed) {
                let next = get_current_mode().next();
                set_current_mode(next);
                println!("[PoC] Modo alterado via clique -> {}", next.name());
            }
            0
        }
        WM_KEYDOWN => {
            match wparam as u16 {
                VK_SPACE => {
                    let next = get_current_mode().next();
                    set_current_mode(next);
                    println!("[PoC] Modo alterado via Space -> {}", next.name());
                }
                0x31 | VK_NUMPAD1 => {
                    set_current_mode(OverlayMode::Speaking);
                    println!("[PoC] Modo 1: Falando (Branco)");
                }
                0x32 | VK_NUMPAD2 => {
                    set_current_mode(OverlayMode::Listening);
                    println!("[PoC] Modo 2: Ouvindo (Âmbar)");
                }
                0x33 | VK_NUMPAD3 => {
                    set_current_mode(OverlayMode::Processing);
                    println!("[PoC] Modo 3: Pensando (Ciano)");
                }
                0x34 | VK_NUMPAD4 => {
                    TARGET_FPS.store(60, Ordering::Relaxed);
                    println!("[PoC] Alvo de FPS alterado para -> 60 FPS");
                }
                0x35 | VK_NUMPAD5 => {
                    TARGET_FPS.store(120, Ordering::Relaxed);
                    println!("[PoC] Alvo de FPS alterado para -> 120 FPS");
                }
                0x36 | VK_NUMPAD6 => {
                    TARGET_FPS.store(180, Ordering::Relaxed);
                    println!("[PoC] Alvo de FPS alterado para -> 180 FPS");
                }
                0x30 | VK_NUMPAD0 => {
                    TARGET_FPS.store(0, Ordering::Relaxed);
                    println!("[PoC] Alvo de FPS alterado para -> UNLOCKED (Velocidade Máxima da CPU)");
                }
                VK_ESCAPE => {
                    println!("[PoC] Encerrando demonstração...");
                    PostQuitMessage(0);
                }
                _ => {}
            }
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn rotate_around(deg: f32, cx: f32, cy: f32) -> resvg::tiny_skia::Transform {
    let rad = deg.to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    let tx = cx - cx * cos + cy * sin;
    let ty = cy - cx * sin - cy * cos;
    resvg::tiny_skia::Transform::from_row(cos, sin, -sin, cos, tx, ty)
}

/// Gera o SVG da camada estática (Glow + Núcleo Central Imóvel + Pílula de Status)
fn generate_static_svg(mode: OverlayMode) -> String {
    let (glow_color, stroke_amber, stroke_dark, badge_border, badge_text_color, label_text, badge_width, dot_x, text_x) = match mode {
        OverlayMode::Speaking => (
            "#ffffff",
            "#ffffff", // Branco brilhante
            "#cbd5e1", // Cinza claro
            "#38bdf8", // Borda azul céu
            "#bae6fd", // Texto azul claro
            "Falando...",
            78.0,
            -27.0,
            -19.0,
        ),
        OverlayMode::Listening => (
            "#f59e0b",
            "#f08c00", // Âmbar rico
            "#1e1e1e", // Escuro grafite
            "#f59e0b", // Borda âmbar
            "#fef3c7", // Texto âmbar suave
            "Ouvindo...",
            78.0,
            -27.0,
            -19.0,
        ),
        OverlayMode::Processing => (
            "#38bdf8",
            "#38bdf8", // Ciano
            "#1e293b", // Slate escuro
            "#38bdf8", // Borda ciano
            "#e0f2fe", // Texto ciano claro
            "Pensando...",
            88.0,
            -32.0,
            -24.0,
        ),
    };
    let rect_x = -badge_width / 2.0;

    format!(r##"<svg width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="sunGlow" cx="50%" cy="38%" r="48%">
      <stop offset="0%" stop-color="{glow_color}" stop-opacity="0.45" />
      <stop offset="50%" stop-color="{glow_color}" stop-opacity="0.18" />
      <stop offset="85%" stop-color="{glow_color}" stop-opacity="0.04" />
      <stop offset="100%" stop-color="{glow_color}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Halo de Fundo (Glow) -->
  <circle cx="68" cy="52" r="48" fill="url(#sunGlow)" />

  <!-- 1. Núcleo Central ESTÁTICO (Centro Heliocêntrico Travado - Nunca Gira) -->
  <g transform="translate(68, 52) scale(0.74) translate(-127.917, -299.632)">
    <!-- Núcleo Central -->
    <g stroke-linecap="round" transform="translate(102.89 276.25)">
      <path d="M12.17 2.63 C12.17 2.63, 12.17 2.63, 12.17 2.63 M12.17 2.63 C12.17 2.63, 12.17 2.63, 12.17 2.63 M2.07 20.35 C7.64 14.81, 11.04 10.91, 17.81 2.23 M2.07 20.35 C7.92 13.66, 11.84 8.01, 17.81 2.23 M1.8 26.74 C9.91 19.2, 16.46 9.95, 23.45 1.84 M1.8 26.74 C7.59 20.07, 13.13 13.94, 23.45 1.84 M2.2 32.39 C11.79 20.82, 22.3 10.53, 29.1 1.44 M2.2 32.39 C8.94 23.62, 17.16 14.27, 29.1 1.44 M4.56 35.77 C13.93 28.45, 18.51 18.92, 33.43 2.56 M4.56 35.77 C10.77 28.18, 18.63 19.62, 33.43 2.56 M7.58 38.39 C16.76 26.55, 27.42 14.71, 37.1 4.43 M7.58 38.39 C18.07 25.7, 28.92 12.21, 37.1 4.43 M9.94 41.77 C20.79 27.32, 32.67 14.37, 40.78 6.3 M9.94 41.77 C18.68 32.89, 26.34 23.88, 40.78 6.3 M12.96 44.39 C20.49 34.97, 28.63 24.92, 44.45 8.17 M12.96 44.39 C20.46 36.81, 27.11 27.64, 44.45 8.17 M17.29 45.51 C25.82 34.82, 32.31 25.87, 46.16 12.3 M17.29 45.51 C27.71 35.21, 36.89 23.7, 46.16 12.3 M21.62 46.62 C30.84 34.62, 44.35 20.94, 47.87 16.43 M21.62 46.62 C27.98 39.7, 35.18 30.67, 47.87 16.43 M26.61 46.98 C32.68 37.95, 43.8 27.22, 49.57 20.57 M26.61 46.98 C32.87 38.01, 40.58 29.86, 49.57 20.57 M34.88 43.57 C38.54 39.86, 41.69 37.92, 48.66 27.72 M34.88 43.57 C37.47 39.06, 41.11 36.24, 48.66 27.72 M10.95 43.8 C10.95 43.8, 10.95 43.8, 10.95 43.8 M10.95 43.8 C10.95 43.8, 10.95 43.8, 10.95 43.8 M18.86 45.37 C15.99 40.48, 8.88 37.71, 1.5 30.28 M18.86 45.37 C12.99 41.29, 8.94 36.29, 1.5 30.28 M26.77 46.94 C17.79 40.84, 10.31 33.29, 1.86 25.29 M26.77 46.94 C18.4 39.23, 10.41 32.01, 1.86 25.29 M31.66 45.89 C22.13 34.53, 8.77 24.91, 2.22 20.31 M31.66 45.89 C22.39 37.28, 13.73 30.62, 2.22 20.31 M35.04 43.53 C21.39 32.32, 9.48 21.04, 2.58 15.32 M35.04 43.53 C28.11 36.57, 20.62 30.9, 2.58 15.32 M38.42 41.17 C28.52 35.2, 19.77 27.54, 4.45 11.64 M38.42 41.17 C26.78 31.92, 17.05 21.78, 4.45 11.64 M41.79 38.8 C31.4 27.98, 19.72 19.26, 7.08 8.63 M41.79 38.8 C34.48 31.05, 25.35 25.05, 7.08 8.63 M44.42 35.78 C29.82 26.15, 20.4 15.65, 9.7 5.61 M44.42 35.78 C35.24 27.41, 25.12 17.9, 9.7 5.61 M46.29 32.11 C31.55 20.56, 18.48 7.91, 12.33 2.59 M46.29 32.11 C39.84 26.25, 32.53 19.76, 12.33 2.59 M48.16 28.44 C41 21.82, 35.06 19.22, 17.21 1.54 M48.16 28.44 C37.9 19.63, 27.97 12.05, 17.21 1.54 M50.03 24.76 C39 16.73, 28.44 6.63, 22.86 1.14 M50.03 24.76 C42.5 18.58, 37.67 13.88, 22.86 1.14 M49.63 19.12 C43.99 13.89, 38.54 9.21, 28.5 0.75 M49.63 19.12 C44.14 14.32, 39.87 10.95, 28.5 0.75 M45.46 10.19 C43.71 8.81, 42.87 7.88, 41.69 6.91 M45.46 10.19 C44.11 8.87, 42.56 7.74, 41.69 6.91" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
      <path d="M12.36 2.4 C16.82 0.16, 25.13 0.37, 30.38 1.32 C35.63 2.27, 40.48 4.4, 43.88 8.11 C47.29 11.82, 50.9 18.59, 50.8 23.6 C50.7 28.61, 46.99 34.19, 43.27 38.16 C39.56 42.13, 33.89 46.47, 28.52 47.42 C23.15 48.37, 15.64 46.62, 11.05 43.88 C6.46 41.14, 2.49 35.83, 0.99 30.97 C-0.5 26.12, -0.35 19.52, 2.08 14.74 C4.51 9.96, 12.7 4.54, 15.57 2.29 C18.45 0.05, 19.03 1.14, 19.33 1.27 M34.91 1.88 C39.95 3.42, 43.86 8.58, 46.39 12.97 C48.91 17.36, 50.97 23.7, 50.05 28.24 C49.13 32.78, 45.11 37.19, 40.87 40.19 C36.63 43.19, 30.17 45.91, 24.62 46.24 C19.08 46.57, 11.76 45.08, 7.6 42.2 C3.44 39.32, 0.55 34.2, -0.34 28.94 C-1.23 23.67, -0.49 15.42, 2.25 10.6 C4.99 5.79, 10.91 1.35, 16.11 0.05 C21.31 -1.24, 30.45 2.58, 33.44 2.83 C36.43 3.08, 34.09 1.26, 34.05 1.54" stroke="{stroke_dark}" stroke-width="1" fill="none" />
    </g>
  </g>

  <!-- Pílula de Status com Fundo Responsivo ao Texto -->
  <g transform="translate(68, 116)">
    <!-- Fundo Translúcido e Borda Sutil com Largura Adaptativa -->
    <rect x="{rect_x:.1}" y="-8.5" width="{badge_width:.1}" height="17" rx="8.5" fill="#09090b" fill-opacity="0.92" stroke="{badge_border}" stroke-width="1.1" />
    <!-- Ponto Pulsante -->
    <circle cx="{dot_x:.1}" cy="0" r="2.5" fill="{badge_border}" />
    <!-- Texto Perfeitamente Legível Sem Estourar -->
    <text x="{text_x:.1}" y="3.2" fill="{badge_text_color}" font-family="Segoe UI, -apple-system, sans-serif" font-size="9.5" font-weight="bold">{label_text}</text>
  </g>
</svg>"##,
        WIDTH = WIDTH,
        HEIGHT = HEIGHT,
        glow_color = glow_color,
        stroke_amber = stroke_amber,
        stroke_dark = stroke_dark,
        badge_border = badge_border,
        badge_text_color = badge_text_color,
        label_text = label_text,
        badge_width = badge_width,
        rect_x = rect_x,
        dot_x = dot_x,
        text_x = text_x,
    )
}

/// Gera o SVG dinâmico das 12 pétalas em um nível de volume específico
fn generate_petals_svg(mode: OverlayMode, volume: f32) -> String {
    let distance = volume.clamp(0.0, 1.0) * 32.0;

    let (stroke_amber, stroke_dark) = match mode {
        OverlayMode::Speaking => ("#ffffff", "#cbd5e1"),
        OverlayMode::Listening => ("#f08c00", "#1e1e1e"),
        OverlayMode::Processing => ("#38bdf8", "#1e293b"),
    };

    let p1_x = 0.28269 * distance;
    let p1_y = -0.95921 * distance;

    let p2_x = 0.70512 * distance;
    let p2_y = -0.70909 * distance;

    let p3_x = 0.95017 * distance;
    let p3_y = 0.31174 * distance;

    let p4_x = 0.69200 * distance;
    let p4_y = 0.72190 * distance;

    let p5_x = 0.16380 * distance;
    let p5_y = 0.98649 * distance;

    let p6_x = -0.42690 * distance;
    let p6_y = 0.90430 * distance;

    let p7_x = -0.88883 * distance;
    let p7_y = 0.45825 * distance;

    let p8_x = -0.97995 * distance;
    let p8_y = -0.19927 * distance;

    let p9_x = -0.75475 * distance;
    let p9_y = -0.65601 * distance;

    let p10_x = -0.31437 * distance;
    let p10_y = -0.94930 * distance;

    let p11_x = 0.99463 * distance;
    let p11_y = -0.10351 * distance;

    let p12_x = 0.88488 * distance;
    let p12_y = -0.46583 * distance;

    format!(r##"<svg width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <!-- 2. As 12 Pétalas DINÂMICAS (Giram em Torno do Núcleo e Florescem) -->
  <g transform="translate(68, 52) scale(0.74) translate(-127.917, -299.632)">
    <!-- Pétala 1 -->
    <g transform="translate({p1_x:.2}, {p1_y:.2})">
      <g stroke-linecap="round" transform="translate(145.19 259.56)">
        <path d="M-11.01 3.67 C-11.01 3.67, -11.01 3.67, -11.01 3.67 M-11.01 3.67 C-11.01 3.67, -11.01 3.67, -11.01 3.67 M-10.62 9.32 C-8.08 6.41, -6.25 4.83, -3.4 1.02 M-10.62 9.32 C-8.14 6.68, -5.86 3.57, -3.4 1.02" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.55 -0.22 C-2.5 0.34, -9.18 1.19, -11.4 3.14 C-13.63 5.1, -15.87 12.08, -13.9 11.49 C-11.92 10.9, -1.78 1.44, 0.46 -0.41 M0.17 -0.81 C-1.64 -0.18, -8 1.75, -10.43 3.64 C-12.85 5.52, -16.24 11.15, -14.36 10.52 C-12.49 9.9, -1.64 1.51, 0.82 -0.11" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 2 -->
    <g transform="translate({p2_x:.2}, {p2_y:.2})">
      <g stroke-linecap="round" transform="translate(146.51 274.67)">
        <path d="M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M6.96 -1.9 C7.7 -2.52, 8.51 -3.65, 10.24 -5.68 M6.96 -1.9 C8.2 -3.47, 9.46 -4.89, 10.24 -5.68 M13.91 -3.81 C14.45 -4.38, 14.6 -4.77, 15.88 -6.07 M13.91 -3.81 C14.35 -4.3, 14.76 -4.71, 15.88 -6.07 M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M4.89 -1.05 C4.31 -1.46, 3.72 -1.99, 3.38 -2.36 M4.89 -1.05 C4.48 -1.42, 3.97 -1.88, 3.38 -2.36 M9.02 -2.76 C8.08 -3.51, 7.25 -4.43, 6 -5.38 M9.02 -2.76 C8.02 -3.56, 6.99 -4.41, 6 -5.38 M13.91 -3.81 C13.05 -4.49, 12.34 -5.07, 10.89 -6.43 M13.91 -3.81 C12.92 -4.74, 11.98 -5.54, 10.89 -6.43 M18.8 -4.86 C18.44 -5.15, 18.08 -5.66, 17.29 -6.17 M18.8 -4.86 C18.27 -5.36, 17.76 -5.8, 17.29 -6.17" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.5 -0.4 C0.78 -1.36, 3.81 -5.13, 7.12 -5.98 C10.44 -6.84, 20.64 -6.59, 19.38 -5.53 C18.13 -4.46, 2.87 -0.46, -0.4 0.42 M0.24 0.58 C1.48 -0.53, 3.4 -5.9, 6.57 -6.85 C9.74 -7.8, 20.45 -6.19, 19.27 -5.14 C18.1 -4.08, 2.61 -1.35, -0.49 -0.53" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 3 -->
    <g transform="translate({p3_x:.2}, {p3_y:.2})">
      <g stroke-linecap="round" transform="translate(159.77 308.17)">
        <path d="M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M3.67 1.87 C3.84 1.69, 4.01 1.54, 4.33 1.11 M3.67 1.87 C3.9 1.59, 4.12 1.35, 4.33 1.11 M6.69 4.49 C7.19 3.71, 7.81 2.98, 9.32 1.47 M6.69 4.49 C7.76 3.36, 8.68 2.12, 9.32 1.47 M10.37 6.36 C10.72 6.04, 10.96 5.66, 11.68 4.85 M10.37 6.36 C10.65 6.03, 10.98 5.69, 11.68 4.85 M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M12.44 5.51 C11.15 4.2, 9.62 2.83, 7.91 1.57 M12.44 5.51 C10.84 4.3, 9.33 2.97, 7.91 1.57" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.23 0.19 C1.46 0.45, 7.56 -0.22, 9.66 1.17 C11.76 2.57, 13.99 8.8, 12.34 8.56 C10.69 8.32, 1.9 1.18, -0.23 -0.27 M0.65 -0.19 C2.35 0.17, 7.33 0.35, 9.47 1.66 C11.6 2.98, 15.07 7.97, 13.45 7.71 C11.84 7.45, 1.95 1.38, -0.23 0.1" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 4 -->
    <g transform="translate({p4_x:.2}, {p4_y:.2})">
      <g stroke-linecap="round" transform="translate(151.37 322.36)">
        <path d="M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M2.36 3.38 C2.66 3.1, 2.91 2.78, 3.02 2.62 M2.36 3.38 C2.49 3.22, 2.65 3.06, 3.02 2.62 M4.07 7.51 C4.5 6.81, 5.47 6.23, 6.69 4.49 M4.07 7.51 C4.72 6.67, 5.5 5.84, 6.69 4.49 M6.43 10.89 C6.92 10.27, 7.58 9.4, 9.06 7.87 M6.43 10.89 C7.22 10.03, 7.9 9.23, 9.06 7.87 M8.35 13.26 C8.35 13.26, 8.35 13.26, 8.35 13.26 M8.35 13.26 C8.35 13.26, 8.35 13.26, 8.35 13.26 M9.47 8.92 C7.1 6.49, 4.64 4.49, 1.92 2.36 M9.47 8.92 C6.72 6.81, 4.18 4.24, 1.92 2.36" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M0.46 -0.41 C1.9 0.64, 7.07 4.18, 8.4 6.46 C9.73 8.74, 9.91 14.36, 8.44 13.26 C6.98 12.17, 0.92 2.19, -0.4 -0.1 M0.04 0.58 C1.67 1.46, 8.11 3.51, 9.43 5.71 C10.75 7.9, 9.63 14.62, 7.98 13.73 C6.33 12.83, 0.82 2.73, -0.49 0.35" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 5 -->
    <g transform="translate({p5_x:.2}, {p5_y:.2})">
      <g stroke-linecap="round" transform="translate(135.34 326.96)">
        <path d="M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M-2.89 9.42 C-1.63 8.08, -0.9 6.77, 1.05 4.89 M-2.89 9.42 C-1.9 8.35, -0.89 6.89, 1.05 4.89 M-4 15.27 C-4 15.27, -4 15.27, -4 15.27 M-4 15.27 C-4 15.27, -4 15.27, -4 15.27 M-0.62 12.91 C-1.55 12.23, -2.29 11.5, -2.88 10.94 M-0.62 12.91 C-1.24 12.33, -1.85 11.75, -2.88 10.94 M1.25 9.23 C0.15 8.52, -0.73 7.36, -1.77 6.61 M1.25 9.23 C0.66 8.71, 0.06 8.24, -1.77 6.61 M0.86 3.59 C0.47 3.2, 0.06 2.8, -0.65 2.28 M0.86 3.59 C0.3 3.09, -0.25 2.62, -0.65 2.28" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.4 0.42 C-0.25 1.86, 2.07 5.86, 1.35 8.27 C0.63 10.68, -4.59 16.33, -4.74 14.87 C-4.88 13.41, -0.34 2.02, 0.5 -0.49 M0.4 0.15 C0.41 1.7, 1.47 6.29, 0.8 8.83 C0.13 11.38, -3.36 16.93, -3.62 15.42 C-3.89 13.91, -1.37 2.34, -0.8 -0.24" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 6 -->
    <g transform="translate({p6_x:.2}, {p6_y:.2})">
      <g stroke-linecap="round" transform="translate(117.74 326.56)">
        <path d="M-11.37 11.32 C-11.37 11.32, -11.37 11.32, -11.37 11.32 M-11.37 11.32 C-11.37 11.32, -11.37 11.32, -11.37 11.32 M-5.72 10.92 C-4.5 9.1, -2.88 7.17, -1.13 5.64 M-5.72 10.92 C-4.19 8.88, -2.46 6.96, -1.13 5.64 M-11.58 11.79 C-11.58 11.79, -11.58 11.79, -11.58 11.79 M-11.58 11.79 C-11.58 11.79, -11.58 11.79, -11.58 11.79 M-6.69 10.74 C-7.57 10.01, -8.39 9.39, -8.95 8.77 M-6.69 10.74 C-7.22 10.2, -7.83 9.72, -8.95 8.77 M-3.31 8.38 C-4.24 7.42, -5.55 6.63, -6.33 5.75 M-3.31 8.38 C-4.33 7.52, -5.44 6.58, -6.33 5.75 M-1.44 4.7 C-1.77 4.32, -2.12 4, -2.95 3.39 M-1.44 4.7 C-1.99 4.21, -2.52 3.76, -2.95 3.39 M-0.32 0.37 C-0.32 0.37, -0.32 0.37, -0.32 0.37 M-0.32 0.37 C-0.32 0.37, -0.32 0.37, -0.32 0.37" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.23 -0.27 C-0.73 1.11, -1.59 6.79, -3.42 8.7 C-5.25 10.61, -11.82 12.68, -11.19 11.2 C-10.57 9.73, -1.57 1.67, 0.31 -0.16 M0.66 0.79 C0.36 2.21, -0.4 7.55, -2.39 9.34 C-4.38 11.14, -11.78 13.07, -11.29 11.55 C-10.79 10.04, -1.21 2.11, 0.58 0.26" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 7 -->
    <g transform="translate({p7_x:.2}, {p7_y:.2})">
      <g stroke-linecap="round" transform="translate(102.50 315.00)">
        <path d="M-18.59 2.39 C-18.59 2.39, -18.59 2.39, -18.59 2.39 M-18.59 2.39 C-18.59 2.39, -18.59 2.39, -18.59 2.39 M-15.58 5.01 C-14.9 3.98, -13.98 3.22, -12.95 1.99 M-15.58 5.01 C-14.55 3.74, -13.49 2.73, -12.95 1.99 M-11.24 6.13 C-9.43 4, -8.02 2.32, -6.65 0.84 M-11.24 6.13 C-9.62 4.25, -8.1 2.53, -6.65 0.84 M-2.32 1.96 C-1.92 1.56, -1.53 1.04, -1.01 0.45 M-2.32 1.96 C-1.94 1.54, -1.57 1.1, -1.01 0.45 M-18.56 3.07 C-18.56 3.07, -18.56 3.07, -18.56 3.07 M-18.56 3.07 C-18.56 3.07, -18.56 3.07, -18.56 3.07 M-9.9 5.29 C-10.81 4.24, -11.89 3.41, -13.68 2.01 M-9.9 5.29 C-10.83 4.48, -11.85 3.64, -13.68 2.01 M-5.77 3.59 C-6.71 2.78, -7.54 1.91, -8.79 0.96 M-5.77 3.59 C-6.89 2.78, -7.86 1.89, -8.79 0.96 M-2.39 1.23 C-2.63 1.04, -2.84 0.84, -3.14 0.57 M-2.39 1.23 C-2.58 1.08, -2.72 0.93, -3.14 0.57" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.4 -0.1 C-1.97 0.8, -6.58 4.71, -9.62 5.16 C-12.65 5.61, -20.23 3.43, -18.61 2.6 C-16.99 1.77, -3 0.63, 0.1 0.18 M0.4 -0.63 C-1.18 0.35, -6.59 4.98, -9.79 5.61 C-12.99 6.23, -20.47 3.92, -18.8 3.11 C-17.12 2.31, -2.75 1.29, 0.27 0.78" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 8 -->
    <g transform="translate({p8_x:.2}, {p8_y:.2})">
      <g stroke-linecap="round" transform="translate(98.42 299.76)">
        <path d="M-13.75 -14.61 C-13.75 -14.61, -13.75 -14.61, -13.75 -14.61 M-13.75 -14.61 C-13.75 -14.61, -13.75 -14.61, -13.75 -14.61 M-12.7 -9.72 C-12.09 -10.39, -11.5 -11.03, -10.74 -11.98 M-12.7 -9.72 C-12.27 -10.14, -11.79 -10.74, -10.74 -11.98 M-11 -5.59 C-10.11 -6.67, -9.2 -7.69, -8.37 -8.6 M-11 -5.59 C-10.12 -6.59, -9.36 -7.48, -8.37 -8.6 M-7.32 -3.72 C-6.79 -4.36, -6.16 -4.98, -5.35 -5.98 M-7.32 -3.72 C-6.79 -4.32, -6.25 -4.85, -5.35 -5.98 M-3.65 -1.85 C-3.45 -2.03, -3.3 -2.23, -2.99 -2.6 M-3.65 -1.85 C-3.43 -2.11, -3.18 -2.37, -2.99 -2.6 M-11.23 -5.37 C-11.23 -5.37, -11.23 -5.37, -11.23 -5.37 M-11.23 -5.37 C-11.23 -5.37, -11.23 -5.37, -11.23 -5.37 M0.45 -0.52 C-4.25 -5.3, -8.05 -7.66, -13.89 -12.98 M0.45 -0.52 C-5.29 -5.03, -10.51 -10.49, -13.89 -12.98" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M0.5 -0.49 C-1.24 -1.38, -8.46 -3.09, -10.8 -5.43 C-13.15 -7.77, -15.36 -15.42, -13.56 -14.53 C-11.77 -13.64, -2.35 -2.59, -0.03 -0.11 M0.09 0.45 C-1.66 -0.35, -8.75 -2.16, -11.08 -4.82 C-13.4 -7.47, -15.71 -16.36, -13.86 -15.5 C-12 -14.64, -2.22 -2.36, 0.07 0.34" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 9 -->
    <g transform="translate({p9_x:.2}, {p9_y:.2})">
      <g stroke-linecap="round" transform="translate(100.66 283.08)">
        <path d="M0.48 -16.81 C0.48 -16.81, 0.48 -16.81, 0.48 -16.81 M0.48 -16.81 C0.48 -16.81, 0.48 -16.81, 0.48 -16.81 M-2.4 -7.39 C-1.68 -8.15, -1.48 -8.67, 0.22 -10.41 M-2.4 -7.39 C-1.81 -8.05, -1.28 -8.6, 0.22 -10.41 M-0.7 -3.26 C-0.54 -3.44, -0.4 -3.55, -0.04 -4.01 M-0.7 -3.26 C-0.55 -3.42, -0.41 -3.58, -0.04 -4.01 M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M0.36 -4.99 C-0.58 -5.74, -1.41 -6.66, -2.66 -7.61 M0.36 -4.99 C-0.64 -5.79, -1.67 -6.64, -2.66 -7.61 M-0.03 -10.63 C-0.46 -10.97, -0.82 -11.26, -1.54 -11.94 M-0.03 -10.63 C-0.53 -11.1, -1 -11.5, -1.54 -11.94 M0.33 -15.62 C0.33 -15.62, 0.33 -15.62, 0.33 -15.62 M0.33 -15.62 C0.33 -15.62, 0.33 -15.62, 0.33 -15.62" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M0.31 -0.16 C-0.25 -1.47, -2.82 -5.59, -2.83 -8.34 C-2.85 -11.09, -0.3 -18.11, 0.23 -16.66 C0.76 -15.21, 0.38 -2.49, 0.35 0.35 M-0.2 -0.72 C-0.86 -2.16, -3.22 -6.64, -3.21 -9.21 C-3.2 -11.77, -0.77 -17.54, -0.13 -16.11 C0.51 -14.68, 0.72 -3.44, 0.64 -0.63" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 10 -->
    <g transform="translate({p10_x:.2}, {p10_y:.2})">
      <g stroke-linecap="round" transform="translate(116.42 274.93)">
        <path d="M0.42 -14.21 C0.42 -14.21, 0.42 -14.21, 0.42 -14.21 M0.42 -14.21 C0.42 -14.21, 0.42 -14.21, 0.42 -14.21 M-1.15 -6.3 C-0.41 -7.48, 0.53 -8.58, 2.79 -10.83 M-1.15 -6.3 C0.45 -8, 1.84 -9.87, 2.79 -10.83 M-0.1 -1.41 C0.08 -1.57, 0.2 -1.76, 0.56 -2.17 M-0.1 -1.41 C0.04 -1.58, 0.21 -1.75, 0.56 -2.17 M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M1.11 -4.33 C0.26 -5.21, -0.77 -6.11, -1.9 -6.96 M1.11 -4.33 C0.05 -5.14, -0.96 -6.02, -1.9 -6.96 M2.23 -8.66 C1.31 -9.37, 0.51 -10.22, -0.79 -11.29 M2.23 -8.66 C1.26 -9.57, 0.24 -10.41, -0.79 -11.29 M3.34 -12.99 C3.01 -13.53, 2.5 -13.87, 1.08 -14.96 M3.34 -12.99 C2.59 -13.71, 1.76 -14.36, 1.08 -14.96" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M0.1 0.18 C-0.39 -1.3, -3.33 -6.27, -2.66 -9.04 C-1.98 -11.81, 3.71 -18.03, 4.16 -16.46 C4.6 -14.89, 0.77 -2.44, 0.02 0.37 M-0.51 -0.2 C-1.11 -1.58, -3.86 -5.54, -3.11 -8.4 C-2.36 -11.25, 3.45 -18.65, 3.99 -17.35 C4.53 -16.05, 0.74 -3.62, 0.14 -0.6" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 11 -->
    <g transform="translate({p11_x:.2}, {p11_y:.2})">
      <g stroke-linecap="round" transform="translate(161.61 292.80)">
        <path d="M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M3.67 1.87 C4 1.35, 4.73 0.9, 5.64 -0.39 M3.67 1.87 C4.16 1.24, 4.74 0.61, 5.64 -0.39 M8.01 2.98 C8.49 2.37, 9.15 1.5, 10.63 -0.03 M8.01 2.98 C8.8 2.12, 9.47 1.32, 10.63 -0.03 M11.68 4.85 C12.18 4.32, 12.64 3.8, 12.99 3.34 M11.68 4.85 C12.14 4.37, 12.6 3.82, 12.99 3.34 M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M11.68 4.85 C10.02 3.29, 8.27 1.75, 5.64 -0.39 M11.68 4.85 C10.36 3.69, 8.99 2.74, 5.64 -0.39" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M-0.03 -0.11 C1.7 -0.11, 8.07 -0.91, 10.49 0.16 C12.9 1.22, 16.28 6.25, 14.47 6.28 C12.65 6.32, 2.08 1.42, -0.4 0.38 M-0.71 -0.64 C0.97 -0.81, 7.76 -1.63, 10.23 -0.63 C12.71 0.38, 15.91 5.4, 14.13 5.41 C12.34 5.41, 1.8 0.28, -0.5 -0.59" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>

    <!-- Pétala 12 -->
    <g transform="translate({p12_x:.2}, {p12_y:.2})">
      <g stroke-linecap="round" transform="translate(156.49 282.95)">
        <path d="M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M5.64 -0.39 C7.06 -1.53, 7.81 -2.83, 9.58 -4.92 M5.64 -0.39 C7.02 -1.99, 8.43 -3.66, 9.58 -4.92 M11.94 -1.54 C12.54 -2.35, 13.33 -3.18, 13.91 -3.81 M11.94 -1.54 C12.52 -2.2, 13.11 -2.86, 13.91 -3.81 M0 0 C0 0, 0 0, 0 0 M0 0 C0 0, 0 0, 0 0 M5.64 -0.39 C5.06 -0.98, 4.44 -1.58, 3.38 -2.36 M5.64 -0.39 C4.81 -1.14, 3.98 -1.85, 3.38 -2.36 M10.53 -1.45 C9.35 -2.57, 7.81 -3.58, 6.76 -4.73 M10.53 -1.45 C9.46 -2.24, 8.69 -3.01, 6.76 -4.73 M16.17 -1.84 C15.54 -2.47, 14.43 -3.01, 12.4 -5.12 M16.17 -1.84 C15.14 -2.88, 13.88 -3.75, 12.4 -5.12" stroke="{stroke_amber}" stroke-width="0.5" fill="none" />
        <path d="M0.35 0.35 C1.76 -0.51, 5.81 -4.93, 8.42 -5.28 C11.03 -5.62, 17.49 -2.61, 16.02 -1.72 C14.55 -0.84, 2.17 -0.29, -0.42 0.03 M-0.14 0.06 C1.2 -0.95, 5.12 -5.61, 8 -6.05 C10.88 -6.49, 18.55 -3.69, 17.13 -2.59 C15.71 -1.49, 2.32 0.04, -0.52 0.55" stroke="{stroke_dark}" stroke-width="1" fill="none" />
      </g>
    </g>
  </g>
</svg>"##,
        WIDTH = WIDTH,
        HEIGHT = HEIGHT,
        stroke_amber = stroke_amber,
        stroke_dark = stroke_dark,
        p1_x = p1_x, p1_y = p1_y,
        p2_x = p2_x, p2_y = p2_y,
        p3_x = p3_x, p3_y = p3_y,
        p4_x = p4_x, p4_y = p4_y,
        p5_x = p5_x, p5_y = p5_y,
        p6_x = p6_x, p6_y = p6_y,
        p7_x = p7_x, p7_y = p7_y,
        p8_x = p8_x, p8_y = p8_y,
        p9_x = p9_x, p9_y = p9_y,
        p10_x = p10_x, p10_y = p10_y,
        p11_x = p11_x, p11_y = p11_y,
        p12_x = p12_x, p12_y = p12_y,
    )
}

fn main() {
    println!("=======================================================");
    println!("   COPERNICO — NATIVE WIN32 OVERLAY COM SVG REAL       ");
    println!("=======================================================");
    println!("- Renderizando o SVG exato do CopernicoSun.tsx");
    println!("- 12 pétalas com blooming dinâmico & curvas Bézier");
    println!("- Etiqueta com texto nítido ('Ouvindo...', 'Falando...')");
    println!("- 100% Win32 DWM nativo (Zero WebView2, zero tela branca)");
    println!("- Controles:");
    println!("    [Clique]    -> Alterna estado (Ouvindo / Pensando / Falando)");
    println!("    [Arrastar]  -> Move pela tela");
    println!("    [Espaco]    -> Alterna estado");
    println!("    [1, 2, 3]   -> 1: Falando | 2: Ouvindo | 3: Pensando");
    println!("    [4, 5, 6]   -> 4: 60 FPS  | 5: 120 FPS | 6: 180 FPS (Padrão)");
    println!("    [0]         -> Desbloqueia FPS (Máximo da CPU)");
    println!("    [Esc]       -> Sair da demonstração");
    println!("=======================================================");

    // Carrega o banco de fontes do sistema para renderizar textos SVG
    let mut fontdb = fontdb::Database::new();
    fontdb.load_system_fonts();
    let opt = usvg::Options {
        fontdb: Arc::new(fontdb),
        ..Default::default()
    };

    unsafe {
        timeBeginPeriod(1);
        let instance = GetModuleHandleW(null_mut());
        let class_name: Vec<u16> = "CopernicoNativeSvgOverlay\0".encode_utf16().collect();

        let wnd_class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: 0 as HICON,
            hCursor: 0 as HCURSOR,
            hbrBackground: 0 as HBRUSH,
            lpszMenuName: null_mut(),
            lpszClassName: class_name.as_ptr(),
        };

        RegisterClassW(&wnd_class);

        let ex_style = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        let style = WS_POPUP;

        let init_x = CURRENT_POS_X.load(Ordering::Relaxed);
        let init_y = CURRENT_POS_Y.load(Ordering::Relaxed);

        let hwnd = CreateWindowExW(
            ex_style,
            class_name.as_ptr(),
            null_mut(),
            style,
            init_x,
            init_y,
            WIDTH,
            HEIGHT,
            0 as HWND,
            0 as _,
            instance,
            null_mut(),
        );

        if hwnd == 0 as HWND {
            eprintln!("[ERRO] Falha ao criar janela nativa Win32.");
            return;
        }

        ShowWindow(hwnd, SW_SHOW);

        let screen_dc = 0 as HDC;
        let mem_dc = CreateCompatibleDC(screen_dc);

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: WIDTH,
                biHeight: -HEIGHT, // Top-down DIB
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows_sys::Win32::Graphics::Gdi::RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };

        let mut bits_ptr: *mut u32 = null_mut();
        let hbitmap = CreateDIBSection(
            mem_dc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits_ptr as *mut *mut u32 as *mut *mut _,
            0 as _,
            0,
        );

        SelectObject(mem_dc, hbitmap);

        // Thread emulando a captura contínua de áudio do Rust (CPAL / Sidecar / Rodio)
        std::thread::spawn(|| {
            let audio_start = Instant::now();
            loop {
                let elapsed = audio_start.elapsed().as_secs_f32();
                let mode = get_current_mode();
                let simulated_rms = match mode {
                    OverlayMode::Speaking => {
                        // Formantes acústicos de fala humana (modulação rica)
                        let f1 = (elapsed * 9.0).sin().abs() * 0.45;
                        let f2 = (elapsed * 16.0).cos().abs() * 0.35;
                        let f3 = (elapsed * 4.0).sin().abs() * 0.20;
                        (f1 + f2 + f3).clamp(0.15, 0.95)
                    }
                    OverlayMode::Listening => {
                        // Simula ciclo realista: 3.5s silêncio (< 0.02) seguido de 4.5s fala ativa do usuário
                        let cycle = elapsed % 8.0;
                        if cycle < 3.5 {
                            0.005 // Silêncio absoluto abaixo do noise floor (repouso 0 deg/s)
                        } else {
                            // Fala acústica variada do usuário
                            let speech = (elapsed * 7.0).sin().abs() * 0.6 + (elapsed * 13.0).cos().abs() * 0.3;
                            0.02 + speech * 0.08
                        }
                    }
                    OverlayMode::Processing => {
                        // Pulso de computação rítmico
                        ((elapsed * 4.0).sin() * 0.5 + 0.5) * 0.30 + 0.08
                    }
                };
                write_audio_rms(simulated_rms);
                // O microfone/TTS real atualiza a cada ~20ms (50 Hz)
                std::thread::sleep(Duration::from_millis(20));
            }
        });

        println!("[PoC] Pré-processando vetores na RAM para eliminar o gargalo de XML parsing...");
        let static_trees: Vec<usvg::Tree> = vec![
            usvg::Tree::from_str(&generate_static_svg(OverlayMode::Speaking), &opt).unwrap(),
            usvg::Tree::from_str(&generate_static_svg(OverlayMode::Listening), &opt).unwrap(),
            usvg::Tree::from_str(&generate_static_svg(OverlayMode::Processing), &opt).unwrap(),
        ];

        const VOL_STEPS: usize = 32;
        let mut petal_trees: Vec<Vec<usvg::Tree>> = Vec::with_capacity(3);
        for m in 0..3 {
            let mode = OverlayMode::from_u8(m);
            let mut list = Vec::with_capacity(VOL_STEPS);
            for s in 0..VOL_STEPS {
                let v = (s as f32) / ((VOL_STEPS - 1) as f32);
                let svg = generate_petals_svg(mode, v);
                list.push(usvg::Tree::from_str(&svg, &opt).unwrap());
            }
            petal_trees.push(list);
        }
        println!("[OK] Vetores cacheados na RAM! Tempo de parse por quadro: 0 µs.");

        let mut msg: MSG = std::mem::zeroed();
        let mut last_frame_time = Instant::now();
        let mut last_fps_report = Instant::now();
        let mut frames = 0;
        let mut current_vol: f32 = 0.0;
        let mut rotation_deg: f32 = 0.0;
        let mut pixmap = Pixmap::new(WIDTH as u32, HEIGHT as u32).unwrap();

        let init_target_fps = TARGET_FPS.load(Ordering::Relaxed);
        println!("[OK] Janela do Sol criada em ({}, {}). Renderizando SVG a {} FPS...", init_x, init_y, init_target_fps);

        loop {
            let frame_start = Instant::now();
            let dt = last_frame_time.elapsed().as_secs_f32().clamp(0.001, 0.1);
            last_frame_time = Instant::now();

            while PeekMessageW(&mut msg, 0 as HWND, 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    break;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if msg.message == WM_QUIT {
                break;
            }

            let mode = get_current_mode();

            // 1. Leitura atômica do áudio da memória (zero latência, sem IPC)
            let raw_rms = read_audio_rms();
            let target_vol = match mode {
                OverlayMode::Speaking => raw_rms,
                OverlayMode::Listening => {
                    // Silêncio estrito abaixo de 0.02 (noise floor).
                    // Zero respiração artificial que force giro contínuo no silêncio.
                    // Acima de 0.02, resposta estritamente acoplada à voz do usuário.
                    if raw_rms < 0.02 {
                        0.0
                    } else {
                        ((raw_rms - 0.02) * 10.5).clamp(0.0, 1.0)
                    }
                }
                OverlayMode::Processing => raw_rms,
            };

            // 2. Interpolação contínua (ataque rápido de voz, desaceleração com inércia orgânica)
            let lerp_speed = if target_vol > current_vol { 16.0 } else { 9.0 };
            let lerp_factor = 1.0 - (-lerp_speed * dt).exp();
            current_vol += (target_vol - current_vol) * lerp_factor;

            // Ponto de repouso absoluto no silêncio: elimina qualquer micro-drift residual
            if target_vol == 0.0 && current_vol < 0.002 {
                current_vol = 0.0;
            }

            // 3. Rotação dinâmica acoplada estritamente à voz (0 deg/s no silêncio absoluto)
            let clamped_vol = current_vol.clamp(0.0, 1.0);
            let rot_speed = match mode {
                OverlayMode::Speaking => 35.0 + clamped_vol * 180.0, // Giro expressivo com a voz
                OverlayMode::Listening => clamped_vol * 160.0,        // 0 deg/s no silêncio, acelerando estritamente com a voz
                OverlayMode::Processing => 55.0,                     // Giro ritmado constante
            };
            rotation_deg = (rotation_deg + rot_speed * dt) % 360.0;

            // 4. Renderiza em 2 camadas compondo direto na memória (Zero parsing!)
            let t0 = Instant::now();
            let vol_idx = ((current_vol.clamp(0.0, 1.0) * (VOL_STEPS - 1) as f32).round() as usize).min(VOL_STEPS - 1);
            let static_tree = &static_trees[mode as usize];
            let petals_tree = &petal_trees[mode as usize][vol_idx];

            pixmap.fill(resvg::tiny_skia::Color::TRANSPARENT);

            // 4.1. Camada estática (Glow + Núcleo Central Imóvel + Pílula)
            resvg::render(static_tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());

            // 4.2. Camada dinâmica (12 Pétalas girando e florescendo)
            let rot_transform = rotate_around(rotation_deg, 68.0, 52.0);
            resvg::render(petals_tree, rot_transform, &mut pixmap.as_mut());
            let t1 = Instant::now();

            // Converte RGBA pré-multiplicado do resvg para BGRA 32 bits do Windows DWM
            let rgba_bytes = pixmap.data();
            let dst_pixels = std::slice::from_raw_parts_mut(bits_ptr, (WIDTH * HEIGHT) as usize);
            for i in 0..(WIDTH * HEIGHT) as usize {
                let r = rgba_bytes[i * 4];
                let g = rgba_bytes[i * 4 + 1];
                let b = rgba_bytes[i * 4 + 2];
                let a = rgba_bytes[i * 4 + 3];
                dst_pixels[i] = ((a as u32) << 24) | ((r as u32) << 16) | ((g as u32) << 8) | (b as u32);
            }
            let t2 = Instant::now();

            let cur_x = CURRENT_POS_X.load(Ordering::Relaxed);
            let cur_y = CURRENT_POS_Y.load(Ordering::Relaxed);

            let pt_src = POINT { x: 0, y: 0 };
            let pt_dst = POINT { x: cur_x, y: cur_y };
            let size = SIZE { cx: WIDTH, cy: HEIGHT };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };

            UpdateLayeredWindow(
                hwnd,
                0 as HDC,
                &pt_dst,
                &size,
                mem_dc,
                &pt_src,
                0,
                &blend,
                ULW_ALPHA,
            );
            let t3 = Instant::now();

            frames += 1;
            if last_fps_report.elapsed() >= Duration::from_secs(2) {
                let fps = (frames as f32) / last_fps_report.elapsed().as_secs_f32();
                let target_fps = TARGET_FPS.load(Ordering::Relaxed);
                let meta_str = if target_fps > 0 { format!("{} FPS", target_fps) } else { "Unlocked".to_string() };
                let render_us = t1.duration_since(t0).as_micros();
                let copy_us = t2.duration_since(t1).as_micros();
                let dwm_us = t3.duration_since(t2).as_micros();
                println!(
                    "[PoC SVG] Modo: {} | {:.1} FPS (Alvo: {}) | Render: {}µs | Copy: {}µs | DWM: {}µs",
                    mode.name(),
                    fps,
                    meta_str,
                    render_us,
                    copy_us,
                    dwm_us
                );
                frames = 0;
                last_fps_report = Instant::now();
            }

            // 5. Throttling adaptativo de precisão (Suporte a 60, 120, 180 FPS ou Unlocked)
            let target_fps = TARGET_FPS.load(Ordering::Relaxed);
            if let Some(target_frame_micros) = 1_000_000u64.checked_div(target_fps as u64) {
                let target_frame_duration = Duration::from_micros(target_frame_micros);
                while let Some(remaining) = target_frame_duration.checked_sub(frame_start.elapsed()) {
                    if remaining == Duration::ZERO {
                        break;
                    }
                    if remaining > Duration::from_millis(2) {
                        std::thread::sleep(Duration::from_millis(1));
                    } else {
                        std::hint::spin_loop();
                    }
                }
            }
        }

        timeEndPeriod(1);
        DeleteObject(hbitmap);
        DeleteDC(mem_dc);
        println!("[PoC] Encerrado.");
    }
}
