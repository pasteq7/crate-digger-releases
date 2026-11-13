import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
const python = path.resolve(".importer-venv/Scripts/python.exe");
if (!existsSync(python))
  throw new Error(
    "Create .importer-venv and install scripts/importer-requirements.txt before packaging.",
  );
mkdirSync("build/importer", { recursive: true });
const result = spawnSync(
  python,
  [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--console",
    "--name",
    "CrateDiggerImport",
    "--distpath",
    "build/importer",
    "--workpath",
    ".importer-build/work",
    "--specpath",
    ".importer-build",
    "--collect-submodules",
    "mutagen",
    "electron/import_music.py",
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) process.exit(result.status || 1);
const site = path.resolve(".importer-venv/Lib/site-packages");
mkdirSync("build/importer/licenses", { recursive: true });
mkdirSync("build/importer/source", { recursive: true });
copyFileSync(
  "electron/import_music.py",
  "build/importer/source/import_music.py",
);
copyFileSync(
  path.join(site, "mutagen-1.47.0.dist-info/COPYING"),
  "build/importer/licenses/Mutagen-COPYING",
);
copyFileSync(
  path.join(site, "pyinstaller-6.20.0.dist-info/licenses/COPYING.txt"),
  "build/importer/licenses/PyInstaller-COPYING.txt",
);
const pythonLicense = spawnSync(
  python,
  [
    "-c",
    "import pathlib, sys; print(pathlib.Path(sys.base_prefix) / 'LICENSE.txt')",
  ],
  { encoding: "utf8", windowsHide: true },
);
if (pythonLicense.status !== 0 || !existsSync(pythonLicense.stdout.trim()))
  throw new Error(
    "Unable to locate the Python license for the packaged importer.",
  );
copyFileSync(
  pythonLicense.stdout.trim(),
  "build/importer/licenses/Python-LICENSE.txt",
);
cpSync(path.join(site, "mutagen"), "build/importer/source/mutagen", {
  recursive: true,
  filter: (file) =>
    !file.includes("__pycache__") &&
    (statSync(file).isDirectory() || file.endsWith(".py")),
});
writeFileSync(
  "build/importer/source/README.txt",
  "Crate Digger ZIP import helper. Copyright 2026 Crate Digger contributors.\nThe helper and included Mutagen sources are provided under GNU GPL version 2 or later.\nSee ../licenses/Mutagen-COPYING for the license. Mutagen 1.47.0: https://github.com/quodlibet/mutagen\nBuild: python -m pip install mutagen==1.47.0 pyinstaller==6.20.0\npython -m PyInstaller --onefile --console --collect-submodules mutagen import_music.py\nThe Electron app launches this helper as a separate process with a JSON request on standard input.\n",
);
