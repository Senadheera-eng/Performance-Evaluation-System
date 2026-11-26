import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Unit tests for the app's pure logic (GPA, attendance, grade boundaries,
 * minors, the ML checks). Kept apart from vite.config.ts so a test run does
 * not load the React and Tailwind plugins it does not need.
 *
 * The tests never reach Supabase. Some modules import the Supabase client,
 * which is created at import time from these two variables, so they are given
 * harmless placeholders here; no request is ever made with them.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      TZ: 'UTC',
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
})
