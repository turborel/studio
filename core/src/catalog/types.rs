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
/// A structured type's references of a type of its own.
const USER_GENERATED: &str = "USER GENERATED";
/// A structured type's references derived of its attributes.
const DERIVED: &str = "DERIVED";

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
        let attributes: Vec<Attribute> = self
            .rows(queries::ATTRIBUTES, &[schema, name])?
            .iter()
            .map(|r| Attribute { name: need(r, 0), default: text(r, 1), type_written: type_at(r, 2) })
            .collect();
        let parent = self.rows(queries::SUPERTYPE, &[schema, name])?.first().map(|r| (need(r, 0), need(r, 1)));
        let inherited = match &parent {
            Some((s, n)) => self.rows(queries::ATTRIBUTES, &[s, n])?.len(),
            None => 0,
        };
        let supertype = parent.map(|(s, n)| qualified(&s, &n));
        let reference = (category != DISTINCT).then(|| text(row, 7)).flatten();
        let reference_using = (reference.as_deref() == Some(USER_GENERATED)).then(|| type_at(row, 3));
        let methods = self.methods(schema, name, &attributes)?;
        Ok(UserType {
            schema: schema.to_owned(),
            name: name.to_owned(),
            source: (category == DISTINCT).then(|| type_at(row, 3)),
            instantiable: yes(row, 1),
            is_final: yes(row, 2),
            category,
            attributes,
            supertype,
            inherited,
            reference,
            reference_using,
            methods,
        })
    }

    /// The method specifications of type `schema`.`name`, each written as
    /// CREATE TYPE writes it: not the observers and mutators the type makes
    /// of its `attributes`.
    fn methods(&self, schema: &str, name: &str, attributes: &[Attribute]) -> Result<Vec<String>> {
        let mut parameters: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
        for r in self.rows(queries::METHOD_PARAMETERS, &[schema])? {
            let mode = text(&r, 1).filter(|m| m != "IN").map(|m| format!("{m} ")).unwrap_or_default();
            let named = text(&r, 2).map(|n| format!("{} ", ident(&n))).unwrap_or_default();
            parameters.entry(need(&r, 0)).or_default().push(format!("{mode}{named}{}", type_at(&r, 3)));
        }
        let made = |r: &[crate::connections::cells::Cell]| {
            let specific = need(r, 0);
            let attribute = attributes.iter().any(|a| a.name == need(r, 1));
            attribute && (specific.ends_with("_OBSERVER") || specific.ends_with("_MUTATOR"))
        };
        Ok(self
            .rows(queries::METHODS, &[schema, name])?
            .iter()
            .filter(|r| !made(r))
            .map(|r| method_spec(r, &parameters.remove(&need(r, 0)).unwrap_or_default()))
            .collect())
    }
}

/// A method specification of a row of METHOD_SPECIFICATIONS and its
/// parameters, as CREATE TYPE writes it.
fn method_spec(r: &[crate::connections::cells::Cell], parameters: &[String]) -> String {
    let returns = if need(r, 5) == "USER-DEFINED" { qualified(&need(r, 9), &need(r, 10)) } else { type_at(r, 5) };
    let head = format!("METHOD {}({}) RETURNS {returns}", ident(&need(r, 1)), parameters.join(", "));
    if yes(r, 3) {
        return format!("OVERRIDING {head}");
    }
    let kind = if yes(r, 2) {
        "STATIC "
    } else if yes(r, 4) {
        "CONSTRUCTOR "
    } else {
        ""
    };
    let mut out = format!("{kind}{head} SPECIFIC {}", ident(&need(r, 0)));
    if yes(r, 12) {
        out.push_str(" DETERMINISTIC");
    }
    if let Some(access) = text(r, 11) {
        let _ = write!(out, " {access}"); // Writing to a String cannot fail.
    }
    if yes(r, 13) {
        out.push_str(" RETURNS NULL ON NULL INPUT");
    }
    out
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
        .skip(t.inherited)
        .map(|a| {
            let mut out = format!("    {} {}", ident(&a.name), a.type_written);
            if let Some(default) = &a.default {
                let _ = write!(out, " DEFAULT {default}"); // Writing to a String cannot fail.
            }
            out
        })
        .collect::<Vec<_>>()
        .join(",\n");
    let under = t.supertype.as_ref().map(|s| format!(" UNDER {s}")).unwrap_or_default();
    let representation = if attributes.is_empty() { String::new() } else { format!(" AS (\n{attributes}\n)") };
    let instantiable = if t.instantiable { "" } else { " NOT INSTANTIABLE" };
    let finality = if t.is_final { "FINAL" } else { "NOT FINAL" };
    let reference = match (t.supertype.is_some(), t.reference.as_deref(), &t.reference_using) {
        (false, Some(USER_GENERATED), Some(using)) => format!(" REF USING {using}"),
        _ => String::new(),
    };
    let derived = if t.supertype.is_none() && t.reference.as_deref() == Some(DERIVED) {
        "-- Its references are DERIVED of attributes the Information Schema does not tell: REF FROM (...).\n"
    } else {
        ""
    };
    let methods = if t.methods.is_empty() { String::new() } else { format!("\n    {}", t.methods.join(",\n    ")) };
    format!("{derived}CREATE TYPE {name}{under}{representation}{instantiable} {finality}{reference}{methods};\n")
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
            supertype: None,
            inherited: 0,
            reference: None,
            reference_using: None,
            methods: vec![],
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
        let abstracted = UserType { instantiable: false, is_final: true, ..address.clone() };
        assert!(create_type(&abstracted).ends_with(") NOT INSTANTIABLE FINAL;\n"));
    }

    /// [DOC sql/statements/create-type.md SYNOPSIS] [DESIGN] D33: a
    /// structured type is written UNDER its supertype, of its own
    /// attributes alone, its references as it represents them, and its
    /// method specifications; references derived of attributes the
    /// Information Schema does not tell are said so.
    #[test]
    fn a_structured_type_is_written_whole() {
        let name = Attribute { name: "NAME".into(), type_written: "CHARACTER VARYING(20)".into(), default: None };
        let school = Attribute { name: "SCHOOL".into(), type_written: "CHARACTER VARYING(20)".into(), default: None };
        let person = UserType {
            schema: "ANN".into(),
            name: "PERSON".into(),
            category: "STRUCTURED".into(),
            instantiable: true,
            is_final: false,
            source: None,
            attributes: vec![name.clone()],
            supertype: None,
            inherited: 0,
            reference: Some("USER GENERATED".into()),
            reference_using: Some("INTEGER".into()),
            methods: vec![
                "METHOD GREET(P CHARACTER VARYING(10)) RETURNS CHARACTER VARYING(40) SPECIFIC PERSON_GREET_1 CONTAINS SQL".into(),
            ],
        };
        assert_eq!(
            create_type(&person),
            "CREATE TYPE ANN.PERSON AS (\n    NAME CHARACTER VARYING(20)\n) NOT FINAL REF USING INTEGER\n    \
             METHOD GREET(P CHARACTER VARYING(10)) RETURNS CHARACTER VARYING(40) SPECIFIC PERSON_GREET_1 CONTAINS SQL;\n"
        );
        let student = UserType {
            name: "STUDENT".into(),
            attributes: vec![name, school],
            supertype: Some("ANN.PERSON".into()),
            inherited: 1,
            methods: vec!["OVERRIDING METHOD GREET(P CHARACTER VARYING(10)) RETURNS CHARACTER VARYING(40)".into()],
            ..person.clone()
        };
        assert_eq!(
            create_type(&student),
            "CREATE TYPE ANN.STUDENT UNDER ANN.PERSON AS (\n    SCHOOL CHARACTER VARYING(20)\n) NOT FINAL\n    \
             OVERRIDING METHOD GREET(P CHARACTER VARYING(10)) RETURNS CHARACTER VARYING(40);\n"
        );
        let bare = UserType { attributes: vec![student.attributes[0].clone()], methods: vec![], ..student };
        assert_eq!(create_type(&bare), "CREATE TYPE ANN.STUDENT UNDER ANN.PERSON NOT FINAL;\n");
        let place = UserType { name: "PLACE".into(), reference: Some("DERIVED".into()), reference_using: None, methods: vec![], ..person };
        assert!(create_type(&place).starts_with("-- Its references are DERIVED"));
    }
}
