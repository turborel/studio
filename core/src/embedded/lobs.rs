//! A row's large objects, as an embedded session gives them to a result
//! (RULES.md D59), as a server places them for its clients: each held
//! whole if at most `INLINE_BYTES` long, read now; else by a locator of
//! the session's, which keeps it readable until the transaction ends, so
//! a viewer reads it later as it reads a server's.

use turborel::db::Session;
use turborel::storage::Row;
use turborel::value::Value;
use turborel::value::lob::{Lob, LobKind};

use crate::connections::values::INLINE_BYTES;
use crate::error::Result;

/// `row`, each large object in it placed.
///
/// # Errors
///
/// Reading a large object's.
pub fn placed_row(session: &Session, row: Row) -> Result<Row> {
    if !row.iter().any(|v| matches!(v, Value::Lob(_))) {
        return Ok(row);
    }
    row.into_iter()
        .map(|v| match v {
            Value::Lob(l) => placed(session, l).map(Value::Lob),
            other => Ok(other),
        })
        .collect()
}

/// `l` held whole if at most `INLINE_BYTES` long, else by a locator.
fn placed(session: &Session, l: Lob) -> Result<Lob> {
    if l.inline().is_some() {
        return Ok(l);
    }
    if l.octets() <= u64::try_from(INLINE_BYTES).unwrap_or(u64::MAX) {
        let bytes = l.reader().read(0, l.octets())?;
        return Ok(match l.kind() {
            LobKind::Character => Lob::of_text(&String::from_utf8_lossy(&bytes)),
            LobKind::Binary => Lob::of_octets(&bytes),
        });
    }
    let (kind, totals) = (l.kind(), (l.octets(), l.chars()));
    Ok(Lob::of_locator(kind, session.locator_of(l), totals))
}
