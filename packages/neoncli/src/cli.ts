#!/usr/bin/env node

const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

console.log("");
console.log(yellow("`neoncli` is not the official Neon CLI."));
console.log(`The official Neon command-line tool is ${bold("neonctl")}.`);
console.log("");
console.log("Install it with one of:");
console.log("  npm install -g neonctl");
console.log("  brew install neonctl");
console.log("");
console.log("Then run it as `neonctl` (or `neon`).");
console.log("Docs: https://neon.com/docs/reference/neon-cli");
console.log("");

process.exit(0);
