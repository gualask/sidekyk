//! Files the app reads within a limit and writes whole: the notes, the settings, an export.

use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::Context;

use sidekyk_core::app::notes::ExportFiles;

/// What a write writes before it renames over the file: one cut short leaves it beside.
pub(crate) const TEMP_SUFFIX: &str = ".tmp";

/// The bytes of `path`, at most `limit`: none when there is no file, an error when it is longer.
pub(crate) fn read_within(path: &Path, limit: u64) -> anyhow::Result<Option<Vec<u8>>> {
    let opened = match fs::File::open(path) {
        Ok(opened) => opened,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).with_context(|| format!("opening {}", path.display())),
    };
    let mut bytes = Vec::new();
    opened
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .with_context(|| format!("reading {}", path.display()))?;
    anyhow::ensure!(
        bytes.len() as u64 <= limit,
        "{} is longer than {limit} bytes",
        path.display()
    );
    Ok(Some(bytes))
}

/// This host's files, as an export writes them (`write_whole`).
pub(crate) struct HostFiles;

impl ExportFiles for HostFiles {
    fn write_whole(&self, path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
        write_whole(path, bytes)
    }
}

/// Writes `bytes` to `path` whole, making the folders above it: to a file beside it, flushed to
/// the disk, then renamed over it. Renaming within a folder replaces a file whole on every system,
/// so a crash, a full disk or a power cut leaves the previous file, never half of one. A failed
/// write removes its copy. One writer per path at a time: the copy beside has a fixed name.
pub(crate) fn write_whole(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)
            .with_context(|| format!("creating the folder of {}", path.display()))?;
    }
    let temp = temp_path(path);
    let written = write_flushed(&temp, bytes)
        .with_context(|| format!("writing {}", temp.display()))
        .and_then(|()| {
            fs::rename(&temp, path).with_context(|| format!("replacing {}", path.display()))
        });
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

fn temp_path(path: &Path) -> PathBuf {
    let mut temp = path.as_os_str().to_owned();
    temp.push(TEMP_SUFFIX);
    PathBuf::from(temp)
}

fn write_flushed(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut out = fs::File::create(path)?;
    out.write_all(bytes)?;
    out.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_is_replaced_whole_and_no_copy_stays() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/file.json");
        write_whole(&path, b"first").unwrap();
        write_whole(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_write_keeps_the_file_and_removes_its_copy() {
        let dir = tempfile::tempdir().unwrap();
        // a folder where the file goes: the rename fails, the folder stays
        let path = dir.path().join("taken");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("inside"), b"kept").unwrap();
        assert!(write_whole(&path, b"new").is_err());
        assert_eq!(fs::read(path.join("inside")).unwrap(), b"kept");
        assert!(!temp_path(&path).exists());
    }
}
