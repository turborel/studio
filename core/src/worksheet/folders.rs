//! The files a worksheet may read and write (RULES.md D36, R-SEC-5): only
//! those the user chose in the platform's dialog this session, and the
//! `.sql` files of the project folders the user chose, kept in a file of
//! format 1. The webview names a file; the backend writes it only if it is
//! one of those, so no path the webview makes up is written.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::store::{self, FORMAT};

/// The project folders' file.
pub const PROJECTS_FILE: &str = "projects.json";
/// The extension of a worksheet's file.
pub const SQL_EXTENSION: &str = "sql";
/// The most project folders kept.
pub const MAX_PROJECTS: usize = 100;
/// The most files a project folder lists.
pub const MAX_LISTED: usize = 5000;
/// The deepest a project folder is listed, in folders.
pub const MAX_DEPTH: usize = 8;
/// The longest file read or written, in bytes.
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// The longest the projects' file may be, in bytes.
const MAX_PROJECTS_FILE_BYTES: u64 = 1024 * 1024;

/// The projects' file.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectsFile {
    format: u32,
    folders: Vec<String>,
}

/// A file read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// Its path.
    pub path: String,
    /// Its name, without its folder.
    pub name: String,
    /// Its text.
    pub text: String,
}

/// The files a worksheet may use.
#[derive(Debug)]
pub struct Files {
    projects: PathBuf,
    chosen: Mutex<BTreeSet<PathBuf>>,
}

/// `path` made whole, its folder's links followed, so no `..` nor link
/// leads out of where it seems to be.
fn whole(path: &Path) -> Result<PathBuf> {
    let refused = || StudioError::misuse(format!("[DESIGN] {} is no file Studio may use", path.display()));
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(refused());
    }
    let name = path.file_name().ok_or_else(refused)?;
    let folder = path.parent().ok_or_else(refused)?.canonicalize().map_err(|_| refused())?;
    Ok(folder.join(name))
}

impl Files {
    /// The files of the project folders kept in `dir`, and none chosen yet.
    pub fn new(dir: &Path) -> Self {
        Files { projects: dir.join(PROJECTS_FILE), chosen: Mutex::new(BTreeSet::new()) }
    }

    /// Lets `path`, one the user chose, be read and written this session.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it is no file's path.
    pub fn choose(&self, path: &Path) -> Result<()> {
        let path = whole(path)?;
        self.chosen.lock().map_err(|_| StudioError::misuse("[DESIGN] the files were poisoned"))?.insert(path);
        Ok(())
    }

    /// The project folders, as the user chose them.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn projects(&self) -> Result<Vec<String>> {
        Ok(store::read::<ProjectsFile>(&self.projects, MAX_PROJECTS_FILE_BYTES)?.map(|f| f.folders).unwrap_or_default())
    }

    /// Keeps `folder`, one the user chose, among the project folders.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it is no folder, there are too many, or the file
    /// cannot be read or written.
    pub fn add_project(&self, folder: &Path) -> Result<Vec<String>> {
        let folder =
            folder.canonicalize().ok().filter(|f| f.is_dir()).ok_or_else(|| StudioError::misuse("[DESIGN] a project is a folder"))?;
        let mut folders = self.projects()?;
        let named = folder.display().to_string();
        if !folders.contains(&named) {
            if folders.len() >= MAX_PROJECTS {
                return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_PROJECTS} project folders are kept")));
            }
            folders.push(named);
        }
        store::write(&self.projects, &ProjectsFile { format: FORMAT, folders: folders.clone() })?;
        Ok(folders)
    }

    /// Lets the project folder `folder` go; its files stay as they are.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read or written.
    pub fn remove_project(&self, folder: &str) -> Result<Vec<String>> {
        let folders: Vec<String> = self.projects()?.into_iter().filter(|f| f != folder).collect();
        store::write(&self.projects, &ProjectsFile { format: FORMAT, folders: folders.clone() })?;
        Ok(folders)
    }

    /// The `.sql` files of the project folder `folder`, by their paths
    /// within it, `/` between their parts, in order.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it is no project folder, or cannot be read.
    pub fn listed(&self, folder: &str) -> Result<Vec<String>> {
        if !self.projects()?.iter().any(|f| f == folder) {
            return Err(StudioError::misuse(format!("[DESIGN] {folder} is no project folder")));
        }
        let mut found = Vec::new();
        list(Path::new(folder), Path::new(folder), 0, &mut found)?;
        found.sort();
        Ok(found)
    }

    /// Whether `path` may be read or written: one chosen, or a `.sql` file
    /// of a project folder.
    /// `path`, if the user chose it in the platform's dialog this session.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it was not chosen.
    pub fn chosen(&self, path: &Path) -> Result<PathBuf> {
        let path = whole(path)?;
        if self.chosen.lock().map_err(|_| StudioError::misuse("[DESIGN] the files were poisoned"))?.contains(&path) {
            Ok(path)
        } else {
            Err(StudioError::misuse(format!("[DESIGN] {} is no file chosen", path.display())))
        }
    }

    fn allowed(&self, path: &Path) -> Result<PathBuf> {
        let path = whole(path)?;
        let chosen = self.chosen.lock().map_err(|_| StudioError::misuse("[DESIGN] the files were poisoned"))?.contains(&path);
        let sql = path.extension().is_some_and(|e| e == SQL_EXTENSION);
        let in_project = sql && self.projects()?.iter().any(|f| path.starts_with(f));
        if chosen || in_project {
            Ok(path)
        } else {
            Err(StudioError::misuse(format!("[DESIGN] {} is no file chosen, nor a project's", path.display())))
        }
    }

    /// The text of `path`, a file chosen or a project's.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it may not be read, is longer than `MAX_FILE_BYTES`,
    /// or is not UTF-8.
    pub fn read(&self, path: &Path) -> Result<Opened> {
        let path = self.allowed(path)?;
        let length = std::fs::metadata(&path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?.len();
        if length > MAX_FILE_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a file read is at most {MAX_FILE_BYTES} bytes")));
        }
        let text = std::fs::read_to_string(&path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        Ok(Opened { path: path.display().to_string(), name, text })
    }

    /// Writes `text` to `path`, a file chosen or a project's.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it may not be written, the text is too long, or the
    /// write fails.
    pub fn write(&self, path: &Path, text: &str) -> Result<()> {
        let path = self.allowed(path)?;
        if u64::try_from(text.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a file written is at most {MAX_FILE_BYTES} bytes")));
        }
        std::fs::write(&path, text).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))
    }
}

/// Adds the `.sql` files under `dir`, `depth` folders below `root`, to
/// `found`, up to `MAX_LISTED`; links are not followed.
fn list(root: &Path, dir: &Path, depth: usize, found: &mut Vec<String>) -> Result<()> {
    let entries = std::fs::read_dir(dir).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", dir.display())))?;
    for entry in entries.flatten() {
        if found.len() >= MAX_LISTED {
            return Ok(());
        }
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() && depth < MAX_DEPTH {
            list(root, &path, depth.saturating_add(1), found)?;
        } else if kind.is_file()
            && path.extension().is_some_and(|e| e == SQL_EXTENSION)
            && let Ok(relative) = path.strip_prefix(root)
        {
            found.push(relative.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Files;
    use crate::testing::scratch;

    /// [RULE] R-SEC-5 [DESIGN] D36: a file is read and written only if the
    /// user chose it, or it is a `.sql` file of a project folder; a path
    /// leading out by `..`, or a relative one, never.
    #[test]
    fn only_files_chosen_or_a_projects_are_used() {
        let dir = scratch("folders").canonicalize().unwrap();
        let config = dir.join("config");
        let project = dir.join("project");
        std::fs::create_dir_all(project.join("reports")).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let files = Files::new(&config);
        let loose = dir.join("loose.txt");
        assert!(files.write(&loose, "x").is_err());
        files.choose(&loose).unwrap();
        files.write(&loose, "SELECT 1").unwrap();
        assert_eq!(files.read(&loose).unwrap().text, "SELECT 1");
        let report = project.join("reports").join("daily.sql");
        assert!(files.write(&report, "x").is_err());
        let folder = files.add_project(&project).unwrap()[0].clone();
        assert_eq!(files.add_project(&project).unwrap().len(), 1);
        let report = std::path::Path::new(&folder).join("reports").join("daily.sql");
        files.write(&report, "SELECT 2").unwrap();
        std::fs::write(std::path::Path::new(&folder).join("notes.txt"), "x").unwrap();
        assert_eq!(files.listed(&folder).unwrap(), ["reports/daily.sql"]);
        assert_eq!(files.read(&report).unwrap().name, "daily.sql");
        assert!(files.write(&std::path::Path::new(&folder).join("notes.txt"), "x").is_err());
        assert!(files.write(&std::path::Path::new(&folder).join("..").join("escape.sql"), "x").is_err());
        assert!(files.write(std::path::Path::new("relative.sql"), "x").is_err());
        assert!(files.listed("/nowhere").is_err());
        assert!(files.add_project(&dir.join("missing")).is_err());
        assert_eq!(files.remove_project(&folder).unwrap(), Vec::<String>::new());
        assert!(files.write(&report, "x").is_err());
    }

    /// [RULE] R-FMT-2 [STUDIO projects.json]: the manual's example of the
    /// file is one Studio reads.
    #[test]
    fn the_manuals_example_is_read() {
        let dir = scratch("projects-manual");
        std::fs::write(dir.join(super::PROJECTS_FILE), crate::testing::manual_json("appendix/d-files.md", "projects.json")).unwrap();
        assert_eq!(Files::new(&dir).projects().unwrap(), ["/home/ann/sql"]);
    }
}
