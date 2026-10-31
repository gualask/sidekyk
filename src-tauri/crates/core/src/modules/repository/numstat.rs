//! Parsers for `git diff --numstat -z` and `--name-status -z`, plus line counting for untracked
//! files.

/// Lines added and removed in one file. Both are `None` for a binary file, and for a file that
/// was not counted.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Counts {
    pub(super) additions: Option<u32>,
    pub(super) deletions: Option<u32>,
    pub(super) binary: bool,
}

impl Counts {
    pub(super) const BINARY: Self = Self {
        additions: None,
        deletions: None,
        binary: true,
    };

    pub(super) fn lines(additions: u32, deletions: u32) -> Self {
        Self {
            additions: Some(additions),
            deletions: Some(deletions),
            binary: false,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct LineCounts {
    pub(super) path: String,
    pub(super) counts: Counts,
}

/// Each record is `<added>\t<deleted>\t<path>`. A rename leaves the path empty and puts
/// `<old>` and `<new>` in the next two records. A binary file counts `-`.
pub(super) fn parse_numstat_z(bytes: &[u8]) -> Vec<LineCounts> {
    let text = String::from_utf8_lossy(bytes);
    let mut records = text.split('\0');
    let mut counts = Vec::new();

    while let Some(record) = records.next() {
        let mut fields = record.splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let path = if path.is_empty() {
            records.next();
            records.next().unwrap_or_default()
        } else {
            path
        };
        counts.push(LineCounts {
            path: path.to_string(),
            counts: if added == "-" && deleted == "-" {
                Counts::BINARY
            } else {
                Counts {
                    additions: added.parse().ok(),
                    deletions: deleted.parse().ok(),
                    binary: false,
                }
            },
        });
    }

    counts
}

/// Every path `git diff --name-status -z` names: a status, then the path, or for a rename or a
/// copy (`R100`, `C75`) the old path and the new one.
pub(super) fn parse_name_status_z(bytes: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(bytes);
    let mut fields = text.split('\0');
    let mut paths = Vec::new();
    while let Some(status) = fields.next() {
        let sides = match status.chars().next() {
            None => continue,
            Some('R' | 'C') => 2,
            Some(_) => 1,
        };
        paths.extend(fields.by_ref().take(sides).map(str::to_string));
    }
    paths
}

/// A NUL in the first 8 KiB: the heuristic git uses to call a file binary.
pub(super) fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8000)].contains(&0)
}

/// How many lines a new file adds, or `None` when it looks binary.
pub(super) fn count_text_lines(bytes: &[u8]) -> Option<u32> {
    if looks_binary(bytes) {
        return None;
    }
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count();
    let unterminated = usize::from(bytes.last().is_some_and(|&b| b != b'\n'));
    u32::try_from(newlines + unterminated).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_renamed_and_binary_records() {
        let out = b"3\t1\tsrc/a b.ts\0-\t-\tlogo.png\x002\t0\t\0old.ts\0new.ts\0";
        assert_eq!(
            parse_numstat_z(out),
            vec![
                LineCounts {
                    path: "src/a b.ts".into(),
                    counts: Counts::lines(3, 1),
                },
                LineCounts {
                    path: "logo.png".into(),
                    counts: Counts::BINARY,
                },
                LineCounts {
                    path: "new.ts".into(),
                    counts: Counts::lines(2, 0),
                },
            ]
        );
        assert!(parse_numstat_z(b"").is_empty());
    }

    #[test]
    fn names_every_path_with_both_sides_of_a_rename() {
        let out = b"M\0src/a b.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0";
        assert_eq!(
            parse_name_status_z(out),
            ["src/a b.ts", "old.ts", "new.ts", "gone.ts"]
        );
        assert!(parse_name_status_z(b"").is_empty());
    }

    #[test]
    fn counts_lines_of_new_text_files() {
        assert_eq!(count_text_lines(b""), Some(0));
        assert_eq!(count_text_lines(b"a\nb\n"), Some(2));
        assert_eq!(count_text_lines(b"a\nb"), Some(2));
        assert_eq!(count_text_lines(b"PNG\0data"), None);
    }
}
