//! The types of a new table's columns, inferred from a sample of a file's
//! records (RULES.md D63), as Turborel's own types
//! ([DOC sql/02-data-types.md Numbers], [DOC appendix/d-limits.md
//! Limits]): the narrowest each field's values all fit. The user sees
//! and edits each before the table is made.

use serde::Serialize;

use crate::connections::cells::Cell;

/// The records a type is inferred from, at most.
pub const SAMPLED: usize = 1000;
/// The most digits of an exact number.
pub const MAX_DIGITS: usize = 38;
/// The longest CHARACTER VARYING, in characters.
pub const MAX_VARCHAR: usize = 32_767;
/// The lengths a CHARACTER VARYING is rounded up to.
const LENGTHS: [usize; 8] = [10, 20, 50, 100, 255, 1000, 4000, MAX_VARCHAR];

/// A field's type, as inferred.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inferred {
    /// The type, as SQL writes it.
    pub type_written: String,
    /// Whether a value of the sample was null.
    pub nulls: bool,
}

/// What a field's values have shown so far: each kind still possible.
#[derive(Debug, Clone)]
#[expect(clippy::struct_excessive_bools, reason = "each a kind a field's values may still all be")]
struct Seen {
    any: bool,
    nulls: bool,
    boolean: bool,
    integer: bool,
    /// Digits before and after the point of the exact numbers.
    exact: Option<(usize, usize)>,
    approximate: bool,
    date: bool,
    time: bool,
    timestamp: bool,
    zoned: bool,
    json: bool,
    /// The longest value, in characters.
    longest: usize,
    /// The integers' range.
    least: i128,
    greatest: i128,
}

impl Default for Seen {
    fn default() -> Seen {
        Seen {
            any: false,
            nulls: false,
            boolean: true,
            integer: true,
            exact: Some((0, 0)),
            approximate: true,
            date: true,
            time: true,
            timestamp: true,
            zoned: false,
            json: true,
            longest: 0,
            least: 0,
            greatest: 0,
        }
    }
}

/// `text`'s digits before and after its point, if it is an exact number.
fn exact_digits(text: &str) -> Option<(usize, usize)> {
    let unsigned = text.strip_prefix(['-', '+']).unwrap_or(text);
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    if whole.is_empty() && fraction.is_empty() || !digits(whole) || !digits(fraction) {
        return None;
    }
    // A code written with leading zeros, as a postal code is, is text.
    if whole.len() > 1 && whole.starts_with('0') {
        return None;
    }
    let whole = whole.trim_start_matches('0');
    Some((whole.len(), fraction.len()))
}

/// Whether `text` is an approximate number: digits with an exponent.
fn approximate(text: &str) -> bool {
    let Some((mantissa, exponent)) = text.split_once(['e', 'E']) else { return false };
    let exponent = exponent.strip_prefix(['-', '+']).unwrap_or(exponent);
    exact_digits(mantissa).is_some() && !exponent.is_empty() && exponent.bytes().all(|b| b.is_ascii_digit())
}

/// Whether `text` is `n` ASCII digits.
fn digits(text: &str, n: usize) -> bool {
    text.len() == n && text.bytes().all(|b| b.is_ascii_digit())
}

/// Whether `text` is a date, `YYYY-MM-DD`.
fn date(text: &str) -> bool {
    let mut parts = text.split('-');
    matches!((parts.next(), parts.next(), parts.next(), parts.next()), (Some(y), Some(m), Some(d), None)
        if digits(y, 4) && digits(m, 2) && digits(d, 2)
        && (1..=12).contains(&m.parse::<u8>().unwrap_or(0)) && (1..=31).contains(&d.parse::<u8>().unwrap_or(0)))
}

/// Whether `text` is a time of day, `HH:MM:SS`, with a fraction or not.
fn time(text: &str) -> bool {
    let (whole, fraction) = text.split_once('.').unwrap_or((text, "0"));
    let mut parts = whole.split(':');
    matches!((parts.next(), parts.next(), parts.next(), parts.next()), (Some(h), Some(m), Some(s), None)
        if digits(h, 2) && digits(m, 2) && digits(s, 2) && h < "24" && m < "60" && s < "61")
        && !fraction.is_empty()
        && fraction.bytes().all(|b| b.is_ascii_digit())
}

/// Whether `text` is a time zone's displacement, `Z` or `+HH:MM`.
fn zone(text: &str) -> bool {
    text == "Z" || text.strip_prefix(['+', '-']).is_some_and(|hm| hm.split_once(':').is_some_and(|(h, m)| digits(h, 2) && digits(m, 2)))
}

/// Whether `text` is a timestamp, a date and a time between a space or a
/// `T`, and whether it has a time zone.
fn timestamp(text: &str) -> Option<bool> {
    let (day, rest) = text.split_once([' ', 'T'])?;
    if !date(day) {
        return None;
    }
    let at = rest.find(['Z', '+']).or_else(|| rest.get(1..).and_then(|r| r.find('-')).map(|at| at.saturating_add(1)));
    match at {
        Some(at) => (time(rest.get(..at)?) && zone(rest.get(at..)?)).then_some(true),
        None => time(rest).then_some(false),
    }
}

/// Whether `text` is an object or an array of JSON.
fn json(text: &str) -> bool {
    matches!(text.as_bytes().first(), Some(b'{' | b'[')) && serde_json::from_str::<serde::de::IgnoredAny>(text).is_ok()
}

impl Seen {
    /// What `cell` shows.
    fn see(&mut self, cell: &Cell) {
        let Some(text) = cell.as_deref() else {
            self.nulls = true;
            return;
        };
        let text = text.trim();
        self.any = true;
        self.longest = self.longest.max(text.chars().count());
        self.boolean &= text.eq_ignore_ascii_case("true") || text.eq_ignore_ascii_case("false");
        let exact = exact_digits(text);
        self.exact = match (self.exact, exact) {
            (Some((w, f)), Some((tw, tf))) => Some((w.max(tw), f.max(tf))),
            _ => None,
        };
        let integer = exact.filter(|&(_, f)| f == 0).and_then(|_| text.parse::<i128>().ok());
        self.integer &= integer.is_some();
        if let Some(n) = integer {
            self.least = self.least.min(n);
            self.greatest = self.greatest.max(n);
        }
        self.approximate &= exact.is_some() || approximate(text);
        self.date &= date(text);
        self.time &= time(text);
        let stamp = timestamp(text);
        self.timestamp &= stamp.is_some() || date(text);
        self.zoned |= stamp == Some(true);
        self.json &= json(text);
    }

    /// The narrowest type of what was seen.
    fn type_written(&self) -> String {
        let fits = |n: i128, of: i128| n >= of.saturating_neg() && n < of;
        match self.exact {
            _ if !self.any => "VARCHAR(255)".to_owned(),
            _ if self.boolean => "BOOLEAN".to_owned(),
            Some(_) if self.integer && fits(self.least, 1 << 31) && fits(self.greatest, 1 << 31) => "INTEGER".to_owned(),
            Some(_) if self.integer && fits(self.least, 1 << 63) && fits(self.greatest, 1 << 63) => "BIGINT".to_owned(),
            Some((whole, fraction)) if whole.saturating_add(fraction) <= MAX_DIGITS => {
                format!("NUMERIC({},{fraction})", whole.saturating_add(fraction).max(1))
            }
            _ if self.approximate => "DOUBLE PRECISION".to_owned(),
            _ if self.date => "DATE".to_owned(),
            _ if self.time => "TIME".to_owned(),
            _ if self.timestamp && self.zoned => "TIMESTAMP WITH TIME ZONE".to_owned(),
            _ if self.timestamp => "TIMESTAMP".to_owned(),
            _ if self.json => "JSON".to_owned(),
            _ => match LENGTHS.iter().find(|&&n| n >= self.longest) {
                Some(n) => format!("VARCHAR({n})"),
                None => "CLOB(1M)".to_owned(),
            },
        }
    }
}

/// The type of each of `width` fields, inferred from `records`, the
/// first `SAMPLED` of a file's.
pub fn infer(records: &[Vec<Cell>], width: usize) -> Vec<Inferred> {
    let mut seen = vec![Seen::default(); width];
    for record in records.iter().take(SAMPLED) {
        for (at, s) in seen.iter_mut().enumerate() {
            s.see(record.get(at).unwrap_or(&None));
        }
    }
    seen.iter().map(|s| Inferred { type_written: s.type_written(), nulls: s.nulls || !s.any }).collect()
}

#[cfg(test)]
mod tests;
