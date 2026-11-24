//! The routine debugger's connections (RULES.md D73): a debugging
//! connection opened beside the one the user works in, of the same server
//! and user, or a second session of the same embedded database, attached
//! to that one's session; its calls asked of its worker; and its end.

use turborel::db::DebugTarget;

use super::{ConnectionManager, Opened, Origin, Stopper, unexpected, unknown};
use crate::connections::worker::{Reply, Request};
use crate::debugging::{DebugAnswer, DebugCall, Target};
use crate::error::{Result, StudioError};
use crate::events::ConnectionId;

impl ConnectionManager {
    /// The answer of connection `id`'s worker to the debugger's `call`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the server's or the
    /// database's, as `debugging::server_call` and `embedded_call` give them.
    pub fn debug(&self, id: ConnectionId, call: DebugCall) -> Result<DebugAnswer> {
        match self.ask(id, Request::Debug(call))? {
            Reply::Debugged(answer) => Ok(answer),
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Parameters(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
        }
    }

    /// What a debugger attaches to connection `target`'s session by: a
    /// server's connection's ID, asked of it while it is idle, or an
    /// embedded session's handle.
    fn debug_target(&self, target: ConnectionId) -> Result<Target> {
        let embedded = match &self.handles().get(&target).ok_or_else(|| unknown(target))?.stopper {
            Stopper::Embedded(stop) => Some(stop.clone().ok_or_else(|| StudioError::misuse("[DESIGN] the session cannot be debugged"))?),
            Stopper::Server(_) => None,
        };
        match embedded {
            Some(stop) => Ok(Target::Embedded(DebugTarget::of(stop))),
            None => match self.debug(target, DebugCall::Id)? {
                DebugAnswer::Id { id } => Ok(Target::Server(id)),
                DebugAnswer::Done
                | DebugAnswer::Breakpoint(_)
                | DebugAnswer::Breakpoints { .. }
                | DebugAnswer::Stack { .. }
                | DebugAnswer::Event { .. } => Err(unexpected()),
            },
        }
    }

    /// A debugging connection opened beside connection `target`, of its
    /// server and user, or of its embedded database, its guards the
    /// target's and read-only, and attached to `target`'s session.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the server's: one granting
    /// no `debugger`, or refusing the attach; the database's.
    pub fn debug_start(&self, target: ConnectionId) -> Result<Opened> {
        let attach_to = self.debug_target(target)?;
        let (origin, guards) = {
            let handles = self.handles();
            let h = handles.get(&target).ok_or_else(|| unknown(target))?;
            let origin = match &h.origin {
                Origin::Server(settings) => Origin::Server(settings.clone()),
                Origin::Embedded(e) => Origin::Embedded(std::sync::Arc::clone(e)),
            };
            (origin, crate::guard::policy::Guards { read_only: true, ..h.guards })
        };
        let id = self.next_id();
        let (handle, session) = match origin {
            Origin::Server(settings) => self.start(id, *settings, guards)?,
            Origin::Embedded(e) => self.start_embedded(id, e, guards)?,
        };
        self.handles().insert(id, handle);
        if let Err(e) = self.debug(id, DebugCall::Attach(attach_to)) {
            let _ = self.close(id); // Its failure is the one told.
            return Err(e);
        }
        Ok(Opened { connection: id, session, told: None })
    }

    /// Debugging connection `debugger` detached, its target going on, and
    /// closed.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection.
    pub fn debug_stop(&self, debugger: ConnectionId) -> Result<()> {
        let _ = self.debug(debugger, DebugCall::Detach); // One detached already, or ended, is let go all the same.
        self.close(debugger)
    }
}
