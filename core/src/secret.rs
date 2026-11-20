//! A secret held by the backend (RULES.md R-SEC-1): a password or a key,
//! never shown by `Debug` or `Display`, and never serialized, so it can
//! reach neither a log nor the webview.

/// A password or a key.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    /// The secret `text`.
    pub fn new(text: impl Into<String>) -> Secret {
        Secret(text.into())
    }

    /// Its text, for the one use that needs it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    /// Never its text.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(..)")
    }
}

#[cfg(test)]
mod tests {
    use super::Secret;

    /// [RULE] R-SEC-1: a secret's debug form never shows it.
    #[test]
    fn debug_never_shows_the_secret() {
        let secret = Secret::new("ann's secret");
        assert_eq!(format!("{secret:?}"), "Secret(..)");
        assert_eq!(secret.expose(), "ann's secret");
    }
}
