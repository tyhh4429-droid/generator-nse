import vue from '@vitejs/plugin-vue'
import autoprefixer from 'autoprefixer'
import tailwind from 'tailwindcss'
import { defineConfig } from 'vite'
import { version } from './package.json'

// https://vitejs.dev/config/
export default defineConfig({
    base: process.env.VITE_BASE_PATH || '/',
    css: {
        postcss: {
            plugins: [tailwind(), autoprefixer()],
        },
    },
    plugins: [vue()],
    define: {
        __APP_VERSION__: JSON.stringify(
            (process.env.CF_PAGES_BRANCH !== 'prod' &&
                process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8)) ||
                version,
        ),
    },
})
