import { checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";

import { checkEncodingTools } from "@/core/env";
import { validateAudioFormat, validateAudioLoudness } from "@/core/validation/audio";
import { validateMedia } from "@/core/validation/media";
import { getAudioFormat, getLoudnessStats, getWebmFormat } from "@/core/validation/specs";

async function validate(): Promise<void> {
    await checkEncodingTools();

    const workDir = process.cwd();

    const fileCandidates = (await fs.readdir(workDir)).filter((file) => file.endsWith(".webm"));

    if (fileCandidates.length === 0) {
        throw new Error("No WebM(s) candidates in current directory");
    }

    const files = await checkbox({
        message: "Select source files",
        choices: fileCandidates.map((file) => ({
            value: file,
            name: file,
        })),
    });

    for (const file of files) {
        const webmFormat = await getWebmFormat(file);
        const audioFormat = await getAudioFormat(file);
        const loudnessStats = await getLoudnessStats(file);

        const results = [
            validateMedia(webmFormat),
            await validateAudioFormat(audioFormat),
            await validateAudioLoudness(loudnessStats)
        ];

        console.log(chalk.white(`Results for ${file}:`));
        for (const result of results) {
            if (result.success) {
                continue;
            }

            for (const issue of result.issues) {
                const path = formatIssuePath(issue);
                const message = `${path}: ${issue.message}. Expected: ${issue.expected}. Got: ${issue.received}`;

                console.error(message);
            }
        }

        if (results.every(result => result.success)) {
            console.log(chalk.green("OK"));
        }
    }
}

function formatIssuePath(issue: { path?: Array<{ key?: unknown }> }): string {
    const path = issue.path
        ?.map(item => item.key)
        .filter(key => key !== undefined && key !== null)
        .map(String)
        .join(".");

    return path || "<root>";
}

export { validate };