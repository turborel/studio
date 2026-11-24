//! The embedded tests of the routine debugger (RULES.md D73): a second
//! session of the same database attached to the first, a breakpoint, a
//! pause with its call stack, steps, and the end.

use turborel_studio_core::catalog::Catalog;
use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::debugging::{BreakAt, DebugAnswer, DebugCall, DebugEvent, RoutineKind, Step, aligned, routine_text};
use turborel_studio_core::events::ConnectionId;

use crate::{Scratch, open, run, spec};

/// A procedure of four lines' body, its UPDATE on line 4 of its text.
pub const RAISE_PAY: &str = "CREATE PROCEDURE RAISE_PAY(IN PCT INTEGER) MODIFIES SQL DATA
BEGIN
  DECLARE N INTEGER DEFAULT 0;
  UPDATE STAFF SET SALARY = SALARY * (100 + PCT) / 100;
  SET N = (SELECT COUNT(*) FROM STAFF);
END";

/// The schema and specific name of RAISE_PAY on `id`.
pub fn named(manager: &ConnectionManager, id: ConnectionId) -> (String, String) {
    let sql = "SELECT SPECIFIC_SCHEMA, SPECIFIC_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_NAME = 'RAISE_PAY'";
    let Outcome::Rows { page, .. } = run(manager, id, sql).unwrap().outcome else { panic!("no routine") };
    let row = page.rows.into_iter().next().unwrap();
    (row[0].clone().unwrap(), row[1].clone().unwrap())
}

/// The next event of `debugger`, waited for at most ten seconds.
fn next_event(manager: &ConnectionManager, debugger: ConnectionId) -> DebugEvent {
    for _ in 0..20 {
        if let DebugAnswer::Event { event: Some(event) } = manager.debug(debugger, DebugCall::Wait(500)).unwrap() {
            return event;
        }
    }
    panic!("no event came")
}

/// [DOC user/11-debugging.md Two sessions] [DESIGN] D73: an embedded
/// database's session is debugged by another of the same database: a
/// breakpoint at line 4 pauses its CALL there, the frame's parameter and
/// variable shown and the line found in Studio's CREATE of the procedure;
/// a step over pauses at line 5; continuing lets the CALL complete, which
/// changed the rows; a breakpoint past the routine's last line is
/// refused, and so is a step of a target not paused.
pub fn a_procedure_is_debugged(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let target = open(&manager, &spec(&scratch.path("debugged"), true)).unwrap().connection;
    manager.set_autocommit(target, true).unwrap();
    for sql in ["CREATE TABLE STAFF (ID INTEGER PRIMARY KEY, SALARY INTEGER)", "INSERT INTO STAFF VALUES (1, 50000), (2, 60000)", RAISE_PAY]
    {
        run(&manager, target, sql).unwrap();
    }
    let debugger = manager.debug_start(target).unwrap().connection;
    let (schema, specific) = named(&manager, target);
    let at = |line| BreakAt { kind: RoutineKind::Procedure, schema: schema.clone(), name: specific.clone(), line, condition: None };
    let DebugAnswer::Breakpoint(set) = manager.debug(debugger, DebugCall::Break(at(4))).unwrap() else { panic!("no breakpoint") };
    assert_eq!((set.number, set.line), (1, 4));
    assert!(manager.debug(debugger, DebugCall::Break(at(99))).is_err());
    assert!(manager.debug(debugger, DebugCall::Resume(Step::Over)).is_err());
    let shown = routine_text(&Catalog::of(&manager, target), (RoutineKind::Procedure, &schema, &specific), None).unwrap();
    std::thread::scope(|threads| {
        let call = threads.spawn(|| run(&manager, target, "CALL RAISE_PAY(10)"));
        let DebugEvent::Paused(paused) = next_event(&manager, debugger) else { panic!("not paused") };
        assert_eq!(paused.breakpoint, Some(1));
        let top = &paused.frames[0];
        assert_eq!((top.name.as_deref(), top.line), (Some("RAISE_PAY"), Some(4)));
        assert_eq!(top.parameters[0].value.as_deref(), Some("10"));
        assert_eq!(top.variables[0].value.as_deref(), Some("0"));
        assert!(aligned(&shown, top.at.unwrap(), (4, top.column.unwrap())));
        manager.debug(debugger, DebugCall::Resume(Step::Over)).unwrap();
        let DebugEvent::Paused(stepped) = next_event(&manager, debugger) else { panic!("not paused after the step") };
        assert_eq!((stepped.breakpoint, stepped.frames[0].line), (None, Some(5)));
        let DebugAnswer::Stack { paused: Some(again) } = manager.debug(debugger, DebugCall::Stack).unwrap() else { panic!("not paused") };
        assert_eq!(again.frames[0].line, Some(5));
        manager.debug(debugger, DebugCall::Resume(Step::Continue)).unwrap();
        call.join().unwrap().unwrap();
    });
    let DebugAnswer::Breakpoints { breakpoints } = manager.debug(debugger, DebugCall::Breakpoints).unwrap() else { panic!("no list") };
    assert_eq!(breakpoints.len(), 1);
    manager.debug(debugger, DebugCall::Clear(1)).unwrap();
    manager.debug_stop(debugger).unwrap();
    let Outcome::Rows { page, .. } = run(&manager, target, "SELECT SALARY FROM STAFF WHERE ID = 1").unwrap().outcome else {
        panic!("no rows")
    };
    assert_eq!(page.rows, [[Some("55000".to_owned())]]);
    manager.close(target).unwrap();
}

/// [DESIGN] D73: an embedded session not attached refuses each call that
/// needs a debugger, an ID, and an attach to a server's connection; one
/// attached refuses a second attach.
pub fn an_unattached_session_refuses(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = open(&manager, &spec(&scratch.path("unattached"), true)).unwrap().connection;
    let calls = [
        DebugCall::Id,
        DebugCall::Attach(turborel_studio_core::debugging::Target::Server(1)),
        DebugCall::Detach,
        DebugCall::Break(BreakAt {
            kind: RoutineKind::Procedure,
            schema: "OWNER".to_owned(),
            name: "P".to_owned(),
            line: 1,
            condition: None,
        }),
        DebugCall::Clear(1),
        DebugCall::Breakpoints,
        DebugCall::Resume(Step::Continue),
        DebugCall::Interrupt,
        DebugCall::Stack,
        DebugCall::Wait(10),
    ];
    for call in calls {
        let shown = format!("{call:?}");
        assert!(manager.debug(id, call).is_err(), "{shown}");
    }
    let target = open(&manager, &spec(&scratch.path("attached"), true)).unwrap().connection;
    let debugger = manager.debug_start(target).unwrap().connection;
    let again = manager.debug_start(target);
    assert!(again.is_err());
    manager.debug_stop(debugger).unwrap();
    manager.close(target).unwrap();
    manager.close(id).unwrap();
}
