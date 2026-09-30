// Some environments (this sandboxed dev machine included) export
// ELECTRON_RUN_AS_NODE=1 globally, which forces every Electron-based binary
// (Cypress's included) to run as plain Node instead of launching its
// Electron app/browser. Setting the variable to an empty string (e.g. via
// cross-env) is not enough, since Electron only checks whether the key is
// present, not whether it is truthy - so it has to be deleted outright
// before spawning Cypress.
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawnSync } = require("child_process");

const mode = process.argv[2] || "run";
const extraArgs = process.argv.slice(3);

const result = spawnSync("npx", ["cypress", mode, ...extraArgs], {
    stdio: "inherit",
    env: process.env,
    shell: true,
});

process.exit(result.status === null ? 1 : result.status);
