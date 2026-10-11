//! Parser for `git diff --numstat -z`, plus line counting for untracked files.

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

/// How many lines a new file adds, or `None` when it looks binary (a NUL in its first 8 KiB,
/// the heuristic git uses).
pub(super) fn count_text_lines(bytes: &[u8]) -> Option<u32> {
    if bytes[..bytes.len().min(8000)].contains(&0) {
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
    fn counts_lines_of_new_text_files() {
        assert_eq!(count_text_lines(b""), Some(0));
        assert_eq!(count_text_lines(b"a\nb\n"), Some(2));
        assert_eq!(count_text_lines(b"a\nb"), Some(2));
        assert_eq!(count_text_lines(b"PNG\0data"), None);
    }
}
