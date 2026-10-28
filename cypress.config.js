const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    baseUrl: "https://quickvee.com",
    viewportWidth: 1920,
    viewportHeight: 1080,
    // `cypress run` never keeps a passed test's step-by-step command log (it
    // only collects logs when interactive) - expanding passed tests step by
    // step needs `cypress open` (npm run cypress:open). Recording video means
    // passed `cypress run` tests can still be reviewed afterward by watching
    // the recording, not just by reading screenshots (only taken on failure).
    video: true,
    // A failed test is re-run up to twice (in both `cypress run` and
    // `cypress open`) before counting as failed - this machine's slow,
    // low-memory page loads regularly fail one attempt and pass the next with
    // no code change.
    retries: { runMode: 2, openMode: 2 },
    setupNodeEvents(on, config) {
      on("task", {
        log(message) {
          console.log(message);
          return null;
        },
        // Empties the local downloads folder before an export, so a check
        // reads the file just downloaded - not an older one of the same
        // name (`cypress open` keeps downloads between runs).
        clearDownloads() {
          const fs = require("fs");
          const path = require("path");
          if (fs.existsSync(config.downloadsFolder)) {
            fs.readdirSync(config.downloadsFolder).forEach((file) =>
              fs.rmSync(path.join(config.downloadsFolder, file), { recursive: true, force: true })
            );
          }
          return null;
        },
        // The newest finished file in the downloads folder whose name starts
        // with `prefix`, as { name, content } - or null while there is none
        // yet (Chrome writes a .crdownload first). For exports whose exact
        // saved name isn't known up front (react-csv's has no extension, and
        // Chrome may or may not add ".csv").
        readDownload(prefix) {
          const fs = require("fs");
          const path = require("path");
          if (!fs.existsSync(config.downloadsFolder)) return null;
          const newest = fs
            .readdirSync(config.downloadsFolder)
            .filter((file) => file.startsWith(prefix) && !file.endsWith(".crdownload"))
            .map((file) => ({ file, mtime: fs.statSync(path.join(config.downloadsFolder, file)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)[0];
          if (!newest) return null;
          return { name: newest.file, content: fs.readFileSync(path.join(config.downloadsFolder, newest.file), "utf8") };
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
