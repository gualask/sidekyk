//! The `git` CLI as the repository module's backend. No libgit2: every answer is what the user's
//! own git would print.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use crate::modules::repository::{GitOutput, RepositoryBackend};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// An app started from Finder gets a minimal PATH, so the usual install dirs are checked too.
const FALLBACK_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

fn find_git() -> Option<PathBuf> {
    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    path_dirs
        .into_iter()
        .chain(FALLBACK_DIRS.iter().map(PathBuf::from))
        .map(|dir| dir.join("git"))
        .find(|candidate| candidate.is_file())
}

#[derive(Default)]
pub(crate) struct LocalRepositoryBackend {
    git: OnceLock<Option<PathBuf>>,
}

impl RepositoryBackend for LocalRepositoryBackend {
    fn git(&self, cwd: &Path, args: &[&str]) -> anyhow::Result<GitOutput> {
        let Some(bin) = self.git.get_or_init(find_git) else {
            return Err(user_facing(UserFacingErrorCode::GitNotFound));
        };
        let out = Command::new(bin)
            .args(args)
            .current_dir(cwd)
            // Never take index.lock: a refresh must not fight the agent's own git commands, and
            // a status that rewrote the index would wake the watcher again.
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .output()?;
        Ok(GitOutput {
            code: out.status.code().unwrap_or(-1),
            stdout: out.stdout,
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
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
        load_file_diff, load_snapshot, resolve_repository, FileDiffRequest, RepositorySnapshot,
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
                { "path": "src/cart.ts", "origPath": null, "area": "staged", "kind": "modified", "additions": 2, "deletions": 1 },
                { "path": "README.md", "origPath": null, "area": "unstaged", "kind": "deleted", "additions": 0, "deletions": 1 },
                { "path": "src/cart.ts", "origPath": null, "area": "unstaged", "kind": "modified", "additions": 1, "deletions": 0 },
                { "path": "notes/todo.md", "origPath": null, "area": "untracked", "kind": "untracked", "additions": 3, "deletions": 0 },
            ])
        );
        // vs HEAD: cart +3 -1, README -1, todo +3
        assert_eq!(
            value["totals"],
            json!({ "files": 3, "additions": 6, "deletions": 2 })
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
    fn a_folder_outside_any_repository_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let err = resolve_repository(&LocalRepositoryBackend::default(), dir.path())
            .err()
            .unwrap();
        assert_eq!(err.to_string(), "not_a_repository");
    }
}
