import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient() {
    // Every query and mutation reaches the backend through IPC, so none waits for the network:
    // under the default `online` mode a browser `offline` event would pause them all, a branch
    // switch included. A query that goes online says so itself.
    return new QueryClient({
        defaultOptions: {
            queries: {
                networkMode: 'always',
                retry: false,
                refetchOnReconnect: false,
                refetchOnWindowFocus: false,
            },
            mutations: { networkMode: 'always' },
        },
    });
}
