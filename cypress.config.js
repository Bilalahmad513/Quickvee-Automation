const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://quickvee.com",
    viewportWidth: 1920,
    viewportHeight: 1080,
    // `cypress run` (used instead of `cypress open` - see scripts/run-cypress.js
    // for why) doesn't keep each test's step-by-step command log in the UI
    // once it passes, to save memory. Recording video means passed tests can
    // still be reviewed afterward by watching the recording, not just by
    // reading screenshots (which only get captured on failure).
    video: true,
    // A failed test is re-run up to twice in `cypress run` before counting as
    // failed - this machine's slow, low-memory page loads regularly fail one
    // attempt and pass the next with no code change.
    retries: { runMode: 2, openMode: 0 },
    // `cypress run` normally keeps no command log for passed tests (0), so a
    // short passing test's lines vanish from the Chrome window as soon as it
    // passes. Keeping the last few lets them be reviewed in the window -
    // kept small because this machine runs low on memory.
    numTestsKeptInMemory: 5,
    setupNodeEvents(on, config) {
      on("task", {
        log(message) {
          console.log(message);
          return null;
        },
      });

      // Chrome checks for updates in the background and, once a new build
      // is ready, can force-relaunch itself - which killed the automated
      // window mid-session here (observed Chrome silently jumping from 153
      // to 154 between runs). This is Chrome's own documented QA/testing
      // flag to suppress that "restart to update" behavior for the launched
      // instance.
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.family === "chromium") {
          launchOptions.args.push("--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'");
        }
        return launchOptions;
      });

      return config;
    },
  },
  // Real credentials live in cypress.env.json (gitignored - see
  // cypress.env.json.example for the shape). Cypress loads that file
  // automatically and merges it into Cypress.env(), so nothing else here
  // needs to change.
});
