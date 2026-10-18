//! How many lines the branch on screen changed, commit by commit, since a time: the week of work
//! on a project's card. Read when the card shows, never in the background.

use super::contracts::{CommitActivity, CommittedLines, RepositoryInfo};
use super::open::existing_root;
use super::ports::{git_checked, RepositoryBackend};

/// At most this many commits are read: a week of a busy team's repository stays well below.
const MAX_COMMITS: usize = 500;

/// Far more than `MAX_COMMITS` commits take, a timestamp and a shortstat line each.
const MAX_ACTIVITY_BYTES: usize = 256 * 1024;

/// The commits of the branch on screen made since `since` (Unix seconds), newest first, merges
/// left out so that each change counts once, on the day it was committed; none before the first
/// commit.
pub fn load_commit_activity(
    backend: &dyn RepositoryBackend,
    repository: &RepositoryInfo,
    since: i64,
) -> anyhow::Result<CommitActivity> {
    let root = existing_root(backend, repository)?;
    let since = format!("--since=@{since}");
    // one more than read, to know whether there are more
    let count = format!("-n{}", MAX_COMMITS + 1);
    let out = git_checked(
        backend,
        root,
        &[
            "log",
            "--format=%x00%ct",
            // git runs with `LC_ALL=C`: the summary line is not translated
            "--shortstat",
            "--no-merges",
            &since,
            &count,
            // `log.showSignature` in the user's config would run gpg for every commit
            "--no-show-signature",
            // before the first commit HEAD names nothing: no commits, not a failure
            "--ignore-missing",
            "HEAD",
            "--",
        ],
        &[0],
        MAX_ACTIVITY_BYTES,
    )?;
    let mut commits = parse_activity(&out.stdout, out.truncated);
    let more = out.truncated || commits.len() > MAX_COMMITS;
    commits.truncate(MAX_COMMITS);
    Ok(CommitActivity { commits, more })
}

/// The commits of `git log --format=%x00%ct --shortstat`. Output `cut` by the transport loses its
/// last commit instead of counting it short.
fn parse_activity(bytes: &[u8], cut: bool) -> Vec<CommittedLines> {
    let text = String::from_utf8_lossy(bytes);
    let mut records: Vec<&str> = text.split('\0').skip(1).collect();
    if cut {
        records.pop();
    }
    records
        .iter()
        .filter_map(|record| {
            let mut lines = record.lines();
            let time = lines.next()?.trim().parse().ok()?;
            // an empty commit has no summary line
            let stat = lines.find(|line| !line.trim().is_empty()).unwrap_or("");
            Some(CommittedLines {
                time,
                additions: count_of(stat, "insertion"),
                deletions: count_of(stat, "deletion"),
            })
        })
        .collect()
}

/// The number before `word` in a shortstat line: ` 3 files changed, 12 insertions(+), 4
/// deletions(-)`; 0 when git left the part out.
fn count_of(stat: &str, word: &str) -> u32 {
    stat.split(',')
        .find(|part| part.contains(word))
        .and_then(|part| part.split_whitespace().next())
        .and_then(|count| count.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(time: i64, additions: u32, deletions: u32) -> CommittedLines {
        CommittedLines {
            time,
            additions,
            deletions,
        }
    }

    #[test]
    fn each_commit_takes_the_lines_of_its_summary_line() {
        let out = b"\x0020\n\n 3 files changed, 12 insertions(+), 4 deletions(-)\n\
            \x0010\n\n 1 file changed, 1 deletion(-)\n\
            \x005\n";
        assert_eq!(
            parse_activity(out, false),
            [lines(20, 12, 4), lines(10, 0, 1), lines(5, 0, 0)]
        );
    }

    #[test]
    fn output_cut_short_drops_its_last_commit() {
        let out = b"\x0020\n\n 1 file changed, 2 insertions(+)\n\x0010\n\n 1 file chan";
        assert_eq!(parse_activity(out, true), [lines(20, 2, 0)]);
        assert!(parse_activity(b"", false).is_empty());
    }
}
