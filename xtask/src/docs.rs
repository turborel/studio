//! The manual's layout, as turborel.com's documentation site reads it
//! (R-DOC-7): each page's `# Title`, its `[Contents](README.md)` line, each
//! volume listing its pages, no images in `doc/`, and every relative link
//! of every Markdown file resolving, to a file and to a heading.

use std::path::{Path, PathBuf};

use crate::command::root;
use crate::error::{Result, fail};
use crate::files::ext_is;

/// The line that follows a chapter's title (R-DOC-7).
const CONTENTS: &str = "[Contents](README.md)";
/// The link back to the set that a volume's README holds.
const THE_SET: &str = "](../README.md)";

/// Checks the manual, and the links of every Markdown file of `paths`.
pub fn check_manual(paths: &[String]) -> Result<()> {
    let mut problems = Vec::new();
    let mut linked = Vec::new();
    for path in paths.iter().filter(|p| p.starts_with("doc/")) {
        let text = if ext_is(path, "md") { std::fs::read_to_string(root().join(path))? } else { String::new() };
        problems.extend(page_problems(path, &text, paths));
    }
    for path in paths.iter().filter(|p| ext_is(p, "md")) {
        let text = std::fs::read_to_string(root().join(path))?;
        problems.extend(link_problems(path, &text));
        problems.extend(image_problems(path, &text, &mut linked));
    }
    problems.extend(readme_problems(&std::fs::read_to_string(root().join("README.md"))?, paths));
    for image in paths.iter().filter(|p| p.starts_with(IMAGES)) {
        if !linked.iter().any(|l| l == image) {
            problems.push(format!("{image}: no page links the image (R-DOC-7)"));
        }
    }
    if problems.is_empty() { Ok(()) } else { fail(problems.join("\n")) }
}

/// What is wrong with the manual's page `path`, of `text`, among `paths`.
pub fn page_problems(path: &str, text: &str, paths: &[String]) -> Vec<String> {
    if path.starts_with(IMAGES) && IMAGE_KINDS.iter().any(|k| ext_is(path, k)) {
        return Vec::new();
    }
    if !ext_is(path, "md") {
        return vec![format!("{path}: doc/ holds its pages and, in {IMAGES}, PNG, GIF and SVG images alone (R-DOC-7)")];
    }
    let lines: Vec<&str> = text.lines().collect();
    let mut problems = Vec::new();
    if !lines.first().is_some_and(|l| l.starts_with("# ")) {
        problems.push(format!("{path}: does not open with its # Title (R-DOC-7)"));
    }
    let depth = path.matches('/').count();
    let is_readme = path.ends_with("/README.md");
    if is_readme && depth == 2 {
        if !text.contains(THE_SET) {
            problems.push(format!("{path}: a volume's README links back to the set (R-DOC-7)"));
        }
        problems.extend(unlisted(path, text, paths));
    } else if !is_readme && lines.get(2).copied() != Some(CONTENTS) {
        problems.push(format!("{path}: its third line is not {CONTENTS} (R-DOC-7)"));
    }
    problems
}

/// The pages of the volume whose README is `readme`, of `text`, that it
/// does not list.
fn unlisted(readme: &str, text: &str, paths: &[String]) -> Vec<String> {
    let folder = readme.trim_end_matches("README.md");
    paths
        .iter()
        .filter_map(|p| p.strip_prefix(folder))
        .filter(|name| !name.contains('/') && ext_is(name, "md") && *name != "README.md")
        .filter(|name| !text.contains(&format!("]({name})")))
        .map(|name| format!("{readme}: does not list {name} (R-DOC-7)"))
        .collect()
}

/// The relative links of `text`, outside fenced code.
pub fn links(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let mut rest = line;
        while let Some(at) = rest.find("](") {
            let after = rest.get(at.saturating_add(2)..).unwrap_or_default();
            let end = after.find(')').unwrap_or(after.len());
            found.push(after.get(..end).unwrap_or_default().to_owned());
            rest = after.get(end..).unwrap_or_default();
        }
    }
    found.retain(|l| !l.starts_with("http://") && !l.starts_with("https://") && !l.starts_with("mailto:"));
    found
}

/// The User's Guide's chapters of what Studio does, each a feature the
/// README's list links: those after Installing and The Window.
const FEATURE_CHAPTERS: &str = "doc/user/";
/// The chapters of the User's Guide that are of no one feature.
const NOT_FEATURES: [&str; 3] = ["01-installing.md", "02-window.md", "README.md"];

/// What the README, `readme`, does not say of what Studio does: each
/// chapter of the User's Guide of a feature, among `paths`, its feature
/// list links (R-DOC-9), so a feature that comes without the README
/// following it is refused.
pub fn readme_problems(readme: &str, paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter_map(|p| p.strip_prefix(FEATURE_CHAPTERS))
        .filter(|name| !name.contains('/') && ext_is(name, "md") && !NOT_FEATURES.contains(name))
        .filter(|name| !readme.contains(&format!("](doc/user/{name})")))
        .map(|name| format!("README.md: its feature list links not doc/user/{name}, the chapter of a feature (R-DOC-9)"))
        .collect()
}

/// The folder of the manual's images (RULES.md D60).
const IMAGES: &str = "doc/images/";
/// The kinds of image the manual holds.
const IMAGE_KINDS: [&str; 3] = ["png", "gif", "svg"];

/// The images `text` shows, outside fenced code: each one's alt text and target.
pub fn images(text: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        let mut rest = line;
        while !fenced && let Some(at) = rest.find("![") {
            let after = rest.get(at.saturating_add(2)..).unwrap_or_default();
            let Some(close) = after.find("](") else { break };
            let alt = after.get(..close).unwrap_or_default().to_owned();
            let target = after.get(close.saturating_add(2)..).unwrap_or_default();
            let end = target.find(')').unwrap_or(target.len());
            found.push((alt, target.get(..end).unwrap_or_default().to_owned()));
            rest = target.get(end..).unwrap_or_default();
        }
    }
    found
}

/// What is wrong with the images of the Markdown file `path`, of `text`:
/// an alt text that is empty. Each image it shows, as a path from the
/// root, is added to `linked`.
fn image_problems(path: &str, text: &str, linked: &mut Vec<String>) -> Vec<String> {
    let base = Path::new(path).parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let mut problems = Vec::new();
    for (alt, target) in images(text) {
        if alt.trim().is_empty() {
            problems.push(format!("{path}: the image {target} says not what it shows: its alt text is empty (R-DOC-7)"));
        }
        let mut parts: Vec<String> = Vec::new();
        for part in base.join(&target).components() {
            match part {
                std::path::Component::ParentDir => {
                    parts.pop();
                }
                std::path::Component::Normal(p) => parts.push(p.to_string_lossy().into_owned()),
                _ => {}
            }
        }
        linked.push(parts.join("/"));
    }
    problems
}

/// What is wrong with the links of the Markdown file `path`, of `text`.
fn link_problems(path: &str, text: &str) -> Vec<String> {
    let base = Path::new(path).parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let mut problems = Vec::new();
    for link in links(text) {
        let (file, fragment) = link.split_once('#').map_or((link.as_str(), None), |(f, h)| (f, Some(h)));
        let target = if file.is_empty() { PathBuf::from(path) } else { base.join(file) };
        let full = root().join(&target);
        if !full.exists() {
            problems.push(format!("{path}: the link {link} names no file"));
            continue;
        }
        if let Some(fragment) = fragment {
            let headings = std::fs::read_to_string(&full).unwrap_or_default();
            if !anchors(&headings).iter().any(|a| a == fragment) {
                problems.push(format!("{path}: the link {link} names no heading"));
            }
        }
    }
    problems
}

/// The anchors of a Markdown text's headings, as GitHub makes them.
pub fn anchors(text: &str) -> Vec<String> {
    text.lines().filter(|l| l.starts_with('#')).map(|l| slug(l.trim_start_matches('#').trim())).collect()
}

/// A heading's anchor, as GitHub makes it: lower case, spaces as hyphens,
/// other punctuation dropped.
pub fn slug(heading: &str) -> String {
    heading
        .chars()
        .filter_map(|c| match c {
            ' ' => Some('-'),
            c if c.is_alphanumeric() || c == '-' || c == '_' => Some(c),
            _ => None,
        })
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests;
