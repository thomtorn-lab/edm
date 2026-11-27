// The app reuses a few dependency-free modules from the website
// (../src/lib/datetime.ts, format.ts, taxonomy.ts, appEvents.ts), so Metro
// must be allowed to read that folder. Nothing else outside mobile/ is used.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../src/lib")];

module.exports = config;
