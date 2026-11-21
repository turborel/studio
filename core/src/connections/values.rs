//! Values between the grid and the server (`[CLIENT Large objects]`,
//! RULES.md D39, D41): a large object that came by its locator read whole
//! for a viewer, a chunk at a time, at most `MAX_VALUE_BYTES` of it, a
//! character one as text, a binary one as Base64; and a parameter's value
//! of the text the grid writes, a binary one in hexadecimal, a long large
//! object written to the server first.

use serde::Serialize;
use turborel::value::lob::{Lob, LobKind};
use turborel::value::{Binary, DataType, Value};

use crate::error::{Result, StudioError};
pub use turborel_client::export::ExportFormat;

/// The most octets of a value read for a viewer.
pub const MAX_VALUE_BYTES: u64 = 16 * 1024 * 1024;
/// The octets one read of a large object asks for: the client's chunk.
pub const CHUNK_BYTES: u64 = 256 * 1024;

/// A value read for a viewer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ValueRead {
    /// A character large object's text.
    Text {
        /// Its text, as far as it was read.
        text: String,
        /// Its length, in octets.
        octets: u64,
        /// Whether it was cut at `MAX_VALUE_BYTES`.
        cut: bool,
    },
    /// A binary large object's octets.
    Binary {
        /// Its octets, as far as they were read, in Base64.
        base64: String,
        /// Its length, in octets.
        octets: u64,
        /// Whether it was cut at `MAX_VALUE_BYTES`.
        cut: bool,
    },
}

/// The octets of `lob` to read: all, or `MAX_VALUE_BYTES`.
pub fn wanted(lob: &Lob) -> u64 {
    lob.octets().min(MAX_VALUE_BYTES)
}

/// `bytes` of `lob` as a viewer is given them.
pub fn read(lob: &Lob, bytes: &[u8]) -> ValueRead {
    let octets = lob.octets();
    let cut = octets > MAX_VALUE_BYTES;
    match lob.kind() {
        LobKind::Character => ValueRead::Text { text: String::from_utf8_lossy(bytes).into_owned(), octets, cut },
        LobKind::Binary => ValueRead::Binary { base64: base64(bytes), octets, cut },
    }
}

/// The longest value of a large object sent whole as a parameter; a longer
/// one is written by `create_lob` (`[CLIENT Large objects]`).
pub const INLINE_BYTES: usize = 64 * 1024;

/// The octets of `hex`, a binary value as the grid shows it: SQLSTATE
/// 22018 if it is not hexadecimal digits in pairs.
///
/// # Errors
///
/// SQLSTATE 22018 for text that is not.
pub fn octets_of_hex(hex: &str) -> Result<Vec<u8>> {
    let digits = hex.trim();
    let bad = || StudioError::new(-301, "22018", format!("[DESIGN] a binary value is written in hexadecimal digits, in pairs: {digits}"));
    if !digits.len().is_multiple_of(2) {
        return Err(bad());
    }
    digits
        .as_bytes()
        .chunks(2)
        .map(|pair| std::str::from_utf8(pair).ok().and_then(|p| u8::from_str_radix(p, 16).ok()).ok_or_else(bad))
        .collect()
}

/// The value of a parameter of type `data_type` written `text`: a binary
/// string's as hexadecimal digits; a large object's longer than
/// `INLINE_BYTES` written to the server first by `create_lob`, `write`
/// writing its octets; any other cast from text, as CAST would.
///
/// # Errors
///
/// SQLSTATE 22018 for a binary value not hexadecimal; the cast's; the
/// large object's writing.
pub fn parameter_value(data_type: &DataType, text: &str, write: &mut dyn FnMut(LobKind, &[u8]) -> Result<Lob>) -> Result<Value> {
    let value = match data_type {
        DataType::Binary { .. } | DataType::VarBinary { .. } => Value::Binary(Binary::new(octets_of_hex(text)?)),
        DataType::Lob { kind, .. } => {
            let octets = match kind {
                LobKind::Character => text.as_bytes().to_vec(),
                LobKind::Binary => octets_of_hex(text)?,
            };
            if octets.len() > INLINE_BYTES {
                return Ok(Value::Lob(write(*kind, &octets)?));
            }
            match kind {
                LobKind::Character => Value::Char(text.to_owned()),
                LobKind::Binary => Value::Binary(Binary::new(octets)),
            }
        }
        _ => Value::Char(text.to_owned()),
    };
    turborel::value::cast(value, data_type).map_err(StudioError::from)
}

/// The Base64 alphabet [RFC 4648 §4].
const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `bytes` in Base64, padded [RFC 4648 §4].
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3).saturating_mul(4));
    for chunk in bytes.chunks(3) {
        let [a, b, c] = [0, 1, 2].map(|i| chunk.get(i).copied().unwrap_or(0));
        let n = (u32::from(a) << 16) | (u32::from(b) << 8) | u32::from(c);
        let sextet = |shift: u32| char::from(ALPHABET.get(usize::try_from((n >> shift) & 0x3F).unwrap_or(0)).copied().unwrap_or(b'A'));
        out.push(sextet(18));
        out.push(sextet(12));
        out.push(if chunk.len() > 1 { sextet(6) } else { '=' });
        out.push(if chunk.len() > 2 { sextet(0) } else { '=' });
    }
    out
}

/// The octets of `text`, padded Base64 [RFC 4648 §4]: SQLCODE -910 if it
/// is not.
///
/// # Errors
///
/// SQLCODE -910 for text that is not padded Base64.
pub fn from_base64(text: &str) -> Result<Vec<u8>> {
    let bad = || StudioError::misuse("[DESIGN] the octets are not Base64");
    let digit = |c: u8| ALPHABET.iter().position(|&a| a == c).and_then(|p| u32::try_from(p).ok());
    if !text.len().is_multiple_of(4) {
        return Err(bad());
    }
    let mut out = Vec::with_capacity(text.len());
    for chunk in text.as_bytes().chunks(4) {
        let pads = chunk.iter().rev().take_while(|&&c| c == b'=').count();
        let kept = chunk.len().saturating_sub(pads);
        let mut n: u32 = 0;
        for (i, &c) in chunk.iter().enumerate() {
            let value = if i >= kept { Some(0) } else { digit(c) };
            n = (n << 6) | value.ok_or_else(bad)?;
        }
        let [_, a, b, c] = n.to_be_bytes();
        let octets = [a, b, c];
        out.extend_from_slice(octets.get(..kept.saturating_sub(1)).ok_or_else(bad)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use turborel::value::lob::{Lob, LobKind};

    use turborel::value::{CharUnits, DataType, Value};

    use super::{INLINE_BYTES, MAX_VALUE_BYTES, ValueRead, base64, from_base64, octets_of_hex, parameter_value, read, wanted};

    /// [DESIGN] D39: a large object is read whole up to 16 MiB, a
    /// character one as text, a binary one in Base64, a longer one cut and
    /// said to be.
    #[test]
    fn a_large_object_is_read_up_to_its_bound() {
        let text = Lob::of_locator(LobKind::Character, 7, (5, 5));
        assert_eq!(wanted(&text), 5);
        assert_eq!(read(&text, b"hello"), ValueRead::Text { text: "hello".to_owned(), octets: 5, cut: false });
        let long = Lob::of_locator(LobKind::Binary, 8, (MAX_VALUE_BYTES + 1, 0));
        assert_eq!(wanted(&long), MAX_VALUE_BYTES);
        assert_eq!(read(&long, b"fo"), ValueRead::Binary { base64: "Zm8=".to_owned(), octets: MAX_VALUE_BYTES + 1, cut: true });
    }

    /// [DESIGN] D41: a binary value is given in hexadecimal digits, in
    /// pairs, of either case; a large object longer than a row holds is
    /// written first, and one shorter sent whole.
    #[test]
    fn parameters_are_written_as_the_grid_writes_them() {
        assert_eq!(octets_of_hex(" deADbe ").unwrap(), [0xde, 0xad, 0xbe]);
        assert_eq!(octets_of_hex("abc").unwrap_err().sqlstate, "22018");
        assert_eq!(octets_of_hex("zz").unwrap_err().sqlstate, "22018");
        let mut written = Vec::new();
        let mut write = |kind: LobKind, octets: &[u8]| {
            written.push(octets.len());
            Ok(Lob::of_locator(kind, 1, (u64::try_from(octets.len()).unwrap(), 0)))
        };
        let varbinary = DataType::VarBinary { length: 4 };
        assert!(matches!(parameter_value(&varbinary, "0aff", &mut write).unwrap(), Value::Binary(b) if b.to_string() == "0AFF"));
        let blob = DataType::Lob { kind: LobKind::Binary, length: 1 << 20, units: CharUnits::Octets };
        assert!(matches!(parameter_value(&blob, "00", &mut write).unwrap(), Value::Lob(_)));
        let long = "ab".repeat(INLINE_BYTES + 1);
        assert!(matches!(parameter_value(&blob, &long, &mut write).unwrap(), Value::Lob(l) if l.locator() == Some(1)));
        assert_eq!(written, [INLINE_BYTES + 1]);
    }

    /// [DESIGN] D41: a character large object longer than a row holds is
    /// written first, and one shorter sent whole; another type's value
    /// cast from its text.
    #[test]
    fn a_long_character_value_is_written_first() {
        let mut written = Vec::new();
        let mut write = |kind: LobKind, octets: &[u8]| {
            written.push(octets.len());
            Ok(Lob::of_locator(kind, 1, (u64::try_from(octets.len()).unwrap(), 0)))
        };
        let clob = DataType::Lob { kind: LobKind::Character, length: 1 << 20, units: CharUnits::Characters };
        assert!(matches!(parameter_value(&clob, "short", &mut write).unwrap(), Value::Lob(l) if l.locator().is_none()));
        assert!(matches!(parameter_value(&clob, &"x".repeat(INLINE_BYTES + 1), &mut write).unwrap(), Value::Lob(_)));
        assert!(matches!(parameter_value(&DataType::Boolean, "TRUE", &mut write).unwrap(), Value::Bool(true)));
        assert_eq!(written, [INLINE_BYTES + 1]);
    }

    /// [DESIGN] D46: Base64 is read back as written, and text that is not
    /// padded Base64 refused.
    #[test]
    fn base64_is_read_back() {
        for plain in ["", "f", "fo", "foo", "foob", "fooba", "foobar"] {
            assert_eq!(from_base64(&base64(plain.as_bytes())).unwrap(), plain.as_bytes());
        }
        for bad in ["Zg=", "Z!==", "Zm9v!A=="] {
            assert!(from_base64(bad).is_err(), "{bad}");
        }
    }

    /// [DESIGN] D39: Base64 is written as RFC 4648's test vectors give it.
    #[test]
    fn base64_is_rfc_4648s() {
        for (plain, coded) in
            [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")]
        {
            assert_eq!(base64(plain.as_bytes()), coded);
        }
    }
}
