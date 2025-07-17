import * as v from "valibot";
import { $ } from "bun";
import { type MediaAnalysis, MediaAnalysisSchema, type MediaStream } from "./schema.ts";

async function analyze(sourceFile: string): Promise<MediaAnalysis> {
    const result = await $`ffprobe -v quiet -print_format json -show_streams -show_format -show_chapters ${sourceFile}`.json();

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

export { analyze, streamToString };
