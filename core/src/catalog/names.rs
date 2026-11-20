//! Names as SQL writes them (`[DOC sql/03-names.md Names and Qualification]`): an identifier
//! the Information Schema gives, written bare where Turborel's own lexer
//! reads it back as the same identifier, and delimited, its quotes
//! doubled, where it would not, as a name in lower case or a key word.

use turborel::lexer::{Tok, lex};

/// The quote that delimits an identifier.
const QUOTE: char = '"';

/// `name` as SQL writes it.
pub fn ident(name: &str) -> String {
    let tokens = lex(name).unwrap_or_default();
    let mut read = tokens.iter().filter(|t| t.tok != Tok::End);
    let bare = matches!((read.next(), read.next()), (Some(token), None) if token.tok == Tok::Identifier(name.to_owned()));
    if bare {
        return name.to_owned();
    }
    let doubled = name.replace(QUOTE, "\"\"");
    format!("{QUOTE}{doubled}{QUOTE}")
}

/// `schema`.`name` as SQL writes them.
pub fn qualified(schema: &str, name: &str) -> String {
    format!("{}.{}", ident(schema), ident(name))
}

/// `text` as a character string literal, its quotes doubled.
pub fn literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::{ident, literal, qualified};

    /// [DOC sql/01-lexical.md Key words] A regular identifier is written bare,
    /// and one in lower case, with a space or a quote, or a key word, is
    /// delimited.
    #[test]
    fn names_are_delimited_where_they_must_be() {
        assert_eq!(ident("STAFF"), "STAFF");
        assert_eq!(ident("ORDER_2"), "ORDER_2");
        assert_eq!(ident("staff"), "\"staff\"");
        assert_eq!(ident("SELECT"), "\"SELECT\"");
        assert_eq!(ident("A B"), "\"A B\"");
        assert_eq!(ident("SAY\"HI"), "\"SAY\"\"HI\"");
        assert_eq!(qualified("ANN", "order"), "ANN.\"order\"");
        assert_eq!(literal("ann's"), "'ann''s'");
    }
}
