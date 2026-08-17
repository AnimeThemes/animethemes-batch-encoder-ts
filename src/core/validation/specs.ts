import { $ } from "bun";
import chalk from "chalk";

const formatArgs = [
    "ffprobe",
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    "-show_chapters",
];

export type UnknownRecord = Record<string, unknown>;

export type WebmFormat = UnknownRecord;
export type LoudnessStats = UnknownRecord;
export type AudioFormat = UnknownRecord;

// Source 1: WebM Streams/Formats
async function getWebmFormat(file: string): Promise<WebmFormat> {
    console.log(chalk.white(`Analyzing ${file}...`));

    return await $`${formatArgs} ${file}`.nothrow().json();
}

// Source 2: Extracted audio stream, needed for verifying audio bitrate
async function getAudioFormat(file: string): Promise<AudioFormat> {
    console.log(chalk.white("Retrieving extracted audio stream/format data..."));

    const oggFile = `${file}.ogg`;

    await $`ffmpeg -v quiet -i ${file} -vn -acodec copy -f ogg -y ${oggFile}`;

    const result = await $`${formatArgs} ${oggFile}`.nothrow().json();

    await Bun.file(oggFile).delete();

    return result;
}

// Source 3: Loudness stats
// Implementation: https://gist.github.com/SoThatsPrettyBrutal/85cbbfc42fea03c6954d08db28c2626b
async function getLoudnessStats(file: string): Promise<LoudnessStats> {
    console.log(chalk.white("Retrieving loudness data..."));

    const audioFilter = "loudnorm=I=-16:LRA=20:TP=-1:dual_mono=true:linear=true:print_format=json";
    const loudnessResult = await $`ffmpeg -i ${file} -hide_banner -nostats -vn -sn -dn -af ${audioFilter} -f null NUL`.quiet().nothrow();

    const stderr = Buffer.from(loudnessResult.stderr).toString("utf8");

    const match = stderr.match(/\{[^}]*\}/s);

    if (!match) {
        throw new Error("Could not find loudnorm JSON.");
    }

    return JSON.parse(match[0]);
}

export {
    getWebmFormat,
    getAudioFormat,
    getLoudnessStats,
};