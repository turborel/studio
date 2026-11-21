//! Base64 of the URL's alphabet, with no padding (RFC 4648 §5), for an
//! invitation's code, which is pasted and sent in a link.

/// The alphabet.
const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// The shifts of a group's four characters, from its 24 bits.
const SHIFTS: [u32; 4] = [18, 12, 6, 0];

/// `bytes`, encoded.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().zip([16u32, 8, 0]).fold(0u32, |n, (&b, shift)| n | (u32::from(b) << shift));
        for shift in SHIFTS.iter().take(chunk.len().saturating_add(1)) {
            let index = usize::try_from((n >> shift) & 63).unwrap_or(0);
            out.push(char::from(ALPHABET.get(index).copied().unwrap_or(b'A')));
        }
    }
    out
}

/// The value of the character `c`, if it is of the alphabet.
fn value(c: u8) -> Option<u32> {
    ALPHABET.iter().position(|&a| a == c).and_then(|p| u32::try_from(p).ok())
}

/// The bytes of `text`; none if it is not of the alphabet, or of a length
/// no encoding has.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for chunk in text.as_bytes().chunks(4) {
        let kept = chunk.len().checked_sub(1).filter(|k| *k > 0)?;
        let mut n = 0u32;
        for (&c, shift) in chunk.iter().zip(SHIFTS) {
            n |= value(c)? << shift;
        }
        out.extend(n.to_be_bytes().iter().skip(1).take(kept));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::{decode, encode};

    /// [DESIGN] D56: RFC 4648's examples, unpadded, and their inverse.
    #[test]
    fn the_rfcs_examples_round_trip() {
        for (plain, coded) in
            [("", ""), ("f", "Zg"), ("fo", "Zm8"), ("foo", "Zm9v"), ("foob", "Zm9vYg"), ("fooba", "Zm9vYmE"), ("foobar", "Zm9vYmFy")]
        {
            assert_eq!(encode(plain.as_bytes()), coded);
            assert_eq!(decode(coded).as_deref(), Some(plain.as_bytes()));
        }
        assert_eq!(encode(&[0xfb, 0xff]), "-_8");
        assert_eq!(decode("-_8"), Some(vec![0xfb, 0xff]));
        assert_eq!(decode("Z"), None);
        assert_eq!(decode("Zm9v!"), None);
    }
}
