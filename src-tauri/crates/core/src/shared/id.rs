//! Ids the app makes: for notes, their lists and projects. Opaque, compared and never read.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// A new id: 16 hex digits of a hash keyed by the system's randomness, the time and a counter.
pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    format!("{:016x}", hasher.finish())
}

/// Whether `id` is one `new_id` makes: the only names let through to files.
pub fn is_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn ids_are_new_each_time() {
        let ids: HashSet<String> = (0..1000).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 1000);
        assert!(ids.iter().all(|id| is_id(id)));
    }

    #[test]
    fn ids_are_sixteen_lowercase_hex_digits() {
        assert!(is_id("0123456789abcdef"));
        assert!(!is_id("0123456789ABCDEF"));
        assert!(!is_id("0123456789abcde"));
        assert!(!is_id("../0123456789abc"));
    }
}
