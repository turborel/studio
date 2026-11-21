//! A schema's property graphs, for their diagrams (RULES.md D46,
//! `[DOC sql/07-information-schema.md The views]`): each graph's vertex and
//! edge tables, their labels, and the columns joining each edge table's
//! ends to its vertex tables.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::catalog::{Catalog, need, queries, text, yes};
use crate::error::Result;

/// A property graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    /// Its name.
    pub name: String,
    /// ENFORCED or TRUSTED.
    pub mode: String,
    /// Its element tables, the vertex tables first.
    pub elements: Vec<Element>,
}

/// An element table of a graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    /// Its alias in the graph.
    pub alias: String,
    /// VERTEX or EDGE.
    pub kind: String,
    /// Its table's schema, if it is a table's and not a query's.
    pub schema: Option<String>,
    /// Its table's name, so.
    pub table: Option<String>,
    /// Whether it is an undirected edge table.
    pub undirected: bool,
    /// Its labels, in order.
    pub labels: Vec<String>,
    /// Of an edge table, its ends: each the vertex table's alias, and the
    /// column pairs joining it.
    pub ends: Vec<End>,
}

/// An end of an edge table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct End {
    /// SOURCE or DESTINATION.
    pub end: String,
    /// The vertex table's alias.
    pub vertex: String,
    /// Each pair of the edge table's column and the vertex table's it
    /// matches.
    pub columns: Vec<(String, String)>,
}

impl Catalog<'_> {
    /// The property graphs of `schema` the user may see.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn graphs(&self, schema: &str) -> Result<Vec<Graph>> {
        let mut labels: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
        for r in self.rows(queries::GRAPH_LABELS, &[schema])? {
            labels.entry((need(&r, 0), need(&r, 1))).or_default().push(need(&r, 2));
        }
        let mut ends: BTreeMap<(String, String), Vec<End>> = BTreeMap::new();
        for r in self.rows(queries::GRAPH_ENDPOINTS, &[schema])? {
            let list = ends.entry((need(&r, 0), need(&r, 1))).or_default();
            let (end, vertex, pair) = (need(&r, 2), need(&r, 3), (need(&r, 4), need(&r, 5)));
            match list.iter_mut().find(|e| e.end == end && e.vertex == vertex) {
                Some(found) => found.columns.push(pair),
                None => list.push(End { end, vertex, columns: vec![pair] }),
            }
        }
        let mut elements: BTreeMap<String, Vec<Element>> = BTreeMap::new();
        for r in self.rows(queries::GRAPH_ELEMENTS, &[schema])? {
            let key = (need(&r, 0), need(&r, 1));
            elements.entry(key.0.clone()).or_default().push(Element {
                alias: key.1.clone(),
                kind: need(&r, 2),
                schema: text(&r, 3),
                table: text(&r, 4),
                undirected: yes(&r, 5),
                labels: labels.remove(&key).unwrap_or_default(),
                ends: ends.remove(&key).unwrap_or_default(),
            });
        }
        let graphs = self.rows(queries::GRAPHS, &[schema])?;
        Ok(graphs
            .iter()
            .map(|r| Graph { name: need(r, 0), mode: need(r, 1), elements: elements.remove(&need(r, 0)).unwrap_or_default() })
            .collect())
    }
}
