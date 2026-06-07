import { bitRateModes } from "@/ffmpeg/bitrateMode";
import type { Config } from "@/config/schema";
import { checkbox, confirm, input } from "@inquirer/prompts";

async function promptCustomQuestions(config: Config): Promise<Config> {
    const newConfig = {...config};

    newConfig.limitSizeEnable = await confirm({
        message: "Limit Size Enable?",
        default: config.limitSizeEnable,
    });

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

export { promptCustomQuestions };