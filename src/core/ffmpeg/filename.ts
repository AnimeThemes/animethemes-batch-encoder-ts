import type { BitrateModes } from "@/core/ffmpeg/bitrateMode";
import type { VideoFilter } from "@/core/ffmpeg/videoFilter";

// Build unique WebM filename for encodes
function buildFilename(
    outputname: string,
    videoFilter: VideoFilter,
    mode: keyof BitrateModes,
    crf: number | null,
    bitrate: number | null,
    maxBitrate: number | null,
): string {
    if ((mode === "VBR" || mode === "CQ") && crf) {
        outputname += `-${crf}`;
    }

    if (mode === "CBR" && bitrate) {
        outputname += `-${bitrate}`;
    }

    if (mode === "CBR" && maxBitrate) {
        outputname += `-${maxBitrate}`;
    }

    if (videoFilter.filename) {
        outputname += `-${videoFilter.filename}`;
    }

    return outputname;
}

export { buildFilename };