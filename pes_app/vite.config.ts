import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // transformers.js (local in-browser embeddings for chatbot RAG) ships its
  // own WASM/worker loading that Vite's dependency pre-bundler mishandles —
  // exclude it so it's loaded as-is at runtime instead.
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv', '**/*.jpg', '**/*.jpeg', '**/*.png', '**/*.gif', '**/*.webp'],
})
