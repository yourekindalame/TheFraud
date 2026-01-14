const fs = require("node:fs");
const path = require("node:path");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
  return true;
}

function rmDirSafe(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

const repoRoot = path.resolve(__dirname, "..", "..");
const clientDist = path.join(repoRoot, "client", "dist");
const serverPublic = path.join(repoRoot, "server", "public");

rmDirSafe(serverPublic);
const ok = copyDir(clientDist, serverPublic);
if (!ok) {
  console.warn("[server build] client/dist not found. Run `npm --prefix client run build` first.");
  process.exit(0);
}
console.log(`[server build] Copied client build -> ${path.relative(repoRoot, serverPublic)}`);

