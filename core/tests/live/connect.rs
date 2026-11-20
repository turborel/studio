//! Connecting, every way the settings allow (`[CLIENT Connecting by
//! settings]`).

use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::connections::session::Transport;
use turborel_studio_core::connections::spec::{APPLICATION, ConnectionSpec};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::policy::Guards;

use crate::server::{OWNER, OWNER_PASSWORD, PORT};
use crate::{Live, no_environment};

/// The cells of the first column of the result `sql` gives on `id`.
pub fn column(manager: &ConnectionManager, id: ConnectionId, sql: &str) -> Vec<Option<String>> {
    match crate::run(manager, id, sql).unwrap().outcome {
        Outcome::Rows { page, .. } => page.rows.into_iter().map(|row| row.into_iter().next().unwrap()).collect(),
        Outcome::Done { .. } => panic!("{sql} gave no rows"),
    }
}

/// [CLIENT Connecting] [RULE] R-SEC-3: a password over TLS is proved by
/// SCRAM, the server's certificate verified, and the session says it is
/// secure.
pub fn connect_over_tls_by_scram(live: &Live) {
    let (manager, _) = live.manager();
    let opened = manager.open((&live.spec(), Guards::default()), Some(&live.password()), no_environment).unwrap();
    let session = opened.session;
    assert_eq!(session.transport, Transport::Tls);
    assert_eq!(session.authorization, OWNER);
    assert!(session.owner && !session.lost);
    assert!(session.server.starts_with("turborel"), "{}", session.server);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT TLS by mode] [DESIGN] D26: by default the server's certificate
/// must be signed by an authority trusted, and the tests' is not the
/// platform's.
pub fn an_untrusted_certificate_is_refused(live: &Live) {
    let (manager, _) = live.manager();
    let spec = ConnectionSpec { tls_roots: None, tls_mode: None, ..live.spec() };
    let error = manager.open((&spec, Guards::default()), Some(&live.password()), no_environment).unwrap_err();
    assert!(error.sqlstate.starts_with("08"), "{error}");
    assert_eq!(manager.threads(), []);
}

/// [CLIENT Connecting by settings] [RULE] R-SEC-3: a password is refused
/// over plain TCP before anything is sent (SQLSTATE 28000).
pub fn a_password_is_refused_over_plain_tcp(live: &Live) {
    let (manager, _) = live.manager();
    let spec = ConnectionSpec { tls_mode: Some("disable".into()), ..live.spec() };
    let error = manager.open((&spec, Guards::default()), Some(&live.password()), no_environment).unwrap_err();
    assert_eq!(error.sqlstate, "28000", "{error}");
}

/// [CLIENT Connecting] A user trusted over the server's Unix socket needs
/// no password, and the session says it is local. Windows has no Unix
/// socket, so there the test passes untried (R-PLAT-4).
pub fn a_local_socket_is_trusted(live: &Live) {
    let Some(socket) = &live.server.socket else { return };
    let (manager, _) = live.manager();
    let spec = ConnectionSpec { host: Some(socket.display().to_string()), user: Some(OWNER.into()), ..ConnectionSpec::default() };
    let opened = manager.open((&spec, Guards::default()), None, no_environment).unwrap();
    assert_eq!(opened.session.transport, Transport::Local);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT The connection URI] A URI names the server, the user and the
/// settings.
pub fn connect_by_uri(live: &Live) {
    let (manager, _) = live.manager();
    let roots = live.server.certs.authority.display().to_string();
    let uri = format!("turborel://{OWNER}@localhost:{PORT}/?tls_mode=verify-full&tls_roots={roots}");
    let spec = ConnectionSpec { uri: Some(uri), ..ConnectionSpec::default() };
    let opened = manager.open((&spec, Guards::default()), Some(&live.password()), no_environment).unwrap();
    assert_eq!(opened.session.transport, Transport::Tls);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT The service file] A service names every setting but the
/// password.
pub fn connect_by_service_file(live: &Live) {
    let (manager, _) = live.manager();
    let file = live.server.dir.join("service.conf");
    let roots = live.server.certs.authority.display();
    let text = format!(
        "# Studio's live tests\n[studio]\nhost = localhost\nport = {PORT}\nuser = {OWNER}\ntls_mode = verify-full\ntls_roots = {roots}\n"
    );
    std::fs::write(&file, text).unwrap();
    let spec =
        ConnectionSpec { service: Some("studio".into()), service_file: Some(file.display().to_string()), ..ConnectionSpec::default() };
    let opened = manager.open((&spec, Guards::default()), Some(&live.password()), no_environment).unwrap();
    assert_eq!(opened.session.authorization, OWNER);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT The password file] A password not given is the password file's,
/// matched by host, port and user.
pub fn connect_by_password_file(live: &Live) {
    let (manager, _) = live.manager();
    let file = live.server.dir.join("passfile");
    std::fs::write(&file, format!("# Studio's live tests\nlocalhost:{PORT}:{OWNER}:{OWNER_PASSWORD}\n")).unwrap();
    let spec = ConnectionSpec { passfile: Some(file.display().to_string()), ..live.spec() };
    let opened = manager.open((&spec, Guards::default()), None, no_environment).unwrap();
    assert_eq!(opened.session.authorization, OWNER);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT Connecting] A user with no password is proved by the client
/// certificate the settings name.
pub fn connect_by_certificate(live: &Live) {
    let (manager, _) = live.manager();
    let (chain, key) = &live.server.certs.client;
    let spec =
        ConnectionSpec { tls_certificate: Some(chain.display().to_string()), tls_key: Some(key.display().to_string()), ..live.spec() };
    let opened = manager.open((&spec, Guards::default()), None, no_environment).unwrap();
    assert_eq!(opened.session.authorization, OWNER);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT Several servers] A server that cannot be reached is passed for
/// the next.
pub fn the_next_host_is_tried(live: &Live) {
    let (manager, _) = live.manager();
    let spec = ConnectionSpec { host: Some(format!("127.0.0.1:1,localhost:{PORT}")), port: None, ..live.spec() };
    let opened = manager.open((&spec, Guards::default()), Some(&live.password()), no_environment).unwrap();
    assert_eq!(opened.session.transport, Transport::Tls);
    manager.close(opened.connection).unwrap();
}

/// [CLIENT What a connection asks for] [DOC sql/07-information-schema.md This implementation's own views *(extension)*]
/// The server is told Studio's name, as the attribute `application`.
pub fn the_application_is_named(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let names = column(&manager, id, "SELECT APPLICATION FROM INFORMATION_SCHEMA.CONNECTIONS");
    assert!(names.contains(&Some(APPLICATION.to_owned())), "{names:?}");
    manager.close(id).unwrap();
}
