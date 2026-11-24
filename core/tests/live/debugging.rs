//! The live tests of the routine debugger (RULES.md D73): a debugging
//! connection opened beside the user's, attached to its session, a
//! breakpoint, a pause with its call stack, steps, and the refusal of a
//! routine its user may not debug.

use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::debugging::{BreakAt, DebugAnswer, DebugCall, DebugEvent, RoutineKind, Step};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::secret::Secret;

use crate::{Live, no_environment, run};

/// A procedure of four lines' body, its UPDATE on line 4 of its text.
const RAISE_PAY: &str = "CREATE PROCEDURE DBG_RAISE(IN PCT INTEGER) SPECIFIC DBG_RAISE MODIFIES SQL DATA
BEGIN
  DECLARE N INTEGER DEFAULT 0;
  UPDATE DBG_STAFF SET SALARY = SALARY * (100 + PCT) / 100;
  SET N = (SELECT COUNT(*) FROM DBG_STAFF);
END";

/// A breakpoint at line `line` of DBG_RAISE.
fn at(line: u32) -> BreakAt {
    BreakAt { kind: RoutineKind::Procedure, schema: "ANN".to_owned(), name: "DBG_RAISE".to_owned(), line, condition: None }
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

/// [DOC user/11-debugging.md Two sessions] [DESIGN] D73: a server's
/// session is debugged by a connection opened beside it of the same user:
/// a breakpoint at line 4 pauses its CALL there with its parameter and
/// variable, a conditional one that is false never pauses, a step into
/// pauses at line 5, and continuing lets the CALL complete; a user who
/// holds no DEBUG on the procedure is refused, SQLSTATE 42000, until it is
/// granted.
pub fn a_procedure_is_debugged(live: &Live) {
    let (manager, _) = live.manager();
    let target = live.owner(&manager);
    manager.set_autocommit(target, true).unwrap();
    for sql in [
        "CREATE TABLE DBG_STAFF (ID INTEGER PRIMARY KEY, SALARY INTEGER)",
        "INSERT INTO DBG_STAFF VALUES (1, 50000), (2, 60000)",
        RAISE_PAY,
    ] {
        run(&manager, target, sql).unwrap();
    }
    let debugger = manager.debug_start(target).unwrap().connection;
    let DebugAnswer::Breakpoint(set) = manager.debug(debugger, DebugCall::Break(at(4))).unwrap() else { panic!("no breakpoint") };
    assert_eq!((set.number, set.name.as_str(), set.line), (1, "DBG_RAISE", 4));
    let never = BreakAt { condition: Some("PCT > 50".to_owned()), ..at(5) };
    manager.debug(debugger, DebugCall::Break(never)).unwrap();
    std::thread::scope(|threads| {
        let call = threads.spawn(|| run(&manager, target, "CALL DBG_RAISE(10)"));
        let DebugEvent::Paused(paused) = next_event(&manager, debugger) else { panic!("not paused") };
        let top = &paused.frames[0];
        assert_eq!((paused.breakpoint, top.line, top.parameters[0].value.as_deref()), (Some(1), Some(4), Some("10")));
        manager.debug(debugger, DebugCall::Resume(Step::Into)).unwrap();
        let DebugEvent::Paused(stepped) = next_event(&manager, debugger) else { panic!("not paused after the step") };
        assert_eq!((stepped.breakpoint, stepped.frames[0].line), (None, Some(5)));
        manager.debug(debugger, DebugCall::Resume(Step::Continue)).unwrap();
        call.join().unwrap().unwrap();
    });
    manager.debug_stop(debugger).unwrap();
    refused_without_debug(live, &manager, target);
    run(&manager, target, "DROP PROCEDURE DBG_RAISE CASCADE").unwrap();
    run(&manager, target, "DROP TABLE DBG_STAFF CASCADE").unwrap();
    manager.close(target).unwrap();
}

/// A user granted EXECUTE on DBG_RAISE but not DEBUG is refused a
/// breakpoint in it, SQLSTATE 42000, until `owner` grants DEBUG.
fn refused_without_debug(live: &Live, manager: &ConnectionManager, owner: ConnectionId) {
    for sql in ["CREATE USER DBG_BOB PASSWORD 'dbg-bob'", "GRANT EXECUTE ON PROCEDURE DBG_RAISE TO DBG_BOB"] {
        run(manager, owner, sql).unwrap();
    }
    let spec = turborel_studio_core::connections::spec::ConnectionSpec { user: Some("DBG_BOB".into()), ..live.spec() };
    let bob = manager.open((&spec, Guards::default()), Some(&Secret::new("dbg-bob")), no_environment).unwrap().connection;
    let debugger = manager.debug_start(bob).unwrap().connection;
    let refused = manager.debug(debugger, DebugCall::Break(at(4))).unwrap_err();
    assert_eq!(refused.sqlstate, "42000", "{refused:?}");
    run(manager, owner, "GRANT DEBUG ON PROCEDURE DBG_RAISE TO DBG_BOB").unwrap();
    assert!(matches!(manager.debug(debugger, DebugCall::Break(at(4))).unwrap(), DebugAnswer::Breakpoint(_)));
    manager.debug_stop(debugger).unwrap();
    manager.close(bob).unwrap();
    for sql in [
        "REVOKE DEBUG ON PROCEDURE DBG_RAISE FROM DBG_BOB CASCADE",
        "REVOKE EXECUTE ON PROCEDURE DBG_RAISE FROM DBG_BOB CASCADE",
        "DROP USER DBG_BOB",
    ] {
        let Outcome::Done { .. } = run(manager, owner, sql).unwrap().outcome else { panic!("{sql} gave rows") };
    }
}
