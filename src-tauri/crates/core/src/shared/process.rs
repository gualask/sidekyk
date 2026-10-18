/// What a child process wrote, read within a size, and how it ended (`infrastructure/process.rs`).
pub struct ProcessOutput {
    /// -1 when it was killed: it wrote more than the call reads.
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
    /// It wrote more than `max_stdout` bytes: `stdout` is its first `max_stdout`, cut anywhere,
    /// and it was killed instead of read to the end.
    pub truncated: bool,
}
