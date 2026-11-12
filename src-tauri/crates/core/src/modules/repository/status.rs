//! Parser for `git status --porcelain=v2 -z --branch`.

use super::contracts::{BranchStatus, ChangeKind};

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct StatusReport {
    pub(super) branch: BranchStatus,
    pub(super) entries: Vec<StatusEntry>,
    /// git listed more entries than were read.
    pub(super) truncated: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct StatusEntry {
    pub(super) path: String,
    pub(super) orig_path: Option<String>,
    pub(super) staged: Option<ChangeKind>,
    pub(super) unstaged: Option<ChangeKind>,
    /// The objects of the path in HEAD (of `orig_path` for a rename) and in the index: `None`
    /// where it is not.
    pub(super) head_blob: Option<String>,
    pub(super) index_blob: Option<String>,
}

const SHORT_COMMIT: usize = 7;

pub(super) fn kind_of(code: char) -> Option<ChangeKind> {
    match code {
        'M' => Some(ChangeKind::Modified),
        'T' => Some(ChangeKind::TypeChanged),
        'A' => Some(ChangeKind::Added),
        'D' => Some(ChangeKind::Deleted),
        'R' => Some(ChangeKind::Renamed),
        'C' => Some(ChangeKind::Copied),
        _ => None,
    }
}

/// An object id as git prints it, `None` for the one of zeros that stands for no object.
pub(super) fn object_id(id: &str) -> Option<String> {
    (!id.is_empty() && id.bytes().any(|b| b != b'0')).then(|| id.to_string())
}

/// `fields`: `<XY> <sub> <mH> <mI> <mW> <hH> <hI> …`, the path last.
fn tracked_entry(fields: &[&str], path: &str, orig_path: Option<String>) -> StatusEntry {
    let mut codes = fields[0].chars();
    let blob = |at: usize| fields.get(at).copied().and_then(object_id);
    StatusEntry {
        path: path.to_string(),
        orig_path,
        staged: codes.next().and_then(kind_of),
        unstaged: codes.next().and_then(kind_of),
        head_blob: blob(5),
        index_blob: blob(6),
    }
}

/// `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`, without its tag.
fn ordinary_entry(rest: &str) -> Option<StatusEntry> {
    let fields: Vec<&str> = rest.splitn(8, ' ').collect();
    fields.last().map(|path| tracked_entry(&fields, path, None))
}

/// `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`, without its tag; `orig_path` the
/// record after it.
fn renamed_entry(rest: &str, orig_path: Option<String>) -> Option<StatusEntry> {
    let fields: Vec<&str> = rest.splitn(9, ' ').collect();
    fields
        .last()
        .map(|path| tracked_entry(&fields, path, orig_path))
}

fn untracked_entry(path: &str) -> StatusEntry {
    StatusEntry {
        path: path.to_string(),
        orig_path: None,
        staged: None,
        unstaged: Some(ChangeKind::Untracked),
        head_blob: None,
        index_blob: None,
    }
}

fn conflicted_entry(path: &str) -> StatusEntry {
    StatusEntry {
        path: path.to_string(),
        orig_path: None,
        staged: None,
        unstaged: Some(ChangeKind::Conflicted),
        // the index holds the stages, not one version
        head_blob: None,
        index_blob: None,
    }
}

fn read_header(branch: &mut BranchStatus, header: &str) {
    let Some((key, value)) = header.split_once(' ') else {
        return;
    };
    match key {
        "branch.oid" if value != "(initial)" => {
            branch.commit = Some(value.chars().take(SHORT_COMMIT).collect());
        }
        "branch.head" if value != "(detached)" => branch.head = Some(value.to_string()),
        "branch.upstream" => branch.upstream = Some(value.to_string()),
        "branch.ab" => read_ahead_behind(branch, value),
        _ => {}
    }
}

/// `+<ahead> -<behind>`.
fn read_ahead_behind(branch: &mut BranchStatus, value: &str) {
    for part in value.split(' ') {
        if let Some(n) = part.strip_prefix('+') {
            branch.ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix('-') {
            branch.behind = n.parse().unwrap_or(0);
        }
    }
}

pub(super) fn parse_porcelain_v2(bytes: &[u8]) -> StatusReport {
    let text = String::from_utf8_lossy(bytes);
    let mut records = text.split('\0').filter(|r| !r.is_empty());
    let mut report = StatusReport::default();

    while let Some(record) = records.next() {
        let Some((tag, rest)) = record.split_once(' ') else {
            continue;
        };
        match tag {
            "#" => read_header(&mut report.branch, rest),
            "1" => report.entries.extend(ordinary_entry(rest)),
            // <origPath> follows as its own record
            "2" => {
                let orig_path = records.next().map(str::to_string);
                report.entries.extend(renamed_entry(rest, orig_path));
            }
            // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            "u" => report
                .entries
                .extend(rest.splitn(10, ' ').nth(9).map(conflicted_entry)),
            "?" => report.entries.push(untracked_entry(rest)),
            _ => {}
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn z(records: &[&str]) -> Vec<u8> {
        records
            .iter()
            .flat_map(|r| [r.as_bytes(), b"\0"].concat())
            .collect()
    }

    #[test]
    fn reads_branch_headers() {
        let report = parse_porcelain_v2(&z(&[
            "# branch.oid 0123456789abcdef",
            "# branch.head feature/x",
            "# branch.upstream origin/feature/x",
            "# branch.ab +3 -1",
        ]));
        assert_eq!(
            report.branch,
            BranchStatus {
                head: Some("feature/x".into()),
                commit: Some("0123456".into()),
                upstream: Some("origin/feature/x".into()),
                ahead: 3,
                behind: 1,
            }
        );
    }

    #[test]
    fn an_unborn_detached_branch_has_no_head_or_commit() {
        let report =
            parse_porcelain_v2(&z(&["# branch.oid (initial)", "# branch.head (detached)"]));
        assert_eq!(report.branch, BranchStatus::default());
    }

    #[test]
    fn reads_ordinary_renamed_unmerged_and_untracked_entries() {
        let report = parse_porcelain_v2(&z(&[
            "1 .M N... 100644 100644 100644 aaa bbb src/with space.ts",
            "1 MD N... 100644 100644 000000 aaa bbb lib.rs",
            "1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 ddd new.png",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts",
            "old name.ts",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
            "? notes/todo.md",
            "! ignored.log",
        ]));

        assert_eq!(
            report.entries,
            vec![
                StatusEntry {
                    path: "src/with space.ts".into(),
                    orig_path: None,
                    staged: None,
                    unstaged: Some(ChangeKind::Modified),
                    head_blob: Some("aaa".into()),
                    index_blob: Some("bbb".into()),
                },
                StatusEntry {
                    path: "lib.rs".into(),
                    orig_path: None,
                    staged: Some(ChangeKind::Modified),
                    unstaged: Some(ChangeKind::Deleted),
                    head_blob: Some("aaa".into()),
                    index_blob: Some("bbb".into()),
                },
                // nothing in HEAD: git prints an id of zeros
                StatusEntry {
                    path: "new.png".into(),
                    orig_path: None,
                    staged: Some(ChangeKind::Added),
                    unstaged: None,
                    head_blob: None,
                    index_blob: Some("ddd".into()),
                },
                StatusEntry {
                    path: "new name.ts".into(),
                    orig_path: Some("old name.ts".into()),
                    staged: Some(ChangeKind::Renamed),
                    unstaged: None,
                    head_blob: Some("aaa".into()),
                    index_blob: Some("bbb".into()),
                },
                StatusEntry {
                    path: "conflict.ts".into(),
                    orig_path: None,
                    staged: None,
                    unstaged: Some(ChangeKind::Conflicted),
                    head_blob: None,
                    index_blob: None,
                },
                StatusEntry {
                    path: "notes/todo.md".into(),
                    orig_path: None,
                    staged: None,
                    unstaged: Some(ChangeKind::Untracked),
                    head_blob: None,
                    index_blob: None,
                },
            ]
        );
    }
}
