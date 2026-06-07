import * as v from "valibot";
import { $ } from "bun";
import { type AudioStream, type MediaAnalysis, MediaAnalysisSchema, type MediaStream, type VideoStream } from "./schema.ts";
import chalk from "chalk";
import { select } from "@inquirer/prompts";

async function analyze(sourceFile: string): Promise<MediaAnalysis> {
    console.log(chalk.white(`Analyzing ${sourceFile}...`));

    const result = await $`ffprobe -v quiet -print_format json -show_streams -show_format ${sourceFile}`.json();

    return v.parse(MediaAnalysisSchema, result);
}

function streamToString(stream: MediaStream): string {
    switch (stream.codec_type) {
        case "video":
            return `${stream.codec_name} (${stream.profile}), ${stream.pix_fmt} (${stream.color_range}, ${stream.color_space}), ${stream.width}x${stream.height}`;
        case "audio":
            return `${stream.codec_name} (${stream.channels} channels, ${stream.sample_rate} Hz)`;
    }
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

export {
    analyze,
    getAudioStream,
    getVideoStream,
};
