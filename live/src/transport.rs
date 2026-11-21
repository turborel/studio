//! The transport (RULES.md D56): QUIC by quinn, TLS 1.3 alone by rustls
//! on aws-lc-rs. A guest reaches its host directly, the QUIC session's TLS
//! pinned to the host's fingerprint; or through a relay, over a stream the
//! relay pairs, inside which the guest and host run a TLS 1.3 session of
//! their own, pinned the same way, so the relay passes bytes it cannot
//! read. Each channel's safety code is drawn from its TLS session's keys
//! (RFC 8446 §7.5), the same on both sides of one session and on no other.

use std::any::Any;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use rustls::pki_types::ServerName;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::cert::{Fingerprint, Identity, Pinned, SERVER_NAME, provider};
use crate::error::{LiveError, Result, failed, refused};
use crate::frame;
use crate::invite::RelaySpec;

/// The protocol a session's TLS names.
pub const ALPN: &[u8] = b"turborel-studio-live/1";
/// The protocol a relay's TLS names.
pub const RELAY_ALPN: &[u8] = b"turborel-studio-relay/1";
/// The label of the keys a safety code is drawn from.
const EXPORT_LABEL: &[u8] = b"EXPORTER-turborel-studio-live-safety-code";
/// The longest a connection takes to be made.
pub const CONNECT_WITHIN: Duration = Duration::from_secs(10);
/// The longest a QUIC connection is idle before it is closed.
const IDLE: Duration = Duration::from_secs(60);
/// How often an idle connection is kept alive.
const KEEP_ALIVE: Duration = Duration::from_secs(10);
/// The longest frame of a relay's own messages.
pub const RELAY_FRAME: u32 = 4096;

/// A channel between a guest and its host: its two directions, its safety
/// code, and what keeps it open.
pub struct Channel {
    /// What the peer sends.
    pub reader: Box<dyn AsyncRead + Send + Unpin>,
    /// What is sent the peer.
    pub writer: Box<dyn AsyncWrite + Send + Unpin>,
    /// The safety code, six digits, a space after the third.
    pub code: String,
    /// The connection and endpoint, held while the channel is.
    keep: Box<dyn Any + Send>,
}

/// The parts of a channel: what the peer sends, what is sent it, its
/// safety code, and what keeps it open, held while the parts are used.
pub type Parts = (Box<dyn AsyncRead + Send + Unpin>, Box<dyn AsyncWrite + Send + Unpin>, String, Box<dyn Any + Send>);

impl Channel {
    /// The channel's parts.
    pub fn into_parts(self) -> Parts {
        (self.reader, self.writer, self.code, self.keep)
    }
}

/// A relay's message, of a host or a guest, before it pairs them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RelayAsk {
    /// A host's session, to be reached through the relay.
    Host {
        /// The session's identifier.
        session: String,
    },
    /// A guest's, to reach the host of the session.
    Join {
        /// The session's identifier.
        session: String,
    },
}

/// A relay's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RelayAnswer {
    /// Done.
    Ok,
    /// Not done, and why.
    Refused {
        /// Why.
        why: String,
    },
}

/// A failure of the network, of `what`.
fn net<E: std::fmt::Display>(what: &'static str) -> impl Fn(E) -> LiveError {
    move |e| failed(what, e)
}

/// The safety code of four bytes of keying material: six digits.
pub fn safety_code(material: [u8; 4]) -> String {
    let digits = format!("{:06}", u32::from_be_bytes(material).checked_rem(1_000_000).unwrap_or(0));
    match digits.split_at_checked(3) {
        Some((a, b)) => format!("{a} {b}"),
        None => digits,
    }
}

/// QUIC's transport settings: an idle connection kept alive, and closed
/// past a minute of silence.
fn transport() -> Result<Arc<quinn::TransportConfig>> {
    let mut config = quinn::TransportConfig::default();
    let idle = quinn::IdleTimeout::try_from(IDLE).map_err(|e| failed("QUIC's settings", e))?;
    config.max_idle_timeout(Some(idle)).keep_alive_interval(Some(KEEP_ALIVE));
    Ok(Arc::new(config))
}

/// A TLS 1.3 server's configuration of `identity`, naming `alpn`.
///
/// # Errors
///
/// Of a key rustls refuses.
pub fn server_tls(identity: &Identity, alpn: &[u8]) -> Result<rustls::ServerConfig> {
    let mut config = rustls::ServerConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| failed("TLS", e))?
        .with_no_client_auth()
        .with_single_cert(vec![identity.certificate.clone()], identity.key())
        .map_err(|e| failed("the session's certificate", e))?;
    config.alpn_protocols = vec![alpn.to_vec()];
    Ok(config)
}

/// A TLS 1.3 client's configuration that accepts the certificate `pin`
/// alone, naming `alpn`.
///
/// # Errors
///
/// Never, but as rustls refuses its own versions.
pub fn client_tls(pin: Fingerprint, alpn: &[u8]) -> Result<rustls::ClientConfig> {
    let mut config = rustls::ClientConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|e| failed("TLS", e))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned::new(pin)))
        .with_no_client_auth();
    config.alpn_protocols = vec![alpn.to_vec()];
    Ok(config)
}

/// A QUIC server of `identity`, bound to `bind`, naming `alpn`.
///
/// # Errors
///
/// Of an address that cannot be bound. It is called within a tokio runtime.
pub fn quic_server(identity: &Identity, bind: SocketAddr, alpn: &[u8]) -> Result<quinn::Endpoint> {
    let tls = quinn::crypto::rustls::QuicServerConfig::try_from(server_tls(identity, alpn)?).map_err(net("QUIC's TLS"))?;
    let mut config = quinn::ServerConfig::with_crypto(Arc::new(tls));
    config.transport_config(transport()?);
    quinn::Endpoint::server(config, bind).map_err(|e| failed(&format!("cannot listen on {bind}"), e))
}

/// A QUIC connection to `target`, pinned to `pin`, naming `alpn`, and its endpoint.
async fn quic_connect(target: SocketAddr, pin: Fingerprint, alpn: &[u8]) -> Result<(quinn::Endpoint, quinn::Connection)> {
    let tls = quinn::crypto::rustls::QuicClientConfig::try_from(client_tls(pin, alpn)?).map_err(net("QUIC's TLS"))?;
    let mut config = quinn::ClientConfig::new(Arc::new(tls));
    config.transport_config(transport()?);
    let any: SocketAddr = if target.is_ipv6() { (Ipv6Addr::UNSPECIFIED, 0).into() } else { (Ipv4Addr::UNSPECIFIED, 0).into() };
    let mut endpoint = quinn::Endpoint::client(any).map_err(net("a QUIC endpoint"))?;
    endpoint.set_default_client_config(config);
    let connecting = endpoint.connect(target, SERVER_NAME).map_err(|e| failed(&format!("cannot reach {target}"), e))?;
    let connection = tokio::time::timeout(CONNECT_WITHIN, connecting)
        .await
        .map_err(|_| refused(format!("{target} did not answer within {} seconds", CONNECT_WITHIN.as_secs())))?
        .map_err(|e| failed(&format!("cannot reach {target}"), e))?;
    Ok((endpoint, connection))
}

/// The safety code of QUIC connection `connection` of session `session`.
fn quic_code(connection: &quinn::Connection, session: &str) -> Result<String> {
    let mut material = [0u8; 4];
    connection
        .export_keying_material(&mut material, EXPORT_LABEL, session.as_bytes())
        .map_err(|_| refused("the session's keys cannot be read"))?;
    Ok(safety_code(material))
}

/// The address `address`, `host:port`, resolves to first.
///
/// # Errors
///
/// Of a name that does not resolve.
pub async fn resolve(address: &str) -> Result<SocketAddr> {
    tokio::net::lookup_host(address)
        .await
        .map_err(|e| failed(&format!("cannot resolve {address}"), e))?
        .next()
        .ok_or_else(|| refused(format!("{address} resolves to no address")))
}

/// A guest's channel to the host at `target` directly, pinned to `pin`,
/// of session `session`.
///
/// # Errors
///
/// Of a host that cannot be reached, or whose certificate is not `pin`.
pub async fn dial_direct(target: SocketAddr, pin: Fingerprint, session: &str) -> Result<Channel> {
    let (endpoint, connection) = quic_connect(target, pin, ALPN).await?;
    let (send, recv) = connection.open_bi().await.map_err(net("a stream to the host"))?;
    let code = quic_code(&connection, session)?;
    Ok(Channel { reader: Box::new(recv), writer: Box::new(send), code, keep: Box::new((endpoint, connection)) })
}

/// The host's channel of a guest's `incoming` connection, of session `session`.
///
/// # Errors
///
/// Of a connection that fails before its first stream.
pub async fn accept_direct(incoming: quinn::Incoming, session: &str) -> Result<Channel> {
    let connection = tokio::time::timeout(CONNECT_WITHIN, incoming)
        .await
        .map_err(|_| refused("a guest did not finish connecting"))?
        .map_err(net("a guest's connection"))?;
    let (send, recv) = tokio::time::timeout(CONNECT_WITHIN, connection.accept_bi())
        .await
        .map_err(|_| refused("a guest opened no stream"))?
        .map_err(net("a guest's stream"))?;
    let code = quic_code(&connection, session)?;
    Ok(Channel { reader: Box::new(recv), writer: Box::new(send), code, keep: Box::new(connection) })
}

/// Asks the relay of `relay`'s spec `ask`: its connection, and the stream
/// it answered on.
async fn ask_relay(
    relay: &RelaySpec,
    ask: &RelayAsk,
) -> Result<(quinn::Endpoint, quinn::Connection, quinn::SendStream, quinn::RecvStream)> {
    let target = resolve(&relay.address).await?;
    let (endpoint, connection) = quic_connect(target, Fingerprint::parse(&relay.fingerprint)?, RELAY_ALPN).await?;
    let (mut send, mut recv) = connection.open_bi().await.map_err(net("a stream to the relay"))?;
    frame::write(&mut send, ask, RELAY_FRAME).await?;
    match frame::read::<_, RelayAnswer>(&mut recv, RELAY_FRAME).await? {
        Some(RelayAnswer::Ok) => Ok((endpoint, connection, send, recv)),
        Some(RelayAnswer::Refused { why }) => Err(refused(format!("the relay refused: {why}"))),
        None => Err(refused("the relay closed the stream")),
    }
}

/// A host's place at a relay: the guests the relay pairs with it arrive as
/// streams of its connection.
pub struct RelayHost {
    connection: quinn::Connection,
    _keep: Box<dyn Any + Send + Sync>,
}

impl RelayHost {
    /// Registers session `session` at `relay`.
    ///
    /// # Errors
    ///
    /// Of a relay that cannot be reached, is not `relay.fingerprint`'s, or
    /// refuses the session.
    pub async fn register(relay: &RelaySpec, session: &str) -> Result<RelayHost> {
        let (endpoint, connection, send, recv) = ask_relay(relay, &RelayAsk::Host { session: session.to_owned() }).await?;
        Ok(RelayHost { connection, _keep: Box::new((endpoint, send, recv)) })
    }

    /// The next guest the relay pairs, as the host's channel to it: a TLS
    /// session of `identity`'s inside the relay's stream; none when the
    /// relay's connection ends.
    ///
    /// # Errors
    ///
    /// Of a guest whose TLS fails.
    pub async fn accept(&self, identity: &Identity, session: &str) -> Option<Result<Channel>> {
        let (send, recv) = self.connection.accept_bi().await.ok()?;
        Some(secure_host(identity, (send, recv), session).await)
    }

    /// Closes the host's place at the relay.
    pub fn close(&self) {
        self.connection.close(0u32.into(), b"ended");
    }
}

/// The host's side of a TLS session of `identity` inside the relay's stream.
async fn secure_host(identity: &Identity, (send, recv): (quinn::SendStream, quinn::RecvStream), session: &str) -> Result<Channel> {
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_tls(identity, ALPN)?));
    let stream = tokio::time::timeout(CONNECT_WITHIN, acceptor.accept(tokio::io::join(recv, send)))
        .await
        .map_err(|_| refused("a guest did not finish its TLS handshake"))?
        .map_err(net("a guest's TLS handshake"))?;
    let material =
        stream.get_ref().1.export_keying_material([0u8; 4], EXPORT_LABEL, Some(session.as_bytes())).map_err(net("the session's keys"))?;
    let (reader, writer) = tokio::io::split(stream);
    Ok(Channel { reader: Box::new(reader), writer: Box::new(writer), code: safety_code(material), keep: Box::new(()) })
}

/// A guest's channel to the host of session `session` through `relay`: a
/// TLS session pinned to `pin`, inside the stream the relay pairs.
///
/// # Errors
///
/// Of a relay that cannot be reached or refuses, or a host whose
/// certificate is not `pin`.
pub async fn dial_relay(relay: &RelaySpec, pin: Fingerprint, session: &str) -> Result<Channel> {
    let (endpoint, connection, send, recv) = ask_relay(relay, &RelayAsk::Join { session: session.to_owned() }).await?;
    let connector = tokio_rustls::TlsConnector::from(Arc::new(client_tls(pin, ALPN)?));
    let name = ServerName::try_from(SERVER_NAME).map_err(net("the host's name"))?;
    let stream = tokio::time::timeout(CONNECT_WITHIN, connector.connect(name, tokio::io::join(recv, send)))
        .await
        .map_err(|_| refused("the host did not finish its TLS handshake"))?
        .map_err(net("the host's TLS handshake"))?;
    let material =
        stream.get_ref().1.export_keying_material([0u8; 4], EXPORT_LABEL, Some(session.as_bytes())).map_err(net("the session's keys"))?;
    let (reader, writer) = tokio::io::split(stream);
    Ok(Channel { reader: Box::new(reader), writer: Box::new(writer), code: safety_code(material), keep: Box::new((endpoint, connection)) })
}

#[cfg(test)]
mod tests {
    use super::safety_code;

    /// [DESIGN] D56: a safety code is six digits, a space after the third.
    #[test]
    fn a_safety_code_is_six_digits() {
        assert_eq!(safety_code([0, 0, 0, 7]), "000 007");
        assert_eq!(safety_code([255, 255, 255, 255]), "967 295");
    }
}
