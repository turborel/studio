//! Citations (RULES.md D6, R-TRACE): every test cites what it verifies, and
//! every citation names a decision, rule or heading that exists. Turborel's
//! headings are copied, at the commit `turborel-client` is pinned to, into
//! `xtask/turborel-headings.tsv`, so the check needs no checkout of
//! Turborel: those a file of Studio's cites alone, so no heading Studio
//! does not use, as one that names another product, is kept in its files.

use std::collections::BTreeSet;
use std::path::Path;

use crate::command::{root, say};
use crate::error::{Error, Result, fail};

/// The copy of Turborel's headings, relative to the root.
pub const HEADINGS_FILE: &str = "xtask/turborel-headings.tsv";
/// The parity matrix, whose rows cite Turborel's manual as tests do.
const CONFORMANCE: &str = "CONFORMANCE.md";
/// The pages of turborel-client that `[CLIENT …]` cites (D6).
const CLIENT_PAGES: [&str; 2] = ["client/02-library.md", "client/02-library-connections.md"];

/// A citation of a test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tag {
    /// `[DESIGN] D<n>`, a decision of RULES.md.
    Design(String),
    /// `[RULE] R-<id>`, a rule of RULES.md.
    Rule(String),
    /// `[CLIENT <heading>]`, a heading of turborel-client's chapters.
    Client(String),
    /// `[DOC <page> <heading>]`, a heading of a page of Turborel's manual.
    Doc(String, String),
    /// `[STUDIO <heading>]`, a heading of this repository's manual.
    Studio(String),
}

/// What citations may name: the decisions and rules of RULES.md, and the
/// headings of Turborel's manual and of Studio's.
pub struct Known {
    rules: String,
    turborel: BTreeSet<(String, String)>,
    studio: BTreeSet<String>,
}

/// The tags `text` holds.
pub fn tags_in(text: &str) -> Vec<Tag> {
    let mut tags = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find('[') {
        rest = rest.get(at.saturating_add(1)..).unwrap_or_default();
        let Some(end) = rest.find(']') else { break };
        let inner = rest.get(..end).unwrap_or_default();
        let after = rest.get(end.saturating_add(1)..).unwrap_or_default();
        if let Some(tag) = tag_of(inner, after) {
            tags.push(tag);
        }
    }
    tags
}

/// The tag of the bracketed `inner`, followed by `after`, if it is one.
fn tag_of(inner: &str, after: &str) -> Option<Tag> {
    let word = |prefix: &str| after.strip_prefix(' ').filter(|w| w.starts_with(prefix)).map(id_of);
    match inner {
        "DESIGN" => word("D").map(Tag::Design),
        "RULE" => word("R-").map(Tag::Rule),
        _ => {
            if let Some(heading) = inner.strip_prefix("CLIENT ") {
                return Some(Tag::Client(heading.to_owned()));
            }
            if let Some(heading) = inner.strip_prefix("STUDIO ") {
                return Some(Tag::Studio(heading.to_owned()));
            }
            let (page, heading) = inner.strip_prefix("DOC ")?.split_once(' ')?;
            Some(Tag::Doc(page.to_owned(), heading.to_owned()))
        }
    }
}

/// The identifier `text` begins with: letters, digits and hyphens.
fn id_of(text: &str) -> String {
    text.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>().trim_end_matches('-').to_owned()
}

impl Known {
    /// What the repository's files say exists.
    pub fn read() -> Result<Known> {
        let rules = std::fs::read_to_string(root().join("RULES.md"))?;
        let copied = std::fs::read_to_string(root().join(HEADINGS_FILE))?;
        let turborel = copied
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| l.split_once('\t'))
            .map(|(p, h)| (p.to_owned(), h.to_owned()))
            .collect();
        let mut studio = BTreeSet::new();
        for page in crate::files::tracked()?.iter().filter(|p| p.starts_with("doc/") && crate::files::ext_is(p, "md")) {
            let text = std::fs::read_to_string(root().join(page))?;
            studio.extend(headings_of(&text));
        }
        Ok(Known { rules, turborel, studio })
    }

    /// Whether `tag` names what exists.
    pub fn knows(&self, tag: &Tag) -> bool {
        match tag {
            Tag::Design(id) => self.rules.contains(&format!("#### {id}. ")),
            Tag::Rule(id) => self.rules.contains(&format!("| {id} |")),
            Tag::Client(h) => CLIENT_PAGES.iter().any(|p| self.turborel.contains(&((*p).to_owned(), h.clone()))),
            Tag::Doc(page, h) => self.turborel.contains(&(page.clone(), h.clone())),
            Tag::Studio(h) => self.studio.contains(h),
        }
    }
}

/// The headings of a Markdown text, as printed.
pub fn headings_of(text: &str) -> Vec<String> {
    let mut fenced = false;
    let mut found = Vec::new();
    for line in text.lines() {
        if line.starts_with("```") {
            fenced = !fenced;
        } else if !fenced && line.starts_with('#') {
            found.push(line.trim_start_matches('#').trim().to_owned());
        }
    }
    found
}

/// Checks that every test of `paths` cites, and cites what exists.
pub fn check_tests(paths: &[String]) -> Result<()> {
    let known = Known::read()?;
    let mut problems = Vec::new();
    for path in paths {
        let cited = if crate::files::ext_is(path, "rs") {
            rust_tests(&std::fs::read_to_string(root().join(path))?)
        } else if crate::files::is_ts_test(path) {
            ts_tests(&std::fs::read_to_string(root().join(path))?)
        } else {
            continue;
        };
        problems.extend(cited.iter().flat_map(|(line, tags)| test_problems(path, *line, tags, &known)));
    }
    let conformance = std::fs::read_to_string(root().join(CONFORMANCE))?;
    problems.extend(
        tags_in(&conformance).iter().filter(|t| !known.knows(t)).map(|t| format!("{CONFORMANCE}: {t:?} names nothing that exists")),
    );
    if problems.is_empty() { Ok(()) } else { fail(problems.join("\n")) }
}

/// The headings of Turborel's manual the files of `paths` cite, each by
/// its page: a `[CLIENT …]` heading of each of the client's pages.
///
/// # Errors
///
/// A file that cannot be read.
pub fn cited_headings(paths: &[String]) -> Result<BTreeSet<(String, String)>> {
    let mut cited = BTreeSet::new();
    let texts = paths.iter().filter(|p| ["rs", "ts", "tsx", "md"].iter().any(|e| crate::files::ext_is(p, e)));
    for path in texts {
        for tag in tags_in(&std::fs::read_to_string(root().join(path))?) {
            match tag {
                Tag::Doc(page, heading) => {
                    cited.insert((page, heading));
                }
                Tag::Client(heading) => cited.extend(CLIENT_PAGES.iter().map(|p| ((*p).to_owned(), heading.clone()))),
                Tag::Design(_) | Tag::Rule(_) | Tag::Studio(_) => {}
            }
        }
    }
    Ok(cited)
}

/// Checks that every heading copied is one a file cites (RULES.md D6), so
/// the copy holds nothing of Turborel's manual Studio does not use.
pub fn check_headings(paths: &[String]) -> Result<()> {
    let cited = cited_headings(paths)?;
    let copied = std::fs::read_to_string(root().join(HEADINGS_FILE))?;
    let problems: Vec<String> = copied
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .filter_map(|l| l.split_once('\t'))
        .filter(|(p, h)| !cited.contains(&((*p).to_owned(), (*h).to_owned())))
        .map(|(p, h)| format!("{HEADINGS_FILE}: {p} {h} is cited nowhere: copy the headings again (RULES.md D6)"))
        .collect();
    if problems.is_empty() { Ok(()) } else { fail(problems.join("\n")) }
}

/// What is wrong with the citations `tags` of the test at `path:line`.
fn test_problems(path: &str, line: usize, tags: &[Tag], known: &Known) -> Vec<String> {
    if tags.is_empty() {
        return vec![format!("{path}:{line}: a test cites nothing it verifies (R-TRACE-1)")];
    }
    tags.iter().filter(|t| !known.knows(t)).map(|t| format!("{path}:{line}: {t:?} names nothing that exists (R-TRACE-2)")).collect()
}

/// The signature that marks a live test, a function of the live
/// harness's own (`core/tests/live`), which runs no `#[test]`.
const LIVE_TEST: &str = "(live: &Live)";
/// What marks a test of the embedded tests' program (RULES.md D59).
const EMBEDDED_TEST: &str = "(scratch: &Scratch)";

/// Whether `line` begins a test: `#[test]`, or a live test's signature.
fn is_test(line: &str) -> bool {
    let line = line.trim();
    line == "#[test]" || (line.starts_with("pub fn ") && (line.contains(LIVE_TEST) || line.contains(EMBEDDED_TEST)))
}

/// Each Rust test of `text`, by its line, with the tags of its doc comment.
pub fn rust_tests(text: &str) -> Vec<(usize, Vec<Tag>)> {
    let lines: Vec<&str> = text.lines().collect();
    let mut tests = Vec::new();
    for (at, line) in lines.iter().enumerate() {
        if !is_test(line) {
            continue;
        }
        let comment = lines
            .get(..at)
            .unwrap_or_default()
            .iter()
            .rev()
            .map(|l| l.trim())
            .skip_while(|l| l.starts_with("#["))
            .take_while(|l| l.starts_with("///"))
            .map(|l| l.trim_start_matches('/'))
            .collect::<Vec<_>>()
            .join(" ");
        tests.push((at.saturating_add(1), tags_in(&comment)));
    }
    tests
}

/// Each TypeScript test of `text`, by its line, with the tags of its title.
pub fn ts_tests(text: &str) -> Vec<(usize, Vec<Tag>)> {
    const OPENERS: [&str; 4] = ["it(", "test(", "it.each(", "test.each("];
    text.lines()
        .enumerate()
        .filter(|(_, l)| OPENERS.iter().any(|o| l.trim_start().starts_with(o)))
        .map(|(at, l)| (at.saturating_add(1), tags_in(l)))
        .collect()
}

/// Copies the headings of every page of Turborel's manual under `dir`, a
/// checkout's `doc/`, into `HEADINGS_FILE`.
pub fn copy_headings(dir: Option<&str>, at: Option<&str>) -> Result<()> {
    let dir = Path::new(dir.ok_or_else(|| Error("usage: cargo xtask headings <turborel checkout>/doc [commit]".into()))?);
    let checkout = dir.parent().map_or_else(|| ".".to_owned(), |p| p.to_string_lossy().into_owned());
    // A doc/ exported of a commit names its commit; a checkout's is its HEAD.
    let commit = match at {
        Some(commit) => commit.to_owned(),
        None => crate::command::output("git", &["-C", &checkout, "rev-parse", "HEAD"])?.1,
    };
    let mut lines =
        vec![format!("# The headings of Turborel's manual at {}, copied by `cargo xtask headings` (RULES.md D6).", commit.trim())];
    let mut pages = Vec::new();
    collect_pages(dir, dir, &mut pages)?;
    pages.sort();
    let cited = cited_headings(&crate::files::tracked()?)?;
    for page in pages {
        let text = std::fs::read_to_string(dir.join(&page))?;
        let of_page = headings_of(&text).into_iter().filter(|h| cited.contains(&(page.clone(), h.clone())));
        lines.extend(of_page.map(|h| format!("{page}\t{h}")));
    }
    lines.push(String::new());
    std::fs::write(root().join(HEADINGS_FILE), lines.join("\n"))?;
    crate::functions::copy_functions(dir, commit.trim())?;
    say(&format!("headings: {HEADINGS_FILE} and {} written", crate::functions::FUNCTIONS_FILE));
    Ok(())
}

/// The Markdown pages under `dir`, relative to `base`, with `/` between
/// their parts on every platform.
fn collect_pages(base: &Path, dir: &Path, pages: &mut Vec<String>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_pages(base, &path, pages)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            let relative = path.strip_prefix(base).map_err(|e| Error(e.to_string()))?;
            pages.push(relative.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
