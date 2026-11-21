//! A large object read whole for a viewer (`[CLIENT Large objects]`,
//! RULES.md D39): one that came by its locator, not in its row, read a
//! chunk at a time, at most `MAX_VALUE_BYTES` of it; a character one as
//! text, a binary one as Base64, which the webview shows as an image or
//! as octets.

use serde::Serialize;
use turborel::value::lob::{Lob, LobKind};
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

#[cfg(test)]
mod tests {
    use turborel::value::lob::{Lob, LobKind};

    use super::{MAX_VALUE_BYTES, ValueRead, base64, read, wanted};

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
