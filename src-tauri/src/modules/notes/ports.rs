/// Where notes are kept: folders of small files, one folder per project, under the app's data. A
/// folder or file name is always one this module made.
pub(crate) trait NotesStorage: Send + Sync {
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
}
