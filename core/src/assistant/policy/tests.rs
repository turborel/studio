//! The guard rails: levels, lists, the hard floor, and the corpus of
//! statements the assistant may never run.

use std::collections::BTreeMap;

use super::{ConnectionPolicy, Level, Limits, Policies, PolicyFile, Use, judge, named_objects};
use crate::guard::classify::Class;
use crate::saved::Environment;

/// The corpus: each statement between its lines of `---`, the file's own
/// comment before the first left out.
fn corpus() -> Vec<String> {
    let body = include_str!("../blocked.sql").lines().skip_while(|l| l.starts_with("-- ")).collect::<Vec<_>>().join("\n");
    body.split("\n---\n").map(|part| part.trim().to_owned()).filter(|part| !part.is_empty()).collect()
}

/// A policy of `level`.
fn at(level: Level) -> ConnectionPolicy {
    ConnectionPolicy { level, ..ConnectionPolicy::default() }
}

/// [DESIGN] D55: every statement of the corpus is never run, nor
/// explained, at any level, and a draft of it is blocked for the
/// assistant, its confirmation named.
#[test]
fn the_corpus_is_blocked_at_every_level() {
    let statements = corpus();
    assert!(statements.len() >= 30, "{}", statements.len());
    for level in [Level::Off, Level::ExplainOnly, Level::Read, Level::ProposeChanges] {
        for sql in &statements {
            for use_ in [Use::Run, Use::Explain] {
                let v = judge(&at(level), Environment::Development, (use_, Some("ANN")), sql);
                assert!(!v.allowed, "{level:?} {use_:?} ran: {sql}");
            }
            let draft = judge(&at(level), Environment::Development, (Use::Propose, Some("ANN")), sql);
            assert!(!draft.allowed || draft.blocked, "{level:?} drafted unblocked: {sql}");
            assert!(!draft.blocked || draft.confirm.is_some(), "{sql}");
        }
    }
}

/// [DESIGN] D55: a query is explained from Explain Only up, run from Read
/// up, never on Off; a draft of a write needs Propose Changes; production
/// is at most Read and starts Off.
#[test]
fn levels_allow_what_they_say() {
    let query = "SELECT NAME FROM ANN.STAFF WHERE ID = 1";
    let allowed = |level, use_, sql: &str| judge(&at(level), Environment::Development, (use_, None), sql).allowed;
    assert!(!allowed(Level::Off, Use::Explain, query));
    assert!(allowed(Level::ExplainOnly, Use::Explain, query));
    assert!(!allowed(Level::ExplainOnly, Use::Run, query));
    assert!(allowed(Level::Read, Use::Run, query));
    assert!(allowed(Level::ExplainOnly, Use::Propose, query));
    let write = "UPDATE ANN.STAFF SET PAY = 1 WHERE ID = 2";
    assert!(!allowed(Level::Read, Use::Propose, write));
    assert!(allowed(Level::ProposeChanges, Use::Propose, write));
    assert!(!allowed(Level::ProposeChanges, Use::Run, write));
    let v = judge(&at(Level::ProposeChanges), Environment::Development, (Use::Run, None), write);
    assert_eq!((v.rule.as_deref(), v.class), (Some("READ-ONLY"), Class::WriteRows));
    let production = ConnectionPolicy::for_environment(Environment::Production);
    assert_eq!((production.level, production.redact_literals), (Level::Off, true));
    let raised = at(Level::ProposeChanges);
    assert_eq!(raised.level_on(Environment::Production), Level::Read);
    assert!(!judge(&raised, Environment::Production, (Use::Propose, None), write).allowed);
    let floored = judge(&at(Level::ProposeChanges), Environment::Development, (Use::Propose, None), "DROP TABLE ANN.STAFF CASCADE");
    assert!(floored.allowed && floored.blocked);
    assert_eq!(floored.confirm.as_deref(), Some("STAFF"));
}

/// [DESIGN] D55 [DESIGN] D29: EXPLAIN ANALYZE of a data change runs it for
/// real, so the assistant judges it a write, never a read, and one that
/// destroys is held to the floor.
#[test]
fn explain_analyze_of_a_change_is_a_write() {
    for analyzed in ["EXPLAIN ANALYZE UPDATE ANN.STAFF SET PAY = 1 WHERE ID = 2", "EXPLAIN ANALYZE DELETE FROM ANN.STAFF"] {
        let v = judge(&at(Level::ProposeChanges), Environment::Development, (Use::Run, None), analyzed);
        assert_eq!((v.allowed, v.class), (false, Class::WriteRows), "{analyzed}");
    }
    let floored =
        judge(&at(Level::ProposeChanges), Environment::Development, (Use::Propose, None), "EXPLAIN ANALYZE DELETE FROM ANN.STAFF");
    assert!(floored.blocked);
}

/// [DESIGN] D55: lists of classes and objects allow and deny, and a hidden
/// schema or table is never named to the assistant, even of the session's
/// schema written alone.
#[test]
fn lists_allow_deny_and_hide() {
    let base = at(Level::ProposeChanges);
    let judged = |p: &ConnectionPolicy, use_, sql: &str| judge(p, Environment::Test, (use_, Some("ANN")), sql);
    let hidden = ConnectionPolicy { hidden: vec!["ANN.SECRETS".into()], ..base.clone() };
    assert_eq!(judged(&hidden, Use::Run, "SELECT * FROM SECRETS").rule.as_deref(), Some("HIDDEN"));
    let schema = ConnectionPolicy { hidden: vec!["HR".into()], ..base.clone() };
    assert_eq!(judged(&schema, Use::Run, "SELECT * FROM hr.pay").rule.as_deref(), Some("HIDDEN"));
    assert!(judged(&schema, Use::Run, "SELECT * FROM ANN.STAFF").allowed);
    let denied = ConnectionPolicy { deny_objects: vec!["ANN.PAY".into()], ..base.clone() };
    assert_eq!(judged(&denied, Use::Run, "SELECT * FROM PAY").rule.as_deref(), Some("DENIED"));
    let only = ConnectionPolicy { allow_objects: vec!["ANN.STAFF".into()], ..base.clone() };
    assert!(judged(&only, Use::Run, "SELECT * FROM STAFF").allowed);
    assert_eq!(judge(&only, Environment::Test, (Use::Run, None), "SELECT * FROM OTHER.T").rule.as_deref(), Some("NOT-ALLOWED"));
    let classes = ConnectionPolicy { deny_classes: vec![Class::ChangeSchema], ..base.clone() };
    assert_eq!(judged(&classes, Use::Propose, "CREATE TABLE T (A INTEGER)").rule.as_deref(), Some("CLASS"));
    let reads = ConnectionPolicy { allow_classes: vec![Class::Read], ..base };
    assert_eq!(judged(&reads, Use::Propose, "INSERT INTO T VALUES (1)").rule.as_deref(), Some("CLASS"));
    assert_eq!(named_objects("SELECT A FROM \"x\".T"), ["A", "T", "x", "x.T"]);
    assert_eq!(named_objects("SELECT 'unterminated"), Vec::<String>::new());
}

/// [DESIGN] D55: policies are kept by saved connection in a file of
/// format 1, bounded, replaced whole as an export is, and a connection with
/// none has its environment's.
#[test]
fn policies_are_kept_and_bounded() {
    let dir = crate::testing::scratch("assistant/policy");
    let policies = Policies::new(&dir);
    assert_eq!(policies.of(Some("c1"), Environment::Production).unwrap().level, Level::Off);
    let kept = policies.keep("c1", at(Level::ExplainOnly)).unwrap();
    assert_eq!(kept.connections.len(), 1);
    assert_eq!(policies.of(Some("c1"), Environment::Production).unwrap().level, Level::ExplainOnly);
    assert_eq!(policies.of(None, Environment::Test).unwrap().level, Level::Read);
    for bad in [
        ConnectionPolicy { hidden: vec![String::new()], ..at(Level::Read) },
        ConnectionPolicy { deny_objects: vec!["X".repeat(401)], ..at(Level::Read) },
        ConnectionPolicy { limits: Limits { rows: 0, ..Limits::default() }, ..at(Level::Read) },
        ConnectionPolicy { limits: Limits { tokens: 999_999, ..Limits::default() }, ..at(Level::Read) },
        ConnectionPolicy { login: Some(String::new()), ..at(Level::Read) },
        ConnectionPolicy { allow_objects: vec!["A".into(); 501], ..at(Level::Read) },
    ] {
        assert!(policies.keep("c2", bad).is_err());
    }
    let exported = policies.all().unwrap();
    policies.replace(&PolicyFile { format: 1, connections: BTreeMap::new() }).unwrap();
    assert!(policies.all().unwrap().connections.is_empty());
    policies.replace(&exported).unwrap();
    assert!(policies.replace(&PolicyFile { format: 2, connections: BTreeMap::new() }).is_err());
    assert_eq!(policies.all().unwrap(), exported);
}

/// [DESIGN] D55: a script of two statements is never explained or run,
/// and one of none is the strictest.
#[test]
fn one_statement_at_a_time() {
    let v = judge(&at(Level::Read), Environment::Development, (Use::Run, None), "SELECT 1 FROM T; SELECT 2 FROM T");
    assert_eq!(v.rule.as_deref(), Some("ONE-STATEMENT"));
    let empty = judge(&at(Level::Read), Environment::Development, (Use::Run, None), "   ");
    assert_eq!(empty.class, Class::Unclassified);
    assert!(!empty.allowed);
}

/// [STUDIO assistant-policy.json]: the manual's example
/// is read and fits its bounds.
#[test]
fn the_manuals_policy_is_read() {
    let dir = crate::testing::scratch("assistant/manual-policy");
    std::fs::write(dir.join(super::POLICY_FILE), crate::testing::manual_json("appendix/d-files.md", "assistant-policy.json")).unwrap();
    let policy = Policies::new(&dir).of(Some("9f2c4e1a"), Environment::Development).unwrap();
    assert_eq!(
        (policy.level, policy.deny_classes.as_slice(), policy.login.as_deref()),
        (Level::Read, [Class::Security].as_slice(), Some("HELPER"))
    );
    policy.validate().unwrap();
}
