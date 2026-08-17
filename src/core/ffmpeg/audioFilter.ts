import { getLoudnormInput } from "@/core/ffmpeg/loudnorm";
import type { AudioStream } from "@/core/ffprobe/schema";

export type FadeInOptions = {
    duration: number;
};

export type FadeOutOptions = {
    startTime: number;
    duration: number;
};

export type MuteOptions = {
    startTime: number;
    endTime: number;
};

export type AudioFilterDefinition<T> = {
    id: string;
    label: string;
    serialize: (options: T) => string;
};

export const fadeInFilter: AudioFilterDefinition<FadeInOptions> = {
    id: "fade-in",
    label: "Fade In",
    serialize: ({ duration }) =>
        `afade=d=${duration}:curve=exp`,
};

export const fadeOutFilter: AudioFilterDefinition<FadeOutOptions> = {
    id: "fade-out",
    label: "Fade Out",
    serialize: ({ startTime, duration }) =>
        `afade=t=out:st=${startTime}:d=${duration}`,
};

export const muteFilter: AudioFilterDefinition<MuteOptions> = {
    id: "mute",
    label: "Mute",
    serialize: ({ startTime, endTime }) =>
        `volume=enable='between(t,${startTime},${endTime})':volume=0`,
};

// If our source file audio stream is not a 2-channel stereo layout, we need to resample it before normalization
function getAudioResampling(audioStream: AudioStream): string {
    const channels = audioStream.channels ?? 2;
    const channelLayout = audioStream.channel_layout ?? "stereo";

    return channels !== 2 || channelLayout !== "stereo"
        ? "aresample=ochl=stereo"
        : "";
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

export { getAudioResampling, getAudioFiltersString };
