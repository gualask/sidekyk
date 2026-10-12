import transformImports from '@rolldown/plugin-transform-imports';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

/**
 * Vendor chunks. A group also takes the dependencies of what it captures, so the groups whose
 * modules others depend on come first: React before the libraries built on it.
 */
const VENDOR_CHUNKS = [
    {
        name: 'react-vendor',
        test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
        priority: 4,
    },
    { name: 'icons-vendor', test: /[\\/]node_modules[\\/]@tabler[\\/]/, priority: 3 },
    // Base UI and what only it uses, fetched with the first code that needs an overlay: in
    // `vendor` they would be preloaded with the first paint
    {
        name: 'base-ui-vendor',
        test: /[\\/]node_modules[\\/](@base-ui|@floating-ui|@babel[\\/]runtime|reselect|use-sync-external-store)[\\/]/,
        priority: 2,
    },
    { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 1 },
];

// https://vite.dev/config/
export default defineConfig(async () => ({
    plugins: [
        transformImports({
            '@tabler/icons-react': {
                transform: '@tabler/icons-react/dist/esm/icons/{{member}}.mjs',
                preventFullImport: true,
            },
        }),
        tailwindcss(),
        react(),
    ],
    resolve: {
        tsconfigPaths: true,
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: VENDOR_CHUNKS,
                },
            },
        },
    },
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                  protocol: 'ws',
                  host,
                  port: 1421,
              }
            : undefined,
        watch: {
            // 3. tell Vite to ignore watching `src-tauri`, and `.local` (reference clones)
            ignored: ['**/src-tauri/**', '**/.local/**'],
        },
    },
}));
