import transformImports from '@rolldown/plugin-transform-imports';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

function vendorChunkName(moduleId: string): string | null {
    const id = moduleId.replaceAll('\\', '/');
    if (!id.includes('/node_modules/')) return null;
    if (id.includes('/node_modules/@tabler/')) return 'icons-vendor';
    if (
        id.includes('/node_modules/react/') ||
        id.includes('/node_modules/react-dom/') ||
        id.includes('/node_modules/scheduler/')
    ) {
        return 'react-vendor';
    }
    return 'vendor';
}

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
                    groups: [
                        {
                            name: vendorChunkName,
                            test: 'node_modules',
                        },
                    ],
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
