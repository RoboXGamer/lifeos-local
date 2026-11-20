import { copyFile, mkdir } from "node:fs/promises";

if (process.platform === "win32") {
  const buildDir = new URL(`../build/stable-win-${process.arch}/`, import.meta.url);
  const installerDir = new URL(".installer/", buildDir);

  // Electrobun adds this directory to the Setup ZIP, but its build-folder EXE
  // also looks for the payload and metadata beside itself in .installer.
  await mkdir(installerDir, { recursive: true });

  for (const file of ["LifeOS-Setup.tar.zst", "LifeOS-Setup.metadata.json"]) {
    await copyFile(new URL(file, buildDir), new URL(file, installerDir));
  }
}
