//! The manual's checks, against pages made for each case.

use super::{anchors, links, page_problems, slug};

/// [RULE] R-DOC-7: a chapter opens with its title, then its Contents line.
#[test]
fn a_chapter_needs_its_title_and_contents_line() {
    let paths = vec!["doc/user/02-x.md".to_owned()];
    assert_eq!(page_problems("doc/user/02-x.md", "# X\n\n[Contents](README.md)\n", &paths), Vec::<String>::new());
    assert_eq!(page_problems("doc/user/02-x.md", "X\n\n[Contents](README.md)\n", &paths).len(), 1);
    assert_eq!(page_problems("doc/user/02-x.md", "# X\n\nText\n", &paths).len(), 1);
}

/// [RULE] R-DOC-7: a volume's README lists every page of its folder.
#[test]
fn a_volume_lists_each_of_its_pages() {
    let paths = vec!["doc/user/README.md".to_owned(), "doc/user/01-a.md".to_owned(), "doc/user/02-b.md".to_owned()];
    let text = "# Volume I\n\n[The documentation set](../README.md)\n\n- [A](01-a.md)\n";
    assert_eq!(page_problems("doc/user/README.md", text, &paths), ["doc/user/README.md: does not list 02-b.md (R-DOC-7)"]);
}

/// [RULE] R-DOC-7: doc/ holds no images.
#[test]
fn an_image_in_the_manual_is_refused() {
    assert_eq!(page_problems("doc/user/shot.png", "", &[]).len(), 1);
}

/// [RULE] R-DOC-7: links in fenced code are not links, and web addresses
/// are not checked.
#[test]
fn links_are_read_outside_code_alone() {
    let text = "See [a](a.md#b) and [web](https://example.org).\n```\n[no](x.md)\n```\n";
    assert_eq!(links(text), ["a.md#b"]);
}

/// [RULE] R-DOC-7: anchors are made as GitHub makes them.
#[test]
fn anchors_are_githubs() {
    assert_eq!(slug("The Object Explorer's tree"), "the-object-explorers-tree");
    assert_eq!(slug("D5. The version"), "d5-the-version");
    assert_eq!(anchors("# A b\ntext\n## C, d\n"), ["a-b", "c-d"]);
}
