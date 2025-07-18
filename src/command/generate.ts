import fs from "node:fs/promises";
import * as prompts from "@inquirer/prompts";
import { analyze, streamToString } from "@/ffprobe/analyze";
import { parseDuration } from "@/ffmpeg/duration";
import { loadEnvironment } from "@/env";
import * as ffmpeg from "@/ffmpeg/builder";
import * as customPrompts from "@/util/prompt";

async function generate() {
    const { config, workDir } = await loadEnvironment();

    const allowedFileTypes = config.allowedFileTypes.split(",");
    const sourceFileCandidates = (await fs.readdir(workDir)).filter((file) =>
        allowedFileTypes.some((type) => file.endsWith(type)),
    );

    if (sourceFileCandidates.length === 0) {
        throw new Error("No source file candidates in current directory");
    }

    const sourceFiles = await prompts.checkbox({
        message: "Select source files",
        choices: sourceFileCandidates.map((file) => ({
            value: file,
            name: file,
        })),
    });

    for (const sourceFile of sourceFiles) {
        const sourceMeta = await analyze(sourceFile);

        const videoStream = await prompts.select({
            message: "Select video stream",
            choices: sourceMeta.streams
                .filter((stream) => stream.codec_type === "video")
                .map((stream) => ({
                    value: stream,
                    name: streamToString(stream),
                })),
        });

        const audioStream = await prompts.select({
            message: "Select audio stream",
            choices: sourceMeta.streams
                .filter((stream) => stream.codec_type === "audio")
                .map((stream) => ({
                    value: stream,
                    name: streamToString(stream),
                })),
        });

        const from = await customPrompts.duration({ message: "Enter start time", required: true });
        const to = await customPrompts.duration({ message: "Enter end time", required: true });

        const duration = parseDuration(to) - parseDuration(from);

        const outputFile = await prompts
            .input({
                message: "Enter output file name",
            })
            .then((fileName) => (fileName.endsWith(".webm") ? fileName : `${fileName}.webm`));

        const isSlowSeek = sourceFile.endsWith(".m2ts");

        const ffmpegCommand = ffmpeg.toString([
            isSlowSeek
                ? [ffmpeg.input(sourceFile), ffmpeg.seek(from, to)]
                : [ffmpeg.seek(from, to), ffmpeg.input(sourceFile)],
            ffmpeg.map(videoStream.index),
            ffmpeg.map(audioStream.index),
            ffmpeg.output(outputFile),
        ]);

        console.info(ffmpegCommand);

        // const process = Bun.spawn({
        //     cmd: ffmpegCommand,
        //     stdout: "inherit",
        //     stderr: "pipe",
        // });
        //
        // const progress = new SingleBar({}, Presets.shades_grey);
        //
        // progress.start(Math.floor(duration * 100) / 100, 0);
        //
        // for await (const chunk of process.stderr) {
        //     const decoder = new TextDecoder();
        //     const line = decoder.decode(chunk);
        //
        //     const time = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)?.[1];
        //     if (time) {
        //         progress.update(Math.floor(parseDuration(time) * 100) / 100);
        //     }
        // }
        //
        // progress.update(duration);
        // progress.stop();
    }

    // const audioFilter = await select({
    //   message: "Select an audio filter",
    //   choices: audioFilters.map((audioFilter) => ({
    //     value: audioFilter,
    //     name: audioFilter.label,
    //   })),
    // });
    //
    // const audioFilterString = await audioFilter.promptToString();
    //
    // console.info(audioFilterString);
}

export { generate };
