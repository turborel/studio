//! A table's partitions and its indexes' options, read from the views
//! of partitioned tables and of index options
//! (`[DOC sql/23-partitioning.md The Information Schema]`).

use std::collections::BTreeMap;

use crate::catalog::model::{Index, Partition, PartitionOf, Partitioning};
use crate::catalog::names::literal;
use crate::catalog::{Catalog, need, queries, yes};
use crate::error::Result;

/// How INDEX_OPTIONS' VALUE_KIND begins for an option whose value is text.
const TEXT_KIND: &str = "TEXT";

impl Catalog<'_> {
    /// How `schema`.`name` is partitioned, if it is.
    pub(crate) fn partitioning(&self, schema: &str, name: &str) -> Result<Option<Partitioning>> {
        let Some(row) = self.rows(queries::PARTITIONED, &[schema, name])?.into_iter().next() else {
            return Ok(None);
        };
        let partitions = self.rows(queries::PARTITIONS, &[schema, name])?;
        Ok(Some(Partitioning {
            strategy: need(&row, 0),
            key: need(&row, 1),
            partitions: partitions
                .iter()
                .map(|r| Partition { schema: need(r, 0), name: need(r, 1), bound: need(r, 2), partitioned: yes(r, 3) })
                .collect(),
        }))
    }

    /// The table `schema`.`name` is a partition of, if it is one.
    pub(crate) fn partition_of(&self, schema: &str, name: &str) -> Result<Option<PartitionOf>> {
        let rows = self.rows(queries::PARTITION_OF, &[schema, name])?;
        Ok(rows.first().map(|r| PartitionOf { schema: need(r, 0), name: need(r, 1), bound: need(r, 2) }))
    }

    /// The names of the indexes made on the partition `schema`.`name` by
    /// its table's indexes.
    pub(crate) fn made_by_templates(&self, schema: &str, name: &str) -> Result<Vec<String>> {
        Ok(self.rows(queries::INDEXES_OF_PARTITION, &[schema, name])?.iter().map(|r| need(r, 0)).collect())
    }

    /// The indexes of the partitioned table `schema`.`name`, each as an
    /// index of a partition it made shows it, named as CREATE INDEX named
    /// it.
    pub(crate) fn templates(&self, schema: &str, name: &str) -> Result<Vec<Index>> {
        let mut first: BTreeMap<String, (String, String, String)> = BTreeMap::new();
        for r in self.rows(queries::PARTITION_INDEXES, &[schema, name])? {
            first.entry(need(&r, 0)).or_insert_with(|| (need(&r, 1), need(&r, 2), need(&r, 3)));
        }
        let mut found = Vec::with_capacity(first.len());
        for (template, (partition_schema, partition, index)) in first {
            let made = self.indexes(&partition_schema, &partition)?.into_iter().find(|i| i.name == index);
            if let Some(made) = made {
                found.push(Index { implied: template.contains('.'), name: template, ..made });
            }
        }
        Ok(found)
    }

    /// The options the indexes of `schema`.`name` were given by WITH, by
    /// index, each as SQL writes it.
    pub(crate) fn index_options(&self, schema: &str, name: &str) -> Result<BTreeMap<String, Vec<(String, String)>>> {
        let mut options: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        for r in self.rows(queries::INDEX_OPTIONS, &[schema, name])? {
            let value = need(&r, 2);
            let written = if need(&r, 3).starts_with(TEXT_KIND) { literal(&value) } else { value };
            options.entry(need(&r, 0)).or_default().push((need(&r, 1), written));
        }
        Ok(options)
    }
}
