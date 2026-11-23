//! The repository and folder modules' backend on this machine: the `git` CLI (no libgit2: every
//! answer is what the user's own git would print), the disk read directly (`worktree_files`), and
//! the walk of a folder without git (`folder_walk`).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use super::folder_walk;
use super::hide_console;
use super::process::{self, TimedOut};
use super::worktree_files;
use crate::modules::folder::{
    FileStamp, FolderEntry, FolderRules, GitOutput, RepositoryBackend, Walked, WorktreeEntry,
};
use crate::shared::error::{user_facing, user_facing_code, UserFacingError, UserFacingErrorCode};

/// No git call takes longer: past it git is killed and the call fails with `git_timed_out`, so a
/// hung command (a network drive, a huge repository) cannot hold a snapshot forever. Its message
/// in `app-error.ts` names it.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// A git that writes (a branch switch, its hooks: git-lfs fetching files) is killed only past this,
/// stuck: killed midway it would leave `index.lock` and a half-switched tree.
const GIT_WRITE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Far more than a switch and its hooks print.
const MAX_WRITE_STDOUT: usize = 1024 * 1024;

/// In a partial clone git fetches an object it lacks from the remote, writing a pack: a read never
/// does (git 2.45 on; an older git ignores it), it fails instead. The branch switch the user asks
/// for may, as in a terminal: its checkout needs the files.
const NO_LAZY_FETCH: &str = "GIT_NO_LAZY_FETCH";

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
            // refresh: never here. Not every command its config names is turned off: a
            // `filter.<driver>.clean` still runs when a diff or numstat reads the working tree, so
            // a folder whose `.git` came from someone else runs what that `.git` says, as git does
            // in a terminal (the branch switch the user asks for runs its hooks, as there too).
            .args(["-c", "core.fsmonitor=false"])
            // `git diff` against the working tree rewrites the index when a file's stat changed
            // but not its content, even with `GIT_OPTIONAL_LOCKS=0`: a read must not write.
            .args(["-c", "diff.autoRefreshIndex=false"])
            .args(args)
            .current_dir(cwd)
            // Never take index.lock: a refresh must not fight the agent's own git commands, and
            // a status that rewrote the index would wake the watcher again.
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env(NO_LAZY_FETCH, "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // git would open a console window for every command
        hide_console(&mut command);
        Ok(command)
    }

    /// Runs a git `command` of `args` within the limits, and logs it (`log_git`).
    fn run_git(
        command: &mut Command,
        args: &[&str],
        input: Option<&[u8]>,
        max_stdout: usize,
        timeout: Duration,
    ) -> anyhow::Result<GitOutput> {
        let started = Instant::now();
        let output = run(command, input, max_stdout, timeout);
        log_git(args, started, &output);
        output
    }
}

/// A git run, logged in development builds only (`debug` is compiled out of release builds); a git
/// that timed out, in every build.
fn log_git(args: &[&str], started: Instant, output: &anyhow::Result<GitOutput>) {
    match output {
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
}

/// `process::run`, past its time a `git_timed_out` (`app-error.ts` names git), and a repository git
/// refuses for its owner a `repository_unsafe_owner`.
fn run(
    command: &mut Command,
    input: Option<&[u8]>,
    max_stdout: usize,
    timeout: Duration,
) -> anyhow::Result<GitOutput> {
    let output = process::run(command, input, max_stdout, timeout).map_err(|error| {
        if error.is::<TimedOut>() {
            user_facing(UserFacingErrorCode::GitTimedOut)
        } else {
            error
        }
    })?;
    if refuses_owner(&output) {
        // git's own words, for the log
        return Err(
            anyhow::anyhow!("{}", output.stderr.trim()).context(UserFacingError::new(
                UserFacingErrorCode::RepositoryUnsafeOwner,
            )),
        );
    }
    Ok(output)
}

/// Whether git refused the repository because another user owns it (CVE-2022-24765): its config
/// could run programs as this user. Sidekyk never adds it to `safe.directory`; the user does. Under
/// `LC_ALL=C`, up to git 2.37 (and in its backports): "unsafe repository ('…' is owned by someone
/// else)"; since 2.38: "detected dubious ownership in repository at '…'".
fn refuses_owner(output: &GitOutput) -> bool {
    output.code == 128
        && (output.stderr.contains("detected dubious ownership")
            || output.stderr.contains("is owned by someone else"))
}

impl RepositoryBackend for LocalRepositoryBackend {
    fn git(&self, cwd: &Path, args: &[&str], max_stdout: usize) -> anyhow::Result<GitOutput> {
        let mut command = self.command(cwd, args)?;
        Self::run_git(&mut command, args, None, max_stdout, GIT_TIMEOUT)
    }

    fn git_with_input(
        &self,
        cwd: &Path,
        args: &[&str],
        input: &[u8],
        max_stdout: usize,
    ) -> anyhow::Result<GitOutput> {
        let mut command = self.command(cwd, args)?;
        Self::run_git(&mut command, args, Some(input), max_stdout, GIT_TIMEOUT)
    }

    fn git_write(&self, cwd: &Path, args: &[&str]) -> anyhow::Result<GitOutput> {
        let mut command = self.command(cwd, args)?;
        command.env_remove(NO_LAZY_FETCH);
        Self::run_git(
            &mut command,
            args,
            None,
            MAX_WRITE_STDOUT,
            GIT_WRITE_TIMEOUT,
        )
    }

    fn read_file(&self, path: &Path, limit: u64) -> Option<Vec<u8>> {
        worktree_files::read_file(path, limit)
    }

    fn read_entry(&self, root: &Path, path: &Path, limit: usize) -> Option<WorktreeEntry> {
        worktree_files::read_entry(root, path, limit)
    }

    fn file_stamp(&self, root: &Path, path: &Path) -> Option<FileStamp> {
        worktree_files::file_stamp(root, path)
    }

    fn modified_times(&self, root: &Path, paths: &[&str]) -> Vec<Option<i64>> {
        worktree_files::modified_times(root, paths)
    }

    fn open_file(&self, root: &Path, path: &Path) -> Option<Box<dyn Read + Send>> {
        worktree_files::open_file(root, path)
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn has_entry(&self, root: &Path, path: &Path) -> bool {
        std::fs::symlink_metadata(root.join(path)).is_ok()
    }

    fn entries(&self, root: &Path, path: &Path) -> Option<Vec<FolderEntry>> {
        worktree_files::entries(root, path)
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

#[cfg(test)]
mod tests;
