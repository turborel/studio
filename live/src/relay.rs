//! The relay (RULES.md D56): a QUIC server, `studio-relay`, that pairs a
//! guest with the host of its session and passes the bytes between them,
//! a TLS session of their own it cannot read. It has no accounts and keeps
//! its sessions in memory alone: a session is the host's while its
//! connection lasts, the first host of an identifier holding it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::cert::Identity;
use crate::error::{Result, failed};
use crate::frame;
use crate::transport::{RELAY_ALPN, RELAY_FRAME, RelayAnswer, RelayAsk, quic_server};

/// What a relay holds at most.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Sessions at once.
    pub sessions: usize,
    /// Guests of a session at once.
    pub guests: usize,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits { sessions: 1000, guests: 64 }
    }
}

/// The longest a peer refused is waited for to close its connection.
const FAREWELL_WITHIN: std::time::Duration = std::time::Duration::from_secs(5);
/// The most bytes a relay that records keeps of what it passed.
const RECORDED: usize = 1024 * 1024;

/// A session's host, and its guests now.
struct Session {
    host: quinn::Connection,
    guests: usize,
}

/// A relay's state.
pub struct Relay {
    limits: Limits,
    sessions: Mutex<HashMap<String, Session>>,
    /// What it passed, kept where it records, as its tests read it.
    recorded: Option<Mutex<Vec<u8>>>,
}

/// Whether `session` is an identifier: 32 hexadecimal digits.
fn identifier(session: &str) -> bool {
    session.len() == 32 && session.bytes().all(|b| b.is_ascii_hexdigit())
}

impl Relay {
    /// A relay of `limits`, which keeps the first MiB of what it passes if
    /// `record`, for its tests to read.
    pub fn new(limits: Limits, record: bool) -> Arc<Relay> {
        Arc::new(Relay { limits, sessions: Mutex::new(HashMap::new()), recorded: record.then(|| Mutex::new(Vec::new())) })
    }

    /// The bytes passed so far, of a relay that records.
    pub fn passed(&self) -> Vec<u8> {
        self.recorded.as_ref().map(|r| r.lock().unwrap_or_else(PoisonError::into_inner).clone()).unwrap_or_default()
    }

    /// The sessions held now.
    pub fn sessions(&self) -> usize {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner).len()
    }

    /// Listens on `bind` as `identity`, and serves each connection until the
    /// endpoint closes.
    ///
    /// # Errors
    ///
    /// Of an address that cannot be bound.
    pub fn listen(self: &Arc<Relay>, identity: &Identity, bind: std::net::SocketAddr) -> Result<quinn::Endpoint> {
        let endpoint = quic_server(identity, bind, RELAY_ALPN)?;
        let relay = Arc::clone(self);
        let serving = endpoint.clone();
        tokio::spawn(async move {
            while let Some(incoming) = serving.accept().await {
                let relay = Arc::clone(&relay);
                tokio::spawn(async move {
                    let _ = relay.serve(incoming).await; // A connection that fails ends alone.
                });
            }
        });
        Ok(endpoint)
    }

    /// Serves connection `incoming`: a host's registration, or a guest's join.
    async fn serve(&self, incoming: quinn::Incoming) -> Result<()> {
        let connection = incoming.await.map_err(|e| failed("a connection", e))?;
        let (mut send, mut recv) = connection.accept_bi().await.map_err(|e| failed("a stream", e))?;
        let served = match frame::read::<_, RelayAsk>(&mut recv, RELAY_FRAME).await? {
            Some(RelayAsk::Host { session }) => self.host(&connection, &mut send, session).await,
            Some(RelayAsk::Join { session }) => self.join(send, recv, &session).await,
            None => Ok(()),
        };
        // A refusal arrives before the connection closes: the peer closes it
        // once read, or is let go.
        let _ = tokio::time::timeout(FAREWELL_WITHIN, connection.closed()).await;
        served
    }

    /// Holds `session` for the host of `connection` while it lasts.
    async fn host(&self, connection: &quinn::Connection, send: &mut quinn::SendStream, session: String) -> Result<()> {
        let refusal = {
            let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
            if !identifier(&session) {
                Some("a session's identifier is 32 hexadecimal digits")
            } else if sessions.contains_key(&session) {
                Some("the session is held already")
            } else if sessions.len() >= self.limits.sessions {
                Some("the relay holds as many sessions as it may")
            } else {
                sessions.insert(session.clone(), Session { host: connection.clone(), guests: 0 });
                None
            }
        };
        if let Some(why) = refusal {
            frame::write(send, &RelayAnswer::Refused { why: why.to_owned() }, RELAY_FRAME).await?;
            let _ = send.finish(); // As the refusal is sent whole.
            return Ok(());
        }
        frame::write(send, &RelayAnswer::Ok, RELAY_FRAME).await?;
        connection.closed().await;
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner).remove(&session);
        Ok(())
    }

    /// The host of `session`, a guest counted, if it may take one more.
    fn guest_of(&self, session: &str) -> std::result::Result<quinn::Connection, &'static str> {
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        let held = sessions.get_mut(session).ok_or("no host holds the session")?;
        if held.guests >= self.limits.guests {
            return Err("the session has as many guests as the relay passes");
        }
        held.guests = held.guests.saturating_add(1);
        Ok(held.host.clone())
    }

    /// Pairs a guest's stream with a new stream of its session's host, and
    /// passes the bytes between them until either ends.
    async fn join(&self, mut send: quinn::SendStream, recv: quinn::RecvStream, session: &str) -> Result<()> {
        let host = match self.guest_of(session) {
            Ok(host) => host,
            Err(why) => {
                frame::write(&mut send, &RelayAnswer::Refused { why: why.to_owned() }, RELAY_FRAME).await?;
                let _ = send.finish(); // As the refusal is sent whole.
                return Ok(());
            }
        };
        let paired = async {
            let (to_host, from_host) = host.open_bi().await.map_err(|e| failed("a stream to the host", e))?;
            frame::write(&mut send, &RelayAnswer::Ok, RELAY_FRAME).await?;
            tokio::join!(self.pass(recv, to_host), self.pass(from_host, send));
            Ok::<(), crate::error::LiveError>(())
        };
        let passed = paired.await;
        if let Some(held) = self.sessions.lock().unwrap_or_else(PoisonError::into_inner).get_mut(session) {
            held.guests = held.guests.saturating_sub(1);
        }
        passed
    }

    /// Passes the bytes of `from` to `to` until `from` ends, then ends `to`.
    async fn pass<R: AsyncRead + Unpin, W: AsyncWrite + Unpin + Finish>(&self, mut from: R, mut to: W) {
        let mut buffer = vec![0u8; 16 * 1024];
        while let Ok(read) = from.read(&mut buffer).await {
            let Some(chunk) = buffer.get(..read).filter(|c| !c.is_empty()) else { break };
            if let Some(recorded) = &self.recorded {
                let mut kept = recorded.lock().unwrap_or_else(PoisonError::into_inner);
                let room = RECORDED.saturating_sub(kept.len());
                kept.extend(chunk.iter().take(room));
            }
            if to.write_all(chunk).await.is_err() {
                break;
            }
        }
        to.finish_stream();
    }
}

/// A stream that is ended, its peer told so.
trait Finish {
    /// Ends the stream.
    fn finish_stream(&mut self);
}

impl Finish for quinn::SendStream {
    fn finish_stream(&mut self) {
        let _ = self.finish(); // A stream already ended needs no ending.
    }
}
