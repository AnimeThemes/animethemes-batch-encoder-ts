import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, normalize } from "node:path";

import packageJson from "../../package.json";
import { escapePowerShellString } from "./install";

function getPackageString(value: unknown, fallback: string) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export const VERSION = getPackageString(packageJson.version, "0.0.0");

export const APP_NAME = getPackageString(packageJson.name, "batch-encoder");
const OWNER = getPackageString(packageJson.author, "");
const REPO = getPackageString((packageJson as { repo?: unknown }).repo, "");

const IS_WINDOWS = process.platform === "win32";

export const INSTALL_DIR = join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    "Programs",
    APP_NAME,
);

export const INSTALL_EXE = join(INSTALL_DIR, `${APP_NAME}.exe`);

type GitHubRelease = {
    tag_name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
};

export function samePath(a: string, b: string) {
    return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

function cleanVersion(version: string) {
    return version.replace(/^v/i, "").trim();
}

function sameVersion(a: string, b: string) {
    return cleanVersion(a) === cleanVersion(b);
}

async function getLatestRelease(): Promise<GitHubRelease | null> {
    if (!OWNER || !REPO) {
        console.log("GitHub owner or repository is missing in package.json.");
        return null;
    }

    const response = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
        {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": APP_NAME,
            },
        },
    );

    if (!response.ok) {
        console.log(`Update check failed: ${response.status} ${response.statusText}`);
        return null;
    }

    return response.json() as Promise<GitHubRelease>;
}

async function downloadFile(url: string, destination: string) {
    const response = await fetch(url, {
        headers: {
            "User-Agent": APP_NAME,
        },
    });

    if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    await Bun.write(destination, await response.arrayBuffer());
}

async function replaceInstalledExe(sourceExe: string) {
    const ps1Path = join(tmpdir(), `${APP_NAME}-update-${Date.now()}.ps1`);
    const logPath = join(tmpdir(), `${APP_NAME}-update.log`);

    const safeSource = escapePowerShellString(sourceExe);
    const safeDestination = escapePowerShellString(INSTALL_EXE);
    const safeLog = escapePowerShellString(logPath);

    const script = `
$ErrorActionPreference = 'Continue'

$Source = '${safeSource}'
$Destination = '${safeDestination}'
$Log = '${safeLog}'
$ProcessIdToWait = ${process.pid}

"Starting update..." | Out-File -FilePath $Log -Encoding UTF8
"Source: $Source" | Out-File -FilePath $Log -Append -Encoding UTF8
"Destination: $Destination" | Out-File -FilePath $Log -Append -Encoding UTF8
"Waiting for process: $ProcessIdToWait" | Out-File -FilePath $Log -Append -Encoding UTF8

try {
    Wait-Process -Id $ProcessIdToWait -ErrorAction SilentlyContinue
} catch {
    "Wait-Process failed: $($_.Exception.Message)" | Out-File -FilePath $Log -Append -Encoding UTF8
}

Start-Sleep -Seconds 2

for ($i = 1; $i -le 30; $i++) {
    "Copy attempt $i..." | Out-File -FilePath $Log -Append -Encoding UTF8

    try {
        if (!(Test-Path -LiteralPath $Source)) {
            "Source file does not exist." | Out-File -FilePath $Log -Append -Encoding UTF8
            exit 1
        }

        Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop

        "Copy succeeded." | Out-File -FilePath $Log -Append -Encoding UTF8

        Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue

        exit 0
    } catch {
        "Copy failed: $($_.Exception.Message)" | Out-File -FilePath $Log -Append -Encoding UTF8
        Start-Sleep -Seconds 1
    }
}

"Update failed after all attempts." | Out-File -FilePath $Log -Append -Encoding UTF8
exit 1
`;

    await Bun.write(ps1Path, script);

    await new Promise<void>((resolve, reject) => {
        const launcher = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapePowerShellString(ps1Path)}'`,
            ],
            {
                windowsHide: true,
                stdio: "ignore",
            },
        );

        launcher.on("error", reject);

        launcher.on("close", code => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`Updater launcher exited with code ${code}`));
        });
    });

    console.log("Update downloaded. Please run the command again.");
    console.log(`Update log: ${logPath}`);

    process.exit(0);
}

export async function update() {
    if (!IS_WINDOWS) {
        console.log("Update is only available on Windows.");
        return;
    }

    const release = await getLatestRelease();

    if (!release) {
        console.log("Could not check for updates.");
        return;
    }

    if (sameVersion(release.tag_name, VERSION)) {
        console.log("No update available.");
        return;
    }

    const asset = release.assets.find(asset => asset.name === `${APP_NAME}.exe`);

    if (!asset) {
        console.log("No Windows executable found in the latest release.");
        return;
    }

    console.log(`Updating from ${VERSION} to ${release.tag_name}...`);

    const tempExe = join(
        tmpdir(),
        `${APP_NAME}-${cleanVersion(release.tag_name)}.exe`,
    );

    await downloadFile(asset.browser_download_url, tempExe);
    await replaceInstalledExe(tempExe);
}