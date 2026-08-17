import { checkbox, input, number, select } from "@inquirer/prompts";
import chalk from "chalk";
import fs, { writeFile } from "node:fs/promises";

import { getOutputName } from "@/command/execute";
import type { Config } from "@/core/config/schema";
import { loadEnvironment } from "@/core/env";
import { fadeInFilter, fadeOutFilter, getAudioFiltersString, muteFilter } from "@/core/ffmpeg/audioFilter";
import { getCbrBitrate, getCbrMaxBitrate } from "@/core/ffmpeg/bitrateMode";
import { bitRateModes } from "@/core/ffmpeg/bitrateMode";
import { getColorspaceArgs } from "@/core/ffmpeg/colorspace";
import { isValidDuration, parseDuration } from "@/core/ffmpeg/duration";
import { getFirstPassString, getSecondPassString } from "@/core/ffmpeg/pass";
import { seek } from "@/core/ffmpeg/seek";
import { type VideoFilter, type VideoFilterPreset,videoFilterPresets } from "@/core/ffmpeg/videoFilter";
import { analyze, streamToString } from "@/core/ffprobe/analyze";
import type { AudioStream, VideoStream } from "@/core/ffprobe/schema";

type GenerateArgs = {
    file: string;
    configFile: string;
    split: boolean;
}

async function getVideoStream(videoStreams: VideoStream[]): Promise<VideoStream | undefined> {
    return videoStreams.length > 1
        ? await select({
            message: "Select video stream",
            choices: videoStreams
                .map((stream) => ({
                    value: stream,
                    name: streamToString(stream),
                })),
        })
        : videoStreams[0];
}

async function getAudioStream(audioStreams: AudioStream[]): Promise<AudioStream | undefined> {
    return audioStreams.length > 1
        ? await select({
            message: "Select audio stream",
            choices: audioStreams
                .map((stream) => ({
                    value: stream,
                    name: streamToString(stream),
                })),
        })
        : audioStreams[0];
}

function promptDuration(message: string, previous: string|null = null): Promise<string> {
    return input({
        message,
        validate: (value) => {
            if (! isValidDuration(value)) {
                return "Please enter a valid duration. See FFmpeg documentation for accepted formats: https://ffmpeg.org/ffmpeg-utils.html#time-duration-syntax";
            }

            if (previous && value.split(',').length !== previous.split(',').length) {
                return "Please enter the same amount of text splitted by a comma";
            }

            return true;
        }
    });
}

function output(ss: string): Promise<string> {
    return input({
        message: "Enter output file name",
        validate: (value) => value.split(',').length === ss.split(',').length || "Please enter the same amount of text splitted by a comma",
    });
}

type AudioFilterPrompt = {
    id: string;
    label: string;
    prompt: () => Promise<string>;
};

const audioFilterPrompts: AudioFilterPrompt[] = [
    {
        id: fadeInFilter.id,
        label: fadeInFilter.label,
        async prompt() {
            console.log(
                chalk.green(`Select the values for the ${fadeInFilter.label} filter`),
            );

            const duration = await number({
                message: "Duration",
                required: true,
                step: 0.001,
            });

            return fadeInFilter.serialize({ duration });
        },
    },
    {
        id: fadeOutFilter.id,
        label: fadeOutFilter.label,
        async prompt() {
            console.log(
                chalk.green(`Select the values for the ${fadeOutFilter.label} filter`),
            );

            const startTime = await number({
                message: "Start Time",
                required: true,
                step: 0.001,
            });

            const duration = await number({
                message: "Duration",
                required: true,
                step: 0.001,
            });

            return fadeOutFilter.serialize({
                startTime,
                duration,
            });
        },
    },
    {
        id: muteFilter.id,
        label: muteFilter.label,
        async prompt() {
            console.log(
                chalk.green(`Select the values for the ${muteFilter.label} filter`),
            );

            const startTime = await number({
                message: "Start Time",
                required: true,
                step: 0.001,
            });

            const endTime = await number({
                message: "End Time",
                required: true,
                step: 0.001,
            });

            return muteFilter.serialize({
                startTime,
                endTime,
            });
        },
    },
    {
        id: "custom",
        label: "Custom",
        async prompt() {
            return input({
                message: "Filter",
                required: true,
            });
        },
    },
];

export async function promptAudioFilters(): Promise<string> {
    const selectedFilters = await checkbox({
        message: "Select audio filters",
        choices: audioFilterPrompts.map((filter) => ({
            name: filter.label,
            value: filter,
        })),
        required: false,
    });

    const filters: string[] = [];

    for (const filter of selectedFilters) {
        filters.push(await filter.prompt());
    }

    return filters.join(",");
}

type VideoFilterChoice =
    | {
        type: "preset";
        preset: VideoFilterPreset;
    }
    | {
        type: "custom";
    };

export async function promptVideoFilters(config: Config): Promise<VideoFilter[]> {
    const configFilters = Object.keys(config.videoFilters);

    const selected = await checkbox<VideoFilterChoice>({
        message: "Select video filters",
        choices: [
            ...videoFilterPresets.map((preset) => ({
                name: preset.label,
                value: {
                    type: "preset" as const,
                    preset,
                },
                checked: configFilters.includes(preset.filename),
            })),
            {
                name: "Custom",
                value: {
                    type: "custom" as const,
                },
            },
        ],
        required: false,
    });

    const results: VideoFilter[] = [];

    for (const selectedFilter of selected) {
        if (selectedFilter.type === "preset") {
            results.push({
                filter: selectedFilter.preset.filter,
                filename: selectedFilter.preset.filename
            });

            continue;
        }

        const filter = await input({
            message: "Custom video filter",
            required: true,
        });

        const filename = await input({
            message: "Filename suffix",
            required: true,
        });

        results.push({
            filter: filter,
            filename: filename
        });
    }

    return results;
}

async function promptCustomQuestions(config: Config): Promise<Config> {
    const newConfig = {...config};

    newConfig.encodingModes = await checkbox({
        message: "Select Encoding Modes",
        choices: Object.keys(bitRateModes).map(mode => ({
            value: mode,
            name: mode,
            checked: config.encodingModes.includes(mode),
        })),
    });

    if (newConfig.encodingModes.includes("VBR") || newConfig.encodingModes.includes("CQ")) {
        const crfs = await input({
            message: "CRF Value (0-63, lower is better quality)",
            default: config.crfs.join(","),
            validate: (value) => value.split(",").every(v => /^-?\d+$/.test(v.trim())),
        });

        newConfig.crfs = crfs.split(",").map(Number);
    }

    if (newConfig.encodingModes.includes("CBR") || newConfig.encodingModes.includes("CQ")) {
        const bitrate = await input({
            message: "Bitrate Value",
            default: config.cbrBitrates.join(","),
            validate: (value) => value.split(",").every(v => /^-?\d+$/.test(v.trim())),
        });

        newConfig.cbrBitrates = bitrate.split(",").map(Number);

        if (newConfig.encodingModes.includes("CBR")) {
            const maxBitrate = await input({
                message: "Max Bitrate Value",
                default: config.cbrMaxBitrates.join(","),
                validate: (value) => value.split(",").every(v => /^-?\d+$/.test(v.trim())),
            });

            newConfig.cbrMaxBitrates = maxBitrate.split(",").map(Number);
        }
    }

    return newConfig;
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
                                getFirstPassString(colorspace, seekArgs, mode, crf, null, null, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig),
                                await getSecondPassString(colorspace, seekArgs, mode, crf, null, null, outputFile, videoStreamIndex, audioStreamIndex, duration, audioFilters, videoFilter, sourceMeta, customConfig),
                            );
                        }
                    }
                }

                if (mode === "CBR") {
                    for (const cbrBitrate of bitrate) {
                        for (const cbrMaxBitrate of maxBitrate) {
                            for (const videoFilter of videoFilters) {
                                ffmpegCommands.push(
                                    getFirstPassString(colorspace, seekArgs, mode, null, cbrBitrate, cbrMaxBitrate, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig),
                                    await getSecondPassString(colorspace, seekArgs, mode, null, cbrBitrate, cbrMaxBitrate, outputFile, videoStreamIndex, audioStreamIndex, duration, audioFilters, videoFilter, sourceMeta, customConfig),
                                );
                            }
                        }
                    }
                }

                if (mode === "CQ") {
                    for (const crf of customConfig.crfs) {
                        for (const videoFilter of videoFilters) {
                            ffmpegCommands.push(
                                getFirstPassString(colorspace, seekArgs, mode, crf, bitrate[0]!, null, outputFile, videoStreamIndex, audioStreamIndex, duration, customConfig),
                                await getSecondPassString(colorspace, seekArgs, mode, crf, bitrate[0]!, null, outputFile, videoStreamIndex, audioStreamIndex, duration, audioFilters, videoFilter, sourceMeta, customConfig),
                            );
                        }
                    }
                }
            }
        }
    }

    if (args.split) {
        for (let index = 0; index < ffmpegCommands.length; index += 2) {
            const jobCommands = ffmpegCommands.slice(index, index + 2);

            await writeFile(getOutputName(jobCommands[1]!).replace(".webm", ".txt"), jobCommands.join('\n'));
        }
    } else {
        await writeFile(args.file, ffmpegCommands.join('\n'));
    }
}

export { generate };

