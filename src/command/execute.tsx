import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Box, Text, render, useApp} from "ink";
import {promises as fs} from "node:fs";
import {basename} from "node:path";

import {checkEncodingTools} from "@/env";

type ExecuteArgs = {
    recursive: boolean;
};

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

type SelectOption = {
    label: string;
    value: string;
};

type TerminalKey = {
    upArrow: boolean;
    downArrow: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
};

type TerminalInputOptions = {
    isActive?: boolean;
};

function parseTerminalInput(raw: string): {input: string; key: TerminalKey} {
    const key: TerminalKey = {
        upArrow: raw === "\u001b[A" || raw === "\u001bOA",
        downArrow: raw === "\u001b[B" || raw === "\u001bOB",
        return: raw === "\r" || raw === "\n",
        escape: raw === "\u001b",
        ctrl: false,
    };

    // In raw mode Ctrl+A..Ctrl+Z arrive as bytes 0x01..0x1a.
    // Normalize them to the same shape Ink's useInput() exposes.
    if (raw.length === 1) {
        const code = raw.charCodeAt(0);

        if (code >= 1 && code <= 26) {
            key.ctrl = true;
            return {
                input: String.fromCharCode(code + 96),
                key,
            };
        }
    }

    return {input: raw, key};
}

/**
 * Bun-compatible replacement for Ink's useInput().
 *
 * Ink reads stdin through `readable` + stdin.read(). The original CLI used
 * `data` successfully under Bun, so let Ink render while we own keyboard input.
 */
function useTerminalInput(
    handler: (input: string, key: TerminalKey) => void,
    options: TerminalInputOptions = {},
): void {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (options.isActive === false) {
            return;
        }

        const onData = (chunk: string | Buffer) => {
            const event = parseTerminalInput(String(chunk));
            handlerRef.current(event.input, event.key);
        };

        process.stdin.on("data", onData);

        return () => {
            process.stdin.off("data", onData);
        };
    }, [options.isActive]);
}

function parseCommand(command: string): string[] {
    return (command.match(/"[^"]*"|\S+/g) ?? []).map(argument =>
        argument.replace(/^"|"$/g, ""),
    );
}

function getOutputPath(command: string): string | undefined {
    const args = parseCommand(command);
    const finalArg = args.at(-1);

    if (!finalArg) {
        return undefined;
    }

    if (["NUL", "/DEV/NULL"].includes(finalArg.toUpperCase())) {
        return undefined;
    }

    return finalArg;
}

export function getOutputName(command: string): string {
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
        unitIndex += 1;
    }

    if (unitIndex === 0) {
        return `${Math.round(value)} ${units[unitIndex]}`;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function parseFFmpegSizeToBytes(
    value: string,
    unit: string | undefined,
): number | undefined {
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

    if (normalizedUnit === "gb" || normalizedUnit === "gib") {
        return number * 1024 * 1024 * 1024;
    }

    return number;
}

function createProgressRow(job: EncodeJob): ProgressRow {
    return {
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

        jobs.push({
            id: `${file}:${index}:${output}`,
            sourceFile: file,
            output,
            outputPath: getOutputPath(outputCommand),
            commands: jobCommands,
            status: "available",
        });
    }

    return jobs;
}

class EncodeQueue {
    readonly jobs: EncodeJob[];
    readonly progressRows = new Map<string, ProgressRow>();
    readonly availableJobs: EncodeJob[] = [];
    readonly queuedJobs: EncodeJob[] = [];
    readonly runningJobs = new Map<string, EncodeJob>();

    maxParallelEncodes: number;
    shutdownRequested = false;
    exitWhenIdle = false;
    finished = false;

    private readonly listeners = new Set<() => void>();

    constructor(jobs: EncodeJob[], initialJobIds: string[]) {
        this.jobs = jobs;
        this.maxParallelEncodes = Math.max(1, initialJobIds.length);

        const initialIds = new Set(initialJobIds);

        for (const job of jobs) {
            job.status = "available";
            job.controller = undefined;
            job.error = undefined;

            if (!initialIds.has(job.id)) {
                this.availableJobs.push(job);
            }
        }

        for (const job of jobs) {
            if (initialIds.has(job.id)) {
                this.queueJob(job, false);
            }
        }
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    start(): void {
        this.emit();
        this.pumpQueue();
    }

    setMaxParallelEncodes(value: number): void {
        this.maxParallelEncodes = Math.max(1, Math.floor(value));

        this.emit();
        this.pumpQueue();
    }

    queueJobs(jobIds: string[]): void {
        const ids = new Set(jobIds);

        for (const job of [...this.availableJobs]) {
            if (ids.has(job.id)) {
                this.queueJob(job, false);
            }
        }

        this.emit();
        this.pumpQueue();
    }

    stopJob(jobId: string): void {
        const job = this.runningJobs.get(jobId);
        const row = this.progressRows.get(jobId);

        if (!job) {
            return;
        }

        job.status = "stopped";

        if (row) {
            row.status = "stopped";
            row.speed = "stopping";
        }

        job.controller?.abort();
        this.emit();
    }

    requestExitWhenIdle(): void {
        this.exitWhenIdle = true;
        this.emit();
        this.pumpQueue();
        this.checkFinished();
    }

    shutdownAll(): void {
        if (this.shutdownRequested) {
            return;
        }

        this.shutdownRequested = true;
        this.exitWhenIdle = true;

        while (this.queuedJobs.length > 0) {
            const job = this.queuedJobs.shift()!;
            job.status = "stopped";

            const row = this.getOrCreateProgressRow(job);
            row.status = "stopped";
            row.speed = "stopped";
        }

        for (const job of this.runningJobs.values()) {
            this.stopJob(job.id);
        }

        this.emit();
        this.checkFinished();
    }

    get exitCode(): number {
        if (this.shutdownRequested) {
            return 130;
        }

        return this.jobs.some(job => job.status === "failed") ? 1 : 0;
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private getOrCreateProgressRow(job: EncodeJob): ProgressRow {
        const existing = this.progressRows.get(job.id);

        if (existing) {
            return existing;
        }

        const row = createProgressRow(job);
        this.progressRows.set(job.id, row);
        return row;
    }

    private queueJob(job: EncodeJob, shouldPump = true): void {
        if (job.status !== "available") {
            return;
        }

        const availableIndex = this.availableJobs.findIndex(item => item.id === job.id);

        if (availableIndex !== -1) {
            this.availableJobs.splice(availableIndex, 1);
        }

        job.status = "queued";
        this.queuedJobs.push(job);

        const row = this.getOrCreateProgressRow(job);
        row.status = "queued";
        row.speed = "queued";

        this.emit();

        if (shouldPump) {
            this.pumpQueue();
        }
    }

    private pumpQueue(): void {
        if (this.shutdownRequested) {
            this.checkFinished();
            return;
        }

        while (
            this.runningJobs.size < this.maxParallelEncodes &&
            this.queuedJobs.length > 0
        ) {
            const job = this.queuedJobs.shift();

            if (!job) {
                break;
            }

            void this.runEncodeJob(job).finally(() => {
                this.pumpQueue();
                this.checkFinished();
            });
        }

        this.checkFinished();
    }

    private checkFinished(): void {
        if (this.finished) {
            return;
        }

        const hasRunning = this.runningJobs.size > 0;
        const hasQueued = this.queuedJobs.length > 0;
        const hasAvailable = this.availableJobs.length > 0;

        const shouldFinish =
            (this.shutdownRequested && !hasRunning) ||
            (this.exitWhenIdle && !hasRunning && !hasQueued) ||
            (!hasRunning && !hasQueued && !hasAvailable);

        if (shouldFinish) {
            this.finished = true;
            this.emit();
        }
    }

    private updateProgressFromFFmpegOutput(row: ProgressRow, text: string): void {
        const timeMatches = [...text.matchAll(/time=\s*([0-9:.]+)/g)];
        const fpsMatches = [...text.matchAll(/fps=\s*([0-9.]+)/g)];
        const bitrateMatches = [...text.matchAll(/bitrate=\s*([^\s]+)/g)];
        const sizeMatches = [
            ...text.matchAll(/size=\s*([0-9.]+)\s*([KMGT]?i?B|[kMGT]?B|B)?/gi),
        ];
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

        this.emit();
    }

    private async updateFileSizeFromDisk(
        job: EncodeJob,
        row: ProgressRow,
    ): Promise<void> {
        if (!job.outputPath) {
            return;
        }

        try {
            const stat = await fs.stat(job.outputPath);

            if (stat.size > 0) {
                row.size = formatBytes(stat.size);
                this.emit();
            }
        } catch {
            // The output may not exist yet (for example while pass 1 is running).
        }
    }

    private startFileSizeWatcher(job: EncodeJob, row: ProgressRow) {
        return setInterval(() => {
            if (
                job.status !== "running" ||
                this.shutdownRequested ||
                ["done", "failed", "stopped"].includes(job.status)
            ) {
                return;
            }

            void this.updateFileSizeFromDisk(job, row);
        }, 500);
    }

    private async consumeFFmpegStream(
        stream: ReadableStream<Uint8Array>,
        row: ProgressRow,
        errorBuffer: string[],
    ): Promise<void> {
        const decoder = new TextDecoder();

        try {
            for await (const chunk of stream) {
                const text = decoder.decode(chunk, {stream: true});

                this.updateProgressFromFFmpegOutput(row, text);

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
            // Aborting a Bun child process may also close its stream with an exception.
        }
    }

    private shouldStopJob(job: EncodeJob): boolean {
        return this.shutdownRequested || job.status === "stopped";
    }

    private async runSingleCommand(job: EncodeJob, command: string): Promise<void> {
        if (this.shouldStopJob(job)) {
            return;
        }

        const args = parseCommand(command);

        if (args.length === 0) {
            throw new Error("Cannot execute an empty command.");
        }

        const commandOutputPath = getOutputPath(command);

        if (commandOutputPath) {
            job.outputPath = commandOutputPath;
        }

        const row = this.getOrCreateProgressRow(job);
        const controller = new AbortController();

        job.controller = controller;
        job.status = "running";
        row.status = "running";

        if (["-", "pending", "queued"].includes(row.speed)) {
            row.speed = "starting";
        }

        this.emit();

        const sizeWatcher = this.startFileSizeWatcher(job, row);
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
            ? this.consumeFFmpegStream(proc.stdout, row, errorBuffer)
            : Promise.resolve();
        const stderrPromise = proc.stderr
            ? this.consumeFFmpegStream(proc.stderr, row, errorBuffer)
            : Promise.resolve();

        const exitCode = await proc.exited;

        clearInterval(sizeWatcher);
        await this.updateFileSizeFromDisk(job, row);
        await Promise.allSettled([stdoutPromise, stderrPromise]);

        job.controller = undefined;

        if (controller.signal.aborted || this.shouldStopJob(job)) {
            job.status = "stopped";
            row.status = "stopped";
            row.speed = "stopped";
            this.emit();
            return;
        }

        if (exitCode !== 0) {
            const details = errorBuffer.length
                ? `\n\nLast ffmpeg output:\n${errorBuffer.join("\n")}`
                : "";

            throw new Error(`Command failed (${exitCode}): ${command}${details}`);
        }
    }

    private async runEncodeJob(job: EncodeJob): Promise<void> {
        const row = this.getOrCreateProgressRow(job);

        try {
            job.status = "running";
            row.status = "running";
            row.speed = "starting";
            this.runningJobs.set(job.id, job);
            this.emit();

            for (const command of job.commands) {
                if (this.shouldStopJob(job)) {
                    break;
                }

                await this.runSingleCommand(job, command);
            }

            if (this.shouldStopJob(job)) {
                job.status = "stopped";
                row.status = "stopped";
                row.speed = "stopped";
                return;
            }

            await this.updateFileSizeFromDisk(job, row);

            job.status = "done";
            row.status = "done";

            if (["starting", "-"].includes(row.speed)) {
                row.speed = "done";
            }
        } catch (error) {
            job.status = "failed";
            row.status = "failed";
            row.speed = "failed";
            job.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.runningJobs.delete(job.id);
            job.controller = undefined;
            this.emit();
        }
    }
}

function useQueueRevision(queue: EncodeQueue): number {
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        return queue.subscribe(() => setRevision(value => value + 1));
    }, [queue]);

    return revision;
}

function statusColor(status: ProgressStatus): string | undefined {
    switch (status) {
        case "done":
            return "green";
        case "failed":
            return "red";
        case "stopped":
            return "yellow";
        case "running":
            return "cyan";
        case "queued":
            return "blue";
        default:
            return undefined;
    }
}

function StatusBadge({status}: {status: ProgressStatus}) {
    const labels: Record<ProgressStatus, string> = {
        available: "AVAILABLE",
        queued: "QUEUED",
        running: "RUNNING",
        done: "DONE",
        failed: "FAILED",
        stopped: "STOPPED",
    };

    return (
        <Text color={statusColor(status)} bold={status === "running" || status === "failed"}>
            {labels[status]}
        </Text>
    );
}

function TableCell({children, width}: {children: React.ReactNode; width: number}) {
    return (
        <Box width={width} flexShrink={0} paddingRight={1}>
            <Text wrap="truncate-end">{children}</Text>
        </Box>
    );
}

function ProgressTable({rows}: {rows: ProgressRow[]}) {
    if (rows.length === 0) {
        return <Text dimColor>No encodes have been queued yet.</Text>;
    }

    return (
        <Box flexDirection="column">
            <Box>
                <TableCell width={26}>Output</TableCell>
                <TableCell width={11}>Status</TableCell>
                <TableCell width={10}>Time</TableCell>
                <TableCell width={8}>FPS</TableCell>
                <TableCell width={15}>Bitrate</TableCell>
                <TableCell width={11}>Size</TableCell>
                <TableCell width={10}>Speed</TableCell>
            </Box>
            <Text dimColor>{"─".repeat(91)}</Text>
            {rows.map(row => (
                <Box key={row.id}>
                    <TableCell width={26}>{row.output}</TableCell>
                    <Box width={11} flexShrink={0} paddingRight={1}>
                        <StatusBadge status={row.status} />
                    </Box>
                    <TableCell width={10}>{row.time}</TableCell>
                    <TableCell width={8}>{row.fps}</TableCell>
                    <TableCell width={15}>{row.bitrate}</TableCell>
                    <TableCell width={11}>{row.size}</TableCell>
                    <TableCell width={10}>{row.speed}</TableCell>
                </Box>
            ))}
        </Box>
    );
}

function MultiSelectList({
    title,
    help,
    options,
    onSubmit,
    onCancel,
    isActive = true,
    maxVisible = 12,
}: {
    title: string;
    help?: string;
    options: SelectOption[];
    onSubmit: (values: string[]) => void;
    onCancel?: () => void;
    isActive?: boolean;
    maxVisible?: number;
}) {
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [validation, setValidation] = useState<string | null>(null);

    useEffect(() => {
        if (cursor >= options.length) {
            setCursor(Math.max(0, options.length - 1));
        }
    }, [cursor, options.length]);

    useTerminalInput(
        (input, key) => {
            if (key.escape && onCancel) {
                onCancel();
                return;
            }

            if (options.length === 0) {
                return;
            }

            if (key.upArrow || input.toLowerCase() === "w") {
                setCursor(value => (value <= 0 ? options.length - 1 : value - 1));
                return;
            }

            if (key.downArrow || input.toLowerCase() === "s") {
                setCursor(value => (value >= options.length - 1 ? 0 : value + 1));
                return;
            }

            if (input === " ") {
                const option = options[cursor];

                if (!option) {
                    return;
                }

                setSelected(previous => {
                    const next = new Set(previous);

                    if (next.has(option.value)) {
                        next.delete(option.value);
                    } else {
                        next.add(option.value);
                    }

                    return next;
                });
                setValidation(null);
                return;
            }

            if (key.return) {
                if (selected.size === 0) {
                    setValidation("Select at least one item.");
                    return;
                }

                onSubmit([...selected]);
            }
        },
        {isActive},
    );

    const start = Math.max(
        0,
        Math.min(
            cursor - Math.floor(maxVisible / 2),
            Math.max(0, options.length - maxVisible),
        ),
    );
    const visible = options.slice(start, start + maxVisible);

    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
                <Text bold>{title}</Text>
                <Text dimColor>
                    {help ?? "↑/↓ or W/S move · Space toggles · Enter confirms"}
                    {onCancel ? " · Esc cancels" : ""}
                </Text>
            </Box>

            {options.length === 0 ? (
                <Text color="yellow">No items available.</Text>
            ) : (
                <Box flexDirection="column">
                    {visible.map((option, visibleIndex) => {
                        const absoluteIndex = start + visibleIndex;
                        const focused = absoluteIndex === cursor;
                        const checked = selected.has(option.value);

                        return (
                            <Text key={option.value} color={focused ? "cyan" : undefined}>
                                {focused ? "❯" : " "} {checked ? "◉" : "○"} {option.label}
                            </Text>
                        );
                    })}
                    {options.length > maxVisible && (
                        <Text dimColor>
                            Showing {start + 1}–{Math.min(start + maxVisible, options.length)} of {options.length}
                        </Text>
                    )}
                </Box>
            )}

            {validation && <Text color="yellow">{validation}</Text>}
        </Box>
    );
}

function SingleSelectList({
    title,
    help,
    options,
    onSubmit,
    onCancel,
}: {
    title: string;
    help: string;
    options: SelectOption[];
    onSubmit: (value: string) => void;
    onCancel: () => void;
}) {
    const [cursor, setCursor] = useState(0);

    useEffect(() => {
        if (cursor >= options.length) {
            setCursor(Math.max(0, options.length - 1));
        }
    }, [cursor, options.length]);

    useTerminalInput((input, key) => {
        if (key.escape) {
            onCancel();
            return;
        }

        if (options.length === 0) {
            return;
        }

        if (key.upArrow || input.toLowerCase() === "w") {
            setCursor(value => (value <= 0 ? options.length - 1 : value - 1));
            return;
        }

        if (key.downArrow || input.toLowerCase() === "s") {
            setCursor(value => (value >= options.length - 1 ? 0 : value + 1));
            return;
        }

        if (key.return) {
            const option = options[cursor];

            if (option) {
                onSubmit(option.value);
            }
        }
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
                <Text bold>{title}</Text>
                <Text dimColor>{help}</Text>
            </Box>

            {options.length === 0 ? (
                <Text color="yellow">No running encodes.</Text>
            ) : (
                <Box flexDirection="column">
                    {options.map((option, index) => (
                        <Text key={option.value} color={index === cursor ? "cyan" : undefined}>
                            {index === cursor ? "❯" : " "} {option.label}
                        </Text>
                    ))}
                </Box>
            )}
        </Box>
    );
}

function RunningScreen({queue}: {queue: EncodeQueue}) {
    const revision = useQueueRevision(queue);
    const [screen, setScreen] = useState<"main" | "add" | "kill" | "parallel">("main");
    const [notice, setNotice] = useState<string | null>(null);

    const rows = useMemo(
        () => [...queue.progressRows.values()],
        [queue, revision],
    );
    const availableOptions = useMemo(
        () =>
            queue.availableJobs.map(job => ({
                value: job.id,
                label: `${job.output} — ${job.sourceFile}`,
            })),
        [queue, revision],
    );
    const runningOptions = useMemo(
        () =>
            [...queue.runningJobs.values()].map(job => {
                const row = queue.progressRows.get(job.id);
                const details = row
                    ? `${row.time} · ${row.fps} fps · ${row.bitrate} · ${row.size} · ${row.speed}`
                    : "starting";

                return {
                    value: job.id,
                    label: `${job.output} — ${details}`,
                };
            }),
        [queue, revision],
    );

    useTerminalInput((input, key) => {
        if (key.ctrl && input.toLowerCase() === "c") {
            setNotice("Stopping running encodes and cancelling queued work…");
            setScreen("main");
            queue.shutdownAll();
        }
    });

    useTerminalInput(
        input => {
            if (input.toLowerCase() === "a") {
                if (queue.availableJobs.length === 0) {
                    setNotice("There are no available encodes to add.");
                } else {
                    setNotice(null);
                    setScreen("add");
                }
                return;
            }

            if (input.toLowerCase() === "p") {
                setNotice(null);
                setScreen("parallel");
                return;
            }

            if (input.toLowerCase() === "k") {
                if (queue.runningJobs.size === 0) {
                    setNotice("There are no running encodes to stop.");
                } else {
                    setNotice(null);
                    setScreen("kill");
                }
                return;
            }

            if (input.toLowerCase() === "q") {
                if (queue.runningJobs.size > 0 || queue.queuedJobs.length > 0) {
                    setNotice("Exit requested; queued/running encodes will finish first.");
                }

                queue.requestExitWhenIdle();
            }
        },
        {isActive: screen === "main"},
    );

    if (screen === "add") {
        return (
            <MultiSelectList
                title="Add encodes to queue"
                help="↑/↓ or W/S move · Space toggles · Enter adds · Esc returns"
                options={availableOptions}
                onSubmit={values => {
                    queue.queueJobs(values);
                    setScreen("main");
                }}
                onCancel={() => setScreen("main")}
            />
        );
    }

    if (screen === "parallel") {
        return (
            <ParallelInput
                current={queue.maxParallelEncodes}
                onSubmit={value => {
                    queue.setMaxParallelEncodes(value);

                    setNotice(
                        `Max parallel encodes changed to ${value}.`,
                    );

                    setScreen("main");
                }}
                onCancel={() => {
                    setScreen("main");
                }}
            />
        );
    }

    if (screen === "kill") {
        return (
            <SingleSelectList
                title="Stop a running encode"
                help="↑/↓ or W/S move · Enter stops · Esc returns"
                options={runningOptions}
                onSubmit={value => {
                    queue.stopJob(value);
                    setScreen("main");
                }}
                onCancel={() => setScreen("main")}
            />
        );
    }

    return (
        <Box flexDirection="column" gap={1}>
            <Box justifyContent="space-between">
                <Text bold>FFmpeg encode queue</Text>
                <Text dimColor>
                    parallel {queue.runningJobs.size}/{queue.maxParallelEncodes} · queued {queue.queuedJobs.length} · available {queue.availableJobs.length}
                </Text>
            </Box>

            <ProgressTable rows={rows} />

            <Box flexDirection="column">
                <Text dimColor>
                    a add encodes · p parallelism · k stop one · q exit when idle · Ctrl+C stop all
                </Text>
                {notice && <Text color="yellow">{notice}</Text>}
            </Box>
        </Box>
    );
}

function ParallelInput({
    current,
    onSubmit,
    onCancel,
}: {
    current: number;
    onSubmit: (value: number) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);

    useTerminalInput((input, key) => {
        if (key.escape) {
            onCancel();
            return;
        }

        if (key.return) {
            const parsed = Number(value);

            if (
                !Number.isInteger(parsed) ||
                parsed < 1
            ) {
                setError("Enter an integer greater than or equal to 1.");
                return;
            }

            onSubmit(parsed);
            return;
        }

        if (input === "\u007f" || input === "\b") {
            setValue(previous => previous.slice(0, -1));
            setError(null);
            return;
        }

        if (/^\d+$/.test(input)) {
            setValue(previous => previous + input);
            setError(null);
        }
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Text bold>Max parallel encodes</Text>

            <Text>
                Current:{" "}
                <Text color="cyan">
                    {current}
                </Text>
            </Text>

            <Text>
                New value:{" "}
                <Text color="cyan">
                    {value}
                </Text>
                <Text color="cyan">█</Text>
            </Text>

            <Text dimColor>
                Type a number · Enter confirms · Esc cancels
            </Text>

            {error && (
                <Text color="yellow">
                    {error}
                </Text>
            )}
        </Box>
    );
}

function SummaryScreen({queue}: {queue: EncodeQueue}) {
    const {exit} = useApp();
    const done = queue.jobs.filter(job => job.status === "done");
    const stopped = queue.jobs.filter(job => job.status === "stopped");
    const failed = queue.jobs.filter(job => job.status === "failed");
    const notRun = queue.jobs.filter(job => job.status === "available");

    useTerminalInput((input, key) => {
        if (
            key.return ||
            key.escape ||
            input.toLowerCase() === "q" ||
            (key.ctrl && input.toLowerCase() === "c")
        ) {
            exit(queue.exitCode);
        }
    });

    return (
        <Box flexDirection="column" gap={1}>
            <Text bold>Encode session complete</Text>

            <Box gap={2}>
                <Text color="green">Done: {done.length}</Text>
                <Text color="yellow">Stopped: {stopped.length}</Text>
                <Text color={failed.length > 0 ? "red" : undefined}>Failed: {failed.length}</Text>
                {notRun.length > 0 && <Text dimColor>Not queued: {notRun.length}</Text>}
            </Box>

            {failed.length > 0 && (
                <Box flexDirection="column" gap={1}>
                    {failed.map(job => (
                        <Box key={job.id} flexDirection="column">
                            <Text color="red" bold>{job.output}</Text>
                            {job.error && <Text color="red">{job.error}</Text>}
                        </Box>
                    ))}
                </Box>
            )}

            <Text dimColor>Press Enter, Esc or q to close.</Text>
        </Box>
    );
}

function FatalError({error}: {error: string}) {
    const {exit} = useApp();

    useTerminalInput(() => exit(1));

    return (
        <Box flexDirection="column" gap={1}>
            <Text color="red" bold>Unable to start encode UI</Text>
            <Text color="red">{error}</Text>
            <Text dimColor>Press any key to close.</Text>
        </Box>
    );
}

function ExecuteTui({files}: {files: string[]}) {
    const {exit} = useApp();
    const [phase, setPhase] = useState<
        "select-files" | "loading-jobs" | "select-jobs" | "running" | "summary"
    >("select-files");
    const [jobs, setJobs] = useState<EncodeJob[]>([]);
    const [queue, setQueue] = useState<EncodeQueue | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fileOptions = useMemo(
        () => files.map(file => ({value: file, label: file})),
        [files],
    );

    const loadSelectedFiles = useCallback(async (selectedFiles: string[]) => {
        setPhase("loading-jobs");

        try {
            const loadedJobs = (
                await Promise.all(selectedFiles.map(file => createEncodeJobsFromFile(file)))
            ).flat();

            if (loadedJobs.length === 0) {
                throw new Error("The selected command files contain no executable commands.");
            }

            setJobs(loadedJobs);
            setPhase("select-jobs");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, []);

    useEffect(() => {
        if (!queue) {
            return;
        }

        if (queue.finished) {
            setPhase("summary");
        }

        return queue.subscribe(() => {
            if (queue.finished) {
                setPhase("summary");
            }
        });
    }, [queue]);

    if (error) {
        return <FatalError error={error} />;
    }

    if (phase === "select-files") {
        return (
            <MultiSelectList
                key="select-files"
                title="Select command files to read"
                options={fileOptions}
                onSubmit={values => void loadSelectedFiles(values)}
                onCancel={() => exit(0)}
            />
        );
    }

    if (phase === "loading-jobs") {
        return (
            <Box gap={1}>
                <Text color="cyan">●</Text>
                <Text>Reading command files…</Text>
            </Box>
        );
    }

    if (phase === "select-jobs") {
        return (
            <MultiSelectList
                key="select-jobs"
                title="Select output files for the initial queue"
                help="Space toggles · Enter starts · initial selection also defines max parallel encodes"
                options={jobs.map(job => ({
                    value: job.id,
                    label: `${job.output} — ${job.sourceFile} — ${job.commands.length} command(s)`,
                }))}
                onSubmit={values => {
                    const nextQueue = new EncodeQueue(jobs, values);
                    setQueue(nextQueue);
                    setPhase("running");
                    nextQueue.start();
                }}
                onCancel={() => setPhase("select-files")}
            />
        );
    }

    if (!queue) {
        return <FatalError error="Queue state was not initialized." />;
    }

    if (phase === "summary") {
        return <SummaryScreen queue={queue} />;
    }

    return <RunningScreen queue={queue} />;
}

export async function execute(args: ExecuteArgs): Promise<void> {
    await checkEncodingTools();

    const workDir = process.cwd();
    const files = (await fs.readdir(workDir, {recursive: args.recursive}))
        .filter(file => !file.includes("node_modules") && file.endsWith(".txt"))
        .sort();

    if (files.length === 0) {
        console.error("No .txt command files found in the current working directory.");
        process.exitCode = 1;
        return;
    }

    if (!process.stdin.isTTY) {
        console.error("Interactive TUI requires stdin to be a TTY.");
        process.exitCode = 1;
        return;
    }

    // Own raw keyboard input ourselves. This deliberately avoids Ink's
    // `useInput()` path (`readable` + stdin.read()), which can stall on Bun.
    // The old implementation already used `data` successfully.
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    const {waitUntilExit} = render(<ExecuteTui files={files} />, {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        exitOnCtrlC: false,
    });

    try {
        const result = await waitUntilExit();

        if (typeof result === "number") {
            process.exitCode = result;
        }
    } finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
    }
}
