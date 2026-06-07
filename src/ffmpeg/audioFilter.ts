import { checkbox, input, number } from "@inquirer/prompts";
import chalk from "chalk";

import { getLoudnormInput } from "@/ffmpeg/loudnorm";
import type { AudioStream } from "@/ffprobe/schema";

interface AudioFilterConfig<T> {
    label: string;
    prompt: () => Promise<T>;
    toString: (options: T) => string;
}

interface AudioFilter {
    label: string;
    promptToString: () => Promise<string>;
}

function createAudioFilter<T>(config: AudioFilterConfig<T>): AudioFilter {
    return {
        label: config.label,
        promptToString: async () => {
            console.log(chalk.green(`Select the values for the ${config.label} filter`));
            const options = await config.prompt();

            return config.toString(options);
        },
    };
}

const audioFilters = [
    createAudioFilter({
        label: "Fade In",
        prompt: async () => ({
            duration: await number({ message: "Duration", required: true, step: 0.001 }),
        }),
        toString: (options) => `afade=d=${options.duration}:curve=exp`,
    }),
    createAudioFilter({
        label: "Fade Out",
        prompt: async () => ({
            startTime: await number({ message: "Start Time", required: true, step: 0.001 }),
            duration: await number({ message: "Duration", required: true, step: 0.001 }),
        }),
        toString: (options) => `afade=t=out:st=${options.startTime}:d=${options.duration}`,
    }),
    createAudioFilter({
        label: "Mute",
        prompt: async () => ({
            startTime: await number({ message: "Start Time", required: true, step: 0.001 }),
            endTime: await number({ message: "End Time", required: true, step: 0.001 }),
        }),
        toString: (options) => `volume=enable='between(t,${options.startTime},${options.endTime})':volume=0`,
    }),
    createAudioFilter({
        label: "Custom",
        prompt: async () => ({
            text: await input({ message: "Filter", required: true }),
        }),
        toString: (options) => options.text,
    }),
] satisfies Array<AudioFilter>;

// If our source file audio stream is not a 2-channel stereo layout, we need to resample it before normalization
function getAudioResampling(audioStream: AudioStream): string {
    const channels = audioStream.channels ?? 2;
    const channelLayout = audioStream.channel_layout ?? "stereo";

    return channels !== 2 || channelLayout !== "stereo"
        ? "aresample=ochl=stereo"
        : "";
}

async function promptAudioFilters() {
    const appliedFilters: Record<string, string> = {};

    const selectedFilters = await checkbox({
        message: "Select audio filters",
        choices: audioFilters.map(filter => ({
            name: filter.label,
            value: filter,
        })),
        required: false,
    });

    for (const filter of selectedFilters) {
        appliedFilters[filter.label] = await filter.promptToString();
    }

    return Object.values(appliedFilters).join(",");
}

// Build audio filtergraph for encodes
async function getAudioFiltersString(seek: string, audioStreamIndex: number, audioStream: AudioStream, customFilters: string): Promise<string> {
    const filters: string[] = [];
    const normalizationFilter: string[] = [];

    const input = await getLoudnormInput(seek, audioStreamIndex, audioStream);

    normalizationFilter.push("loudnorm=I=-16:LRA=20:TP=-1:dual_mono=true:linear=true:");
    normalizationFilter.push(`measured_I=${input.input_i}:`);
    normalizationFilter.push(`measured_LRA=${input.input_lra}:`);
    normalizationFilter.push(`measured_TP=${input.input_tp}:`);
    normalizationFilter.push(`measured_thresh=${input.input_thresh}:`);
    normalizationFilter.push(`offset=${input.target_offset}`);

    filters.push(getAudioResampling(audioStream));
    filters.push(normalizationFilter.join(""));
    filters.push(customFilters);

    return `-af ${filters.filter(Boolean).join(",")}`;
}

export { audioFilters, promptAudioFilters, getAudioResampling, getAudioFiltersString };
