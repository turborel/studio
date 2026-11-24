//! The debugger's views and its text's numbering, judged of values made
//! in the test.

use turborel::catalog::QualifiedName;
use turborel::debugger::{Action, CursorShown, Event, Frame, Kind, Named, Origin, Paused, Reason};
use turborel::value::Value;

use super::{DebugEvent, PauseView, RoutineKind, RoutineText, Step, aligned};

/// A frame of procedure ANN.P, at line `line`, its parameter N of `n`.
fn frame(name: &str, line: u32, n: Option<i64>) -> Frame {
    Frame {
        origin: Some(Origin {
            kind: Kind::Procedure,
            name: QualifiedName { auth: "ANN".to_owned(), ident: format!("{name}_1") },
            shown: QualifiedName { auth: "ANN".to_owned(), ident: name.to_owned() },
        }),
        visible: true,
        at: Some(10),
        line: Some((line, 3)),
        parameters: vec![Named {
            name: "N".to_owned(),
            data_type: "INTEGER".to_owned(),
            value: n.map_or(Value::Null, |n| Value::Exact(turborel::value::Decimal::new(i128::from(n), 0))),
        }],
        variables: Vec::new(),
        cursors: vec![CursorShown { name: "C".to_owned(), open: true, query: "SELECT 1".to_owned() }],
    }
}

/// [DOC user/11-debugging.md Two sessions] [DESIGN] D73: a pause is told
/// innermost frame first, each its routine's names, place, parameters by
/// their text, null as none, and cursors; at a breakpoint its number, at a
/// step's end none.
#[test]
fn a_pause_is_told_innermost_first() {
    let paused = Paused { reason: Reason::Breakpoint(2), frames: vec![frame("OUTER", 4, Some(7)), frame("INNER", 2, None)] };
    let view = PauseView::from(&paused);
    assert_eq!(view.breakpoint, Some(2));
    let names: Vec<_> = view.frames.iter().map(|f| f.name.clone().unwrap_or_default()).collect();
    assert_eq!(names, ["INNER", "OUTER"]);
    let inner = &view.frames[0];
    assert_eq!(
        (inner.kind, inner.specific.as_deref(), inner.line, inner.column),
        (Some(RoutineKind::Procedure), Some("INNER_1"), Some(2), Some(3))
    );
    assert_eq!(inner.parameters[0].value, None);
    assert_eq!(view.frames[1].parameters[0].value.as_deref(), Some("7"));
    assert!(inner.cursors[0].open);
    let stepped = PauseView::from(&Paused { reason: Reason::Step, frames: vec![Frame::default()] });
    assert_eq!((stepped.breakpoint, stepped.frames[0].kind, stepped.frames[0].at), (None, None, None));
    assert_eq!(DebugEvent::from(&Event::TimedOut), DebugEvent::TimedOut);
    assert_eq!(DebugEvent::from(&Event::Cancelled), DebugEvent::Cancelled);
    assert_eq!(DebugEvent::from(&Event::Ended), DebugEvent::Ended);
}

/// [DOC user/11-debugging.md Stepping] [DESIGN] D73: each step is the
/// debugger's action of its name, and each kind its own.
#[test]
fn steps_and_kinds_are_turborels() {
    let actions: Vec<Action> = [Step::Into, Step::Over, Step::Out, Step::Continue].into_iter().map(Action::from).collect();
    assert_eq!(actions, [Action::Into, Action::Over, Action::Out, Action::Continue]);
    for kind in [RoutineKind::Procedure, RoutineKind::Function, RoutineKind::Trigger] {
        assert_eq!(RoutineKind::from(Kind::from(kind)), kind);
    }
}

/// [DESIGN] D73: of the text as written, a frame's place is shown only
/// where it is its character: the first line's, a later line's, the end's;
/// one past the text, or of another character, is not.
#[test]
fn a_place_is_checked_against_the_text_as_written() {
    let shown = RoutineText { text: Some("CREATE PROCEDURE P ()\nBEGIN\n  SET X = 1;\nEND".to_owned()), exact: true };
    assert!(aligned(&shown, 0, (1, 1)));
    assert!(aligned(&shown, 30, (3, 3)));
    assert!(aligned(&shown, 41, (4, 1)));
    assert!(aligned(&shown, 44, (4, 4)));
    assert!(!aligned(&shown, 29, (3, 3)));
    assert!(!aligned(&shown, 0, (9, 1)));
    assert!(!aligned(&RoutineText { text: None, exact: true }, 0, (1, 1)));
}

/// [DESIGN] D73: of Studio's CREATE, a frame's place is shown where a
/// statement may begin: the first character of a line but its spaces, or
/// one after a `;` or a space; not a space, mid-word, past a line's end,
/// past the last line, nor column 0.
#[test]
fn a_place_is_checked_against_studios_create() {
    let shown = RoutineText { text: Some("CREATE PROCEDURE P ()\nBEGIN\n  SET X = 1; SET Y = 2;\nEND".to_owned()), exact: false };
    assert!(aligned(&shown, 99, (3, 3)));
    assert!(aligned(&shown, 99, (3, 14)));
    assert!(aligned(&shown, 99, (2, 1)));
    assert!(!aligned(&shown, 99, (3, 1)));
    assert!(!aligned(&shown, 99, (3, 5)));
    assert!(!aligned(&shown, 99, (3, 40)));
    assert!(!aligned(&shown, 99, (9, 1)));
    assert!(!aligned(&shown, 99, (3, 0)));
}

/// [DESIGN] D73: the window's asks are read by their `ask`, a breakpoint's
/// routine by its `kind`, and each becomes the worker's call.
#[test]
fn the_windows_asks_are_read() {
    use super::{BreakAt, DebugAsk, DebugCall, RoutineOf};
    let ask: DebugAsk =
        serde_json::from_str(r#"{"ask":"break","kind":"trigger","schema":"ANN","name":"LOG","line":3,"condition":"X > 1"}"#).unwrap();
    let DebugCall::Break(BreakAt { kind, line, condition, .. }) = DebugCall::from(ask) else { panic!("no breakpoint") };
    assert_eq!((kind, line, condition.as_deref()), (RoutineKind::Trigger, 3, Some("X > 1")));
    for (text, call) in [
        (r#"{"ask":"clear","number":2}"#, "Clear(2)"),
        (r#"{"ask":"breakpoints"}"#, "Breakpoints"),
        (r#"{"ask":"resume","step":"out"}"#, "Resume(Out)"),
        (r#"{"ask":"interrupt"}"#, "Interrupt"),
        (r#"{"ask":"stack"}"#, "Stack"),
        (r#"{"ask":"wait","ms":500}"#, "Wait(500)"),
    ] {
        let ask: DebugAsk = serde_json::from_str(text).unwrap();
        assert_eq!(format!("{:?}", DebugCall::from(ask)), call);
    }
    assert!(serde_json::from_str::<DebugAsk>(r#"{"ask":"attach"}"#).is_err());
    let of: RoutineOf = serde_json::from_str(r#"{"kind":"procedure","schema":"ANN","name":"P_1","table":null}"#).unwrap();
    assert_eq!((of.kind, of.table), (RoutineKind::Procedure, None));
}
