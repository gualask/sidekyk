//! The `git` CLI as the repository module's backend. No libgit2: every answer is what the user's
//! own git would print.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

use anyhow::Context;

use crate::modules::repository::{GitOutput, RepositoryBackend};
use crate::shared::error::{user_facing, user_facing_code, UserFacingErrorCode};

/// No git call takes longer: past it git is killed and the call fails with `git_timed_out`, so a
/// hung command (a network drive, a huge repository) cannot hold a snapshot forever. Its message
/// in `app-error.ts` names it.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// What git writes to stderr past this is read and dropped: its start says what went wrong.
const MAX_STDERR_BYTES: usize = 64 * 1024;

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

/// A pipe of the child, read to its end on a thread of its own.
enum Pipe {
    Stdout(std::io::Result<Stdout>),
    Stderr(Vec<u8>),
}

struct Stdout {
    bytes: Vec<u8>,
    /// There was more: the reading stopped at the limit.
    truncated: bool,
}

/// Reads at most `max` bytes, and one more to know whether there was more.
fn read_stdout(pipe: impl Read, max: usize) -> std::io::Result<Stdout> {
    let mut bytes = Vec::new();
    pipe.take((max as u64).saturating_add(1))
        .read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max;
    bytes.truncate(max);
    Ok(Stdout { bytes, truncated })
}

/// Keeps the start of stderr and drains the rest, so that git never blocks writing to it.
fn read_stderr(mut pipe: impl Read) -> Vec<u8> {
    let mut bytes = Vec::new();
    let _ = (&mut pipe)
        .take(MAX_STDERR_BYTES as u64)
        .read_to_end(&mut bytes);
    let _ = std::io::copy(&mut pipe, &mut std::io::sink());
    bytes
}

fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Runs `command`, writing `input` to it, and reads its output within `max_stdout` bytes and
/// `timeout`. Each pipe is read on a thread of its own, so the caller can give up on both: a
/// reader left behind ends when the pipe closes. Past `max_stdout` the child is killed and its
/// output comes back cut; past `timeout` it is killed and the call fails.
fn run(
    command: &mut Command,
    input: Option<&[u8]>,
    max_stdout: usize,
    timeout: Duration,
) -> anyhow::Result<GitOutput> {
    let deadline = Instant::now() + timeout;
    let mut child = command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .spawn()?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        // written apart, so a large output cannot block git while we still write; closed once
        // written, which ends git's input
        let input = input.to_vec();
        std::thread::spawn(move || stdin.write_all(&input));
    }
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        kill(&mut child);
        anyhow::bail!("git's output is not piped");
    };
    let (sender, pipes) = mpsc::channel();
    let to_stdout = sender.clone();
    std::thread::spawn(move || to_stdout.send(Pipe::Stdout(read_stdout(stdout, max_stdout))));
    std::thread::spawn(move || sender.send(Pipe::Stderr(read_stderr(stderr))));

    let mut stdout = None;
    let mut stderr = Vec::new();
    let mut stderr_done = false;
    while stdout.is_none() || !stderr_done {
        match pipes.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(Pipe::Stdout(read)) => {
                let read = read.inspect_err(|_| kill(&mut child))?;
                let truncated = read.truncated;
                stdout = Some(read);
                // nobody reads the rest: git stops here, and so does the wait for stderr
                if truncated {
                    kill(&mut child);
                    break;
                }
            }
            Ok(Pipe::Stderr(read)) => {
                stderr = read;
                stderr_done = true;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                kill(&mut child);
                return Err(user_facing(UserFacingErrorCode::GitTimedOut));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                kill(&mut child);
                anyhow::bail!("git's output could not be read");
            }
        }
    }
    let stdout = stdout.context("git's output was not read")?;
    let code = if stdout.truncated {
        -1
    } else {
        // both pipes closed: git has ended, or is ending, so this wait is short
        child.wait()?.code().unwrap_or(-1)
    };
    Ok(GitOutput {
        code,
        stdout: stdout.bytes,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        truncated: stdout.truncated,
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
}

#[cfg(test)]
mod tests {
    //! End to end against a real git in a scratch repository.

    use super::*;
    use crate::modules::repository::{
        load_commit_file_diff, load_commit_files, load_file_diff, load_recent_commits,
        load_snapshot, load_summary, resolve_repository, ChangeArea, ChangeKind, ChangedFile,
        Commit, CommitFileDiffRequest, CommitRequest, FileDiffRequest, IgnoredPaths,
        RepositorySnapshot,
    };
    use crate::modules::search::{search, SearchRequest};
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
            value["summary"]["files"],
            json!([
                { "path": "README.md", "origPath": null, "kind": "deleted", "additions": 0, "deletions": 1, "binary": false },
                { "path": "src/cart.ts", "origPath": null, "kind": "modified", "additions": 3, "deletions": 1, "binary": false },
                { "path": "notes/todo.md", "origPath": null, "kind": "untracked", "additions": null, "deletions": null, "binary": false },
            ])
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
    fn output_past_the_limit_is_cut_and_the_process_killed() {
        let started = Instant::now();
        // writes forever: only killing it ends the call
        let out = run(&mut shell("yes"), None, 1000, Duration::from_secs(10)).unwrap();
        assert!(out.truncated);
        assert_eq!(out.code, -1);
        assert_eq!(out.stdout, b"y\n".repeat(500));
        assert!(started.elapsed() < Duration::from_secs(5));

        let out = run(&mut shell("printf abc"), None, 3, Duration::from_secs(10)).unwrap();
        assert_eq!(
            (out.stdout.as_slice(), out.truncated, out.code),
            (&b"abc"[..], false, 0)
        );
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

    #[cfg(unix)]
    #[test]
    fn input_is_written_and_stderr_kept() {
        let out = run(
            &mut shell("cat; echo oops >&2; exit 3"),
            Some(b"in"),
            1000,
            Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(out.stdout, b"in");
        assert_eq!(out.stderr, "oops\n");
        assert_eq!(out.code, 3);
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

    /// Times the snapshot, the summary, the palette's search over every tracked path, the recent
    /// commits with the files of the newest, and the diff of the largest changed file on a real
    /// repository:
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

        // the palette over every tracked path, as many as it will search once the explorer
        // lists them all
        let listed = backend
            .git(Path::new(&repo.info.root), &["ls-files", "-z"], usize::MAX)
            .unwrap();
        let tracked: Vec<ChangedFile> = String::from_utf8_lossy(&listed.stdout)
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(|path| ChangedFile {
                path: path.to_string(),
                orig_path: None,
                area: ChangeArea::Unstaged,
                kind: ChangeKind::Modified,
                additions: None,
                deletions: None,
                binary: false,
            })
            .collect();
        let palette: SearchRequest =
            serde_json::from_value(json!({ "query": "srcmod", "panels": ["Changes"] })).unwrap();
        println!(
            "search over {} paths: {}",
            tracked.len(),
            time(20, || {
                search(&palette, std::slice::from_ref(&repo.info), &tracked);
            })
        );

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
