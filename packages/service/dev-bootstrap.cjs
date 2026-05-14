const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const serviceRoot = __dirname;
const pnpmRoot = path.join(serviceRoot, "node_modules", ".pnpm");

function findPackageNodeModules(packageName) {
  const matches = [];
  for (const entry of fs.readdirSync(pnpmRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(pnpmRoot, entry.name, "node_modules");
    const packagePath = path.join(candidate, packageName);
    if (fs.existsSync(packagePath)) {
      matches.push(candidate);
    }
  }
  return matches;
}

const searchPaths = new Set([
  path.join(serviceRoot, "node_modules"),
  path.join(serviceRoot, "node_modules", ".pnpm", "node_modules"),
]);

for (const pkg of [
  "@nestjs/core",
  "@nestjs/common",
  "@nestjs/platform-express",
  "@prisma/client",
  "dotenv",
  "reflect-metadata",
  "rxjs",
  "ts-node",
  "tsconfig-paths"
]) {
  for (const candidate of findPackageNodeModules(pkg)) {
    searchPaths.add(candidate);
  }
}

process.env.NODE_PATH = Array.from(searchPaths).join(path.delimiter);
Module._initPaths();

require("ts-node/register/transpile-only");
require("tsconfig-paths/register");
require(path.join(serviceRoot, "src", "main.ts"));
