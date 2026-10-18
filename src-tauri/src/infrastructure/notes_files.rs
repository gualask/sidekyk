//! Notes as files under the app's data folder (`<app data>/notes/<folder>/<file>`).

use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::Context;

use sidekyk_core::modules::notes::NotesStorage;

/// A path as the file system names it, links resolved; a file not written yet, by its folder; as
/// given when neither exists.
pub(crate) fn resolved_path(path: &Path) -> PathBuf {
    if let Ok(resolved) = fs::canonicalize(path) {
        return resolved;
    }
    match (path.parent(), path.file_name()) {
        (Some(folder), Some(name)) => fs::canonicalize(folder)
            .map(|folder| folder.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

/// Writes a file the user chose, such as notes exported, whole.
pub(crate) fn write_chosen_file(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    fs::write(path, bytes).with_context(|| format!("writing {}", path.display()))
}

/// What a write writes before it renames over the file.
const TEMP_SUFFIX: &str = ".tmp";

pub(crate) struct NotesFiles {
    dir: PathBuf,
}

impl NotesFiles {
    pub(crate) fn new(app_data: &Path) -> Self {
        Self {
            dir: app_data.join("notes"),
        }
    }

    /// The path of a folder, or of a file in it: a name with a separator or `..` is refused, so
    /// nothing outside the notes is ever reached.
    fn path(&self, folder: &str, file: Option<&str>) -> anyhow::Result<PathBuf> {
        let plain = |name: &str| {
            !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\'])
        };
        anyhow::ensure!(plain(folder), "not a notes folder: {folder:?}");
        let path = self.dir.join(folder);
        match file {
            Some(file) => {
                anyhow::ensure!(plain(file), "not a notes file: {file:?}");
                Ok(path.join(file))
            }
            None => Ok(path),
        }
    }
}

/// The names of the entries of `dir` that are folders (`dirs`) or files; none when it is missing.
fn entries(dir: &Path, dirs: bool) -> anyhow::Result<Vec<String>> {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error).with_context(|| format!("listing {}", dir.display())),
    };
    let mut names = Vec::new();
    for entry in read {
        let entry = entry?;
        if entry.file_type()?.is_dir() != dirs {
            continue;
        }
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    Ok(names)
}

impl NotesStorage for NotesFiles {
    fn folders(&self) -> anyhow::Result<Vec<String>> {
        entries(&self.dir, true)
    }

    /// A write cut short leaves its file beside the one it replaces: such leftovers are removed
    /// here, never listed.
    fn files(&self, folder: &str) -> anyhow::Result<Vec<String>> {
        let mut files = entries(&self.path(folder, None)?, false)?;
        for leftover in files.extract_if(.., |name| name.ends_with(TEMP_SUFFIX)) {
            self.remove(folder, &leftover)?;
        }
        Ok(files)
    }

    fn read(&self, folder: &str, file: &str, limit: u64) -> anyhow::Result<Option<Vec<u8>>> {
        let path = self.path(folder, Some(file))?;
        let opened = match fs::File::open(&path) {
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

    /// Writes next to the file, flushed to the disk, then renames over it: renaming within a
    /// folder replaces a file whole, on every system.
    fn write(&self, folder: &str, file: &str, bytes: &[u8]) -> anyhow::Result<()> {
        let path = self.path(folder, Some(file))?;
        let temp = self.path(folder, Some(&format!("{file}{TEMP_SUFFIX}")))?;
        fs::create_dir_all(self.path(folder, None)?)
            .with_context(|| format!("creating the folder of {}", path.display()))?;
        let mut out =
            fs::File::create(&temp).with_context(|| format!("creating {}", temp.display()))?;
        out.write_all(bytes)
            .and_then(|()| out.sync_all())
            .with_context(|| format!("writing {}", temp.display()))?;
        drop(out);
        fs::rename(&temp, &path).with_context(|| format!("replacing {}", path.display()))
    }

    fn remove_folder(&self, folder: &str) -> anyhow::Result<()> {
        let path = self.path(folder, None)?;
        match fs::remove_dir_all(&path) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(error).with_context(|| format!("removing {}", path.display()))
            }
            _ => Ok(()),
        }
    }

    fn remove(&self, folder: &str, file: &str) -> anyhow::Result<()> {
        let path = self.path(folder, Some(file))?;
        match fs::remove_file(&path) {
            Err(error) if error.kind() != ErrorKind::NotFound => {
                Err(error).with_context(|| format!("removing {}", path.display()))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_are_written_whole_read_back_and_removed() {
        let data = tempfile::tempdir().unwrap();
        let notes = NotesFiles::new(data.path());
        assert!(notes.folders().unwrap().is_empty());
        assert!(notes.files("shop-123456").unwrap().is_empty());

        notes.write("shop-123456", "a.json", b"one").unwrap();
        notes.write("shop-123456", "a.json", b"two").unwrap();
        assert_eq!(notes.folders().unwrap(), ["shop-123456"]);
        assert_eq!(notes.files("shop-123456").unwrap(), ["a.json"]);
        assert_eq!(
            notes.read("shop-123456", "a.json", 3).unwrap().as_deref(),
            Some(&b"two"[..])
        );
        assert!(notes.read("shop-123456", "a.json", 2).is_err());

        notes.remove("shop-123456", "a.json").unwrap();
        notes.remove("shop-123456", "a.json").unwrap();
        assert_eq!(notes.read("shop-123456", "a.json", 3).unwrap(), None);

        notes.write("shop-123456", "b.json", b"x").unwrap();
        notes.remove_folder("shop-123456").unwrap();
        notes.remove_folder("shop-123456").unwrap();
        assert!(notes.folders().unwrap().is_empty());
    }

    #[test]
    fn a_write_cut_short_leaves_nothing_listed() {
        let data = tempfile::tempdir().unwrap();
        let notes = NotesFiles::new(data.path());
        notes.write("shop-123456", "a.json", b"one").unwrap();
        std::fs::write(data.path().join("notes/shop-123456/b.json.tmp"), b"half").unwrap();
        assert_eq!(notes.files("shop-123456").unwrap(), ["a.json"]);
        assert!(!data.path().join("notes/shop-123456/b.json.tmp").exists());
    }

    #[test]
    fn a_path_resolves_through_links_and_a_file_not_written_by_its_folder() {
        let data = tempfile::tempdir().unwrap();
        let real = resolved_path(data.path());
        let missing = resolved_path(&data.path().join("notes.md"));
        assert_eq!(missing, real.join("notes.md"));
        #[cfg(unix)]
        {
            let link = data.path().join("link");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            assert_eq!(resolved_path(&link.join("notes.md")), real.join("notes.md"));
        }
    }

    #[test]
    fn names_never_leave_the_notes_folder() {
        let data = tempfile::tempdir().unwrap();
        let notes = NotesFiles::new(data.path());
        for (folder, file) in [
            ("..", "a"),
            ("a/b", "c"),
            ("a", "../b"),
            ("a", r"..\b"),
            ("", "a"),
        ] {
            assert!(notes.write(folder, file, b"x").is_err(), "{folder} {file}");
        }
        assert!(!data.path().join("b").exists());
    }

    /// Times reading a project of 1,000 notes from its files, and the writes a note costs:
    /// `cargo test --release notes_timings -- --ignored --nocapture`
    #[test]
    #[ignore = "benchmark"]
    fn notes_timings() {
        use sidekyk_core::modules::notes::NotesStore;
        use std::time::{Duration, Instant};

        fn median(runs: usize, mut run: impl FnMut()) -> Duration {
            let mut times: Vec<Duration> = (0..runs)
                .map(|_| {
                    let started = Instant::now();
                    run();
                    started.elapsed()
                })
                .collect();
            times.sort();
            times[runs / 2]
        }

        let data = tempfile::tempdir().unwrap();
        let files = NotesFiles::new(data.path());
        let store = NotesStore::default();
        let root = "/dev/shop";
        let list = store.notes(&files, root).unwrap().open_list;
        let mut ids = Vec::new();
        for n in 0..1000 {
            // most a line or two, one in ten an agent's long answer
            let text = if n % 10 == 0 {
                "word ".repeat(600)
            } else {
                "word ".repeat(40)
            };
            ids.push(store.add_note(&files, root, &list, text).unwrap().id);
        }
        println!(
            "read 1,000 notes: {:?}",
            median(20, || {
                NotesStore::default().notes(&files, root).unwrap();
            })
        );
        let mut edits = 0;
        println!(
            "edit a note: {:?}",
            median(50, || {
                // a text unchanged writes nothing: each edit changes it
                edits += 1;
                store
                    .set_note_text(&files, root, &ids[500], format!("edited {edits}"))
                    .unwrap();
            })
        );
        // the palette over every note, as at each key typed: a word in no first line, read in all
        let request: sidekyk_core::modules::search::SearchRequest = serde_json::from_value(
            serde_json::json!({ "query": "zzqx", "panels": [], "root": root }),
        )
        .unwrap();
        println!(
            "palette over 1,000 notes: {:?}",
            median(50, || {
                sidekyk_core::modules::search::search(
                    &request,
                    &[],
                    |_| None,
                    |root| {
                        store
                            .with_notes(&files, root, |lists, notes| {
                                sidekyk_core::modules::search::search_notes(
                                    &request.query,
                                    lists,
                                    notes,
                                )
                            })
                            .ok()
                    },
                );
            })
        );
        println!(
            "move a note: {:?}",
            median(50, || {
                store.place_note(&files, root, &ids[0], &list, 500).unwrap();
            })
        );
    }
}
