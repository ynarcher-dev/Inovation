// 전체 JS 파일 문법 검사(node --check)를 한 번에 실행한다. (의존성 없음)
// 사용: npm run check
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";

const ROOTS = ["src", "scripts", "tests"];
const files = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if ([".js", ".mjs"].includes(extname(full))) files.push(full);
  }
}

for (const root of ROOTS) walk(root);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`FAIL: ${file}`);
    console.error(String(err.stderr || err.message));
  }
}

console.log(`\n${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
