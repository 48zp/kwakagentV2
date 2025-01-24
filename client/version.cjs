const fs = require("fs");

const version = require("../package.json").version;
fs.writeFileSync("version.txt", `Version: ${version}\n`);
console.log(`Version extracted: ${version}`);
