//! The live tests' TLS certificates (RULES.md R-TEST-8), made as the server
//! starts so no secret is ever committed: an authority, a certificate of
//! the server for localhost and 127.0.0.1, and a client's of the owner.

use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};

use rcgen::{BasicConstraints, CertificateParams, CertifiedIssuer, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, SanType};

/// The PEM files of the certificates.
#[derive(Debug, Clone)]
pub struct Certs {
    /// The authority's certificate.
    pub authority: PathBuf,
    /// The server's certificate and key.
    pub server: (PathBuf, PathBuf),
    /// The owner's client certificate and key.
    pub client: (PathBuf, PathBuf),
}

/// Writes `text` to `dir`'s file `name`, readable by a server of another
/// user in a container.
fn write(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, text).unwrap();
    path
}

/// Makes the certificates in `dir`, the client's of the user `user`.
pub fn make(dir: &Path, user: &str) -> Certs {
    let mut params = CertificateParams::new(Vec::<String>::new()).unwrap();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.distinguished_name.push(DnType::CommonName, "Studio live tests");
    let issuer = CertifiedIssuer::self_signed(params, KeyPair::generate().unwrap()).unwrap();
    let mut server = CertificateParams::new(vec!["localhost".to_owned()]).unwrap();
    server.subject_alt_names.push(SanType::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST)));
    let server_key = KeyPair::generate().unwrap();
    let server_cert = server.signed_by(&server_key, &issuer).unwrap();
    let mut client = CertificateParams::new(Vec::<String>::new()).unwrap();
    client.distinguished_name.push(DnType::CommonName, user);
    client.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
    let client_key = KeyPair::generate().unwrap();
    let client_cert = client.signed_by(&client_key, &issuer).unwrap();
    Certs {
        authority: write(dir, "ca.pem", &issuer.pem()),
        server: (write(dir, "server.pem", &server_cert.pem()), write(dir, "server.key", &server_key.serialize_pem())),
        client: (write(dir, "client.pem", &client_cert.pem()), write(dir, "client.key", &client_key.serialize_pem())),
    }
}
