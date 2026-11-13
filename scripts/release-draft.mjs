import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const target = pkg.build.publish[0];
const repo = `${target.owner}/${target.repo}`;
const tag = `v${pkg.version}`;
function git(...args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr?.trim() || `Git failed: ${args.join(" ")}`);
  return result.stdout.trim();
}
if (git("status", "--porcelain"))
  throw new Error(
    "Commit the source, version, and release notes before uploading a release.",
  );
const remote = git("remote", "get-url", "origin");
if (
  ![
    `https://github.com/${repo}`,
    `https://github.com/${repo}.git`,
    `git@github.com:${repo}.git`,
  ].includes(remote)
)
  throw new Error(`The origin remote must point to ${repo}.`);
const commit = git("rev-parse", "HEAD");
if (git("rev-parse", `${tag}^{commit}`) !== commit)
  throw new Error("The local version tag must point to HEAD.");
const remoteTags = Object.fromEntries(
  git("ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.trim().split(/\s+/);
      return [ref, sha];
    }),
);
if (
  (remoteTags[`refs/tags/${tag}^{}`] || remoteTags[`refs/tags/${tag}`]) !==
  commit
)
  throw new Error(
    "Push the matching source tag to GitHub before uploading a release.",
  );
const notes = path.resolve("docs", "releases", `${tag}.md`);
if (!existsSync(notes) || !readFileSync(notes, "utf8").trim())
  throw new Error(`Missing release notes: ${notes}`);
const files = [
  `Crate-Digger-Setup-${pkg.version}.exe`,
  `Crate-Digger-Setup-${pkg.version}.exe.blockmap`,
  "latest.yml",
].map((name) => path.resolve("release", name));
for (const file of files)
  if (!existsSync(file))
    throw new Error(
      `Missing release artifact: ${file}. Run npm run dist first.`,
    );
const metadata = Object.fromEntries(
  [
    ...readFileSync(files[2], "utf8").matchAll(
      /^(version|path|sha512):\s*(.+)$/gm,
    ),
  ].map((match) => [match[1], match[2].trim()]),
);
if (
  metadata.version !== pkg.version ||
  metadata.path !== path.basename(files[0]) ||
  metadata.sha512 !==
    createHash("sha512").update(readFileSync(files[0])).digest("base64")
)
  throw new Error(
    "Release metadata does not match this installer/version. Run npm run dist again.",
  );
if (process.argv.includes("--validate-only")) {
  console.log(
    `PASS ${tag}: clean source, matching remote tag, release notes, and installer metadata.`,
  );
  process.exit(0);
}
const result = spawnSync(
  "gh",
  [
    "release",
    "create",
    tag,
    ...files,
    "--repo",
    repo,
    "--draft",
    "--verify-tag",
    "--title",
    `Crate Digger ${pkg.version}`,
    "--notes-file",
    notes,
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status || 0;
