import type { VideoFilter } from "@/core/ffmpeg/videoFilter";
import type { MediaAnalysis } from "@/core/ffprobe/schema";

async function getFileSizeLimitArg(meta: MediaAnalysis, duration: number, videoFilter: VideoFilter): Promise<string> {
    let resolution: number = meta.streams.find(stream => stream.codec_type === "video")?.height ?? 0;

    for (const videoFilterString of (videoFilter.filter).split(",")) {
        if (videoFilterString.includes('scale=-1:')) {
            resolution = parseInt(videoFilterString.split(':')[1]!);
            break;
        }
    }

    const limit = ((resolution * 6500 + 475000) * duration) / 8;

    return `-fs ${Math.round(limit).toString()}`;
}

export { getFileSizeLimitArg };