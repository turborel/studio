//! The rules of every source file a linter does not hold: its length
//! (R-SIZE-2), its opening doc comment (R-DOC-6), and no open-work markers
//! (R-DOC-5).

use crate::command::{output, root};
use crate::error::{Result, fail};

/// The longest a source file may be, in lines (R-SIZE-2).
pub const MAX_FILE_LINES: usize = 600;

/// The markers of open work no code may hold (R-DOC-5), spelt in two parts
/// so this file holds none.
const MARKERS: [(&str, &str); 3] = [("TO", "DO"), ("FIX", "ME"), ("X", "XX")];

/// The extensions of code: Rust, TypeScript, styles, the page and the
/// manifests. Code never names the open-work file either (R-DOC-5): its
/// name holds the first marker.
const CODE: [&str; 6] = ["rs", "ts", "tsx", "css", "toml", "html"];

/// Whether `path`'s extension is `ext`, in any case.
pub fn ext_is(path: &str, ext: &str) -> bool {
    std::path::Path::new(path).extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Whether `path` is a TypeScript test, `*.test.ts` or `*.test.tsx`.
pub fn is_ts_test(path: &str) -> bool {
    let stem = std::path::Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    (ext_is(path, "ts") || ext_is(path, "tsx")) && ext_is(&stem, "test")
}

/// Every file git tracks or would track, relative to the root.
pub fn tracked() -> Result<Vec<String>> {
    let (ok, text) = output("git", &["ls-files", "--cached", "--others", "--exclude-standard"])?;
    if !ok {
        return fail(format!("git ls-files failed: {text}"));
    }
    Ok(text.lines().filter(|path| root().join(path).is_file()).map(str::to_owned).collect())
}

/// Checks every source file of `paths`.
pub fn check_sources(paths: &[String]) -> Result<()> {
    let mut problems = Vec::new();
    for path in paths.iter().filter(|p| CODE.iter().any(|ext| ext_is(p, ext))) {
        let text = std::fs::read_to_string(root().join(path))?;
        problems.extend(problems_of(path, &text));
    }
    if problems.is_empty() { Ok(()) } else { fail(problems.join("\n")) }
}

/// What is wrong with the source file `path`, of text `text`.
pub fn problems_of(path: &str, text: &str) -> Vec<String> {
    let mut problems = Vec::new();
    let lines = text.lines().count();
    if lines > MAX_FILE_LINES {
        problems.push(format!("{path}: {lines} lines, more than {MAX_FILE_LINES} (R-SIZE-2)"));
    }
    if ext_is(path, "rs") && !text.starts_with("//!") {
        problems.push(format!("{path}: does not begin with a //! doc comment (R-DOC-6)"));
    }
    for (number, line) in text.lines().enumerate() {
        for (first, second) in MARKERS {
            if line.contains(&format!("{first}{second}")) {
                problems.push(format!("{path}:{}: an open-work marker (R-DOC-5)", number.saturating_add(1)));
            }
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::{MAX_FILE_LINES, problems_of};

    /// [RULE] R-SIZE-2: a file one line over the limit is refused, one at it
    /// is not.
    #[test]
    fn a_file_longer_than_the_limit_is_refused() {
        let at = "//! a\n".repeat(MAX_FILE_LINES);
        assert_eq!(problems_of("a.rs", &at), Vec::<String>::new());
        let over = format!("{at}x\n");
        assert_eq!(problems_of("a.rs", &over).len(), 1);
    }

    /// [RULE] R-DOC-6: a Rust file begins with its doc comment.
    #[test]
    fn a_rust_file_without_its_doc_comment_is_refused() {
        assert_eq!(problems_of("a.rs", "fn main() {}\n").len(), 1);
        assert_eq!(problems_of("a.ts", "export {};\n"), Vec::<String>::new());
    }

    /// [RULE] R-DOC-5: an open-work marker is refused wherever it is.
    #[test]
    fn an_open_work_marker_is_refused() {
        let marked = format!("//! a\n// {}{}: later\n", "TO", "DO");
        assert_eq!(problems_of("a.rs", &marked), ["a.rs:2: an open-work marker (R-DOC-5)"]);
    }
}
