//! One computation per repository at a time, its result shared by the callers that waited.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::shared::coalesce::Coalesced;
use crate::shared::error::unshare;
use crate::shared::sync::lock;

/// A result shared by every caller that waited for it.
type Shared<T> = Result<T, Arc<anyhow::Error>>;

/// One computation per repository at a time; requests that arrive during it share the next one.
pub(super) struct PerRepository<T> {
    runs: Mutex<HashMap<String, Arc<Coalesced<Shared<T>>>>>,
}

impl<T> Default for PerRepository<T> {
    fn default() -> Self {
        Self {
            runs: Mutex::default(),
        }
    }
}

impl<T: Clone> PerRepository<T> {
    pub(super) fn run(
        &self,
        root: &str,
        work: impl FnOnce() -> anyhow::Result<T>,
    ) -> anyhow::Result<T> {
        let coalesced = lock(&self.runs)
            .entry(root.to_string())
            .or_default()
            .clone();
        coalesced.run(|| work().map_err(Arc::new)).map_err(unshare)
    }

    pub(super) fn retain(&self, keep: &impl Fn(&str) -> bool) {
        lock(&self.runs).retain(|root, _| keep(root));
    }
}
