//! The manual's images made of the window's screenshots (RULES.md D60): a
//! screenshot decoded, cropped to what it shows, and written again as a
//! PNG compressed as far as it goes, losslessly; frames made a short
//! animated GIF by the `gif` crate (MIT or Apache-2.0), its colours
//! quantized each frame.

use std::io::Cursor;
use std::path::Path;

use crate::error::{Error, Result, fail};

/// An image's pixels: its width and height, and RGBA, row by row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pixels {
    /// Its width.
    pub width: u32,
    /// Its height.
    pub height: u32,
    /// Its pixels, four octets each.
    pub rgba: Vec<u8>,
}

/// The Base64 alphabet [RFC 4648 §4].
const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// The octets of `text`, Base64 [RFC 4648 §4], padded or not.
///
/// # Errors
///
/// Text that is not Base64.
pub fn from_base64(text: &str) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len());
    let (mut bits, mut held) = (0u32, 0u32);
    for c in text.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let Some(digit) = ALPHABET.iter().position(|&a| a == c) else { return fail("the screenshot is not Base64") };
        bits = (bits << 6) | u32::try_from(digit).unwrap_or(0);
        held = held.saturating_add(6);
        if held >= 8 {
            held = held.saturating_sub(8);
            out.push(u8::try_from((bits >> held) & 0xFF).unwrap_or(0));
        }
    }
    Ok(out)
}

/// The pixels of the PNG image `png`.
///
/// # Errors
///
/// An image that is not a PNG.
pub fn decode(png: &[u8]) -> Result<Pixels> {
    let mut decoder = png::Decoder::new(Cursor::new(png));
    decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().map_err(|e| Error(format!("the screenshot cannot be read: {e}")))?;
    let mut rgba = vec![0; reader.output_buffer_size().unwrap_or(0)];
    let info = reader.next_frame(&mut rgba).map_err(|e| Error(format!("the screenshot cannot be read: {e}")))?;
    rgba.truncate(info.buffer_size());
    // A grey image, as ImageMagick writes a display of few colours, made RGBA.
    if info.color_type == png::ColorType::GrayscaleAlpha {
        let rgba = rgba.chunks(2).flat_map(|p| {
            let (grey, alpha) = (p.first().copied().unwrap_or(0), p.get(1).copied().unwrap_or(255));
            [grey, grey, grey, alpha]
        });
        return Ok(Pixels { width: info.width, height: info.height, rgba: rgba.collect() });
    }
    if info.color_type != png::ColorType::Rgba {
        return fail(format!("the screenshot is {:?}, not RGBA", info.color_type));
    }
    Ok(Pixels { width: info.width, height: info.height, rgba })
}

/// The part of `image` at `(x, y)`, `width` by `height`, within it.
pub fn crop(image: &Pixels, (x, y, width, height): (u32, u32, u32, u32)) -> Pixels {
    let x = x.min(image.width);
    let y = y.min(image.height);
    let width = width.min(image.width.saturating_sub(x));
    let height = height.min(image.height.saturating_sub(y));
    let row = |r: u32| -> &[u8] {
        let pixel = u64::from(y.saturating_add(r)).saturating_mul(u64::from(image.width)).saturating_add(u64::from(x));
        let start = usize::try_from(pixel.saturating_mul(4)).unwrap_or(0);
        let end = start.saturating_add(usize::try_from(width).unwrap_or(0).saturating_mul(4));
        image.rgba.get(start..end).unwrap_or_default()
    };
    let rgba = (0..height).flat_map(|r| row(r).iter().copied()).collect();
    Pixels { width, height, rgba }
}

/// `images` one below another, `gap` pixels apart, on `background`: each
/// as wide as the widest, its own right filled with `background`.
pub fn stack(images: &[Pixels], gap: u32, background: [u8; 4]) -> Pixels {
    let width = images.iter().map(|i| i.width).max().unwrap_or(0);
    let mut rgba = Vec::new();
    let filled = |n: u32| background.iter().copied().cycle().take(usize::try_from(n).unwrap_or(0).saturating_mul(4)).collect::<Vec<u8>>();
    let mut height = 0u32;
    for (at, image) in images.iter().enumerate() {
        if at > 0 {
            rgba.extend(filled(width.saturating_mul(gap)));
            height = height.saturating_add(gap);
        }
        let stride = usize::try_from(image.width).unwrap_or(0).saturating_mul(4);
        for row in image.rgba.chunks(stride.max(1)) {
            rgba.extend_from_slice(row);
            rgba.extend(filled(width.saturating_sub(image.width)));
        }
        height = height.saturating_add(image.height);
    }
    Pixels { width, height, rgba }
}

/// The colour of `image`'s pixel at its top left, its background as a
/// window's edge shows it.
pub fn corner(image: &Pixels) -> [u8; 4] {
    let mut out = [0, 0, 0, 255];
    for (o, c) in out.iter_mut().zip(image.rgba.iter()) {
        *o = *c;
    }
    out
}

/// Writes `image` to `path` as a PNG, compressed as far as it goes,
/// losslessly, with no metadata, so the same pixels make the same file.
///
/// # Errors
///
/// The file cannot be written.
pub fn write_png(image: &Pixels, path: &Path) -> Result<()> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, image.width, image.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::High);
        let mut writer = encoder.write_header().map_err(|e| Error(format!("{}: {e}", path.display())))?;
        writer.write_image_data(&image.rgba).map_err(|e| Error(format!("{}: {e}", path.display())))?;
    }
    std::fs::write(path, out).map_err(|e| Error(format!("{}: {e}", path.display())))
}

/// The most bytes an animation may take, so the manual and the README load
/// fast (R-DOC-7).
pub const MAX_GIF_BYTES: u64 = 2 * 1024 * 1024;

/// Refuses an animation of `bytes` for `path` past `MAX_GIF_BYTES`.
fn bounded(bytes: usize, path: &Path) -> Result<()> {
    if u64::try_from(bytes).unwrap_or(u64::MAX) > MAX_GIF_BYTES {
        return fail(format!("{}: {bytes} bytes, more than an animation may take, {MAX_GIF_BYTES}", path.display()));
    }
    Ok(())
}

/// `frames` with each frame the same as the one before it merged into it,
/// its time added to that one's.
fn merged(frames: &[(Pixels, u16)]) -> Vec<(Pixels, u16)> {
    let mut out: Vec<(Pixels, u16)> = Vec::new();
    for (frame, hundredths) in frames {
        match out.last_mut() {
            Some((last, shown)) if last == frame => *shown = shown.saturating_add(*hundredths),
            _ => out.push((frame.clone(), *hundredths)),
        }
    }
    out
}

/// Writes `frames`, each shown for its hundredths of a second, to `path`
/// as an animated GIF that repeats, each frame's colours quantized, a
/// frame the same as the one before merged into it.
///
/// # Errors
///
/// No frame, frames of different sizes, a frame too large for a GIF, an
/// animation of more than `MAX_GIF_BYTES`, or a file that cannot be
/// written.
pub fn write_gif(frames: &[(Pixels, u16)], path: &Path) -> Result<()> {
    let frames = merged(frames);
    let Some((first, _)) = frames.first() else { return fail("an animation of no frame") };
    let too_large = || Error(format!("{}: a GIF is at most 65535 pixels a side", path.display()));
    let (width, height) = (u16::try_from(first.width).map_err(|_| too_large())?, u16::try_from(first.height).map_err(|_| too_large())?);
    let failed = |e: gif::EncodingError| Error(format!("{}: {e}", path.display()));
    let mut out = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut out, width, height, &[]).map_err(failed)?;
        encoder.set_repeat(gif::Repeat::Infinite).map_err(failed)?;
        for (frame, hundredths) in &frames {
            if (frame.width, frame.height) != (first.width, first.height) {
                return fail(format!("{}: the frames differ in size", path.display()));
            }
            let mut rgba = frame.rgba.clone();
            let mut made = gif::Frame::from_rgba_speed(width, height, &mut rgba, 10);
            made.delay = *hundredths;
            encoder.write_frame(&made).map_err(failed)?;
        }
    }
    bounded(out.len(), path)?;
    std::fs::write(path, out).map_err(|e| Error(format!("{}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::{Pixels, bounded, corner, crop, decode, from_base64, merged, stack, write_gif, write_png};

    /// [DESIGN] D60: Base64 is read, padded or not.
    #[test]
    fn base64_is_read() {
        assert_eq!(from_base64("TWFu").unwrap(), b"Man");
        assert_eq!(from_base64("TWE=").unwrap(), b"Ma");
        assert!(from_base64("T!").is_err());
    }

    /// [DESIGN] D60: an image is cropped, written as a PNG and read back
    /// the same, and frames make a GIF.
    #[test]
    fn an_image_is_cropped_and_written() {
        let rgba = (0..4 * 3 * 4).map(|i| u8::try_from(i).unwrap()).collect();
        let image = Pixels { width: 4, height: 3, rgba };
        let part = crop(&image, (1, 1, 2, 5));
        assert_eq!((part.width, part.height), (2, 2));
        assert_eq!(part.rgba.get(..4), image.rgba.get(20..24));
        let dir = std::env::temp_dir().join(format!("studio-images-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_png(&part, &dir.join("part.png")).unwrap();
        assert_eq!(decode(&std::fs::read(dir.join("part.png")).unwrap()).unwrap(), part);
        write_gif(&[(part.clone(), 50), (part, 100)], &dir.join("part.gif")).unwrap();
        assert!(std::fs::read(dir.join("part.gif")).unwrap().starts_with(b"GIF89a"));
        assert!(write_gif(&[], &dir.join("none.gif")).is_err());
        assert!(bounded(2 * 1024 * 1024, &dir.join("a.gif")).is_ok());
        assert!(bounded(2 * 1024 * 1024 + 1, &dir.join("a.gif")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// [DESIGN] D60: images are stacked, each as wide as the widest, the
    /// rest of a narrower one and the gaps of the background; frames the
    /// same in turn are merged, their times added.
    #[test]
    fn images_are_stacked_and_frames_merged() {
        let red = Pixels { width: 2, height: 1, rgba: vec![255, 0, 0, 255, 255, 0, 0, 255] };
        let blue = Pixels { width: 1, height: 1, rgba: vec![0, 0, 255, 255] };
        let both = stack(&[red.clone(), blue.clone()], 1, [9, 9, 9, 255]);
        assert_eq!((both.width, both.height), (2, 3));
        assert_eq!(both.rgba.get(8..16), Some(&[9, 9, 9, 255, 9, 9, 9, 255][..]));
        assert_eq!(both.rgba.get(16..24), Some(&[0, 0, 255, 255, 9, 9, 9, 255][..]));
        assert_eq!(corner(&red), [255, 0, 0, 255]);
        let frames = merged(&[(red.clone(), 10), (red.clone(), 20), (blue.clone(), 5), (red.clone(), 1)]);
        assert_eq!(frames.iter().map(|(_, h)| *h).collect::<Vec<_>>(), [30, 5, 1]);
    }
}
