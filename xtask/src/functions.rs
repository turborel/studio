//! The built-in functions of Turborel's manual, copied for the editor's
//! completion (RULES.md D40): each row of a table headed `| Function |`
//! of the SQL volume, its signatures split apart, with the page and
//! heading it is under, written to `ui/worksheet/complete/turborel-functions.tsv`
//! at the commit the headings are copied from.

use std::path::Path;

use crate::command::root;
use crate::error::{Error, Result};

/// The file the functions are written to.
pub const FUNCTIONS_FILE: &str = "ui/worksheet/complete/turborel-functions.tsv";
/// The volume of the manual the functions are read from.
const SQL_DIR: &str = "sql";

/// The signatures of a table's first cell: apart at each comma outside
/// parentheses and brackets, the escaped bars written plain.
pub fn signatures(cell: &str) -> Vec<String> {
    let cell = cell.replace("\\|", "|").replace('`', "");
    let mut found = Vec::new();
    let mut depth = 0_i32;
    let mut current = String::new();
    for c in cell.chars() {
        match c {
            '(' | '[' => depth = depth.saturating_add(1),
            ')' | ']' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                found.push(current.trim().to_owned());
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(c);
    }
    found.push(current.trim().to_owned());
    found.into_iter().filter(|s| s.contains('(')).collect()
}

/// The rows of each functions' table of `text`, each its heading, its
/// signature and its value.
pub fn functions_of(text: &str) -> Vec<(String, String, String)> {
    let mut found = Vec::new();
    let mut heading = String::new();
    let mut in_table = false;
    for line in text.lines() {
        if let Some(h) = line.strip_prefix('#') {
            h.trim_start_matches('#').trim().clone_into(&mut heading);
            in_table = false;
        } else if line.starts_with("| Function |") {
            in_table = true;
        } else if in_table && line.starts_with('|') && !line.starts_with("|---") {
            let cells: Vec<&str> = line.trim_matches('|').split(" | ").map(str::trim).collect();
            let (Some(first), Some(value)) = (cells.first(), cells.get(1)) else { continue };
            for signature in signatures(first) {
                found.push((heading.clone(), signature, (*value).to_owned()));
            }
        } else if !line.starts_with('|') {
            in_table = false;
        }
    }
    found
}

/// Writes the functions of the manual at `doc`, its pages copied at
/// `commit`, to `FUNCTIONS_FILE`.
///
/// # Errors
///
/// A page that cannot be read, or the file not written.
pub fn copy_functions(doc: &Path, commit: &str) -> Result<()> {
    let dir = doc.join(SQL_DIR);
    let mut pages: Vec<String> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .filter(|n| Path::new(n).extension().is_some_and(|e| e.eq_ignore_ascii_case("md")))
        .collect();
    pages.sort();
    let mut lines =
        vec![format!("# The built-in functions of Turborel's manual at {commit}, copied by `cargo xtask headings` (RULES.md D40).")];
    for page in pages {
        let text = std::fs::read_to_string(dir.join(&page))?;
        for (heading, signature, value) in functions_of(&text) {
            if [&heading, &signature, &value].iter().any(|s| s.contains('\t')) {
                return Err(Error(format!("{page}: a tab in a function's row")));
            }
            lines.push(format!("{SQL_DIR}/{page}\t{heading}\t{signature}\t{value}"));
        }
    }
    lines.push(String::new());
    std::fs::write(root().join(FUNCTIONS_FILE), lines.join("\n"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{functions_of, signatures};

    /// [DESIGN] D40: a table's signatures are split at commas outside
    /// parentheses, a row of one kept whole, its escaped bars and code marks
    /// written plain, words without parentheses let go.
    #[test]
    fn signatures_are_split_apart() {
        assert_eq!(signatures("UPPER(s), LOWER(s)"), ["UPPER(s)", "LOWER(s)"]);
        assert_eq!(signatures("LPAD(s, n [, pad]), RPAD(s, n [, pad])"), ["LPAD(s, n [, pad])", "RPAD(s, n [, pad])"]);
        assert_eq!(signatures("TRIM([[LEADING \\| TRAILING] FROM] `s`)"), ["TRIM([[LEADING | TRAILING] FROM] s)"]);
        assert_eq!(signatures("CURRENT_DATE"), Vec::<String>::new());
    }

    /// [DESIGN] D40: each row of a table headed `| Function |` is read with
    /// its heading, and no other table's.
    #[test]
    fn functions_tables_are_read() {
        let page = "# Page\n\n## Strings\n\n| Function | Value |\n|---|---|\n| UPPER(s), LOWER(s) | the case |\n\nText.\n\n| Other | Thing |\n|---|---|\n| A(x) | no |\n";
        assert_eq!(
            functions_of(page),
            [
                ("Strings".to_owned(), "UPPER(s)".to_owned(), "the case".to_owned()),
                ("Strings".to_owned(), "LOWER(s)".to_owned(), "the case".to_owned())
            ]
        );
    }
}
