//! Frames between the app and the helper: a u32 little-endian length, then a JSON message.
//! Requests go down the helper's stdin, each with an id; replies, the files a search in contents
//! finds and the changes the watcher sees come up its stdout (`docs/plans/remote-projects.md`).

use std::io::{self, Read, Write};
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::modules::repository::{
    CommitFileDiffRequest, CommitRequest, FileDiffRequest, RepositoryChange, RepositoryInfo,
};
use crate::modules::search::ContentFile;
use crate::modules::syntax::SyntaxRequest;
use crate::shared::error::{rebuilt, wire_code, UserFacingErrorCode};

/// Past the largest message the app reads (a snapshot of 8 MiB of status, a diff of 2 MiB): a
/// frame longer than this is a broken stream, not a message.
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// One request, numbered by the app; its reply carries the same id.
#[derive(Debug, Serialize, Deserialize)]
pub struct RequestFrame {
    pub id: u64,
    pub request: Request,
}

/// One per method of `Repositories`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Request {
    Resolve {
        candidate: PathBuf,
    },
    Snapshot {
        repository: RepositoryInfo,
    },
    Summary {
        repository: RepositoryInfo,
    },
    FileDiff {
        repository: RepositoryInfo,
        request: FileDiffRequest,
    },
    RecentCommits {
        repository: RepositoryInfo,
    },
    CommitActivity {
        repository: RepositoryInfo,
        since: i64,
    },
    CommitFiles {
        repository: RepositoryInfo,
        commit: CommitRequest,
    },
    CommitFileDiff {
        repository: RepositoryInfo,
        request: CommitFileDiffRequest,
    },
    Directory {
        repository: RepositoryInfo,
        path: String,
    },
    FileContent {
        repository: RepositoryInfo,
        path: String,
    },
    SyntaxColors {
        repository: RepositoryInfo,
        request: SyntaxRequest,
    },
    SearchFiles {
        repository: RepositoryInfo,
        query: String,
    },
    SearchContents {
        repository: RepositoryInfo,
        query: String,
    },
    StopContentSearch,
    Retain {
        roots: Vec<String>,
    },
    Watch {
        repository: Option<RepositoryInfo>,
    },
    SetVisible {
        visible: bool,
    },
}

/// What the helper sends up.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Message {
    /// The answer to request `id`: its value as JSON, read by the caller as the type it expects.
    Reply {
        id: u64,
        result: Result<Box<RawValue>, WireError>,
    },
    /// Files a search in contents (request `id`) found, before its reply.
    Contents { id: u64, files: Vec<ContentFile> },
    /// A change of the repository watched that shows.
    Changed(RepositoryChange),
}

/// A failure as the frontend gets it (`AppError`): its user-facing code, or `unknown`.
#[derive(Debug, Serialize, Deserialize)]
pub struct WireError {
    pub code: String,
    pub message: String,
}

impl From<&anyhow::Error> for WireError {
    fn from(error: &anyhow::Error) -> Self {
        Self {
            code: wire_code(error).to_string(),
            message: format!("{error:#}"),
        }
    }
}

impl From<WireError> for anyhow::Error {
    /// A user-facing failure keeps its code, so the app tells it as if it were its own, and its
    /// cause, for the app's log.
    fn from(error: WireError) -> Self {
        rebuilt(UserFacingErrorCode::parse(&error.code), &error.message)
    }
}

pub fn write_frame(out: &mut impl Write, message: &impl Serialize) -> io::Result<()> {
    let body = serde_json::to_vec(message)?;
    let length = u32::try_from(body.len())
        .ok()
        .filter(|&length| length as usize <= MAX_FRAME_BYTES)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "frame too long"))?;
    out.write_all(&length.to_le_bytes())?;
    out.write_all(&body)?;
    out.flush()
}

/// The next frame, or `None` when the stream ended between two frames.
pub fn read_frame<T: DeserializeOwned>(input: &mut impl Read) -> io::Result<Option<T>> {
    let mut length = [0u8; 4];
    let first = loop {
        match input.read(&mut length[..1]) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            read => break read?,
        }
    };
    if first == 0 {
        return Ok(None);
    }
    // a stream that ends inside a frame, its length included, is cut
    input.read_exact(&mut length[1..])?;
    let length = u32::from_le_bytes(length) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too long"));
    }
    let mut body = vec![0u8; length];
    input.read_exact(&mut body)?;
    Ok(Some(serde_json::from_slice(&body)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_a_stream_ends_between_them() {
        let mut stream = Vec::new();
        let request = RequestFrame {
            id: 7,
            request: Request::Directory {
                repository: RepositoryInfo {
                    root: "/r".into(),
                    name: "r".into(),
                },
                path: "src".into(),
            },
        };
        write_frame(&mut stream, &request).unwrap();
        write_frame(
            &mut stream,
            &Message::Changed(RepositoryChange {
                root: "/r".into(),
                git_dir: false,
                paths: Some(vec!["src/a.ts".into()]),
            }),
        )
        .unwrap();

        let mut input = stream.as_slice();
        let read: RequestFrame = read_frame(&mut input).unwrap().unwrap();
        assert_eq!(read.id, 7);
        assert!(matches!(read.request, Request::Directory { path, .. } if path == "src"));
        let changed: Message = read_frame(&mut input).unwrap().unwrap();
        assert!(matches!(
            changed,
            Message::Changed(event)
                if event.root == "/r" && !event.git_dir && event.paths == Some(vec!["src/a.ts".into()])
        ));
        assert!(read_frame::<Message>(&mut input).unwrap().is_none());
    }

    #[test]
    fn a_reply_keeps_its_value_as_it_was_written() {
        let value = serde_json::value::to_raw_value(&["a", "b"]).unwrap();
        let mut stream = Vec::new();
        write_frame(
            &mut stream,
            &Message::Reply {
                id: 1,
                result: Ok(value),
            },
        )
        .unwrap();
        let Some(Message::Reply { id, result }) = read_frame(&mut stream.as_slice()).unwrap()
        else {
            panic!("not a reply");
        };
        assert_eq!(id, 1);
        let value: Vec<String> = serde_json::from_str(result.unwrap().get()).unwrap();
        assert_eq!(value, ["a", "b"]);
    }

    #[test]
    fn a_frame_too_long_or_cut_short_is_an_error() {
        let mut stream = (MAX_FRAME_BYTES as u32 + 1).to_le_bytes().to_vec();
        assert!(read_frame::<Message>(&mut stream.as_slice()).is_err());
        assert!(read_frame::<Message>(&mut [7u8, 0].as_slice()).is_err());
        stream = 10u32.to_le_bytes().to_vec();
        stream.extend_from_slice(b"{}");
        assert!(read_frame::<Message>(&mut stream.as_slice()).is_err());
    }
}
