//! How many threads a parallel read takes.

/// Threads a search or a walk runs on at most, so a key typed or a folder opened never takes the
/// whole machine.
const MAX_THREADS: usize = 8;

pub fn threads() -> usize {
    std::thread::available_parallelism()
        .map_or(1, std::num::NonZero::get)
        .min(MAX_THREADS)
}
