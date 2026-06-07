import fs, { writeFile } from "node:fs/promises";
import { analyze, getAudioStream, getVideoStream } from "@/ffprobe/analyze";
import { parseDuration, promptDuration } from "@/ffmpeg/duration";
import { loadEnvironment } from "@/env";
import { getColorspaceArgs } from "@/ffmpeg/colorspace";
import { getFirstPassString, getSecondPassString } from "@/ffmpeg/pass";
import { getCbrBitrate, getCbrMaxBitrate } from "@/ffmpeg/bitrateMode";
import { getAudioFiltersString, promptAudioFilters } from "@/ffmpeg/audioFilter";
import { promptVideoFilters } from "@/ffmpeg/videoFilter";
import { output, seek } from "@/ffmpeg/seek";
import { promptCustomQuestions } from "@/ffmpeg/customization";
import chalk from "chalk";
import { checkbox } from "@inquirer/prompts";

type GenerateArgs = {
    file: string;
    configFile: string;
}

async function generate(args: GenerateArgs) {
    const { config, workDir } = await loadEnvironment(args.configFile);

    const allowedFileTypes = config.allowedFileTypes;
    const sourceFileCandidates = (await fs.readdir(workDir)).filter((file) =>
        allowedFileTypes.some((type) => file.endsWith(type)),
    );

    if (sourceFileCandidates.length === 0) {
        throw new Error("No source file candidates in current directory");
    }

    const sourceFiles = await checkbox({
        message: "Select source files",
        choices: sourceFileCandidates.map((file) => ({
            value: file,
            name: file,
        })),
    });

    // Analyze all the source files at once so the user can work freely.
    const sourceFilesMeta = await Promise.all(
        sourceFiles.map(async (sourceFile) => ({
            name: sourceFile,
            meta: await analyze(sourceFile),
        }))
    );

    const ffmpegCommands: string[] = [];
    for (const sourceFile of sourceFiles) {
        const sourceMeta = sourceFilesMeta.find(meta => meta.name === sourceFile)!.meta;

        const sourceMetaVideoStreams = sourceMeta.streams.filter((stream) => stream.codec_type === "video");
        const sourceMetaAudioStreams = sourceMeta.streams.filter((stream) => stream.codec_type === "audio");

        const audioStream = await getAudioStream(sourceMetaAudioStreams);
        const videoStream = await getVideoStream(sourceMetaVideoStreams);

        if (!videoStream || !audioStream) {
            throw new Error("Error on parsing video/audio stream.");
        }

        const audioStreamIndex = sourceMeta.streams.indexOf(audioStream) - 1;
        const videoStreamIndex = sourceMeta.streams.indexOf(videoStream);

        console.log(chalk.green(`\nUsing ${sourceFile}`));
        const multipleSS = await promptDuration("Enter start time");
        const multipleTo = await promptDuration("Enter end time", multipleSS);
        const multipleOutputFile = await output(multipleSS);

        const colorspace = getColorspaceArgs(sourceMeta);

        for (const [index, ss] of multipleSS.split(",").entries()) {
            const to = multipleTo.split(",")[index]!;
            const outputFile = multipleOutputFile.split(",")[index]!;

            const seekArgs = seek(ss, to, sourceFile);
            const duration = parseDuration(to) - parseDuration(ss);

            console.log(chalk.green(`\nSelect for ${outputFile}`));
            const audioFilters = await getAudioFiltersString(seekArgs, audioStreamIndex, audioStream, await promptAudioFilters());
            const videoFilters = await promptVideoFilters(config);

            const customConfig = await promptCustomQuestions(config);

            const bitrate = customConfig.cbrBitrates ?? getCbrBitrate(videoStream);
            const maxBitrate = customConfig.cbrMaxBitrates ?? getCbrMaxBitrate(videoStream);

            console.log(chalk.white(`Generating commands for ${outputFile}...\n`));
            for (const mode of customConfig.encodingModes) {
                if (mode === "VBR") {
                    for (const crf of customConfig.crfs) {
                        for (const videoFilter of videoFilters) {
                            ffmpegCommands.push(
                                getFirstPassString(colorspace, seekArgs, mode, crf, null, null, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig.threads),
                                await getSecondPassString(colorspace, seekArgs, mode, crf, null, null, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig.threads, audioFilters, videoFilter, sourceMeta),
                            );
                        }
                    }
                }

                if (mode === "CBR") {
                    for (const cbrBitrate of bitrate) {
                        for (const cbrMaxBitrate of maxBitrate) {
                            for (const videoFilter of videoFilters) {
                                ffmpegCommands.push(
                                    getFirstPassString(colorspace, seekArgs, mode, null, cbrBitrate, cbrMaxBitrate, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig.threads),
                                    await getSecondPassString(colorspace, seekArgs, mode, null, cbrBitrate, cbrMaxBitrate, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig.threads, audioFilters, videoFilter, sourceMeta),
                                );
                            }
                        }
                    }
                }

                if (mode === "CQ") {
                    for (const crf of customConfig.crfs) {
                        for (const videoFilter of videoFilters) {
                            ffmpegCommands.push(
                                getFirstPassString(colorspace, seekArgs, mode, crf, bitrate[0]!, null, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig.threads),
                                await getSecondPassString(colorspace, seekArgs, mode, crf, bitrate[0]!, null, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig.threads, audioFilters, videoFilter, sourceMeta),
                            );
                        }
                    }
                }
            }
        }

    }

    await writeFile(args.file, ffmpegCommands.join('\n'));
}

export { generate };

