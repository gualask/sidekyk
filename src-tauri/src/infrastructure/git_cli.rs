//! The `git` CLI as the repository module's backend. No libgit2: every answer is what the user's
//! own git would print.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Instant;

use crate::modules::repository::{GitOutput, RepositoryBackend};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// An app started from Finder or a desktop launcher can get a minimal PATH, so the usual install
/// dirs are checked too.
#[cfg(unix)]
const FALLBACK_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
#[cfg(windows)]
const FALLBACK_DIRS: &[&str] = &[r"C:\Program Files\Git\cmd"];

/// Keeps git from opening a console window for every command, which a GUI app's child process
/// does on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
pub(crate) struct LocalRepositoryBackend {
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
        #[cfg(windows)]
        std::os::windows::process::CommandExt::creation_flags(&mut command, CREATE_NO_WINDOW);
        Ok(command)
    }
}

/// Converts a finished git process into the port's output, and logs the command (development
/// builds only: `debug` is compiled out of release builds).
fn git_output(args: &[&str], started: Instant, out: std::process::Output) -> GitOutput {
    let output = GitOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: out.stdout,
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    };
    tracing::debug!(
        args = %args.join(" "),
        code = output.code,
        ms = started.elapsed().as_millis() as u64,
        stdout_bytes = output.stdout.len(),
        "git"
    );
    output
}

impl RepositoryBackend for LocalRepositoryBackend {
    fn git(&self, cwd: &Path, args: &[&str]) -> anyhow::Result<GitOutput> {
        let started = Instant::now();
        let out = self.command(cwd, args)?.stdin(Stdio::null()).output()?;
        Ok(git_output(args, started, out))
    }

    fn git_with_input(&self, cwd: &Path, args: &[&str], input: &[u8]) -> anyhow::Result<GitOutput> {
        let started = Instant::now();
        let mut child = self.command(cwd, args)?.stdin(Stdio::piped()).spawn()?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("git stdin is not piped"))?;
        // Written from another thread, so a large output cannot block git while we still write.
        let out = std::thread::scope(|scope| {
            let writer = scope.spawn(move || stdin.write_all(input));
            let out = child.wait_with_output();
            let _ = writer.join();
            out
        })?;
        Ok(git_output(args, started, out))
    }

    fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>> {
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() || meta.len() > limit {
            return None;
        }
        std::fs::read(path).ok()
    }
}

#[cfg(test)]
mod tests {
    //! End to end against a real git in a scratch repository.

    use super::*;
    use crate::modules::repository::{
        load_file_diff, load_snapshot, resolve_repository, FileDiffRequest, IgnoredPaths,
        RepositorySnapshot,
    };
    use serde_json::json;

    fn git(root: &Path, args: &[&str]) {
        let backend = LocalRepositoryBackend::default();
        let out = backend.git(root, args).unwrap();
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
    fn snapshot_reports_every_area_with_counts_and_totals_against_head() {
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

        assert_eq!(value["branch"]["head"], "main");
        assert_eq!(
            value["files"],
            json!([
                { "path": "src/cart.ts", "origPath": null, "area": "staged", "kind": "modified", "additions": 2, "deletions": 1, "binary": false },
                { "path": "README.md", "origPath": null, "area": "unstaged", "kind": "deleted", "additions": 0, "deletions": 1, "binary": false },
                { "path": "src/cart.ts", "origPath": null, "area": "unstaged", "kind": "modified", "additions": 1, "deletions": 0, "binary": false },
                { "path": "notes/todo.md", "origPath": null, "area": "untracked", "kind": "untracked", "additions": 3, "deletions": 0, "binary": false },
            ])
        );
        // vs HEAD: cart +3 -1, README -1, todo +3
        assert_eq!(
            value["totals"],
            json!({ "files": 3, "additions": 6, "deletions": 2 })
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
        let value = snapshot_json(&load_snapshot(&backend, &repo.info).unwrap());

        // a.ts: +1 staged and +1 unstaged; b.ts: +2 untracked
        assert_eq!(
            value["totals"],
            json!({ "files": 2, "additions": 4, "deletions": 0 })
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

        assert!(load_file_diff(&backend, &repo.info, &request("../x", "unstaged")).is_err());
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
        assert!(!ignored.any_visible(
            &backend,
            &changed(&["target/debug/a.o", "src/debug.log", "vendor/new.js"])
        ));
        assert!(ignored.any_visible(&backend, &changed(&["vendor/kept.js"])));
        assert!(ignored.any_visible(&backend, &changed(&["target/a.o", "src/cart.ts"])));
    }

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

    #[test]
    fn a_folder_outside_any_repository_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let err = resolve_repository(&LocalRepositoryBackend::default(), dir.path())
            .err()
            .unwrap();
        assert_eq!(err.to_string(), "not_a_repository");
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

    /// Times the snapshot and the diff of the largest changed file on a real repository:
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
}
