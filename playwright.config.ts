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
  webServer: {
    command: "npm run dev -- --mode smoke --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
