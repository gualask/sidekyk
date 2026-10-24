//! The repository and folder modules' backend on this machine: the `git` CLI (no libgit2: every
//! answer is what the user's own git would print), the disk read directly, and the walk of a
//! folder without git (`folder_walk`).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use super::folder_walk;
use super::hide_console;
use super::process::{self, TimedOut};
use crate::modules::repository::{
    FolderRules, GitOutput, RepositoryBackend, Walked, WorktreeEntry,
};
use crate::shared::error::{user_facing, user_facing_code, UserFacingErrorCode};

/// No git call takes longer: past it git is killed and the call fails with `git_timed_out`, so a
/// hung command (a network drive, a huge repository) cannot hold a snapshot forever. Its message
/// in `app-error.ts` names it.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// An app started from Finder or a desktop launcher can get a minimal PATH, so the usual install
/// dirs are checked too.
#[cfg(unix)]
const FALLBACK_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
#[cfg(windows)]
const FALLBACK_DIRS: &[&str] = &[r"C:\Program Files\Git\cmd"];

fn find_git() -> Option<PathBuf> {
    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    let file_name = format!("git{}", std::env::consts::EXE_SUFFIX);
    path_dirs
        .into_iter()
        .chain(FALLBACK_DIRS.iter().map(PathBuf::from))
        .map(|dir| dir.join(&file_name))
        .find(|candidate| candidate.is_file())
}

#[derive(Default)]
pub struct LocalRepositoryBackend {
    git: OnceLock<Option<PathBuf>>,
}

impl LocalRepositoryBackend {
    fn command(&self, cwd: &Path, args: &[&str]) -> anyhow::Result<Command> {
        let Some(bin) = self.git.get_or_init(find_git) else {
            return Err(user_facing(UserFacingErrorCode::GitNotFound));
        };
        let mut command = Command::new(bin);
        command
            // A repository's config can name an fsmonitor command, which git would run on every
            // refresh. Sidekyk opens any folder, so it never lets a repository run code.
            .args(["-c", "core.fsmonitor=false"])
            .args(args)
            .current_dir(cwd)
            // Never take index.lock: a refresh must not fight the agent's own git commands, and
            // a status that rewrote the index would wake the watcher again.
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // git would open a console window for every command
        hide_console(&mut command);
        Ok(command)
    }

    /// Runs git within the limits, and logs the command (development builds only: `debug` is
    /// compiled out of release builds); a git that timed out, in every build.
    fn run_git(
        &self,
        cwd: &Path,
        args: &[&str],
        input: Option<&[u8]>,
        max_stdout: usize,
    ) -> anyhow::Result<GitOutput> {
        let started = Instant::now();
        let output = run(
            &mut self.command(cwd, args)?,
            input,
            max_stdout,
            GIT_TIMEOUT,
        );
        match &output {
            Ok(output) => tracing::debug!(
                args = %args.join(" "),
                code = output.code,
                ms = started.elapsed().as_millis() as u64,
                stdout_bytes = output.stdout.len(),
                truncated = output.truncated,
                "git"
            ),
            Err(error) if user_facing_code(error) == Some(UserFacingErrorCode::GitTimedOut) => {
                tracing::warn!(args = %args.join(" "), "git timed out and was killed");
            }
            Err(error) => tracing::debug!(
                args = %args.join(" "),
                error = %format!("{error:#}"),
                "git could not run"
            ),
        }
        output
    }
}

/// `process::run`, past its time a `git_timed_out`: `app-error.ts` names git.
fn run(
    command: &mut Command,
    input: Option<&[u8]>,
    max_stdout: usize,
    timeout: Duration,
) -> anyhow::Result<GitOutput> {
    process::run(command, input, max_stdout, timeout).map_err(|error| {
        if error.is::<TimedOut>() {
            user_facing(UserFacingErrorCode::GitTimedOut)
        } else {
            error
        }
    })
}

impl RepositoryBackend for LocalRepositoryBackend {
    fn git(&self, cwd: &Path, args: &[&str], max_stdout: usize) -> anyhow::Result<GitOutput> {
        self.run_git(cwd, args, None, max_stdout)
    }

    fn git_with_input(
        &self,
        cwd: &Path,
        args: &[&str],
        input: &[u8],
        max_stdout: usize,
    ) -> anyhow::Result<GitOutput> {
        self.run_git(cwd, args, Some(input), max_stdout)
    }

    fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>> {
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() || meta.len() > limit {
            return None;
        }
        std::fs::read(path).ok()
    }

    fn read_entry(&self, root: &Path, path: &Path, limit: usize) -> Option<WorktreeEntry> {
        let (full, meta) = inside(root, path)?;
        if meta.is_symlink() {
            return std::fs::read_link(&full).ok().map(WorktreeEntry::Link);
        }
        if meta.is_dir() {
            return Some(WorktreeEntry::Folder);
        }
        let mut head = Vec::new();
        let read = std::fs::File::open(&full)
            .ok()?
            .take(limit as u64 + 1)
            .read_to_end(&mut head)
            .ok()?;
        let truncated = read > limit;
        head.truncate(limit);
        Some(WorktreeEntry::File { head, truncated })
    }

    fn open_file(&self, root: &Path, path: &Path) -> Option<Box<dyn Read + Send>> {
        let (full, meta) = inside(root, path)?;
        if !meta.is_file() {
            return None;
        }
        let file = std::fs::File::open(full).ok()?;
        Some(Box::new(file))
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn has_entry(&self, root: &Path, path: &Path) -> bool {
        std::fs::symlink_metadata(root.join(path)).is_ok()
    }

    fn folders(&self, root: &Path, path: &Path) -> Option<Vec<PathBuf>> {
        let folder = if path.as_os_str().is_empty() {
            root.to_path_buf()
        } else {
            let (full, meta) = inside(root, path)?;
            meta.is_dir().then_some(full)?
        };
        let entries = std::fs::read_dir(folder).ok()?;
        Some(
            entries
                .filter_map(Result::ok)
                // the entry's own type: a link to a folder is not one
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| PathBuf::from(entry.file_name()))
                .collect(),
        )
    }

    fn walk(&self, root: &Path, max: usize) -> Walked {
        folder_walk::walk(root, max)
    }

    fn folder_rules(&self, root: &Path) -> Box<dyn FolderRules> {
        folder_walk::rules(root)
    }

    #[cfg(unix)]
    fn real_path(&self, path: &Path) -> Option<PathBuf> {
        std::fs::canonicalize(path).ok()
    }

    /// `canonicalize` would give `\\?\C:\…`, which no other path has; `ReadDirectoryChangesW`
    /// reports what changed under the path watched, as it was given.
    #[cfg(windows)]
    fn real_path(&self, path: &Path) -> Option<PathBuf> {
        std::fs::symlink_metadata(path).ok()?;
        std::path::absolute(path).ok()
    }
}

/// `path` (relative) under `root` and what is there, not following a link, or `None` when nothing
/// is there or a folder on the way is not a real one, so a link cannot lead out of the repository.
fn inside(root: &Path, path: &Path) -> Option<(PathBuf, std::fs::Metadata)> {
    let mut folder = root.to_path_buf();
    for name in path.parent()?.components() {
        folder.push(name);
        let meta = std::fs::symlink_metadata(&folder).ok()?;
        if !meta.is_dir() {
            return None;
        }
    }
    let full = root.join(path);
    let meta = std::fs::symlink_metadata(&full).ok()?;
    Some((full, meta))
}

#[cfg(test)]
mod tests {
    //! End to end against a real git in a scratch repository.

    use super::*;
    use crate::modules::folder::{folder_kind, load_folder_tree, resolve_folder, FolderKind};
    use crate::modules::repository::{
        load_commit_activity, load_commit_file_diff, load_commit_files, load_file_content,
        load_file_diff, load_file_tree, load_recent_commits, load_snapshot, load_summary,
        load_version_text, repository_name, resolve_repository, ChangeKind, Commit,
        CommitFileDiffRequest, CommitRequest, FileContent, FileDiffRequest, FileVersion,
        FolderAdded, FolderWatcher, Hiding, IgnoredPaths, RepositoryInfo, RepositorySnapshot,
        RepositoryWatcher, VersionText, Visible, Watch, WatchedFolders,
    };
    use crate::modules::search::{
        search, search_contents, search_files, ContentSearch, ProjectFiles, SearchRequest,
    };
    use std::sync::{Arc, Mutex};

    use crate::infrastructure::watcher::LocalRepositoryWatcher;
    use crate::modules::projects::{Location, Project};
    use crate::modules::repositories::{LocalRepositories, Repositories};
    use crate::modules::syntax::{line_check, load_syntax_colors, ColorCache, SyntaxRequest};
    use serde_json::json;

    fn git(root: &Path, args: &[&str]) {
        let backend = LocalRepositoryBackend::default();
        let out = backend.git(root, args, usize::MAX).unwrap();
        assert_eq!(out.code, 0, "git {args:?}: {}", out.stderr);
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn scratch_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q", "-b", "main"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test"]);
        git(root, &["config", "commit.gpgsign", "false"]);
        write(root, "src/cart.ts", "a\nb\nc\n");
        write(root, "README.md", "hello\n");
        git(root, &["add", "."]);
        git(root, &["commit", "-q", "-m", "init"]);
        dir
    }

    fn snapshot_json(snapshot: &RepositorySnapshot) -> serde_json::Value {
        let mut value = serde_json::to_value(snapshot).unwrap();
        value["files"]
            .as_array_mut()
            .unwrap()
            .sort_by_key(|f| format!("{}{}", f["area"], f["path"]));
        value
    }

    #[test]
    fn snapshot_reports_every_area_and_a_summary_against_head() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, &dir.path().join("src")).unwrap();
        let root = Path::new(&repo.info.root);

        write(root, "src/cart.ts", "a\nB\nc\nd\n");
        git(root, &["add", "src/cart.ts"]);
        write(root, "src/cart.ts", "a\nB\nc\nd\ne\n");
        write(root, "notes/todo.md", "one\ntwo\nthree");
        std::fs::remove_file(root.join("README.md")).unwrap();

        let snapshot = load_snapshot(&backend, &repo.info).unwrap();
        let value = snapshot_json(&snapshot);

        assert_eq!(value["summary"]["branch"]["head"], "main");
        assert_eq!(
            value["files"],
            json!([
                { "path": "src/cart.ts", "origPath": null, "area": "staged", "kind": "modified", "additions": 2, "deletions": 1, "binary": false },
                { "path": "README.md", "origPath": null, "area": "unstaged", "kind": "deleted", "additions": 0, "deletions": 1, "binary": false },
                { "path": "src/cart.ts", "origPath": null, "area": "unstaged", "kind": "modified", "additions": 1, "deletions": 0, "binary": false },
                { "path": "notes/todo.md", "origPath": null, "area": "untracked", "kind": "untracked", "additions": 3, "deletions": 0, "binary": false },
            ])
        );
        // vs HEAD: cart +3 -1, README -1; the new todo counts as a file, its lines unread
        assert_eq!(
            value["summary"]["totals"],
            json!({ "files": 3, "additions": 3, "deletions": 2 })
        );
        assert_eq!(
            load_summary(&backend, &repo.info).unwrap(),
            snapshot.summary,
            "a summary alone is the snapshot's"
        );
    }

    #[test]
    fn snapshot_before_the_first_commit_adds_up_staged_and_unstaged() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q", "-b", "main"]);
        write(root, "a.ts", "one\n");
        git(root, &["add", "a.ts"]);
        write(root, "a.ts", "one\ntwo\n");
        write(root, "b.ts", "x\ny\n");

        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, root).unwrap();
        let snapshot = load_snapshot(&backend, &repo.info).unwrap();

        // a.ts: +1 staged and +1 unstaged; b.ts counts as a file, its lines unread
        assert_eq!(
            snapshot_json(&snapshot)["summary"]["totals"],
            json!({ "files": 2, "additions": 2, "deletions": 0 })
        );
        assert_eq!(
            load_summary(&backend, &repo.info).unwrap(),
            snapshot.summary
        );
    }

    #[test]
    fn diffs_cover_each_area_and_refuse_paths_outside_the_repository() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        write(root, "src/cart.ts", "a\nB\nc\n");
        write(root, "new.ts", "x\n");

        let request = |path: &str, area: &str| -> FileDiffRequest {
            serde_json::from_value(json!({ "path": path, "origPath": null, "area": area })).unwrap()
        };
        let whole_file = |path: &str, area: &str| FileDiffRequest {
            whole_file: true,
            ..request(path, area)
        };

        let unstaged =
            load_file_diff(&backend, &repo.info, &request("src/cart.ts", "unstaged")).unwrap();
        assert!(
            unstaged.text.contains("@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"),
            "{}",
            unstaged.text
        );

        let untracked =
            load_file_diff(&backend, &repo.info, &request("new.ts", "untracked")).unwrap();
        assert!(
            untracked.text.contains("@@ -0,0 +1 @@\n+x\n"),
            "{}",
            untracked.text
        );

        let staged =
            load_file_diff(&backend, &repo.info, &request("src/cart.ts", "staged")).unwrap();
        assert_eq!(staged.text, "");

        // the whole file: every line around the change, in one hunk
        write(root, "src/long.ts", &"x\n".repeat(20));
        git(root, &["add", "src/long.ts"]);
        write(root, "src/long.ts", &format!("{}y\n", "x\n".repeat(19)));
        let changes =
            load_file_diff(&backend, &repo.info, &request("src/long.ts", "unstaged")).unwrap();
        assert!(
            changes.text.contains("@@ -17,4 +17,4 @@"),
            "{}",
            changes.text
        );
        let whole =
            load_file_diff(&backend, &repo.info, &whole_file("src/long.ts", "unstaged")).unwrap();
        assert!(whole.text.contains("@@ -1,20 +1,20 @@"), "{}", whole.text);
        let new_file =
            load_file_diff(&backend, &repo.info, &whole_file("new.ts", "untracked")).unwrap();
        assert!(
            new_file.text.contains("@@ -0,0 +1 @@\n+x\n"),
            "{}",
            new_file.text
        );

        assert!(load_file_diff(&backend, &repo.info, &request("../x", "unstaged")).is_err());
    }

    #[test]
    fn commit_activity_counts_the_lines_of_each_commit_since_a_time() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q", "-b", "main"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test"]);
        git(root, &["config", "commit.gpgsign", "false"]);
        git(root, &["config", "log.showSignature", "true"]);
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, root).unwrap();
        assert!(
            load_commit_activity(&backend, &repo.info, 0)
                .unwrap()
                .commits
                .is_empty(),
            "before the first commit"
        );

        write(root, "src/cart.ts", "a\nb\nc\n");
        git(root, &["add", "."]);
        git(root, &["commit", "-q", "-m", "Add the cart"]);
        write(root, "src/cart.ts", "a\nB\n");
        write(root, "logo.png", "PNG\0data");
        git(root, &["add", "."]);
        git(root, &["commit", "-q", "-m", "Edit the cart"]);
        git(root, &["commit", "-q", "--allow-empty", "-m", "Nothing"]);

        let activity = load_commit_activity(&backend, &repo.info, 0).unwrap();
        let lines: Vec<(u32, u32)> = activity
            .commits
            .iter()
            .map(|c| (c.additions, c.deletions))
            .collect();
        // newest first; a binary file adds no lines
        assert_eq!(lines, [(0, 0), (1, 2), (3, 0)]);
        assert!(!activity.more);
        assert!(activity.commits.iter().all(|c| c.time > 1_700_000_000));

        let later = activity.commits[0].time + 3600;
        assert!(load_commit_activity(&backend, &repo.info, later)
            .unwrap()
            .commits
            .is_empty());
    }

    #[test]
    fn recent_commits_list_the_branch_and_show_what_each_changed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q", "-b", "main"]);
        git(root, &["config", "user.email", "test@example.com"]);
        git(root, &["config", "user.name", "Test"]);
        git(root, &["config", "commit.gpgsign", "false"]);
        // a signature check in the user's config must not run, nor change the output
        git(root, &["config", "log.showSignature", "true"]);
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, root).unwrap();

        let none = load_recent_commits(&backend, &repo.info).unwrap();
        assert!(none.commits.is_empty(), "before the first commit");
        assert!(!none.more);

        write(root, "src/cart.ts", "a\nb\nc\nd\ne\nf\n");
        git(root, &["add", "."]);
        git(root, &["commit", "-q", "-m", "Add the cart"]);
        git(root, &["mv", "src/cart.ts", "src/basket.ts"]);
        write(root, "src/basket.ts", "a\nb\nc\nd\ne\nF\n");
        write(root, "logo.png", "PNG\0data");
        git(root, &["add", "."]);
        git(
            root,
            &["commit", "-q", "-m", "Rename the cart\n\nWith a body."],
        );

        let recent = load_recent_commits(&backend, &repo.info).unwrap();
        let subjects: Vec<&str> = recent.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["Rename the cart", "Add the cart"]);
        let (last, first) = (&recent.commits[0], &recent.commits[1]);
        assert_eq!(last.parent.as_deref(), Some(first.sha.as_str()));
        assert_eq!(first.parent, None);
        assert_eq!(last.author, "Test");
        assert!(last.time > 1_600_000_000);

        let commit = |c: &Commit| CommitRequest {
            sha: c.sha.clone(),
            parent: c.parent.clone(),
        };
        let files = load_commit_files(&backend, &repo.info, &commit(last)).unwrap();
        assert_eq!(
            serde_json::to_value(&files).unwrap(),
            json!({
                "files": [
                    { "path": "logo.png", "origPath": null, "kind": "added", "additions": null, "deletions": null, "binary": true },
                    { "path": "src/basket.ts", "origPath": "src/cart.ts", "kind": "renamed", "additions": 1, "deletions": 1, "binary": false },
                ],
                "truncated": false
            })
        );
        let root_files = load_commit_files(&backend, &repo.info, &commit(first)).unwrap();
        assert_eq!(root_files.files.len(), 1);
        assert_eq!(root_files.files[0].kind, ChangeKind::Added);

        let diff = load_commit_file_diff(
            &backend,
            &repo.info,
            &CommitFileDiffRequest {
                commit: commit(last),
                path: "src/basket.ts".into(),
                orig_path: Some("src/cart.ts".into()),
                whole_file: false,
            },
        )
        .unwrap();
        assert!(
            diff.text.contains("rename from src/cart.ts") && diff.text.contains("-f\n+F\n"),
            "{}",
            diff.text
        );
        let added = load_commit_file_diff(
            &backend,
            &repo.info,
            &CommitFileDiffRequest {
                commit: commit(first),
                path: "src/cart.ts".into(),
                orig_path: None,
                whole_file: false,
            },
        )
        .unwrap();
        assert!(added.text.contains("@@ -0,0 +1,6 @@"), "{}", added.text);
        let whole = load_commit_file_diff(
            &backend,
            &repo.info,
            &CommitFileDiffRequest {
                commit: commit(last),
                path: "src/basket.ts".into(),
                orig_path: Some("src/cart.ts".into()),
                whole_file: true,
            },
        )
        .unwrap();
        assert!(
            whole.text.contains("@@ -1,6 +1,6 @@\n a\n"),
            "{}",
            whole.text
        );

        let outside = CommitFileDiffRequest {
            commit: commit(last),
            path: "../x".into(),
            orig_path: None,
            whole_file: false,
        };
        assert!(load_commit_file_diff(&backend, &repo.info, &outside).is_err());

        // a merged branch: its commits are in the merge, which shows what it brought
        git(root, &["checkout", "-q", "-b", "side"]);
        write(root, "src/side.ts", "s\n");
        git(root, &["add", "."]);
        git(root, &["commit", "-q", "-m", "Work on the side"]);
        git(root, &["checkout", "-q", "main"]);
        git(
            root,
            &["merge", "-q", "--no-ff", "-m", "Merge side", "side"],
        );
        let recent = load_recent_commits(&backend, &repo.info).unwrap();
        let subjects: Vec<&str> = recent.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["Merge side", "Rename the cart", "Add the cart"]);
        assert!(recent.commits[0].merge);
        assert!(!recent.commits[1].merge);
        let merged = load_commit_files(&backend, &repo.info, &commit(&recent.commits[0])).unwrap();
        let paths: Vec<&str> = merged.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["src/side.ts"]);
    }

    #[test]
    fn versions_of_a_file_read_whole_and_color_a_block_at_a_time() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        let head = backend.git(root, &["rev-parse", "HEAD"], 100).unwrap();
        let sha = String::from_utf8(head.stdout).unwrap().trim().to_string();
        write(root, "src/cart.ts", "a\nI\nc\n");
        git(root, &["add", "src/cart.ts"]);
        write(root, "src/cart.ts", "a\nW\nc\n");
        write(root, "image.bin", "\0\x01");

        let text = |path: &str, version: FileVersion| {
            load_version_text(&backend, &repo.info, path, &version, 1024).unwrap()
        };
        let read = |body: &str| VersionText::Text(body.as_bytes().to_vec());
        assert_eq!(
            text("src/cart.ts", FileVersion::Worktree),
            read("a\nW\nc\n")
        );
        assert_eq!(text("src/cart.ts", FileVersion::Index), read("a\nI\nc\n"));
        assert_eq!(text("src/cart.ts", FileVersion::Head), read("a\nb\nc\n"));
        let commit = FileVersion::Commit { sha: sha.clone() };
        assert_eq!(text("src/cart.ts", commit.clone()), read("a\nb\nc\n"));
        assert_eq!(text("new.ts", FileVersion::Head), VersionText::Missing);
        assert_eq!(
            text("image.bin", FileVersion::Worktree),
            VersionText::Binary
        );
        let small = |version: FileVersion| {
            load_version_text(&backend, &repo.info, "src/cart.ts", &version, 3).unwrap()
        };
        assert_eq!(small(FileVersion::Worktree), VersionText::TooLarge);
        assert_eq!(small(FileVersion::Head), VersionText::TooLarge);
        let revision = FileVersion::Commit {
            sha: "HEAD~1".into(),
        };
        assert!(load_version_text(&backend, &repo.info, "src/cart.ts", &revision, 9).is_err());
        assert!(load_version_text(&backend, &repo.info, "../x", &FileVersion::Head, 9).is_err());

        write(
            root,
            "src/total.ts",
            "const total = 1;\n// the end\nlet x = 2;\n",
        );
        let cache = ColorCache::default();
        let colors = |first: u32, count: u32| {
            let request = SyntaxRequest {
                path: "src/total.ts".into(),
                version: FileVersion::Worktree,
                first,
                count,
            };
            let colors = load_syntax_colors(&backend, &repo.info, &cache, &request).unwrap();
            serde_json::to_value(colors).unwrap()
        };
        let block = colors(2, 5);
        assert_eq!(block["tooLarge"], false);
        assert_eq!(
            block["lines"].as_array().unwrap().len(),
            2,
            "two lines from the second"
        );
        assert_eq!(block["lines"][0]["spans"], json!([[0, 10, "comment"]]));
        assert_eq!(block["lines"][1]["spans"][0], json!([0, 3, "keyword"]));
        // the file changed: colored again
        write(root, "src/total.ts", "// only\n");
        assert_eq!(
            colors(1, 1)["lines"][0]["spans"],
            json!([[0, 7, "comment"]])
        );
    }

    #[test]
    fn the_tree_lists_what_git_shows_and_files_read_without_following_links() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        write(root, ".gitignore", "/target/\n");
        write(root, "target/a.o", "");
        write(root, "src/new.ts", "n\n");
        write(root, "logo.png", "PNG\0data");
        write(root, "big.txt", &"line\n".repeat(500_000));
        std::fs::remove_file(root.join("README.md")).unwrap();

        let tree = load_file_tree(&backend, &repo.info).unwrap();
        let top: Vec<String> = tree
            .directory("")
            .entries
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(top, ["src", ".gitignore", "big.txt", "logo.png"]);
        let src: Vec<String> = tree
            .directory("src")
            .entries
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(src, ["src/cart.ts", "src/new.ts"]);

        let content = |path: &str| load_file_content(&backend, &repo.info, path);
        assert_eq!(
            content("src/cart.ts").unwrap(),
            FileContent::Text {
                text: "a\nb\nc\n".into(),
                truncated: false
            }
        );
        assert_eq!(content("logo.png").unwrap(), FileContent::Binary);
        let FileContent::Text { text, truncated } = content("big.txt").unwrap() else {
            panic!("text");
        };
        assert!(truncated);
        assert!(text.len() <= 2 * 1024 * 1024 && text.ends_with("line\n"));
        assert!(content("README.md").is_err(), "deleted");
        assert!(content("../outside").is_err());

        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            write(outside.path(), "secret.txt", "s\n");
            std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
            std::os::unix::fs::symlink("src/cart.ts", root.join("alias.ts")).unwrap();
            assert_eq!(
                content("alias.ts").unwrap(),
                FileContent::Link {
                    target: "src/cart.ts".into()
                }
            );
            assert!(content("linked/secret.txt").is_err(), "through a link");
        }
    }

    #[test]
    fn contents_are_searched_in_files_only_never_through_a_link() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        write(root, "src/new.ts", "let needle;\n");
        write(root, "logo.png", "PNG\0needle");
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            write(outside.path(), "secret.txt", "needle\n");
            std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
            std::os::unix::fs::symlink("src/new.ts", root.join("alias.ts")).unwrap();
        }

        let tree = load_file_tree(&backend, &repo.info).unwrap();
        // a path through the linked folder, as a stale list could hold
        let files: Vec<&str> = tree
            .files()
            .iter()
            .map(String::as_str)
            .chain(["linked/secret.txt"])
            .collect();
        let searched = search_contents(
            &ContentSearch {
                backend: &backend,
                root,
                files: &files,
                query: "needle",
            },
            &|| false,
            &|_| {},
        );
        assert_eq!(searched.files, ["src/new.ts"]);
    }

    #[test]
    fn changes_git_ignores_do_not_count_unless_the_file_is_tracked() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        write(root, ".gitignore", "/target/\n*.log\nvendor/\n");
        write(root, "vendor/kept.js", "x\n");
        git(root, &["add", "-f", "vendor/kept.js"]);
        write(root, "target/debug/a.o", "");
        write(root, "src/debug.log", "");
        write(root, "vendor/new.js", "");

        let mut ignored = IgnoredPaths::new(root.to_path_buf());
        let changed = |rels: &[&str]| rels.iter().map(|rel| root.join(rel)).collect::<Vec<_>>();
        assert!(!ignored
            .visible(
                &backend,
                &changed(&["target/debug/a.o", "src/debug.log", "vendor/new.js"])
            )
            .any());
        assert!(ignored
            .visible(&backend, &changed(&["vendor/kept.js"]))
            .any());
        let mixed = changed(&["target/a.o", "src/cart.ts"]);
        let Visible::Paths(visible) = ignored.visible(&backend, &mixed) else {
            panic!("git answers");
        };
        assert_eq!(visible, [Path::new("src/cart.ts")]);
    }

    // the hook is a shell script, made executable
    #[cfg(unix)]
    #[test]
    fn a_repository_cannot_run_an_fsmonitor_command() {
        let dir = scratch_repo();
        let marker = dir.path().join("fsmonitor-ran");
        let hook = dir.path().join("hook.sh");
        std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
        std::fs::set_permissions(&hook, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        git(
            dir.path(),
            &["config", "core.fsmonitor", hook.to_str().unwrap()],
        );

        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        load_snapshot(&backend, &repo.info).unwrap();
        assert!(!marker.exists(), "the repository's fsmonitor command ran");
    }

    #[cfg(unix)]
    fn shell(script: &str) -> Command {
        let mut command = Command::new("sh");
        command
            .args(["-c", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    #[cfg(unix)]
    #[test]
    fn a_process_past_the_timeout_is_killed() {
        let started = Instant::now();
        let error = run(
            &mut shell("sleep 10"),
            None,
            1000,
            Duration::from_millis(200),
        )
        .err()
        .unwrap();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::GitTimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_folder_is_taken_as_the_repository_holding_it_or_as_it_is() {
        let backend = LocalRepositoryBackend::default();
        let root_of = |candidate: &Path| resolve_folder(&backend, candidate).unwrap().root;
        let real = |path: &Path| {
            backend
                .real_path(path)
                .unwrap()
                .to_str()
                .unwrap()
                .to_string()
        };

        let repo = scratch_repo();
        let repo_root = resolve_repository(&backend, repo.path()).unwrap().info.root;
        assert_eq!(root_of(repo.path()), repo_root);
        assert_eq!(root_of(&repo.path().join("src")), repo_root);

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        let docs = resolve_folder(&backend, &dir.path().join("docs")).unwrap();
        assert_eq!(docs.root, real(&dir.path().join("docs")));
        assert_eq!(docs.name, "docs");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("docs"), dir.path().join("link")).unwrap();
            assert_eq!(root_of(&dir.path().join("link")), docs.root);
        }
        // a `.git` git refuses still makes the root
        write(dir.path(), "broken/.git", "not a git dir\n");
        std::fs::create_dir(dir.path().join("broken/sub")).unwrap();
        assert_eq!(
            root_of(&dir.path().join("broken/sub")),
            real(&dir.path().join("broken"))
        );

        let gone = resolve_folder(&backend, &dir.path().join("gone")).unwrap_err();
        assert_eq!(
            user_facing_code(&gone),
            Some(UserFacingErrorCode::RepositoryMissing)
        );
    }

    #[test]
    fn a_folder_is_a_repository_by_the_git_at_its_root() {
        let backend = LocalRepositoryBackend::default();
        let repo = scratch_repo();
        assert_eq!(
            folder_kind(&backend, repo.path()).unwrap(),
            FolderKind::Repository
        );
        assert_eq!(
            folder_kind(&backend, &repo.path().join("src")).unwrap(),
            FolderKind::Plain
        );
        let gone = folder_kind(&backend, &repo.path().join("gone")).unwrap_err();
        assert_eq!(
            user_facing_code(&gone),
            Some(UserFacingErrorCode::RepositoryMissing)
        );
    }

    /// The local watcher, keeping every path it reports: a failure tells what the system sent.
    #[derive(Default)]
    struct RecordingWatcher(Arc<Mutex<Vec<PathBuf>>>);

    impl RepositoryWatcher for RecordingWatcher {
        fn watch(
            &self,
            root: &Path,
            git_dir: Option<&Path>,
            mut on_change: Box<dyn FnMut(Vec<PathBuf>) + Send>,
        ) -> anyhow::Result<Watch> {
            let seen = self.0.clone();
            LocalRepositoryWatcher::default().watch(
                root,
                git_dir,
                Box::new(move |paths| {
                    seen.lock().unwrap().extend(paths.iter().cloned());
                    on_change(paths);
                }),
            )
        }
    }

    #[test]
    fn the_watched_repository_tells_what_shows_and_marks_it_while_hidden() {
        // past the watcher's quiet period (250 ms) and the system's own delay
        const QUIET: Duration = Duration::from_secs(1);
        const DEADLINE: Duration = Duration::from_secs(10);
        let dir = scratch_repo();
        write(dir.path(), ".gitignore", "build/\n");
        let watcher = Arc::new(RecordingWatcher::default());
        let seen = watcher.0.clone();
        let repositories =
            LocalRepositories::new(Arc::new(LocalRepositoryBackend::default()), watcher);
        let info = repositories.resolve(dir.path()).unwrap();
        let root = Path::new(&info.root);
        let (sent, received) = std::sync::mpsc::channel();
        repositories.watch(
            Some(&info),
            Box::new(move |event| {
                let _ = sent.send(event);
            }),
        );
        // events still on their way, such as FSEvents reporting what happened before the watch
        let settle = || {
            let started = Instant::now();
            while received.recv_timeout(QUIET).is_ok() {
                assert!(started.elapsed() < DEADLINE, "the watcher never went quiet");
            }
        };
        settle();

        seen.lock().unwrap().clear();
        write(root, "build/out.o", "");
        if let Ok(event) = received.recv_timeout(QUIET) {
            panic!(
                "a path git ignores shows nothing: {event:?} from {:?}",
                seen.lock().unwrap()
            );
        }

        write(root, "src/cart.ts", "changed\n");
        let event = received.recv_timeout(DEADLINE).unwrap();
        assert_eq!(event.root, info.root);
        assert!(!event.git_dir);
        let paths = event.paths.unwrap_or_default();
        assert!(paths.iter().any(|path| path == "src/cart.ts"), "{paths:?}");
        settle();

        assert_eq!(repositories.set_visible(false), None);
        write(root, "src/cart.ts", "again\n");
        // the mark lands once the batch is in: looked for until then, hidden in between
        let started = Instant::now();
        let missed = loop {
            if let Some(missed) = repositories.set_visible(true) {
                break missed;
            }
            repositories.set_visible(false);
            assert!(started.elapsed() < DEADLINE, "the change was never marked");
            std::thread::sleep(Duration::from_millis(100));
        };
        assert_eq!(missed, info.root);
        assert!(received.try_recv().is_err(), "nothing is told while hidden");
        assert_eq!(repositories.set_visible(true), None);
        repositories.watch(None, Box::new(|_| {}));
    }

    #[test]
    fn a_folder_without_git_is_listed_and_watched_by_its_rules_and_changes_kind() {
        folder_without_git_watched(LocalRepositoryWatcher::default());
    }

    #[test]
    fn a_folder_without_git_is_watched_one_folder_at_a_time_as_on_linux() {
        folder_without_git_watched(LocalRepositoryWatcher::per_folder());
    }

    fn folder_without_git_watched(watcher: LocalRepositoryWatcher) {
        const QUIET: Duration = Duration::from_secs(1);
        const DEADLINE: Duration = Duration::from_secs(10);
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".gitignore", "build/\n");
        write(dir.path(), "notes/a.md", "a\n");
        write(dir.path(), "build/out.o", "");
        let repositories = LocalRepositories::new(
            Arc::new(LocalRepositoryBackend::default()),
            Arc::new(watcher),
        );
        let info = repositories.resolve(dir.path()).unwrap();
        let root = Path::new(&info.root);
        let paths = |folder: &str| -> Vec<String> {
            let directory = repositories.directory(&info, folder).unwrap();
            directory.entries.into_iter().map(|e| e.path).collect()
        };
        assert_eq!(paths(""), ["notes", ".gitignore"]);

        let (sent, received) = std::sync::mpsc::channel();
        repositories.watch(
            Some(&info),
            Box::new(move |event| {
                let _ = sent.send(event);
            }),
        );
        let settle = || {
            let started = Instant::now();
            while received.recv_timeout(QUIET).is_ok() {
                assert!(started.elapsed() < DEADLINE, "the watcher never went quiet");
            }
        };
        let kind_changed = || {
            let started = Instant::now();
            while started.elapsed() < DEADLINE {
                if received
                    .recv_timeout(DEADLINE)
                    .is_ok_and(|e| e.kind_changed)
                {
                    return;
                }
            }
            panic!("the change of kind was never told");
        };
        settle();

        write(root, "build/more.o", "");
        if let Ok(event) = received.recv_timeout(QUIET) {
            panic!("a path the rules hide shows nothing: {event:?}");
        }
        write(root, "notes/b.md", "b\n");
        let event = received.recv_timeout(DEADLINE).unwrap();
        assert!(!event.kind_changed);
        let changed = event.paths.unwrap_or_default();
        assert!(
            changed.iter().any(|path| path == "notes/b.md"),
            "{changed:?}"
        );
        assert_eq!(paths("notes"), ["notes/a.md", "notes/b.md"]);
        settle();

        git(root, &["init", "-q"]);
        kind_changed();
        assert_eq!(
            repositories.folder_kind(&info).unwrap(),
            FolderKind::Repository
        );
        settle();
        write(root, "notes/c.md", "c\n");
        let event = received.recv_timeout(DEADLINE).unwrap();
        assert!(!event.kind_changed, "watched as a repository now");
        settle();

        std::fs::remove_dir_all(root.join(".git")).unwrap();
        kind_changed();
        assert_eq!(repositories.folder_kind(&info).unwrap(), FolderKind::Plain);
        repositories.watch(None, Box::new(|_| {}));
    }

    /// Records the folders added, refusing past `limit` as the system would.
    struct RecordingFolders {
        added: Mutex<Vec<PathBuf>>,
        limit: usize,
    }

    impl RecordingFolders {
        fn up_to(limit: usize) -> Arc<Self> {
            Arc::new(Self {
                added: Mutex::default(),
                limit,
            })
        }

        fn times(&self, folder: &Path) -> usize {
            let added = self.added.lock().unwrap();
            added.iter().filter(|added| *added == folder).count()
        }
    }

    impl FolderWatcher for RecordingFolders {
        fn add(&self, folder: &Path) -> FolderAdded {
            let mut added = self.added.lock().unwrap();
            if added.len() == self.limit {
                return FolderAdded::Full;
            }
            added.push(folder.to_path_buf());
            FolderAdded::Watched
        }
    }

    #[test]
    fn the_folders_watched_are_those_git_does_not_ignore_and_the_git_dir_s_that_count() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        write(root, ".gitignore", "node_modules/\n/target/\n");
        write(root, "src/cart/a.ts", "");
        write(root, "target/debug/a.o", "");
        write(root, "node_modules/left/i.js", "");
        write(root, "node_modules/kept/k.js", "");
        git(root, &["add", "-f", "node_modules/kept/k.js"]);
        std::fs::create_dir(root.join("empty")).unwrap();
        write(root, "inner/.git/HEAD", "");
        write(root, "inner/lib/b.ts", "");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("src"), root.join("link")).unwrap();

        let recording = RecordingFolders::up_to(usize::MAX);
        let mut folders = WatchedFolders::start(
            &backend,
            recording.clone(),
            root,
            Hiding::Git {
                git_dir: repo.git_dir.clone(),
            },
        );
        let times = |rel: &str| recording.times(&root.join(rel));
        // a folder holding tracked files counts, though its rules say ignored; an empty one too,
        // for what is written in it later; a repository inside only for itself
        for rel in [
            "",
            "src",
            "src/cart",
            "empty",
            "inner",
            "node_modules",
            "node_modules/kept",
            ".git",
            ".git/refs",
            ".git/refs/heads",
            ".git/info",
        ] {
            assert_eq!(times(rel), 1, "{rel}");
        }
        for rel in [
            "target",
            "target/debug",
            "node_modules/left",
            "inner/lib",
            "link",
            ".git/objects",
        ] {
            assert_eq!(times(rel), 0, "{rel}");
        }

        // a folder made with what it holds, a file beside it
        write(root, "new/deep/c.ts", "");
        write(root, "new/node_modules/d/x.js", "");
        folders.add_created(&backend, &[Path::new("new"), Path::new("src/cart/a.ts")]);
        assert_eq!(times("new"), 1);
        assert_eq!(times("new/deep"), 1);
        assert_eq!(times("new/node_modules"), 0);
        // removed, then made again: watched again, as its watches went with it
        std::fs::remove_dir_all(root.join("new")).unwrap();
        folders.add_created(&backend, &[Path::new("new")]);
        write(root, "new/deep/c.ts", "");
        folders.add_created(&backend, &[Path::new("new")]);
        assert_eq!(times("new/deep"), 2);

        // the rules changed while nobody looked
        write(root, ".gitignore", "node_modules/\n");
        folders.add_missed(&backend, &[root.join(".gitignore")]);
        assert_eq!(times("target/debug"), 1);
        assert_eq!(times("src"), 1);
    }

    #[test]
    fn past_the_system_s_limit_the_folders_watched_stay_and_no_more_are_asked() {
        let dir = scratch_repo();
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, dir.path()).unwrap();
        let root = Path::new(&repo.info.root);
        let recording = RecordingFolders::up_to(3);
        let mut folders = WatchedFolders::start(
            &backend,
            recording.clone(),
            root,
            Hiding::Git {
                git_dir: repo.git_dir.clone(),
            },
        );
        write(root, "new/a.ts", "");
        folders.add_created(&backend, &[Path::new("new")]);
        folders.rescan(&backend);
        assert_eq!(recording.added.lock().unwrap().len(), 3);
        assert_eq!(recording.times(&root.join("new")), 0);
    }

    #[test]
    fn folder_by_folder_a_new_folder_is_watched_and_ignored_ones_never_are() {
        const QUIET: Duration = Duration::from_secs(1);
        const DEADLINE: Duration = Duration::from_secs(10);
        let dir = scratch_repo();
        write(dir.path(), ".gitignore", "build/\n");
        std::fs::create_dir(dir.path().join("build")).unwrap();
        let repositories = LocalRepositories::new(
            Arc::new(LocalRepositoryBackend::default()),
            Arc::new(LocalRepositoryWatcher::per_folder()),
        );
        let info = repositories.resolve(dir.path()).unwrap();
        let root = Path::new(&info.root);
        let (sent, received) = std::sync::mpsc::channel();
        repositories.watch(
            Some(&info),
            Box::new(move |event| {
                let _ = sent.send(event);
            }),
        );
        let settle = || {
            let started = Instant::now();
            while received.recv_timeout(QUIET).is_ok() {
                assert!(started.elapsed() < DEADLINE, "the watcher never went quiet");
            }
        };
        // waits for an event naming `path`, writing `rel` again until it comes: a watch added on
        // another thread may still be on its way
        let told = |rel: &str| {
            let started = Instant::now();
            loop {
                write(root, rel, "x\n");
                if let Ok(event) = received.recv_timeout(QUIET) {
                    if event
                        .paths
                        .unwrap_or_default()
                        .iter()
                        .any(|path| path == rel)
                    {
                        return;
                    }
                }
                assert!(started.elapsed() < DEADLINE, "{rel} was never told");
            }
        };
        settle();

        write(root, "build/out.o", "");
        assert!(
            received.recv_timeout(QUIET).is_err(),
            "an ignored folder is not watched"
        );

        std::fs::create_dir_all(root.join("src/new/deep")).unwrap();
        told("src/new/deep/x.ts");
        settle();

        repositories.set_visible(false);
        std::fs::create_dir_all(root.join("later/inner")).unwrap();
        let started = Instant::now();
        while repositories.set_visible(true).is_none() {
            repositories.set_visible(false);
            assert!(
                started.elapsed() < DEADLINE,
                "the new folder was never marked"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        told("later/inner/y.ts");
        repositories.watch(None, Box::new(|_| {}));
    }

    #[cfg(unix)]
    #[test]
    fn a_real_path_resolves_links_as_the_watcher_reports_them() {
        let dir = tempfile::tempdir().unwrap();
        let real = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(real.join("notes")).unwrap();
        std::os::unix::fs::symlink(real.join("notes"), real.join("link")).unwrap();
        let backend = LocalRepositoryBackend::default();
        assert_eq!(
            backend.real_path(&real.join("link")),
            Some(real.join("notes"))
        );
        assert_eq!(backend.real_path(&real.join("gone")), None);
    }

    #[test]
    fn a_repository_moved_away_is_reported_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let repository = RepositoryInfo {
            name: repository_name(&root),
            root,
        };
        drop(dir);
        let err = load_summary(&LocalRepositoryBackend::default(), &repository).unwrap_err();
        assert_eq!(err.to_string(), "repository_missing");
    }

    /// The median, min and max of `runs` calls to `work`, after one warm-up call.
    fn time(runs: usize, mut work: impl FnMut()) -> String {
        work();
        let mut times: Vec<_> = (0..runs)
            .map(|_| {
                let start = std::time::Instant::now();
                work();
                start.elapsed()
            })
            .collect();
        times.sort();
        format!(
            "median {:?}, min {:?}, max {:?}",
            times[runs / 2],
            times[0],
            times[runs - 1]
        )
    }

    /// Times the snapshot, the summary, the file tree, the palette's search over it, the recent
    /// commits with the files of the newest, and the diff of the largest changed file on a real
    /// repository, and its files walked as a folder without git's are:
    /// `SIDEKYK_BENCH_REPO=/path/to/repo cargo test --release backend_timings -- --ignored --nocapture`
    #[test]
    #[ignore = "benchmark, needs SIDEKYK_BENCH_REPO"]
    fn backend_timings() {
        let repo = std::env::var("SIDEKYK_BENCH_REPO").expect("SIDEKYK_BENCH_REPO is set");
        let backend = LocalRepositoryBackend::default();
        let repo = resolve_repository(&backend, Path::new(&repo)).unwrap();

        println!(
            "snapshot: {}",
            time(20, || {
                load_snapshot(&backend, &repo.info).unwrap();
            })
        );
        println!(
            "summary: {}",
            time(20, || {
                load_summary(&backend, &repo.info).unwrap();
            })
        );

        println!(
            "file tree: {}",
            time(20, || {
                load_file_tree(&backend, &repo.info).unwrap();
            })
        );
        let tree = std::sync::Arc::new(load_file_tree(&backend, &repo.info).unwrap());
        // the same folder as one without git would be listed: the walk and its rules
        let root = Path::new(&repo.info.root);
        println!(
            "folder tree, walked ({} files, git lists {}): {}",
            load_folder_tree(&backend, root).files().len(),
            tree.files().len(),
            time(20, || {
                load_folder_tree(&backend, root);
            })
        );
        println!(
            "root folder: {}",
            time(20, || {
                tree.directory("");
            })
        );

        // the palette over every file of the tree, as at each key typed
        let changed: std::sync::Arc<[_]> =
            load_snapshot(&backend, &repo.info).unwrap().files.into();
        let project = Project::new(
            repo.info.name.clone(),
            Some(Location::Local {
                root: repo.info.root.clone(),
            }),
        );
        let palette: SearchRequest = serde_json::from_value(json!({
            "query": "srcmod",
            "panels": ["Changes", "Files"],
            "projectId": project.id,
        }))
        .unwrap();
        println!(
            "search over {} files: {}",
            tree.files().len(),
            time(20, || {
                search(
                    &palette,
                    std::slice::from_ref(&project),
                    |_| {
                        Some(search_files(
                            &palette.query,
                            &ProjectFiles {
                                tree: tree.clone(),
                                changed: changed.clone(),
                            },
                        ))
                    },
                    |_| None,
                    Default::default,
                );
            })
        );

        // `⌘F` over every file of the tree: many lines (stops at the limit), and none
        let files: Vec<&str> = tree.files().iter().map(String::as_str).collect();
        for query in ["fn new", "zzqxw"] {
            println!(
                "contents {query:?}: {}",
                time(10, || {
                    search_contents(
                        &ContentSearch {
                            backend: &backend,
                            root: Path::new(&repo.info.root),
                            files: &files,
                            query,
                        },
                        &|| false,
                        &|_| {},
                    );
                })
            );
        }

        let recent = load_recent_commits(&backend, &repo.info).unwrap();
        println!(
            "recent commits ({}): {}",
            recent.commits.len(),
            time(20, || {
                load_recent_commits(&backend, &repo.info).unwrap();
            })
        );
        if let Some(newest) = recent.commits.first() {
            let commit = CommitRequest {
                sha: newest.sha.clone(),
                parent: newest.parent.clone(),
            };
            let files = load_commit_files(&backend, &repo.info, &commit).unwrap();
            println!(
                "files of the newest commit ({}): {}",
                files.files.len(),
                time(20, || {
                    load_commit_files(&backend, &repo.info, &commit).unwrap();
                })
            );
        }

        // syntax colors of the largest source file colored (1 MiB at most), whole, then a block
        const SOURCE: [&str; 8] = [".rs", ".ts", ".tsx", ".js", ".c", ".h", ".py", ".go"];
        let sources = files
            .iter()
            .filter(|path| SOURCE.iter().any(|e| path.ends_with(e)));
        let sized = sources.filter_map(|path| {
            let meta = std::fs::metadata(Path::new(&repo.info.root).join(path)).ok()?;
            (meta.len() <= 1024 * 1024).then_some((meta.len(), *path))
        });
        if let Some((bytes, path)) = sized.max() {
            let request = SyntaxRequest {
                path: path.to_string(),
                version: FileVersion::Worktree,
                first: 1,
                count: 256,
            };
            println!(
                "colors of {path} ({} KiB): {}",
                bytes / 1024,
                time(5, || {
                    load_syntax_colors(&backend, &repo.info, &ColorCache::default(), &request)
                        .unwrap();
                })
            );
            let cache = ColorCache::default();
            println!(
                "a block of it, colored before: {}",
                time(20, || {
                    load_syntax_colors(&backend, &repo.info, &cache, &request).unwrap();
                })
            );
        }

        let snapshot = load_snapshot(&backend, &repo.info).unwrap();
        let Some(largest) = snapshot
            .files
            .iter()
            .max_by_key(|f| f.additions.unwrap_or(0) + f.deletions.unwrap_or(0))
        else {
            println!("diff: no changed file");
            return;
        };
        let request: FileDiffRequest = serde_json::from_value(json!({
            "path": largest.path,
            "origPath": largest.orig_path,
            "area": largest.area,
        }))
        .unwrap();
        println!(
            "diff of {} ({:?}): {}",
            largest.path,
            largest.area,
            time(20, || {
                load_file_diff(&backend, &repo.info, &request).unwrap();
            })
        );
    }

    /// This process's CPU time so far, as `ps` reports it (`[[h:]m:]s[.cc]`).
    fn cpu_time() -> Duration {
        let pid = std::process::id().to_string();
        let out = Command::new("ps")
            .args(["-o", "cputime=", "-p", &pid])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let seconds = text.trim().split(':').fold(0.0, |total, part| {
            total * 60.0 + part.parse::<f64>().unwrap()
        });
        Duration::from_secs_f64(seconds)
    }

    /// Syntax colors while an agent writes the file on screen: written every 250 ms (the
    /// watcher's batches during a burst), and after each write the block on screen, at the end of
    /// the file, asked for as the viewer does when a change invalidates it, without waiting for
    /// the last answer. An answer shows only if it comes before the next write (the viewer drops
    /// the others). Two edits: a line changed in the middle, a line added near the top.
    /// `SIDEKYK_BENCH_FILE=/path/to/file cargo test --release syntax_colors_while_written -- --ignored --nocapture`
    #[test]
    #[ignore = "benchmark, needs SIDEKYK_BENCH_FILE"]
    fn syntax_colors_while_written() {
        const WRITES: usize = 20;
        const EVERY: Duration = Duration::from_millis(250);
        let source = std::env::var("SIDEKYK_BENCH_FILE").expect("SIDEKYK_BENCH_FILE is set");
        let source = Path::new(&source);
        let name = source.file_name().unwrap().to_str().unwrap().to_string();
        let original: Vec<String> = std::fs::read_to_string(source)
            .unwrap()
            .lines()
            .map(String::from)
            .collect();
        let dir = scratch_repo();
        let backend = std::sync::Arc::new(LocalRepositoryBackend::default());
        let repo = resolve_repository(&*backend, dir.path()).unwrap().info;
        let root = Path::new(&repo.root).to_path_buf();
        // the block of the last screen of the file
        let first = original.len().saturating_sub(40) / 256 * 256 + 1;
        let request = SyntaxRequest {
            path: name.clone(),
            version: FileVersion::Worktree,
            first: first as u32,
            count: 256,
        };

        type Edit = fn(&mut Vec<String>, usize);
        let edits: [(&str, Edit); 2] = [
            ("a line changed in the middle", |lines, i| {
                let middle = lines.len() / 2;
                lines[middle] = format!("// edit {i}");
            }),
            ("a line added near the top", |lines, i| {
                let at = lines.len() / 10;
                lines.insert(at, format!("// edit {i}"));
            }),
        ];
        for (edit_name, edit) in edits {
            let cache = std::sync::Arc::new(ColorCache::default());
            let mut lines = original.clone();
            write(&root, &name, &format!("{}\n", lines.join("\n")));
            let started = Instant::now();
            load_syntax_colors(&*backend, &repo, &cache, &request).unwrap();
            let cold = started.elapsed();

            let cpu = cpu_time();
            let burst = Instant::now();
            let mut asks = Vec::new();
            for i in 0..WRITES {
                edit(&mut lines, i);
                let expected: Vec<u64> = lines
                    .iter()
                    .skip(first - 1)
                    .take(256)
                    .map(|line| u64::from(line_check(line)))
                    .collect();
                write(&root, &name, &format!("{}\n", lines.join("\n")));
                let written = Instant::now();
                let (backend, cache, repo, request) = (
                    backend.clone(),
                    cache.clone(),
                    repo.clone(),
                    request.clone(),
                );
                asks.push(std::thread::spawn(move || {
                    let colors = load_syntax_colors(&*backend, &repo, &cache, &request).unwrap();
                    let answered = written.elapsed();
                    let colors = serde_json::to_value(colors).unwrap();
                    let checks: Vec<u64> = colors["lines"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|line| line["check"].as_u64().unwrap())
                        .collect();
                    // the colors of this version, not of a newer one read again
                    (answered, checks == expected)
                }));
                std::thread::sleep(EVERY.saturating_sub(written.elapsed()));
            }
            let answers: Vec<_> = asks.into_iter().map(|ask| ask.join().unwrap()).collect();
            let cpu = cpu_time() - cpu;
            let wall = burst.elapsed();

            let in_time = answers[..WRITES - 1]
                .iter()
                .filter(|&&(time, own)| own && time < EVERY)
                .count();
            let (last, last_own) = answers[WRITES - 1];
            let mut times: Vec<_> = answers.iter().map(|&(time, _)| time).collect();
            times.sort();
            println!(
                "{name} ({} lines), {edit_name}: first colors {cold:.0?}; shown {in_time}/{} \
                 answers; answer median {:.0?}, max {:.0?}; colors {:.0?} after the last \
                 write{}; CPU {:.2} s in {:.2} s",
                original.len(),
                WRITES - 1,
                times[WRITES / 2],
                times[WRITES - 1],
                last,
                if last_own {
                    ""
                } else {
                    " (of another version)"
                },
                cpu.as_secs_f64(),
                wall.as_secs_f64(),
            );
        }
    }
}
