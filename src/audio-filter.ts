import { input, number } from "@inquirer/prompts";

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
            const options = await config.prompt();

            return config.toString(options);
        },
    };
}

const audioFilters = [
    createAudioFilter({
        label: "Fade In",
        prompt: async () => ({
            exponential: await number({ message: "Exponential Time", required: true }),
        }),
        toString: (options) => `afade=d=${options.exponential}:curve=exp`,
    }),
    createAudioFilter({
        label: "Fade Out",
        prompt: async () => ({
            startTime: await number({ message: "Start Time", required: true }),
            exponential: await number({ message: "Exponential Time", required: true }),
        }),
        toString: (options) => `afade=t=out:st=${options.startTime}:d=${options.exponential}`,
    }),
    createAudioFilter({
        label: "Mute",
        prompt: async () => ({
            startTime: await number({ message: "Start Time", default: 0 }),
            endTime: await number({ message: "End Time", required: true }),
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

export { audioFilters };
