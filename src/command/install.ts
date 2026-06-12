import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";

import { APP_NAME, INSTALL_DIR, INSTALL_EXE, samePath } from "@/command/update";

export async function addInstallDirToPath() {
    const safeInstallDir = escapePowerShellString(INSTALL_DIR);

    const script = `
$InstallDir = '${safeInstallDir}'
$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')

if ([string]::IsNullOrWhiteSpace($UserPath)) {
    [Environment]::SetEnvironmentVariable('Path', $InstallDir, 'User')
    exit 0
}

$Parts = $UserPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ }

if ($Parts -notcontains $InstallDir) {
    $NewPath = ($Parts + $InstallDir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $NewPath, 'User')
}
`;

    new Promise<void>((resolve, reject) => {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            { windowsHide: true },
        );

        let stderr = "";

        child.stderr.on("data", data => {
            stderr += String(data);
        });

        child.on("close", code => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr || `PowerShell exited with code ${code}`));
        });
    });
}

export function escapePowerShellString(value: string) {
    return value.replace(/'/g, "''");
}

export async function install(): Promise<void> {
    if (process.platform !== "win32") return;

    await mkdir(INSTALL_DIR, { recursive: true });

    const currentExe = process.execPath;

    if (!samePath(currentExe, INSTALL_EXE)) {
        await copyFile(currentExe, INSTALL_EXE);

        console.log(`Installed at: ${INSTALL_EXE}`);
        console.log(`Open a new terminal and run: ${APP_NAME} --help`);
    }

    await addInstallDirToPath();
}