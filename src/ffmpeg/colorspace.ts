import type { MediaAnalysis } from "@/ffprobe/schema";

const colorspaces = {
    HD: {
        colorspace: "bt709",
        primaries: "bt709",
        transfer: "bt709",
    },
    NTSC: {
        colorspace: "smpte170m",
        primaries: "smpte170m",
        transfer: "smpte170m",
    },
    PAL: {
        colorspace: "bt470bg",
        primaries: "bt470bg",
        transfer: "gamma28",
    },
};

function buildArgs(colorspace: (typeof colorspaces)[keyof typeof colorspaces]): string {
    return `-colorspace ${colorspace.colorspace} -color_primaries ${colorspace.primaries} -color_trc ${colorspace.transfer}`;
}

function getColorspaceArgs(metaFile: MediaAnalysis): string {
    const stream = metaFile.streams.find(stream => stream.codec_type === "video");

    const sourceColorspace = stream?.color_space;
    const sourceColorPrimaries = stream?.color_primaries;
    const sourceColorTrc = stream?.color_transfer;

    // Method 1: Carry over color data from source if specified
    for (const colorspaceCandidate of Object.values(colorspaces)) {
        if (
            sourceColorspace === colorspaceCandidate.colorspace
            || sourceColorPrimaries === colorspaceCandidate.primaries
            || sourceColorTrc === colorspaceCandidate.transfer
        ) {
            return buildArgs(colorspaceCandidate);
        }
    }

    // Method 2: Infer color date from source file resolution
    const resolution = stream?.height ?? 0;

    if (resolution >= 720) {
        return buildArgs(colorspaces.HD);
    } else if (resolution >= 576) {
        return buildArgs(colorspaces.PAL);
    } else {
        return buildArgs(colorspaces.NTSC);
    }
}

export { getColorspaceArgs };