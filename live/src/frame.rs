//! Frames (RULES.md D56): each a message's JSON, its length first, four
//! bytes big-endian; at most 16 MiB, a frame past it refused unread.

use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::{Result, failed, refused};

/// The longest frame, in bytes.
pub const MAX_FRAME: u32 = 16 * 1024 * 1024;

/// Writes `message` to `to`, and flushes it.
///
/// # Errors
///
/// Of a message past `limit` bytes, or a stream that fails.
pub async fn write<W: AsyncWrite + Unpin, T: Serialize>(to: &mut W, message: &T, limit: u32) -> Result<()> {
    let bytes = serde_json::to_vec(message).map_err(|e| failed("a frame", e))?;
    let length = u32::try_from(bytes.len()).ok().filter(|n| *n <= limit).ok_or_else(|| refused("a frame is too long to send"))?;
    to.write_all(&length.to_be_bytes()).await.map_err(|e| failed("the session's stream", e))?;
    to.write_all(&bytes).await.map_err(|e| failed("the session's stream", e))?;
    to.flush().await.map_err(|e| failed("the session's stream", e))
}

/// The next message of `from`; none where the stream ends before a frame.
///
/// # Errors
///
/// Of a frame past `limit` bytes, a stream that fails or ends within a
/// frame, or JSON that is not a message.
pub async fn read<R: AsyncRead + Unpin, T: DeserializeOwned>(from: &mut R, limit: u32) -> Result<Option<T>> {
    let mut head = [0u8; 4];
    match from.read_exact(&mut head).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(failed("the session's stream", e)),
    }
    let length = u32::from_be_bytes(head);
    if length > limit {
        return Err(refused("a frame is too long to read"));
    }
    let mut body = vec![0u8; usize::try_from(length).unwrap_or(0)];
    from.read_exact(&mut body).await.map_err(|e| failed("the session's stream", e))?;
    serde_json::from_slice(&body).map(Some).map_err(|e| failed("a frame", e))
}

#[cfg(test)]
mod tests {
    use super::{read, write};

    /// [DESIGN] D56: a frame is read as written; the stream's end before a
    /// frame is none; a frame past its limit, or cut short, is refused.
    #[tokio::test]
    async fn frames_are_read_as_written() {
        let (mut sent, mut got) = tokio::io::duplex(1024);
        write(&mut sent, &serde_json::json!({"kind": "hand", "up": true}), 100).await.unwrap();
        let read_back: Option<serde_json::Value> = read(&mut got, 100).await.unwrap();
        assert_eq!(read_back, Some(serde_json::json!({"kind": "hand", "up": true})));
        assert!(write(&mut sent, &"x".repeat(200), 100).await.unwrap_err().0.contains("too long"));
        write(&mut sent, &"y".repeat(50), 100).await.unwrap();
        assert!(read::<_, String>(&mut got, 10).await.unwrap_err().0.contains("too long"));
        drop(sent);
        let (mut cut, mut short) = tokio::io::duplex(64);
        tokio::io::AsyncWriteExt::write_all(&mut cut, &[0, 0, 0, 9, b'1']).await.unwrap();
        drop(cut);
        assert!(read::<_, u32>(&mut short, 100).await.is_err());
        let (closed, mut ended) = tokio::io::duplex(64);
        drop(closed);
        assert_eq!(read::<_, u32>(&mut ended, 100).await.unwrap(), None);
    }
}
