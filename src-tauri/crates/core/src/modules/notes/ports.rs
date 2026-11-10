use std::path::Path;

/// Where notes are kept: folders of small files, one folder per project, under the app's data. A
/// folder or file name is always one this module made.
pub trait NotesStorage: Send + Sync {
    /// Every folder.
    fn folders(&self) -> anyhow::Result<Vec<String>>;

    /// The names of the files in a folder; none when it does not exist.
    fn files(&self, folder: &str) -> anyhow::Result<Vec<String>>;

    /// A file's bytes, or `None` when it is missing; one longer than `limit` bytes fails.
    fn read(&self, folder: &str, file: &str, limit: u64) -> anyhow::Result<Option<Vec<u8>>>;

    /// Replaces a file whole, or creates it and its folder: a reader finds the old bytes or the
    /// new ones, never part of them.
    fn write(&self, folder: &str, file: &str, bytes: &[u8]) -> anyhow::Result<()>;

    /// Removes a file; one already gone is not an error.
    fn remove(&self, folder: &str, file: &str) -> anyhow::Result<()>;

    /// Removes a folder and what is in it; one already gone is not an error.
    fn remove_folder(&self, folder: &str) -> anyhow::Result<()>;

    /// Where a file is, as this system names it: what a note's copy gives an agent to read.
    fn location(&self, folder: &str, file: &str) -> anyhow::Result<String>;
}

/// The files a user gives a note, dropped from the file manager: read where they are.
pub trait GivenFiles: Send + Sync {
    /// The size of the file at `path` when it is a regular file; `None` for a folder or anything
    /// else that is not one.
    fn regular_file_size(&self, path: &Path) -> anyhow::Result<Option<u64>>;

    /// The first `limit` bytes of the file at `path`, and one more when it is longer.
    fn read(&self, path: &Path, limit: u64) -> anyhow::Result<Vec<u8>>;
}
