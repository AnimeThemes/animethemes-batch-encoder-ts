import { $ } from "bun";
import chalk from "chalk";
import * as v from "valibot";

import { type MediaAnalysis, MediaAnalysisSchema, type MediaStream } from "@/core/ffprobe/schema";

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

export {
    analyze,
    streamToString,
};
