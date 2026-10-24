import { defineConfig } from "@playwright/test";

// Automatic page tests: the app runs in Microsoft Edge against a stand-in backend
// (src/smoke/mock.ts) and every page is opened. `npm run test:smoke`.
export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    baseURL: "http://localhost:5199",
    viewport: { width: 1440, height: 900 },
  },
  // A real build of the app (with the stand-in backend), not the development server: the dev
  // server reloads the page when it first meets a library, which breaks a test mid-run.
  webServer: {
    command: "node scripts/gen-thesaurus.mjs --if-missing && npx vite build --mode smoke --outDir dist-smoke && npx vite preview --mode smoke --outDir dist-smoke --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
