//! A session's identity, and the pinning of it (RULES.md D56): a
//! certificate made for the session as it starts, of a key that never
//! leaves the host's memory, known to a guest by its fingerprint alone, the
//! SHA-256 of its DER. A guest accepts the certificate whose fingerprint
//! the invitation carries, and no other; its handshake's signature is
//! still checked, so only the key's holder passes.

use std::fmt;
use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};

use crate::error::{Result, failed, refused};

/// The name a session's certificate is made for, and a guest asks for.
pub const SERVER_NAME: &str = "turborel-studio-live";

/// The SHA-256 of a certificate's DER.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Fingerprint(pub [u8; 32]);

impl Fingerprint {
    /// The fingerprint of `certificate`.
    pub fn of(certificate: &[u8]) -> Fingerprint {
        let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, certificate);
        let mut out = [0u8; 32];
        out.copy_from_slice(digest.as_ref());
        Fingerprint(out)
    }

    /// The fingerprint written in hexadecimal, as `Display` writes it,
    /// colons between its bytes allowed.
    ///
    /// # Errors
    ///
    /// Of text that is not 32 bytes of hexadecimal.
    pub fn parse(text: &str) -> Result<Fingerprint> {
        let digits: String = text.chars().filter(|c| *c != ':' && !c.is_whitespace()).collect();
        let bytes: Option<Vec<u8>> = digits
            .as_bytes()
            .chunks(2)
            .map(|pair| std::str::from_utf8(pair).ok().filter(|p| p.len() == 2).and_then(|p| u8::from_str_radix(p, 16).ok()))
            .collect();
        let bytes = bytes.ok_or_else(|| refused("a fingerprint is 32 bytes of hexadecimal"))?;
        <[u8; 32]>::try_from(bytes.as_slice()).map(Fingerprint).map_err(|_| refused("a fingerprint is 32 bytes of hexadecimal"))
    }
}

impl fmt::Display for Fingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pairs: Vec<String> = self.0.iter().map(|b| format!("{b:02X}")).collect();
        f.write_str(&pairs.join(":"))
    }
}

impl fmt::Debug for Fingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

/// A certificate, its key, and its fingerprint.
pub struct Identity {
    /// The certificate, DER.
    pub certificate: CertificateDer<'static>,
    /// Its key, PKCS #8 DER, held in memory alone.
    key: PrivatePkcs8KeyDer<'static>,
    /// Its fingerprint.
    pub fingerprint: Fingerprint,
}

impl Identity {
    /// A certificate made now for `SERVER_NAME`, of a new key.
    ///
    /// # Errors
    ///
    /// If the key or certificate cannot be made.
    pub fn new() -> Result<Identity> {
        let made = rcgen::generate_simple_self_signed(vec![SERVER_NAME.to_owned()]).map_err(|e| failed("the session's certificate", e))?;
        Ok(Identity::of(made.cert.der().clone(), made.signing_key.serialize_der()))
    }

    /// The identity of `certificate` and its PKCS #8 `key`, as a relay
    /// reads them from its files.
    pub fn of(certificate: CertificateDer<'static>, key: Vec<u8>) -> Identity {
        let fingerprint = Fingerprint::of(&certificate);
        Identity { certificate, key: PrivatePkcs8KeyDer::from(key), fingerprint }
    }

    /// The key, for a TLS server's configuration.
    pub fn key(&self) -> PrivateKeyDer<'static> {
        PrivateKeyDer::Pkcs8(self.key.clone_key())
    }
}

/// The cryptography of every TLS session: aws-lc-rs, never ring.
pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::aws_lc_rs::default_provider())
}

/// A verifier that accepts the certificate of fingerprint `pin` alone.
#[derive(Debug)]
pub struct Pinned {
    pin: Fingerprint,
    provider: Arc<CryptoProvider>,
}

impl Pinned {
    /// The verifier of `pin`.
    pub fn new(pin: Fingerprint) -> Pinned {
        Pinned { pin, provider: provider() }
    }
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        if Fingerprint::of(end_entity) == self.pin {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("the certificate is not the one the invitation names".to_owned()))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::{Fingerprint, Identity};

    /// [DESIGN] D56: a session's certificate is new each time, and its
    /// fingerprint is written and read back.
    #[test]
    fn a_fingerprint_is_written_and_read() {
        let one = Identity::new().unwrap();
        let two = Identity::new().unwrap();
        assert_ne!(one.fingerprint, two.fingerprint);
        let written = one.fingerprint.to_string();
        assert_eq!(written.len(), 32 * 3 - 1);
        assert_eq!(Fingerprint::parse(&written).unwrap(), one.fingerprint);
        assert_eq!(Fingerprint::parse(&written.replace(':', "").to_lowercase()).unwrap(), one.fingerprint);
        assert!(Fingerprint::parse("AB:CD").is_err());
        assert!(Fingerprint::parse(&"ZZ".repeat(32)).is_err());
        assert_eq!(format!("{:?}", one.fingerprint), written);
        assert!(matches!(one.key(), rustls::pki_types::PrivateKeyDer::Pkcs8(_)));
    }
}
