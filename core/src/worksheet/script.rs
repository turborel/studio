//! A worksheet's script split into its statements as the server splits a
//! request of several (`[DOC client/05-protocol.md Query 'Q']`), each with its place in
//! the text, counted as the editor counts, in UTF-16 code units, and its
//! class (RULES.md D29).

use serde::Serialize;
use turborel_client::Splitter;

use crate::error::{Result, StudioError};
use crate::guard::classify::{Classified, classify};

/// The longest script split, in bytes.
pub const MAX_SCRIPT_BYTES: usize = 16 * 1024 * 1024;

/// The reserved words of Turborel's SQL, as its lexer reads them
/// ([DOC sql/01-lexical.md Key words]).
pub fn key_words() -> &'static [&'static str] {
    turborel::lexer::KEY_WORDS
}

/// A statement of a script, and where it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Piece {
    /// Where it begins, in UTF-16 code units from the script's start.
    pub from: usize,
    /// Where it ends, likewise.
    pub to: usize,
    /// The statement, classified.
    pub statement: Classified,
}

/// The statements of `script`, in order, each with its place.
///
/// # Errors
///
/// SQLCODE -910 if the script is longer than `MAX_SCRIPT_BYTES`.
pub fn pieces(script: &str) -> Result<Vec<Piece>> {
    if script.len() > MAX_SCRIPT_BYTES {
        return Err(StudioError::misuse(format!("[DESIGN] a script is at most {MAX_SCRIPT_BYTES} bytes")));
    }
    let mut splitter = Splitter::default();
    let mut texts = splitter.feed(script);
    texts.extend(splitter.finish());
    let mut at = 0;
    let mut found = Vec::with_capacity(texts.len());
    for text in texts {
        // The splitter sends a statement without the separators around
        // it, but for the newline that ends a comment last in it, which the
        // end of the text may stand for.
        let sent = text.strip_suffix('\n').filter(|_| !script.get(at..).unwrap_or_default().contains(text.as_str())).unwrap_or(&text);
        let Some(offset) = script.get(at..).and_then(|rest| rest.find(sent)) else { continue };
        let start = at.saturating_add(offset);
        let end = start.saturating_add(sent.len());
        found.push(Piece { from: utf16(script, start), to: utf16(script, end), statement: classify(&text) });
        at = end;
    }
    Ok(found)
}

/// The UTF-16 code units of `text` before its byte `at`.
fn utf16(text: &str, at: usize) -> usize {
    text.get(..at).map_or(0, |before| before.encode_utf16().count())
}

#[cfg(test)]
mod tests {
    use super::{MAX_SCRIPT_BYTES, key_words, pieces};
    use crate::guard::classify::Class;

    /// The text of each piece of `script`, by its place, and its class.
    fn placed(script: &str) -> Vec<(String, Class)> {
        let units: Vec<u16> = script.encode_utf16().collect();
        pieces(script).unwrap().iter().map(|p| (String::from_utf16(&units[p.from..p.to]).unwrap(), p.statement.class)).collect()
    }

    /// [DOC client/05-protocol.md Query 'Q'] [DESIGN] D36: a script splits at each `;` that
    /// ends a statement, and each statement's place, in UTF-16 code units,
    /// holds its text, past letters of more than one unit, a string holding
    /// `;`, a comment, which is the statement's after it, and a block.
    #[test]
    fn each_statement_is_found_in_its_place() {
        let script =
            "SELECT 'é;😀' FROM T;\n-- a comment; not a statement\nINSERT INTO T VALUES (1) ;  \nBEGIN DELETE FROM T; END;\nCOMMIT -- done";
        assert_eq!(
            placed(script),
            [
                ("SELECT 'é;😀' FROM T".to_owned(), Class::Read),
                ("-- a comment; not a statement\nINSERT INTO T VALUES (1)".to_owned(), Class::WriteRows),
                ("BEGIN DELETE FROM T; END".to_owned(), Class::Unclassified),
                ("COMMIT -- done".to_owned(), Class::Transaction),
            ]
        );
        assert_eq!(pieces("  ;  -- nothing\n").unwrap(), Vec::new());
    }

    /// [DOC sql/01-lexical.md Key words]: the reserved words are SQL-92's,
    /// SELECT and VALUE among them, and INDEX, a word only its statements
    /// read, not.
    #[test]
    fn the_reserved_words_are_the_lexers() {
        assert!(key_words().contains(&"SELECT") && key_words().contains(&"VALUE"));
        assert!(!key_words().contains(&"INDEX"));
    }

    /// [RULE] R-SEC-6: a script longer than its bound is refused.
    #[test]
    fn a_script_too_long_is_refused() {
        assert_eq!(pieces(&" ".repeat(MAX_SCRIPT_BYTES + 1)).unwrap_err().sqlstate, "TB910");
    }
}
