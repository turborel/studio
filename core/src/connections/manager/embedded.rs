//! The connection manager's embedded databases (RULES.md D59): one opened
//! or made, a session of it started on a worker of its own, and what a
//! connection of one was given.

use std::sync::Arc;
use std::sync::mpsc;

use serde::Serialize;
use turborel::txn::Stop;

use super::{ConnectionManager, Handle, Opened, Origin, Stopper, unknown, worker_name};
use crate::connections::session::SessionState;
use crate::connections::worker::Job;
use crate::embedded::worker::EmbeddedWorker;
use crate::embedded::{Embedded, EmbeddedSpec, Place};
use crate::error::{Result, StudioError};
use crate::events::ConnectionId;
use crate::guard::policy::Guards;

/// An embedded database, as a connection of it shows it (RULES.md D59).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedInfo {
    /// Where it is kept.
    pub place: Place,
    /// The identifier its sessions act as.
    pub user: String,
    /// The plug-ins it was given, and those it was not, and why.
    pub plug_ins: Vec<crate::embedded::PlugIn>,
}

impl ConnectionManager {
    /// Opens or makes the embedded database `spec` says, and a session of
    /// it on a worker of its own (RULES.md D59).
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a directory Studio holds open already; the
    /// database's, as `embedded::open` gives them.
    pub fn open_embedded(&self, spec: &EmbeddedSpec, guards: Guards) -> Result<Opened> {
        if let Place::Directory { path } = &spec.place {
            let held = self
                .handles()
                .values()
                .any(|h| matches!(&h.origin, Origin::Embedded(e) if e.place == Place::Directory { path: path.clone() }));
            if held {
                return Err(StudioError::misuse(format!("[DESIGN] the database in {} is open in Studio already", path.display())));
            }
        }
        let embedded = Arc::new(crate::embedded::open(spec)?);
        let told = embedded.told.clone();
        let id = self.next_id();
        let started = self.start_embedded(id, Arc::clone(&embedded), guards);
        match started {
            Ok((handle, session)) => {
                self.handles().insert(id, handle);
                Ok(Opened { connection: id, session, told })
            }
            Err(e) => {
                let _ = embedded.close(); // Its failure is the one given.
                Err(e)
            }
        }
    }

    /// Starts connection `id`'s worker, a session of `embedded`, and waits for it.
    pub(super) fn start_embedded(&self, id: ConnectionId, embedded: Arc<Embedded>, guards: Guards) -> Result<(Handle, SessionState)> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        let (ready, started) = mpsc::channel::<Result<(SessionState, Option<Arc<Stop>>)>>();
        let (spool, database) = (self.spool.clone(), Arc::clone(&embedded));
        let thread = std::thread::Builder::new()
            .name(worker_name(id, true))
            .spawn(move || {
                let worker = EmbeddedWorker::new(database, spool);
                let _ = ready.send(worker.state().map(|s| (s, worker.stop()))); // The opener waits for it.
                worker.serve(&inbox);
            })
            .map_err(|e| StudioError::misuse(format!("[DESIGN] the database's worker cannot start: {e}")))?;
        let answer = started.recv().map_err(|_| StudioError::lost("[DESIGN] the database's worker ended"));
        match answer.and_then(|r| r) {
            Ok((session, stop)) => {
                Ok((Handle { jobs, thread, stopper: Stopper::Embedded(stop), origin: Origin::Embedded(embedded), guards }, session))
            }
            Err(error) => {
                let _ = thread.join(); // It has ended: its failure is the one given.
                Err(error)
            }
        }
    }

    /// The embedded database connection `id` is a session of: where it is
    /// kept and the plug-ins it was given; none of a server's.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if there is no such connection.
    pub fn embedded(&self, id: ConnectionId) -> Result<Option<EmbeddedInfo>> {
        let handles = self.handles();
        Ok(match &handles.get(&id).ok_or_else(|| unknown(id))?.origin {
            Origin::Server(_) => None,
            Origin::Embedded(e) => Some(EmbeddedInfo { place: e.place.clone(), user: e.user.clone(), plug_ins: e.plug_ins.clone() }),
        })
    }
}
