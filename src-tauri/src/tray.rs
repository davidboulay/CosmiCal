//! System-tray icon that shows today's date and a dot when a notification
//! (a pending invitation) is waiting. The icon is rendered on the fly so the
//! day number stays current and the dot appears/disappears live.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use chrono::{Datelike, Local};
use tauri::image::Image;
use tauri::AppHandle;
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Transform};

pub const TRAY_ID: &str = "cosmical-tray";
const FONT: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/tray-font.ttf"));
const SIZE: u32 = 64;

static APP: OnceLock<AppHandle> = OnceLock::new();
static PENDING: AtomicBool = AtomicBool::new(false);

/// Remember the app handle so background updates can reach the tray.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Set whether a notification is pending (toggles the dot) and refresh.
pub fn set_pending(pending: bool) {
    if PENDING.swap(pending, Ordering::Relaxed) != pending {
        refresh();
    }
}

/// Re-render the tray icon for today's date + current pending state. Tray
/// updates must run on the main (GTK) thread.
pub fn refresh() {
    let Some(app) = APP.get() else { return };
    let app = app.clone();
    let day = Local::now().day();
    let pending = PENDING.load(Ordering::Relaxed);
    let for_closure = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(tray) = for_closure.tray_by_id(TRAY_ID) {
            let _ = tray.set_icon(Some(render_day_icon(day, pending)));
        }
    });
}

/// Render a rounded-square icon with the day number, plus a red dot top-right
/// when a notification is pending.
pub fn render_day_icon(day: u32, pending: bool) -> Image<'static> {
    let mut pm = Pixmap::new(SIZE, SIZE).expect("pixmap");
    let s = SIZE as f32;

    // Rounded-square background in the app's accent red (#D33A30) — matches the
    // now-line and Today button.
    let pad = 4.0;
    if let Some(bg) = rounded_rect(pad, pad, s - 2.0 * pad, s - 2.0 * pad, 14.0) {
        let mut paint = Paint::default();
        paint.set_color_rgba8(0xd3, 0x3a, 0x30, 0xff);
        paint.anti_alias = true;
        pm.fill_path(&bg, &paint, FillRule::Winding, Transform::identity(), None);
    }

    // Day number, centered, white.
    draw_text_centered(&mut pm, &day.to_string(), 36.0, [0xff, 0xff, 0xff], s / 2.0, s / 2.0 + 1.0);

    // Pending dot (top-right): white with a thin red ring so it stands out
    // against the red background.
    if pending {
        let (cx, cy, r) = (s - 16.0, 16.0, 11.0);
        if let Some(ring) = circle(cx, cy, r) {
            let mut p = Paint::default();
            p.set_color_rgba8(0xd3, 0x3a, 0x30, 0xff);
            p.anti_alias = true;
            pm.fill_path(&ring, &p, FillRule::Winding, Transform::identity(), None);
        }
        if let Some(dot) = circle(cx, cy, r - 2.5) {
            let mut p = Paint::default();
            p.set_color_rgba8(0xff, 0xff, 0xff, 0xff);
            p.anti_alias = true;
            pm.fill_path(&dot, &p, FillRule::Winding, Transform::identity(), None);
        }
    }

    Image::new_owned(unpremultiply(pm.data()), SIZE, SIZE)
}

fn rounded_rect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.quad_to(x + w, y, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.quad_to(x + w, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.quad_to(x, y + h, x, y + h - r);
    pb.line_to(x, y + r);
    pb.quad_to(x, y, x + r, y);
    pb.close();
    pb.finish()
}

fn circle(cx: f32, cy: f32, r: f32) -> Option<tiny_skia::Path> {
    PathBuilder::from_circle(cx, cy, r)
}

/// Blit a centered string of glyph coverage onto the (premultiplied) pixmap.
fn draw_text_centered(pm: &mut Pixmap, text: &str, px: f32, color: [u8; 3], cx: f32, cy: f32) {
    let Ok(font) = FontRef::try_from_slice(FONT) else { return };
    let scale = PxScale::from(px);
    let scaled = font.as_scaled(scale);

    let mut cursor = 0.0;
    let mut outlines = Vec::new();
    for c in text.chars() {
        let id = scaled.glyph_id(c);
        let glyph = id.with_scale_and_position(scale, ab_glyph::point(cursor, 0.0));
        cursor += scaled.h_advance(id);
        if let Some(o) = font.outline_glyph(glyph) {
            outlines.push(o);
        }
    }
    if outlines.is_empty() {
        return;
    }

    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for o in &outlines {
        let b = o.px_bounds();
        min_x = min_x.min(b.min.x);
        min_y = min_y.min(b.min.y);
        max_x = max_x.max(b.max.x);
        max_y = max_y.max(b.max.y);
    }
    let off_x = cx - (min_x + (max_x - min_x) / 2.0);
    let off_y = cy - (min_y + (max_y - min_y) / 2.0);

    let w = pm.width() as i32;
    let h = pm.height() as i32;
    let data = pm.data_mut();
    for o in &outlines {
        let b = o.px_bounds();
        o.draw(|gx, gy, cov| {
            let x = (b.min.x + gx as f32 + off_x).round() as i32;
            let y = (b.min.y + gy as f32 + off_y).round() as i32;
            if x < 0 || y < 0 || x >= w || y >= h {
                return;
            }
            let i = ((y * w + x) * 4) as usize;
            blend_premul(&mut data[i..i + 4], color, cov);
        });
    }
}

/// Source-over blend of a straight-alpha color (with coverage) onto a
/// premultiplied destination pixel.
fn blend_premul(dst: &mut [u8], color: [u8; 3], cov: f32) {
    let a = cov.clamp(0.0, 1.0);
    let inv = 1.0 - a;
    for c in 0..3 {
        let src = color[c] as f32 * a;
        dst[c] = (src + dst[c] as f32 * inv).round().clamp(0.0, 255.0) as u8;
    }
    dst[3] = (a * 255.0 + dst[3] as f32 * inv).round().clamp(0.0, 255.0) as u8;
}

/// Convert tiny-skia's premultiplied RGBA to the straight RGBA Tauri expects.
fn unpremultiply(premul: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; premul.len()];
    for (i, px) in premul.chunks_exact(4).enumerate() {
        let a = px[3];
        let o = i * 4;
        if a == 0 {
            continue;
        }
        for c in 0..3 {
            out[o + c] = ((px[c] as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8;
        }
        out[o + 3] = a;
    }
    out
}
