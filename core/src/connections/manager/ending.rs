//! Connections cancelled, ended and connected again, and the threads the
//! manager holds (RULES.md D24, D59, R-SAFE-5): a server's statement
//! cancelled through turborel-client's canceller, an embedded session's
//! through its own; an embedded database closed, with a checkpoint, as
//! the last connection of it ends.

use std::sync::{Arc, mpsc};

use super::{ConnectionManager, Origin, Stopper, ThreadInfo, unknown, worker_name};
use crate::connections::session::SessionState;
use crate::connections::worker::Request;
use crate::error::{Result, StudioError};
use crate::events::ConnectionId;

impl ConnectionManager {
    /// Cancels the statement connection `id` runs, from this thread.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection, or one with no canceller;
    /// the cancel's failure, if the server cannot be reached.
    pub fn cancel(&self, id: ConnectionId) -> Result<()> {
        let cannot = || StudioError::misuse("[DESIGN] the connection cannot be cancelled");
        let handles = self.handles();
        match &handles.get(&id).ok_or_else(|| unknown(id))?.stopper {
            Stopper::Server(canceller) => {
                let canceller = canceller.clone().ok_or_else(cannot)?;
                drop(handles);
                canceller.cancel().map_err(StudioError::from)
            }
            Stopper::Embedded(stop) => {
                stop.as_ref().ok_or_else(cannot)?.cancel();
                Ok(())
            }
        }
    }

    /// Ends connection `id`, waiting for its worker to end.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the server's failure as the
    /// session ends, as a deferred constraint's at its commit.
    pub fn close(&self, id: ConnectionId) -> Result<()> {
        let answer = self.ask(id, Request::Terminate).map(drop);
        let handle = self.handles().remove(&id);
        let mut closed = Ok(());
        if let Some(handle) = handle {
            let _ = handle.thread.join(); // It has answered Terminate, and ends.
            // The database closes with the last of its sessions.
            if let Origin::Embedded(embedded) = handle.origin
                && !self.handles().values().any(|h| matches!(&h.origin, Origin::Embedded(e) if Arc::ptr_eq(e, &embedded)))
            {
                closed = embedded.close();
            }
        }
        answer.and(closed)
    }

    /// Connects connection `id` again, by the settings it was made by: its
    /// old session ended, its results with it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the connection's failure.
    pub fn reconnect(&self, id: ConnectionId) -> Result<SessionState> {
        let old = self.handles().remove(&id).ok_or_else(|| unknown(id))?;
        let (reply, _) = mpsc::channel();
        let _ = old.jobs.send((Request::Terminate, reply)); // A worker already ended needs no Terminate.
        let _ = old.thread.join(); // It ends as it is told, or has ended.
        let (handle, session) = match old.origin {
            Origin::Server(settings) => self.start(id, *settings, old.guards)?,
            Origin::Embedded(embedded) => self.start_embedded(id, embedded, old.guards)?,
        };
        self.handles().insert(id, handle);
        Ok(session)
    }

    /// The threads the manager holds, one for each open connection.
    pub fn threads(&self) -> Vec<ThreadInfo> {
        self.handles()
            .iter()
            .map(|(&connection, h)| ThreadInfo { name: worker_name(connection, matches!(h.origin, Origin::Embedded(_))), connection })
            .collect()
    }
}

impl ConnectionManager {
    /// Ends every connection, and its worker with it, each embedded
    /// database closed, as Studio quits (R-SAFE-5, RULES.md D59).
    pub fn close_all(&self) {
        let ids: Vec<ConnectionId> = self.handles().keys().copied().collect();
        for id in ids {
            let _ = self.close(id); // Each is ended; a failure as it ends has no one to tell.
        }
    }
}

impl Drop for ConnectionManager {
    /// Every connection ended, and its worker with it (R-SAFE-5).
    fn drop(&mut self) {
        self.close_all();
    }
}
