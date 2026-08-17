import type { Config } from "@/core/config/schema";
import { type BitrateModes,getAudioBitrateArgs, getBitrateModePass } from "@/core/ffmpeg/bitrateMode";
import { buildFilename } from "@/core/ffmpeg/filename";
import { getFileSizeLimitArg } from "@/core/ffmpeg/fileSizeLimit";
import { getKeyframeIntervalArg } from "@/core/ffmpeg/keyframe";
import type { VideoFilter } from "@/core/ffmpeg/videoFilter";
import type { MediaAnalysis } from "@/core/ffprobe/schema";

function getFirstPassString(
    colorspaceArgs: string,
    seek: string,
    mode: keyof BitrateModes,
    crf: number | null,
    bitrate: number | null,
    maxBitrate: number | null,
    filename: string,
    videoStreamArg: number,
    audioStreamArg: number,
    duration: number,
    config: Config,
): string {
    const firstPass = (() => {
        switch (mode) {
            case "VBR": {
                return getBitrateModePass("VBR").firstPass(crf!);
            }
            case "CBR": {
                return getBitrateModePass("CBR").firstPass(bitrate!, maxBitrate!);
            }
            case "CQ": {
                return getBitrateModePass("CQ").firstPass(crf!, bitrate!);
            }
            default:
                throw new Error("Invalid mode");
        }
    })();

    const commands: string[] = [];

    commands.push(`ffmpeg ${colorspaceArgs} ${seek} -pass 1 -passlogfile ${filename}`);
    commands.push(`-map 0:v:${videoStreamArg} -map 0:a:${audioStreamArg}`);
    commands.push(`-c:v libvpx-vp9 ${firstPass} -cpu-used 4 ${getKeyframeIntervalArg(duration)} -threads ${config.threads}`);
    commands.push(`-tile-columns 6 -frame-parallel 0 -auto-alt-ref 1 -lag-in-frames 25 -row-mt 1 -pix_fmt yuv420p -an -sn -f webm -y NUL`);

    return commands.filter(Boolean).join(" ");
}

async function getSecondPassString(
    colorspaceArgs: string,
    seek: string,
    mode: keyof BitrateModes,
    crf: number | null,
    bitrate: number | null,
    maxBitrate: number | null,
    filename: string,
    videoStreamArg: number,
    audioStreamArg: number,
    duration: number,
    audioFilters: string,
    videoFilter: VideoFilter,
    meta: MediaAnalysis,
    config: Config,
): Promise<string> {
    const secondPass = (() => {
        switch (mode) {
            case "VBR": {
                return getBitrateModePass("VBR").secondPass(crf!);
            }
            case "CBR": {
                return getBitrateModePass("CBR").secondPass(bitrate!, maxBitrate!);
            }
            case "CQ": {
                return getBitrateModePass("CQ").secondPass(crf!, bitrate!);
            }
            default:
                throw new Error("Invalid mode");
        }
    })();

    const commands: string[] = [];

    const finalFilename = buildFilename(filename, videoFilter, mode, crf, bitrate, maxBitrate);

    commands.push(`ffmpeg ${colorspaceArgs} ${seek} -pass 2 -passlogfile ${filename}`);
    commands.push(`-map 0:v:${videoStreamArg} -map 0:a:${audioStreamArg}`);
    commands.push(`-c:v libvpx-vp9 ${secondPass} -cpu-used 0 ${getKeyframeIntervalArg(duration)} -threads ${config.threads}`);
    commands.push(audioFilters);
    commands.push(`${getVideoFilterString(videoFilter)} -tile-columns 6`);
    commands.push(`-frame-parallel 0 -auto-alt-ref 1 -lag-in-frames 25 -row-mt 1 -pix_fmt yuv420p`);
    commands.push(getAudioBitrateArgs(meta));

    if (config.limitSizeEnable) {
        commands.push(await getFileSizeLimitArg(meta, duration, videoFilter));
    }

    commands.push(`-map_metadata:g -1 -map_metadata:s:v -1 -map_metadata:s:a -1 -map_chapters -1 -sn -f webm -y ${finalFilename}.webm`)

    return commands.filter(Boolean).join(" ");
}

function getVideoFilterString(videoFilter: VideoFilter): string {
    return videoFilter.filter
        ? `-vf ${videoFilter.filter}`
        : "";
}

export { getFirstPassString, getSecondPassString };