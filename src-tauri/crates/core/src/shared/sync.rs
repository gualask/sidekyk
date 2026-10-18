use std::sync::{Mutex, MutexGuard};

/// Locks `mutex`, going on with its data if a thread panicked while holding it: the data guarded
/// here (lists, caches, flags) stays valid between statements.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
