import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import path from "node:path";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Build the APE decoder on Windows x64.");
const url = "https://monkeysaudio.com/files/MAC_1347_SDK.zip";
const sha256 =
  "6aec852ecf38ef91c0b323b83356f16cc6d485f1cc7a338151e60995a87e8166";
const work = path.resolve(".test-data/ape-build"),
  output = path.resolve("build/ape");
await mkdir(work, { recursive: true });
await mkdir(path.join(output, "source"), { recursive: true });
const archive = path.join(work, "MAC_1347_SDK.zip");
if (!existsSync(archive)) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Monkey's Audio SDK download failed: ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
if (
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") !== sha256
)
  throw new Error("Monkey's Audio SDK checksum mismatch.");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}).`);
}
const sdk = path.join(work, "sdk");
if (!existsSync(path.join(sdk, "Shared/64/MACDll64.dll"))) {
  // Both paths are fixed build-workspace paths; the archive is hash-pinned.
  const extract = path.join(work, "extract.ps1");
  await writeFile(
    extract,
    "param([string]$Archive,[string]$Destination)\n$ErrorActionPreference='Stop'\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n",
  );
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    extract,
    "-Archive",
    archive,
    "-Destination",
    sdk,
  ]);
}
await copyFile(
  path.join(sdk, "Shared/64/MACDll64.dll"),
  path.join(output, "MACDll64.dll"),
);
await copyFile(path.join(sdk, "License.txt"), path.join(output, "LICENSE.txt"));
await copyFile(
  "electron/ape-decoder.cpp",
  path.join(output, "source/ape-decoder.cpp"),
);
await copyFile("LICENSE", path.join(output, "source/LICENSE-MIT.txt"));
await writeFile(
  path.join(output, "source/README.txt"),
  `Crate Digger APE decoder wrapper. Monkey's Audio SDK 13.47 (3-Clause BSD).\nSDK source: ${url}\nSDK SHA-256: ${sha256}\nThe unmodified MACDll64.dll is redistributed under ../LICENSE.txt.\nWrapper source: ape-decoder.cpp (Crate Digger MIT license).\n`,
);
const vswhere = path.join(
  process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
  "Microsoft Visual Studio/Installer/vswhere.exe",
);
const studio = execFileSync(
  vswhere,
  [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ],
  { encoding: "utf8", windowsHide: true },
).trim();
if (!studio) throw new Error("Install the Visual Studio C++ build tools.");
const script = path.join(work, "compile.cmd");
await writeFile(
  script,
  `@echo off\r\ncall "${path.join(studio, "Common7/Tools/VsDevCmd.bat")}" -no_logo -arch=x64 -host_arch=x64\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++17 /MT /O2 /EHsc /Fo"${path.join(work, "ape-decoder.obj")}" /Fe"${path.join(output, "CrateDiggerApe.exe")}" "${path.resolve("electron/ape-decoder.cpp")}"\r\nexit /b %errorlevel%\r\n`,
);
run("cmd.exe", ["/d", "/c", script]);
console.log(
  "Built private APE decoder with the hash-verified Monkey's Audio 13.47 SDK.",
);
