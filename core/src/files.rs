//! The places Studio keeps files (RULES.md R-SEC-2): each directory its
//! owner's alone, mode 0700 on Unix; on Windows, under the user's own
//! profile, whose access is the user's.

use std::path::Path;

use crate::error::{Result, StudioError};

/// Makes `dir`, and its parents, if they are not there, and makes it its
/// owner's alone.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be made, or its mode set.
pub fn private_dir(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot make {}: {e}", dir.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        /// Read, write and search for the owner alone.
        const OWNER_ONLY: u32 = 0o700;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(OWNER_ONLY))
            .map_err(|e| StudioError::misuse(format!("[DESIGN] cannot make {} private: {e}", dir.display())))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::private_dir;

    /// [RULE] R-SEC-2: a directory Studio keeps files in is its owner's
    /// alone.
    #[test]
    fn a_private_directory_is_the_owners_alone() {
        let dir = crate::testing::scratch("files/private").join("results");
        private_dir(&dir).unwrap();
        assert!(dir.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        private_dir(&dir).unwrap();
    }

    /// [RULE] R-ERR-1: a folder that cannot be made, as one under a file, is
    /// Studio's error, naming it.
    #[test]
    fn a_folder_under_a_file_is_refused() {
        let file = crate::testing::scratch("files/under").join("a-file");
        std::fs::write(&file, b"x").unwrap();
        let error = private_dir(&file.join("folder")).unwrap_err();
        assert!(error.message.contains("a-file"), "{error}");
    }
}
