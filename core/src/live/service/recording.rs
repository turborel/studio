//! The record of the session hosted (RULES.md D67): begun and ended as
//! the session's choice says, each workspace shared and each event of the
//! host's kept in it; and the records kept, listed and read back.

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use turborel_studio_live::host::HostEvent;

use super::{LiveService, misuse};
use crate::error::Result;
use crate::live::record::{Entry, KEY_ENTRY, RecordInfo, RecordRead, Recorder, key, list, now_ms, read};
use crate::live::settings::LiveSettings;
use crate::live::share::read_shared;

/// Keeps in the record, if one is kept, what of `event` it holds: a
/// workspace a viewer presented, a suggestion, a viewer admitted or gone.
/// A record that cannot be written is let be, as the session goes on.
pub(super) fn recorded(recording: &Mutex<Option<Recorder>>, event: &HostEvent) {
    let mut slot = recording.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(recorder) = slot.as_mut() else { return };
    let at = now_ms();
    let _ = match event {
        HostEvent::State { state, presenter } if read_shared(state).is_some() => recorder.shared(state, Some(presenter)),
        HostEvent::Suggested { name, tab, sql, .. } => {
            recorder.keep(&Entry::Suggested { at, by: name.clone(), tab: tab.clone(), sql: sql.clone() })
        }
        HostEvent::Joined { name, .. } => recorder.keep(&Entry::Joined { at, by: name.clone() }),
        HostEvent::Left { name, .. } => recorder.keep(&Entry::Left { at, by: name.clone() }),
        HostEvent::Asked { .. } | HostEvent::Turned { .. } | HostEvent::Hand { .. } | HostEvent::State { .. } => Ok(()),
    };
}

impl LiveService {
    /// The record kept, locked.
    pub(super) fn recording(&self) -> MutexGuard<'_, Option<Recorder>> {
        self.recording.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Begins the record of `session`, as `settings` say: sealed under the
    /// keychain's key if they say so.
    pub(super) fn start_recording(&self, settings: &LiveSettings, session: &str) -> Result<()> {
        let key = if settings.records.sealed { Some(key(&*self.secrets)?) } else { None };
        let recorder = Recorder::start(&self.records, (session, &settings.name), key.as_ref())?;
        *self.recording() = Some(recorder);
        self.log("recording", None, None);
        Ok(())
    }

    /// Ends the record kept, if one is.
    pub(super) fn stop_recording(&self) {
        if let Some(mut recorder) = self.recording().take() {
            let _ = recorder.keep(&Entry::Ended { at: now_ms() }); // A record that cannot be written ends all the same.
            self.log("recorded", None, Some(&recorder.path().display().to_string()));
        }
    }

    /// The records kept on this machine, the latest first (D67).
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if their folder cannot be read.
    pub fn records(&self) -> Result<Vec<RecordInfo>> {
        list(&self.records)
    }

    /// The record at `path`, one of this machine's, read back: opened under
    /// the keychain's key if it is sealed.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a file not among the records, or one `record::read`
    /// refuses.
    pub fn record(&self, path: &Path) -> Result<RecordRead> {
        let within = |p: &Path| p.canonicalize().ok();
        let (Some(file), Some(dir)) = (within(path), within(&self.records)) else {
            return Err(misuse("no such record of a session"));
        };
        if file.parent() != Some(dir.as_path()) {
            return Err(misuse("only a record this Studio kept is read"));
        }
        let key = match self.secrets.get(KEY_ENTRY)? {
            Some(_) => Some(key(&*self.secrets)?),
            None => None,
        };
        read(&file, key.as_ref())
    }
}
