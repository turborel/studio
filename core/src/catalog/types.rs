//! User-defined types, read from USER_DEFINED_TYPES and ATTRIBUTES
//! (`[DOC sql/07-information-schema.md The views]`), and written as
//! CREATE TYPE (`[DOC sql/statements/create-type.md SYNOPSIS]`).

use std::fmt::Write as _;

use crate::catalog::model::{Attribute, UserType};
use crate::catalog::names::{ident, qualified};
use crate::catalog::read::type_at;
use crate::catalog::{Catalog, need, queries, text, yes};
use crate::error::{Result, StudioError};

/// A distinct type's category.
const DISTINCT: &str = "DISTINCT";

impl Catalog<'_> {
    /// The type `schema`.`name`, whole.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the user may see no such type; the server's.
    pub fn user_type(&self, schema: &str, name: &str) -> Result<UserType> {
        let rows = self.rows(queries::USER_TYPE, &[schema, name])?;
        let row = rows.first().ok_or_else(|| StudioError::misuse(format!("[DESIGN] no type {schema}.{name} is to be seen")))?;
        let category = need(row, 0);
        let attributes = self
            .rows(queries::ATTRIBUTES, &[schema, name])?
            .iter()
            .map(|r| Attribute { name: need(r, 0), default: text(r, 1), type_written: type_at(r, 2) })
            .collect();
        Ok(UserType {
            schema: schema.to_owned(),
            name: name.to_owned(),
            source: (category == DISTINCT).then(|| type_at(row, 3)),
            instantiable: yes(row, 1),
            is_final: yes(row, 2),
            category,
            attributes,
        })
    }
}

/// A type's CREATE TYPE: a distinct type of its source, a structured
/// type of its attributes, INSTANTIABLE and FINAL as it is.
pub fn create_type(t: &UserType) -> String {
    let name = qualified(&t.schema, &t.name);
    if let Some(source) = &t.source {
        return format!("CREATE TYPE {name} AS {source};\n");
    }
    let attributes = t
        .attributes
        .iter()
        .map(|a| {
            let mut out = format!("    {} {}", ident(&a.name), a.type_written);
            if let Some(default) = &a.default {
                let _ = write!(out, " DEFAULT {default}"); // Writing to a String cannot fail.
            }
            out
        })
        .collect::<Vec<_>>()
        .join(",\n");
    let instantiable = if t.instantiable { "" } else { " NOT INSTANTIABLE" };
    let finality = if t.is_final { "FINAL" } else { "NOT FINAL" };
    format!("CREATE TYPE {name} AS (\n{attributes}\n){instantiable} {finality};\n")
}

#[cfg(test)]
mod tests {
    use super::create_type;
    use crate::catalog::model::{Attribute, UserType};

    /// [DOC sql/statements/create-type.md SYNOPSIS] [DESIGN] D33: a distinct
    /// type is written of its source, a structured type of its attributes,
    /// their defaults, and whether it is instantiable and final.
    #[test]
    fn a_type_is_written_of_its_representation() {
        let money = UserType {
            schema: "ANN".into(),
            name: "MONEY".into(),
            category: "DISTINCT".into(),
            instantiable: true,
            is_final: true,
            source: Some("DECIMAL(10,2)".into()),
            attributes: vec![],
        };
        assert_eq!(create_type(&money), "CREATE TYPE ANN.MONEY AS DECIMAL(10,2);\n");
        let street = Attribute { name: "STREET".into(), type_written: "CHARACTER VARYING(30)".into(), default: None };
        let city = Attribute { name: "city".into(), type_written: "CHARACTER VARYING(20)".into(), default: Some("'Rome'".into()) };
        let address = UserType {
            name: "ADDRESS".into(),
            category: "STRUCTURED".into(),
            is_final: false,
            source: None,
            attributes: vec![street, city],
            ..money.clone()
        };
        assert_eq!(
            create_type(&address),
            "CREATE TYPE ANN.ADDRESS AS (\n    STREET CHARACTER VARYING(30),\n    \"city\" CHARACTER VARYING(20) DEFAULT 'Rome'\n) NOT FINAL;\n"
        );
        let abstracted = UserType { instantiable: false, is_final: true, ..address };
        assert!(create_type(&abstracted).ends_with(") NOT INSTANTIABLE FINAL;\n"));
    }
}
