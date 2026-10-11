//! Parser for `git diff --numstat -z`, plus line counting for untracked files.

#[derive(Debug, PartialEq, Eq)]
pub(super) struct LineCounts {
    pub(super) path: String,
    /// `None` for binary files.
    pub(super) additions: Option<u32>,
    pub(super) deletions: Option<u32>,
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
            additions: added.parse().ok(),
            deletions: deleted.parse().ok(),
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
                    additions: Some(3),
                    deletions: Some(1),
                },
                LineCounts {
                    path: "logo.png".into(),
                    additions: None,
                    deletions: None,
                },
                LineCounts {
                    path: "new.ts".into(),
                    additions: Some(2),
                    deletions: Some(0),
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
