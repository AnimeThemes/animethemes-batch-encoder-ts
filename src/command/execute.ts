import { checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import * as readline from "node:readline";

type ProgressStatus = 
    | "available"
    | "queued"
    | "running"
    | "done"
    | "failed"
    | "stopped";

type ProgressRow = {
    id: string;
    output: string;
    time: string;
    fps: string;
    bitrate: string;
    size: string;
    speed: string;
    status: ProgressStatus;
};

type EncodeJob = {
    id: string;
    sourceFile: string;
    output: string;
    outputPath?: string;
    commands: string[];
    status: ProgressStatus;
    controller?: AbortController;
    error?: string;
};

const progressRows = new Map<string, ProgressRow>();
const runningJobs = new Map<string, EncodeJob>();
const availableJobs: EncodeJob[] = [];
const queuedJobs: EncodeJob[] = [];
const selectedAddJobIds = new Set<string>();

let maxParallelEncodes = 1;
let queueSessionResolve: (() => void) | null = null;
let userRequestedExit = false;
let addMenuOpen = false;
let selectedAddIndex = 0;
let lastRenderLines = 0;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let killMenuOpen = false;
let selectedKillIndex = 0;
let inputHandler: ((chunk: Buffer) => void) | null = null;
let shutdownRequested = false;

function parseCommand(command: string): string[] {
    return command.match(/"[^"]*"|\S+/g)!.map(arg => arg.replace(/^"|"$/g, ""));
}

function getOutputPath(command: string): string|undefined {
    const args = parseCommand(command);
    const finalArg = args.at(-1)!;

    if (finalArg.toUpperCase() === "NUL" || finalArg.toUpperCase() === "/dev/null") {
        return undefined;
    }

    return finalArg;
}

function getOutputName(command: string): string {
    const args = parseCommand(command);
    const finalArg = args.at(-1);

    if (!finalArg) {
        return "unknown";
    }

    if (finalArg.toUpperCase() === "NUL") {
        return "NUL";
    }

    return basename(finalArg);
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "-";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    if (unitIndex === 0) {
        return `${Math.round(value)} ${units[unitIndex]}`;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function parseFFmpegSizeToBytes(value: string, unit: string | undefined): number|undefined {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return undefined;
    }

    const normalizedUnit = unit?.toLowerCase() ?? "b";

    if (normalizedUnit === "b") {
        return number;
    }

    if (normalizedUnit === "kb" || normalizedUnit === "kib") {
        return number * 1024;
    }

    if (normalizedUnit === "mb" || normalizedUnit === "mib") {
        return number * 1024 * 1024;
    }

    return number;
}

function scheduleRender(): void {
    if (renderTimer) return;

    renderTimer = setTimeout(() => {
        renderTimer = null;

        if (addMenuOpen) {
            renderAddMenu();
            return;
        }

        if (killMenuOpen) {
            renderKillMenu();
            return;
        }

        renderTable();
    }, 120);
}

function clearRenderedTable(): void {
    if (lastRenderLines > 0) {
        readline.moveCursor(process.stdout, 0, -lastRenderLines);
        readline.clearScreenDown(process.stdout);
        lastRenderLines = 0;
    }
}

function renderTable(): void {
    const rows = [...progressRows.values()];

    if (rows.length === 0) return;

    const outputWidth =
        Math.max("Output".length, ...rows.map(row => row.output.length)) + 4;

    const timeWidth = 13;
    const fpsWidth = 8;
    const bitrateWidth = 16;
    const sizeWidth = 12;
    const speedWidth = 10;

    const header =
        "Output".padEnd(outputWidth, " ") +
        "Time".padEnd(timeWidth, " ") +
        "FPS".padEnd(fpsWidth, " ") +
        "Bitrate".padEnd(bitrateWidth, " ") +
        "Size".padEnd(sizeWidth, " ") +
        "Speed".padEnd(sizeWidth, " ");

    const separator = "-".repeat(header.length);

    const lines = [
        header,
        separator,
        ...rows.map(row => {
            return (
                row.output.padEnd(outputWidth, " ") +
                row.time.padEnd(timeWidth, " ") +
                row.fps.padEnd(fpsWidth, " ") +
                row.bitrate.padEnd(bitrateWidth, " ") +
                row.size.padEnd(sizeWidth, " ") +
                row.speed.padEnd(speedWidth, " ")
            );
        }),
    ];

    clearRenderedTable();

    process.stdout.write(lines.join("\n") + "\n");
    lastRenderLines = lines.length;
}

function getRunningJobsList(): EncodeJob[] {
    return [...runningJobs.values()].filter(job => job.status === "running");
}

function renderKillMenu(): void {
    const jobs = getRunningJobsList();

    clearRenderedTable();

    if (jobs.length === 0) {
        const lines = [
            chalk.yellow("No running encodes to kill."),
            "",
            chalk.gray("Press Esc to return."),
        ];

        process.stdout.write(lines.join("\n") + "\n");
        lastRenderLines = lines.length;
        return;
    }

    if (selectedKillIndex >= jobs.length) {
        selectedKillIndex = jobs.length - 1;
    }

    if (selectedKillIndex < 0) {
        selectedKillIndex = 0;
    }

    const lines = [
        chalk.white("Choose an encode to kill"),
        chalk.gray("↑/↓ or W/S to move · Enter to kill · Esc to cancel"),
        "",
        ...jobs.map((job, index) => {
            const prefix = index === selectedKillIndex ? chalk.cyan(">") : " ";

            const row = progressRows.get(job.id);

            const details = row
                ? `${row.time} · ${row.fps} fps · ${row.bitrate} · ${row.size} · ${row.speed}`
                : "";

            const label = `${prefix} ${job.output} — ${details}`;

            return index === selectedKillIndex ? chalk.cyan(label) : label;
        }),
    ];

    process.stdout.write(lines.join("\n") + "\n");
    lastRenderLines = lines.length;
}

function openKillMenu(): void {
    const jobs = getRunningJobsList();

    if (jobs.length === 0) {
        clearRenderedTable();

        const lines = [
            chalk.yellow("No running encodes to kill."),
            "",
            chalk.gray("Press any key to return."),
        ];

        process.stdout.write(lines.join("\n") + "\n");
        lastRenderLines = lines.length;

        killMenuOpen = true;
        selectedKillIndex = 0;

        return;
    }

    killMenuOpen = true;
    selectedKillIndex = 0;
    renderKillMenu();
}

function closeKillMenu(): void {
    killMenuOpen = false;
    selectedKillIndex = 0;
    renderTable();
}

function killSelectedJob(): void {
    const jobs = getRunningJobsList();

    if (jobs.length === 0) {
        closeKillMenu();
        return;
    }

    const job = jobs[selectedKillIndex];

    if (!job) {
        closeKillMenu();
        return;
    }

    stopJob(job.id);
    closeKillMenu();
}

function handleKillMenuInput(input: string): void {
    const jobs = getRunningJobsList();

    if (input === "\u001b" || jobs.length === 0) {
        closeKillMenu();
        return;
    }

    if (input === "\r" || input === "\n") {
        killSelectedJob();
        return;
    }

    const isArrowUp = input === "\u001b[A";
    const isArrowDown = input === "\u001b[B";

    if (isArrowUp || input.toLowerCase() === "w") {
        selectedKillIndex =
            selectedKillIndex <= 0 ? jobs.length - 1 : selectedKillIndex - 1;

        renderKillMenu();
        return;
    }

    if (isArrowDown || input.toLowerCase() === "s") {
        selectedKillIndex =
            selectedKillIndex >= jobs.length - 1 ? 0 : selectedKillIndex + 1;

        renderKillMenu();
        return;
    }

    renderKillMenu();
}

function getAvailableJobsList(): EncodeJob[] {
    return availableJobs.filter(job => job.status === "available");
}

function renderAddMenu(): void {
    const jobs = getAvailableJobsList();

    clearRenderedTable();

    if (jobs.length === 0) {
        const lines = [
            chalk.yellow("No available encodes to add."),
            "",
            chalk.gray("Press Esc to return."),
        ];

        process.stdout.write(lines.join("\n") + "\n");
        lastRenderLines = lines.length;
        return;
    }

    if (selectedAddIndex >= jobs.length) {
        selectedAddIndex = jobs.length - 1;
    }

    if (selectedAddIndex < 0) {
        selectedAddIndex = 0;
    }

    const lines = [
        chalk.white("Add encodes to queue"),
        chalk.gray("↑/↓ or W/S to move · Space to select · Enter to add · Esc to cancel"),
        "",
        ...jobs.map((job, index) => {
            const pointer = index === selectedAddIndex ? chalk.cyan(">") : " ";
            const checked = selectedAddJobIds.has(job.id) ? "[x]" : "[ ]";

            const label = `${pointer} ${checked} ${job.output} — ${job.sourceFile}`;

            return index === selectedAddIndex ? chalk.cyan(label) : label;
        }),
    ];

    process.stdout.write(lines.join("\n") + "\n");
    lastRenderLines = lines.length;
}

function closeAddMenu(): void {
    addMenuOpen = false;
    selectedAddIndex = 0;
    selectedAddJobIds.clear();
    renderTable();
}

function toggleSelectedAddJob(): void {
    const jobs = getAvailableJobsList();
    const job = jobs[selectedAddIndex];

    if (!job) return;

    if (selectedAddJobIds.has(job.id)) {
        selectedAddJobIds.delete(job.id);
    } else {
        selectedAddJobIds.add(job.id);
    }

    renderAddMenu();
}

function addSelectedJobsToQueue(): void {
    const jobs = getAvailableJobsList().filter(job => selectedAddJobIds.has(job.id));

    for (const job of jobs) {
        queueJob(job);
    }

    closeAddMenu();
}

function handleAddMenuInput(input: string): void {
    const jobs = getAvailableJobsList();

    if (input === "\u001b") {
        closeAddMenu();
        return;
    }

    if (input === "\r" || input === "\n") {
        addSelectedJobsToQueue();
        return;
    }

    if (input === " ") {
        toggleSelectedAddJob();
        return;
    }

    if (jobs.length === 0) {
        closeAddMenu();
        return;
    }

    const isArrowUp = input === "\u001b[A";
    const isArrowDown = input === "\u001b[B";

    if (isArrowUp || input.toLowerCase() === "w") {
        selectedAddIndex = selectedAddIndex <= 0 ? jobs.length - 1 : selectedAddIndex - 1;

        renderAddMenu();
        return;
    }

    if (isArrowDown || input.toLowerCase() === "s") {
        selectedAddIndex = selectedAddIndex >= jobs.length - 1 ? 0 : selectedAddIndex + 1;

        renderAddMenu();
        return;
    }

    renderAddMenu();
}

function handleNormalInput(input: string): void {
    if (input === "\u0003") {
        clearRenderedTable();
        console.log(chalk.yellow("Stopping all running encodes..."));

        shutdownRequested = true;

        for (const job of runningJobs.values()) {
            stopJob(job.id);
        }

        return;
    }

    if (input.toLowerCase() === "k") {
        openKillMenu();
        return;
    }

    if (input.toLowerCase() === "a") {
        addMenuOpen = true;
        selectedAddIndex = 0;
        selectedAddJobIds.clear();
        renderAddMenu();
        return;
    }

    if (input.toLowerCase() === "q") {
        if (runningJobs.size > 0) {
            clearRenderedTable();
            console.log(
                chalk.yellow("There are still running encodes. Use Ctrl+C to stop them.")
            );
            renderTable();
            return;
        }

        userRequestedExit = true;
        checkQueueSessionEnd();
        return;
    }
}

function isTerminalStatus(status: ProgressStatus): status is "done" | "failed" | "stopped" {
    return ["done", "failed", "stopped"].includes(status);
}

function queueJob(job: EncodeJob): void {
    if (["queued", "running"].includes(job.status) || isTerminalStatus(job.status)) {
        return;
    }

    const availableIndex = availableJobs.findIndex(item => item.id === job.id);

    if (availableIndex !== -1) {
        availableJobs.splice(availableIndex, 1);
    }

    job.status = "queued";
    queuedJobs.push(job);

    const row = createProgressRow(job);

    row.status = "queued";
    row.speed = "queued";

    scheduleRender();
    pumpQueue();
}

function pumpQueue(): void {
    if (shutdownRequested || userRequestedExit) {
        checkQueueSessionEnd();
        return;
    }

    while (runningJobs.size < maxParallelEncodes && queuedJobs.length > 0) {
        const job = queuedJobs.shift();

        if (!job) break;

        runEncodeJob(job).finally(() => {
            pumpQueue();
            checkQueueSessionEnd();
        });
    }

    checkQueueSessionEnd();
}

function checkQueueSessionEnd(): void {
    if (!queueSessionResolve) return;

    const hasRunning = runningJobs.size > 0;
    const hasQueued = queuedJobs.length > 0;
    const hasAvailable = availableJobs.length > 0;

    if (
        shutdownRequested
        || (userRequestedExit && !hasRunning)
        || (!hasRunning && !hasQueued && !hasAvailable)
    ) {
        queueSessionResolve();
        queueSessionResolve = null;
    }
}

function waitForQueueSessionToEnd(): Promise<void> {
    return new Promise<void>(resolve => {
        queueSessionResolve = resolve;
        checkQueueSessionEnd();
    });
}

function setupKeyboardShortcuts(): void {
    if (!process.stdin.isTTY) {
        console.log(chalk.yellow("Keyboard shortcuts disabled because stdin is not a TTY."));
        return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    inputHandler = chunk => {
        const input = String(chunk);

        if (addMenuOpen) {
            handleAddMenuInput(input);
            return;
        }

        if (killMenuOpen) {
            handleKillMenuInput(input);
            return;
        }

        handleNormalInput(input);
    };

    process.stdin.on("data", inputHandler);
}

function teardownKeyboardShortcuts(): void {
    if (inputHandler) {
        process.stdin.off("data", inputHandler);
        inputHandler = null;
    }

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }

    process.stdin.pause();
}

function updateProgressFromFFmpegOutput(row: ProgressRow, text: string): void {
    const timeMatches = [...text.matchAll(/time=\s*([0-9:.]+)/g)];
    const fpsMatches = [...text.matchAll(/fps=\s*([0-9.]+)/g)];
    const bitrateMatches = [...text.matchAll(/bitrate=\s*([^\s]+)/g)];
    const sizeMatches = [...text.matchAll(/size=\s*([0-9.]+)\s*([KMGT]?i?B|[kMGT]?B|B)?/gi)];
    const speedMatches = [...text.matchAll(/speed=\s*([^\s]+)/g)];

    const lastTime = timeMatches.at(-1)?.[1];
    const lastFps = fpsMatches.at(-1)?.[1];
    const lastBitrate = bitrateMatches.at(-1)?.[1];
    const lastSize = sizeMatches.at(-1);
    const lastSpeed = speedMatches.at(-1)?.[1];

    if (lastTime) {
        row.time = lastTime.split(".")[0]!;
    }

    if (lastFps) {
        row.fps = Number(lastFps).toFixed(1);
    }

    if (lastBitrate) {
        row.bitrate = lastBitrate;
    }

    if (lastSize) {
        const bytes = parseFFmpegSizeToBytes(lastSize[1]!, lastSize[2]);

        if (bytes !== undefined) {
            row.size = formatBytes(bytes);
        }
    }

    if (lastSpeed && lastSpeed !== "N/A") {
        row.speed = lastSpeed;
    }

    scheduleRender();
}

async function updateFileSizeFromDisk(job: EncodeJob, row: ProgressRow): Promise<void> {
    if (!job.outputPath) return;

    try {
        const stat = await fs.stat(job.outputPath);

        if (stat.size > 0) {
            row.size = formatBytes(stat.size);
            scheduleRender();
        }
    } catch {
        // File may still exist during the pass 1.
    }
}

function startFileSizeWatcher(job: EncodeJob, row: ProgressRow) {
    const timer = setInterval(() => {
        if (
            ["done", "failed", "stopped"].includes(job.status)
            || job.status !== "running" ||
            shutdownRequested
        ) {
            clearInterval(timer);
            return;
        }

        updateFileSizeFromDisk(job, row);
    }, 500);

    return timer;
}

async function consumeFFmpegStream(stream: ReadableStream<Uint8Array>, row: ProgressRow, errorBuffer: string[]): Promise<void> {
    const decoder = new TextDecoder();

    try {
        for await (const chunk of stream) {
            const text = decoder.decode(chunk, { stream: true });

            updateProgressFromFFmpegOutput(row, text);

            const lines = text
                .replace(/\r/g, "\n")
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean);

            errorBuffer.push(...lines);

            while (errorBuffer.length > 20) {
                errorBuffer.shift();
            }
        }
    } catch {
        // When a process is aborted, the stream may close with an exception.
    }
}

function createProgressRow(job: EncodeJob): ProgressRow {
    const existingRow = progressRows.get(job.id);

    if (existingRow) {
        return existingRow;
    }

    const row: ProgressRow = {
        id: job.id,
        output: job.output,
        time: "00:00:00",
        fps: "-",
        bitrate: "-",
        size: "-",
        speed:
            job.status === "queued"
                ? "queued"
                : job.status === "available"
                    ? "available"
                    : "-",
        status: job.status,
    };

    progressRows.set(job.id, row);
    return row;
}

async function runSingleCommand(job: EncodeJob, command: string): Promise<void> {
    if (shutdownRequested || job.status === "stopped") {
        return;
    }

    const args = parseCommand(command);
    const commandOutputPath = getOutputPath(command);

    if (commandOutputPath) {
        job.outputPath = commandOutputPath;
    }

    const row = createProgressRow(job);

    const controller = new AbortController();

    job.controller = controller;
    job.status = "running";

    row.status = "running";

    if (["-", "pending"].includes(row.speed)) {
        row.speed = "starting";
    }

    runningJobs.set(job.id, job);
    scheduleRender();

    const sizeWatcher = startFileSizeWatcher(job, row);

    const proc = Bun.spawn({
        cmd: args,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        signal: controller.signal,
        killSignal: "SIGTERM",
    });

    const errorBuffer: string[] = [];

    const stdoutPromise = proc.stdout
        ? consumeFFmpegStream(proc.stdout, row, errorBuffer)
        : Promise.resolve();

    const stderrPromise = proc.stderr
        ? consumeFFmpegStream(proc.stderr, row, errorBuffer)
        : Promise.resolve();

    const exitCode = await proc.exited;

    clearInterval(sizeWatcher);

    await updateFileSizeFromDisk(job, row);
    await Promise.allSettled([stdoutPromise, stderrPromise]);

    job.controller = undefined;

    if (controller.signal.aborted || shouldStopJob(job)) {
        job.status = "stopped";
        row.status = "stopped";
        row.speed = "stopped";
        scheduleRender();
        return;
    }

    if (exitCode !== 0) {
        const details = errorBuffer.length
            ? `\n\nLast ffmpeg output:\n${errorBuffer.join("\n")}`
            : "";

        throw new Error(`Command failed (${exitCode}): ${command}${details}`);
    }
}

function shouldStopJob(job: EncodeJob): boolean {
    return shutdownRequested || job.status === "stopped";
}

async function runEncodeJob(job: EncodeJob): Promise<void> {
    const row = createProgressRow(job);

    try {
        job.status = "running";
        row.status = "running";
        row.speed = "starting";

        runningJobs.set(job.id, job);
        scheduleRender();

        for (const command of job.commands) {
            if (shouldStopJob(job)) {
                break;
            }

            await runSingleCommand(job, command);
        }

        if (shouldStopJob(job)) {
            job.status = "stopped";
            row.status = "stopped";
            row.speed = "stopped";
            return;
        }

        await updateFileSizeFromDisk(job, row);

        job.status = "done";
        row.status = "done";

        if (row.speed === "starting" || row.speed === "-") {
            row.speed = "done";
        }
    } catch (error) {
        job.status = "failed";
        row.status = "failed";
        row.speed = "failed";

        if (error instanceof Error) {
            job.error = error.message;
        } else {
            job.error = String(error);
        }
    } finally {
        runningJobs.delete(job.id);
        job.controller = undefined;
        scheduleRender();
    }
}

function stopJob(jobId: string): void {
    const job = runningJobs.get(jobId);
    const row = progressRows.get(jobId);

    if (!job) {
        console.log(chalk.yellow("\nThis encode is not running anymore."));
        return;
    }

    job.status = "stopped";

    if (row) {
        row.status = "stopped";
        row.speed = "stopping";
    }

    job.controller?.abort();

    scheduleRender();
}

async function createEncodeJobsFromFile(file: string): Promise<EncodeJob[]> {
    const commands = (await Bun.file(file).text())
        .split(/\r?\n/)
        .map(command => command.trim())
        .filter(Boolean);

    const jobs: EncodeJob[] = [];

    for (let index = 0; index < commands.length; index += 2) {
        const jobCommands = commands.slice(index, index + 2);

        const outputCommand = jobCommands[1] ?? jobCommands[0]!;

        const output = getOutputName(outputCommand);
        const outputPath = getOutputPath(outputCommand);

        jobs.push({
            id: `${file}:${index}:${output}`,
            sourceFile: file,
            output,
            outputPath,
            commands: jobCommands,
            status: "queued",
        });
    }

    console.log(chalk.white(`Reading ${commands.length} commands from '${file}' into ${jobs.length} encode jobs...`));

    return jobs;
}

function printSummary(jobs: EncodeJob[]): void {
    const failedJobs = jobs.filter(job => job.status === "failed");
    const stoppedJobs = jobs.filter(job => job.status === "stopped");
    const doneJobs = jobs.filter(job => job.status === "done");

    console.log("");

    if (doneJobs.length > 0) {
        console.log(chalk.green(`Done: ${doneJobs.length}`));
    }

    if (stoppedJobs.length > 0) {
        console.log(chalk.yellow(`Stopped: ${stoppedJobs.length}`));
    }

    if (failedJobs.length > 0) {
        console.log(chalk.red(`Failed: ${failedJobs.length}`));

        for (const job of failedJobs) {
            console.log(chalk.red(`\n${job.output}`));

            if (job.error) {
                console.log(chalk.red(job.error));
            }
        }
    }
}

export async function execute(): Promise<void> {
    const workDir = process.cwd();

    const files = await checkbox({
        message: "Select command files to read",
        choices: (await fs.readdir(workDir)).filter(file => file.endsWith(".txt")).map(file => ({
            name: file,
            value: file,
        })),
        required: true,
    });

    const jobs = (await Promise.all(files.map(file => createEncodeJobsFromFile(file)))).flat();

    const initialJobIds = await checkbox({
        message: "Select output files to add to the initial queue. You can add more later with 'a'.",
        choices: jobs.map(job => ({
            name: `${job.output} — ${job.sourceFile} — ${job.commands.length} command(s)`,
            value: job.id,
        })),
        required: true,
    });

    const selectedInitialJobs = jobs.filter(job => initialJobIds.includes(job.id));
    const notSelectedJobs = jobs.filter(job => !initialJobIds.includes(job.id));

    availableJobs.length = 0;
    queuedJobs.length = 0;
    progressRows.clear();
    runningJobs.clear();

    shutdownRequested = false;
    userRequestedExit = false;

    for (const job of notSelectedJobs) {
        job.status = "available";
        availableJobs.push(job);
    }

    for (const job of selectedInitialJobs) {
        job.status = "available";
    }

    maxParallelEncodes = Math.max(1, selectedInitialJobs.length);

    console.log("");
    console.log(chalk.gray("During execution:"));
    console.log(chalk.gray("  a       add available encodes to the queue"));
    console.log(chalk.gray("  k       choose one running encode to kill"));
    console.log(chalk.gray("  q       quit when idle"));
    console.log(chalk.gray("  Ctrl+C  stop all running encodes"));
    console.log("");

    setupKeyboardShortcuts();

    try {
        for (const job of selectedInitialJobs) {
            queueJob(job);
        }

        await waitForQueueSessionToEnd();
    } finally {
        teardownKeyboardShortcuts();

        if (renderTimer) {
            clearTimeout(renderTimer);
            renderTimer = null;
        }

        renderTable();
        clearRenderedTable();
        renderTable();

        printSummary(jobs);

        if (shutdownRequested) {
            process.exitCode = 130;
        } else if (jobs.some(job => job.status === "failed")) {
            process.exitCode = 1;
        }
    }
}