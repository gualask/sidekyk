import { Channel, invoke } from '@tauri-apps/api/core';

import type { ContentFile, SearchPort } from '@/modules/search';

/** Native search adapter: the commands in `src-tauri/src/interfaces/tauri/search.rs`. */
export const tauriSearch: SearchPort = {
    search: (request) => invoke('search', { request }),
    searchContents: (folderId, query, onFiles) => {
        // the files come as they are found, before the command ends
        const channel = new Channel<ContentFile[]>();
        channel.onmessage = onFiles;
        return invoke('search_contents', { folderId, query, onFiles: channel });
    },
    searchFiles: (folderId, query) => invoke('search_files', { folderId, query }),
    stopContentSearch: () => invoke('stop_content_search'),
    rankNames: (query, names) => invoke('rank_names', { query, names }),
};
