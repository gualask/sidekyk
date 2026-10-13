import { invoke } from '@tauri-apps/api/core';

import type { SearchPort } from '@/modules/search';

/** Native search adapter: the command in `src-tauri/src/interfaces/tauri/search.rs`. */
export const tauriSearch: SearchPort = {
    search: (request) => invoke('search', { request }),
};
