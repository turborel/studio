//! Citations, read from tests made for each case.

use super::{Tag, headings_of, rust_tests, tags_in, ts_tests};

/// [RULE] R-TRACE-1: each kind of tag is read, with what it names.
#[test]
fn every_kind_of_tag_is_read() {
    let text = "[DESIGN] D12, [RULE] R-SEC-3. [CLIENT Running statements] [DOC sql/07-information-schema.md TABLES] [STUDIO Connecting]";
    assert_eq!(
        tags_in(text),
        [
            Tag::Design("D12".into()),
            Tag::Rule("R-SEC-3".into()),
            Tag::Client("Running statements".into()),
            Tag::Doc("sql/07-information-schema.md".into(), "TABLES".into()),
            Tag::Studio("Connecting".into()),
        ]
    );
    assert_eq!(tags_in("an index [i] of no kind"), []);
}

/// [RULE] R-TRACE-1: a Rust test's citation is its doc comment's, above its
/// other attributes.
#[test]
fn a_rust_tests_citation_is_its_doc_comments() {
    let text = "/// [DESIGN] D5: the version.\n#[test]\n#[ignore = \"live\"]\nfn a() {}\n\n#[test]\nfn b() {}\n";
    let tests = rust_tests(text);
    assert_eq!(tests.len(), 2);
    assert_eq!(tests[0], (2, vec![Tag::Design("D5".into())]));
    assert_eq!(tests[1].1, []);
}

/// [RULE] R-TRACE-1: a TypeScript test's citation is in its title.
#[test]
fn a_typescript_tests_citation_is_its_titles() {
    let text = "describe(\"x\", () => {\n  it(\"does [DESIGN] D20\", () => {});\n  it.each([1])(\"none\", () => {});\n});\n";
    assert_eq!(ts_tests(text), [(2, vec![Tag::Design("D20".into())]), (3, vec![])]);
}

/// [RULE] R-TRACE-2: headings in fenced code are not headings.
#[test]
fn headings_are_read_outside_code() {
    assert_eq!(headings_of("# A\n```\n# not\n```\n## B\n"), ["A", "B"]);
}

/// [RULE] R-TRACE-1: a live test, a function of the live harness, cites
/// in its doc comment as a `#[test]` does.
#[test]
fn a_live_tests_citation_is_its_doc_comments() {
    let text = "/// [CLIENT Connecting] It connects.\npub fn connects(live: &Live) {}\n\npub fn helper(live: &Live) {}\n";
    assert_eq!(rust_tests(text), [(2, vec![Tag::Client("Connecting".into())]), (4, vec![])]);
}

/// [DESIGN] D6: the headings a file cites are known by their pages, a
/// client's heading of each of the client's pages, so the copy keeps
/// those alone.
#[test]
fn the_headings_cited_are_known_by_their_pages() {
    let cited = super::cited_headings(&["xtask/src/citations/tests.rs".to_owned()]).unwrap();
    assert!(cited.contains(&("sql/07-information-schema.md".to_owned(), "TABLES".to_owned())));
    assert!(cited.contains(&("client/02-library.md".to_owned(), "Running statements".to_owned())));
    assert!(cited.contains(&("client/02-library-connections.md".to_owned(), "Running statements".to_owned())));
}
