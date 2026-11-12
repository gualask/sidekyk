//! `git diff --numstat` run: the line counts of one area of the working tree, by path.

use std::collections::HashMap;
use std::path::Path;

use super::limits::MAX_NUMSTAT_BYTES;
use super::numstat::{parse_numstat_z, Counts, LineCounts};
use crate::modules::folder::{git_checked, RepositoryBackend, LITERAL_PATHSPECS};

type CountsByPath = HashMap<String, Counts>;

/// The line counts of one numstat, by path.
#[derive(Default)]
pub(super) struct Numstat {
    pub(super) counts: CountsByPath,
    /// The output was cut: some paths have no counts.
    pub(super) truncated: bool,
}

impl Numstat {
    /// The counts of `path`, none when the numstat does not name it.
    pub(super) fn of(&self, path: &str) -> Counts {
        self.counts.get(path).copied().unwrap_or_default()
    }
}

fn by_path(counts: Vec<LineCounts>) -> CountsByPath {
    counts.into_iter().map(|c| (c.path, c.counts)).collect()
}

/// `git diff --numstat` with `extra` options, cut at `MAX_NUMSTAT_BYTES`.
pub(super) fn numstat(
    backend: &dyn RepositoryBackend,
    root: &Path,
    extra: &[&str],
) -> anyhow::Result<Numstat> {
    let mut args = vec![
        LITERAL_PATHSPECS,
        "diff",
        "--numstat",
        "-z",
        "--no-ext-diff",
    ];
    args.extend_from_slice(extra);
    let out = git_checked(backend, root, &args, &[0], MAX_NUMSTAT_BYTES)?;
    let mut counts = parse_numstat_z(&out.stdout);
    if out.truncated {
        // the output was cut anywhere, maybe in the last record
        counts.pop();
    }
    Ok(Numstat {
        counts: by_path(counts),
        truncated: out.truncated,
    })
}

/// The counts of two areas of the same paths, added up path by path.
pub(super) fn added_up(first: Numstat, second: Numstat) -> Numstat {
    let mut counts = first.counts;
    for (path, more) in second.counts {
        let sum = counts.entry(path).or_default();
        *sum = Counts {
            additions: add_options(sum.additions, more.additions),
            deletions: add_options(sum.deletions, more.deletions),
            binary: sum.binary || more.binary,
        };
    }
    Numstat {
        counts,
        truncated: first.truncated || second.truncated,
    }
}

fn add_options(a: Option<u32>, b: Option<u32>) -> Option<u32> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0).saturating_add(b.unwrap_or(0))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_of_two_areas_add_up_path_by_path() {
        let numstat = |entries: &[(&str, Counts)], truncated| Numstat {
            counts: entries.iter().map(|(p, c)| (p.to_string(), *c)).collect(),
            truncated,
        };
        let sum = added_up(
            numstat(
                &[("a.ts", Counts::lines(1, 2)), ("logo.png", Counts::BINARY)],
                false,
            ),
            numstat(
                &[("a.ts", Counts::lines(3, 0)), ("b.ts", Counts::lines(0, 1))],
                true,
            ),
        );
        assert_eq!(sum.counts["a.ts"], Counts::lines(4, 2));
        assert_eq!(sum.counts["b.ts"], Counts::lines(0, 1));
        assert_eq!(sum.counts["logo.png"], Counts::BINARY);
        assert!(sum.truncated);
    }
}
