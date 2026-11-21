//! An Excel sheet's rows imported (RULES.md D63): a `.xlsx` workbook read
//! by calamine's cell reader, a row at a time, so memory holds a row and
//! the workbook's shared strings, not the sheet. A cell is taken as its
//! text: a number as the shortest decimal that is the same double, as
//! Excel keeps numbers as doubles; a date as `YYYY-MM-DD`, with its time
//! if it has one; a truth value as TRUE or FALSE; an error as Excel shows
//! it, `#N/A` and the like, which a column of a number refuses.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use calamine::{Cell, DataRef, Reader, Xlsx, XlsxCellReader, open_workbook};
use turborel::value::Value;
use turborel_client::import::{Heading, Position, Record, Source, SourceError};

use crate::error::{Result, StudioError};

/// The most columns of a sheet, as Excel has.
const MAX_COLUMNS: usize = 16_384;

/// A workbook opened.
pub type Workbook = Xlsx<BufReader<File>>;

/// The workbook at `path`, opened.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be read as a `.xlsx` workbook.
pub fn workbook(path: &Path) -> Result<Workbook> {
    open_workbook(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {} is not a workbook Studio reads: {e}", path.display())))
}

/// The names of the sheets of the workbook at `path`, in order.
///
/// # Errors
///
/// As `workbook`'s.
pub fn sheet_names(path: &Path) -> Result<Vec<String>> {
    Ok(workbook(path)?.sheet_names())
}

/// The sheet `sheet` of `book`, or its first, ready to be read.
///
/// # Errors
///
/// SQLCODE -910 for a workbook of no sheets, a sheet it has not, or one
/// that cannot be read.
pub fn cells<'a>(book: &'a mut Workbook, sheet: Option<&str>) -> Result<XlsxCellReader<'a, BufReader<File>>> {
    let name = match sheet {
        Some(name) => name.to_owned(),
        None => book.sheet_names().into_iter().next().ok_or_else(|| StudioError::misuse("[DESIGN] the workbook has no sheet"))?,
    };
    book.worksheet_cells_reader(&name).map_err(|e| StudioError::misuse(format!("[DESIGN] the sheet {name} cannot be read: {e}")))
}

/// `value`, a cell's, as a field's value.
pub fn value_of(value: &DataRef<'_>) -> Value {
    match value {
        DataRef::Empty => Value::Null,
        DataRef::Int(i) => Value::Char(i.to_string()),
        DataRef::Float(f) => Value::Char(f.to_string()),
        DataRef::String(s) | DataRef::DateTimeIso(s) | DataRef::DurationIso(s) => Value::Char(s.clone()),
        DataRef::SharedString(s) => Value::Char((*s).to_owned()),
        DataRef::Bool(b) => Value::Char(if *b { "TRUE" } else { "FALSE" }.to_owned()),
        DataRef::DateTime(d) if d.is_datetime() => {
            let (year, month, day, hour, minute, second, milli) = d.to_ymd_hms_milli();
            let date = format!("{year:04}-{month:02}-{day:02}");
            Value::Char(match (hour, minute, second, milli) {
                (0, 0, 0, 0) => date,
                (_, _, _, 0) => format!("{date} {hour:02}:{minute:02}:{second:02}"),
                _ => format!("{date} {hour:02}:{minute:02}:{second:02}.{milli:03}"),
            })
        }
        DataRef::DateTime(d) => Value::Char(d.as_f64().to_string()),
        DataRef::Error(e) => Value::Char(e.to_string()),
    }
}

/// A sheet's records: each row of cells, from its first column to its
/// last, a cell not written null; the first row the headings, if asked.
pub struct SheetRecords<'a> {
    cells: XlsxCellReader<'a, BufReader<File>>,
    header: bool,
    /// The first column and the number of columns.
    columns: (u32, usize),
    /// A cell read of the row after the one being gathered.
    next: Option<Cell<DataRef<'a>>>,
    rows: u64,
    ended: bool,
}

impl<'a> SheetRecords<'a> {
    /// The records of `cells`, its first row the headings if `header`.
    pub fn new(cells: XlsxCellReader<'a, BufReader<File>>, header: bool) -> SheetRecords<'a> {
        let dimensions = cells.dimensions();
        let width = usize::try_from(dimensions.end.1.saturating_sub(dimensions.start.1).saturating_add(1)).unwrap_or(0);
        let width = if dimensions.end == (0, 0) && dimensions.start == (0, 0) { 0 } else { width };
        SheetRecords { cells, header, columns: (dimensions.start.1, width), next: None, rows: 0, ended: false }
    }

    /// The rows of the sheet, by its dimensions, its header not counted:
    /// how many records it holds; 0 if it does not tell its dimensions.
    pub fn dimensions_rows(&self) -> u64 {
        let d = self.cells.dimensions();
        if d.start == (0, 0) && d.end == (0, 0) {
            return 0;
        }
        let rows = u64::from(d.end.0.saturating_sub(d.start.0)).saturating_add(1);
        rows.saturating_sub(u64::from(self.header))
    }

    /// The next row's values, and its number, the first 1; none at the end.
    fn row(&mut self) -> std::result::Result<Option<(Vec<Value>, u32)>, SourceError> {
        if self.ended {
            return Ok(None);
        }
        let first = if let Some(cell) = self.next.take() {
            cell
        } else if let Some(cell) = self.cells.next_cell().map_err(|e| self.failed(&e.to_string()))? {
            cell
        } else {
            self.ended = true;
            return Ok(None);
        };
        let row = first.get_position().0;
        let mut values = vec![Value::Null; self.columns.1];
        self.place(&first, &mut values);
        loop {
            match self.cells.next_cell().map_err(|e| self.failed(&e.to_string()))? {
                Some(cell) if cell.get_position().0 == row => self.place(&cell, &mut values),
                Some(cell) => {
                    self.next = Some(cell);
                    break;
                }
                None => {
                    self.ended = true;
                    break;
                }
            }
        }
        self.rows = self.rows.saturating_add(1);
        Ok(Some((values, row.saturating_add(1))))
    }

    /// `cell`'s value put in its column's place of `values`.
    fn place(&self, cell: &Cell<DataRef<'a>>, values: &mut Vec<Value>) {
        let at = usize::try_from(cell.get_position().1.saturating_sub(self.columns.0)).unwrap_or(usize::MAX);
        // A sheet that does not tell its dimensions grows as its cells come,
        // to Excel's most columns.
        if at >= values.len() && at < MAX_COLUMNS {
            values.resize(at.saturating_add(1), Value::Null);
        }
        if let Some(slot) = values.get_mut(at) {
            *slot = value_of(cell.get_value());
        }
    }

    /// A failure at the row being read.
    fn failed(&self, message: &str) -> SourceError {
        SourceError {
            position: Position { record: self.rows.saturating_add(1), line: None },
            message: format!("the sheet cannot be read: {message}"),
        }
    }
}

impl Source for SheetRecords<'_> {
    fn headings(&mut self) -> std::result::Result<Option<Vec<Heading>>, SourceError> {
        if !self.header {
            return Ok(None);
        }
        let Some((values, _)) = self.row()? else { return Ok(Some(Vec::new())) };
        self.rows = 0;
        let names = values.into_iter().enumerate().map(|(at, v)| match v {
            Value::Char(name) if !name.trim().is_empty() => name.trim().to_owned(),
            _ => format!("COLUMN_{}", at.saturating_add(1)),
        });
        Ok(Some(names.map(|name| Heading { name, data_type: None }).collect()))
    }

    fn record(&mut self) -> std::result::Result<Option<Record>, SourceError> {
        Ok(self.row()?.map(|(values, row)| Record { values, position: Position { record: self.rows, line: Some(u64::from(row)) } }))
    }
}
