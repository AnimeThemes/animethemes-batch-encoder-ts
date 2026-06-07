import type { Config } from "@/config/schema";
import { checkbox, input } from "@inquirer/prompts";

type VideoFilter = {
    label: string;
    filename: string;
    toString: () => Promise<string>;
}

type VideoFilterConfig<T> =
    | 
    {
        label: string;
        filename: string;
        prompt: () => Promise<T>;
        toString: (result: T) => string;
    } 
    | 
    {
        label: string;
        filename: string;
        prompt?: undefined;
        toString: string;
    };

function createVideoFilter<T>(config: VideoFilterConfig<T>): VideoFilter {
    return {
        label: config.label,
        filename: config.filename,
        toString: async () => {
            if (config.prompt) {
                const result = await config.prompt();
                return config.toString(result);
            }

            return config.toString;
        }
    }
}

const videoFilters = [
    createVideoFilter({
        label: "None",
        toString: "",
        filename: "",
    }),
    createVideoFilter({
        label: "scale=-1:720",
        toString: "scale=-1:720",
        filename: "720p",
    }),
    createVideoFilter({
        label: "scale=-1:720,hqdn3d=0:0:3:3,gradfun,unsharp",
        toString: "scale=-1:720,hqdn3d=0:0:3:3,gradfun,unsharp",
        filename: "nuked-720p",
    }),
    createVideoFilter({
        label: "hqdn3d=0:0:3:3,gradfun,unsharp",
        toString: "hqdn3d=0:0:3:3,gradfun,unsharp",
        filename: "nuked",
    }),
    createVideoFilter({
        label: "hqdn3d=0:0:3:3",
        toString: "hqdn3d=0:0:3:3",
        filename: "lightdenoise",
    }),
    createVideoFilter({
        label: "hqdn3d=1.5:1.5:6:6",
        toString: "hqdn3d=1.5:1.5:6:6",
        filename: "heavydenoise",
    }),
    createVideoFilter({
        label: "unsharp",
        toString: "unsharp",
        filename: "unsharp",
    }),
    createVideoFilter({
        label: "Custom",
        prompt: async () => ({
            text: await input({ message: "Filter", required: true })
        }),
        toString: (result) => result.text,
        filename: "custom",
    }),
] satisfies Array<VideoFilter>;

async function promptVideoFilters(config: Config): Promise<VideoFilter[]> {
    const selectedFilters = await checkbox({
        message: "Select video filters",
        choices: videoFilters.map(filter => ({
            name: filter.label,
            value: filter,
            checked: Object.keys(config.videoFilters).includes(filter.filename)
        })),
        required: true,
        
    });

    return selectedFilters;
}

export { type VideoFilter, promptVideoFilters };