import { $ } from "bun";

import { loadConfig } from "@/config/loader.ts";

async function loadEnvironment(configfile: string) {
    await checkEncodingTools();

    const workDir = process.cwd();

    const config = await loadConfig(workDir, configfile);

    return { workDir, config };
}

async function checkEncodingTools() {
    if (Bun.which("ffmpeg") === null) {
        throw new Error("FFmpeg is required");
    }

    const ffmpegVersionOutput = await $`ffmpeg -version`.text();
    const ffmpegVersion = ffmpegVersionOutput.match(/ffmpeg version (\d+\.\d+)/)?.[1];

    if (ffmpegVersion === undefined || parseInt(ffmpegVersion) < 7) {
        throw new Error("FFmpeg 7.0.0 or newer is required");
    }

    if (Bun.which("ffprobe") === null) {
        throw new Error("FFprobe is required");
    }
}

export { loadEnvironment };
