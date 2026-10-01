// Entry point so that `node --test tests/` works on Node versions that resolve a
// directory argument as a module (tests/index.js) instead of globbing it.
// Plain `node --test` (no argument) finds the *.test.mjs files directly.
import './logic.test.mjs';
import './db-demo.test.mjs';
