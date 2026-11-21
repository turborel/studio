//! The manual's checks, against pages made for each case.

use super::{anchors, animation_problems, image_problems, images, links, page_problems, readme_problems, slug};

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

/// [RULE] R-DOC-7 [DESIGN] D60: doc/ holds its images in doc/images/
/// alone, PNG, GIF or SVG.
#[test]
fn an_image_is_kept_in_its_folder_alone() {
    assert_eq!(page_problems("doc/user/shot.png", "", &[]).len(), 1);
    assert_eq!(page_problems("doc/images/shot.bmp", "", &[]).len(), 1);
    assert_eq!(page_problems("doc/images/shot-light.png", "", &[]), Vec::<String>::new());
    assert_eq!(page_problems("doc/images/shot.svg", "", &[]), Vec::<String>::new());
}

/// [RULE] R-DOC-7 [DESIGN] D60: an image says what it shows, and is
/// known as the file it links, as is a theme's other picture linked
/// beside it; an animation is bounded in size.
#[test]
fn an_image_says_what_it_shows() {
    let text = "![The window](../images/w.png) and ![](../images/x.gif), [dark](../images/w-dark.png)\n```\n![no](y.png)\n```\n";
    assert_eq!(images(text), [("The window".to_owned(), "../images/w.png".to_owned()), (String::new(), "../images/x.gif".to_owned())]);
    let mut linked = Vec::new();
    let problems = image_problems("doc/user/02-window.md", text, &mut linked);
    assert_eq!(problems.len(), 1);
    assert_eq!(linked, ["doc/images/w.png", "doc/images/x.gif", "doc/images/w-dark.png"]);
    assert_eq!(animation_problems("doc/images/x.gif", 2 * 1024 * 1024), Vec::<String>::new());
    assert_eq!(animation_problems("doc/images/x.gif", 2 * 1024 * 1024 + 1).len(), 1);
    assert_eq!(animation_problems("doc/images/x.png", 9 * 1024 * 1024), Vec::<String>::new());
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

/// [RULE] R-DOC-9: the README's feature list links each chapter of a
/// feature, so a feature cannot come without the README saying so.
#[test]
fn the_readme_links_each_features_chapter() {
    let paths: Vec<String> =
        ["doc/user/01-installing.md", "doc/user/02-window.md", "doc/user/03-a.md", "doc/user/04-b.md", "doc/user/README.md"]
            .map(str::to_owned)
            .to_vec();
    assert_eq!(readme_problems("- [A](doc/user/03-a.md)", &paths).len(), 1);
    assert_eq!(readme_problems("- [A](doc/user/03-a.md)\n- [B](doc/user/04-b.md)", &paths), Vec::<String>::new());
}
