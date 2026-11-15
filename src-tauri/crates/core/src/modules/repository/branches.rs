//! The branches to switch to, and the switch: the one write Sidekyk makes to a repository, when
//! the user asks for it. As VS Code's "Checkout to...": a remote branch makes the local branch
//! that tracks it. Sidekyk never stashes, forces or fetches: git refuses a switch that would
//! overwrite changes, and says why.

use std::collections::HashSet;

use super::contracts::{Branch, BranchSwitch};
use crate::modules::folder::{existing_root, git_checked, RepositoryBackend, RepositoryInfo};
use crate::shared::error::{UserFacingError, UserFacingErrorCode};

/// Far more than the names of thousands of branches take.
const MAX_BRANCH_BYTES: usize = 4 * 1024 * 1024;

/// HEAD's mark, the full name, the branch it tracks and the ref it aliases, apart by NULs.
const BRANCH_FORMAT: &str = "--format=%(HEAD)%00%(refname)%00%(upstream)%00%(symref)";

/// The branches to switch to, the last committed to first (VS Code's `git.branchSortOrder`):
/// the local ones, then the remote ones no local branch tracks (`origin/HEAD` only aliases one).
/// Read when the picker opens.
pub fn load_branches(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
) -> anyhow::Result<Vec<Branch>> {
    let root = existing_root(backend, repository)?;
    let out = git_checked(
        backend,
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            BRANCH_FORMAT,
            "refs/heads",
            "refs/remotes",
        ],
        &[0],
        MAX_BRANCH_BYTES,
    )?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines: Vec<&str> = text.lines().collect();
    if out.truncated {
        // cut anywhere in its last line
        lines.pop();
    }
    Ok(parse_branches(&lines))
}

fn parse_branches(lines: &[&str]) -> Vec<Branch> {
    let mut local = Vec::new();
    let mut tracked = HashSet::new();
    let mut remote = Vec::new();
    for line in lines {
        let [head, name, upstream, symref] = *line.splitn(4, '\0').collect::<Vec<_>>() else {
            continue;
        };
        if let Some(branch) = name.strip_prefix("refs/heads/") {
            if !upstream.is_empty() {
                tracked.insert(upstream);
            }
            local.push(Branch {
                name: branch.to_string(),
                remote: false,
                current: head == "*",
            });
        } else if let Some(branch) = name.strip_prefix("refs/remotes/") {
            if symref.is_empty() {
                remote.push((name, branch));
            }
        }
    }
    let remote = remote
        .into_iter()
        .filter(|(full, _)| !tracked.contains(full))
        .map(|(_, branch)| Branch {
            name: branch.to_string(),
            remote: true,
            current: false,
        });
    local.into_iter().chain(remote).collect()
}

/// Switches to `request`'s branch: `git switch` to a local one, `git switch --track` to a remote
/// one, which makes `feature` for `origin/feature`. Hooks run, as in a terminal: git-lfs fetches
/// its files on `post-checkout`. The watcher then sees HEAD move.
pub fn switch_branch(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    request: &BranchSwitch,
) -> anyhow::Result<()> {
    let root = existing_root(backend, repository)?;
    let name = request.name.as_str();
    anyhow::ensure!(
        !name.is_empty() && !name.chars().any(char::is_control),
        "not a branch name"
    );
    // `--`: a name is never read as an option
    let args = if request.remote {
        ["switch", "--track", "--", name]
    } else {
        ["switch", "--no-guess", "--", name]
    };
    let out = backend.git_write(root, &args)?;
    if out.code == 0 {
        return Ok(());
    }
    let reason = out.stderr.trim();
    let code = switch_refusal(reason);
    let error = anyhow::anyhow!("git switch exited with code {}: {reason}", out.code);
    Err(match code {
        Some(code) => error.context(UserFacingError::new(code)),
        None => error,
    })
}

/// Why git refused a switch, when the user can act on it; under `LC_ALL=C`.
fn switch_refusal(stderr: &str) -> Option<UserFacingErrorCode> {
    if stderr.contains("would be overwritten by checkout") {
        // changed files, or untracked ones the branch has
        Some(UserFacingErrorCode::BranchSwitchBlocked)
    } else if stderr.contains("index.lock") {
        // another git (the agent's) holds the index
        Some(UserFacingErrorCode::RepositoryBusy)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locals_come_first_then_remotes_no_local_tracks() {
        let lines = [
            " \0refs/heads/feature\0refs/remotes/origin/feature\0",
            "*\0refs/heads/main\0refs/remotes/origin/main\0",
            " \0refs/remotes/origin/HEAD\0\0refs/remotes/origin/main",
            " \0refs/remotes/origin/fix-login\0\0",
            " \0refs/remotes/origin/main\0\0",
            " \0refs/remotes/origin/feature\0\0",
            " \0refs/heads/broken",
        ];
        let branches = parse_branches(&lines);
        let names: Vec<(&str, bool, bool)> = branches
            .iter()
            .map(|b| (b.name.as_str(), b.remote, b.current))
            .collect();
        assert_eq!(
            names,
            [
                ("feature", false, false),
                ("main", false, true),
                ("origin/fix-login", true, false),
            ]
        );
    }

    #[test]
    fn a_refused_switch_says_why_when_the_user_can_act() {
        assert_eq!(
            switch_refusal(
                "error: Your local changes to the following files would be overwritten by \
                 checkout:\n\tsrc/a.ts\nPlease commit your changes or stash them before you \
                 switch branches.\nAborting"
            ),
            Some(UserFacingErrorCode::BranchSwitchBlocked)
        );
        assert_eq!(
            switch_refusal(
                "fatal: Unable to create '/r/.git/index.lock': File exists.\n\nAnother git \
                 process seems to be running in this repository"
            ),
            Some(UserFacingErrorCode::RepositoryBusy)
        );
        assert_eq!(
            switch_refusal("fatal: a branch named 'feature' already exists"),
            None
        );
    }
}
