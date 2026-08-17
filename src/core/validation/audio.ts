import * as v from "valibot";

import type { AudioFormat, LoudnessStats } from "@/core/validation/specs";

const ExpectedAudioFormatSchema = v.object({
    format: v.object({
        // If the source is a DVD or BD release with a source bitrate of >= 320 kbps,
        // the audio stream must use a bitrate of 320 kbps.
        // Otherwise, the audio stream must use a default bitrate of 192 kbps.
        // Note: libopus defaults to VBR mode so we will allow for variance
        bit_rate: v.pipe(
            v.string(),
            v.transform(Number),
            v.check(
                value =>
                    (167000 <= value && value <= 217000) ||
                    (295000 <= value && value <= 345000),
                "Unexpected audio bitrate"
            )
        ),
    }),
});

const ExpectedAudioLoudnessSchema = v.object({
    // Audio must be normalized as described by the AES Streaming Loudness Recommendation.
    input_i: v.pipe(
        v.string(),
        v.transform(Number),
        v.minValue(-16.25, "Unexpected target loudness."),
        v.maxValue(-15.75, "Unexpected target loudness."),
    ),
    // Audio must be normalized as described by the AES Streaming Loudness Recommendation.
    input_tp: v.pipe(
        v.string(),
        v.transform(Number),
        v.maxValue(-1, "Unexpected true peak"),
    )
});

async function validateAudioFormat(audioFormat: AudioFormat): Promise<v.SafeParseResult<typeof ExpectedAudioFormatSchema>> {
    return v.safeParse(ExpectedAudioFormatSchema, audioFormat);
}

async function validateAudioLoudness(loudnessStats: LoudnessStats): Promise<v.SafeParseResult<typeof ExpectedAudioLoudnessSchema>> {
    return v.safeParse(ExpectedAudioLoudnessSchema, loudnessStats);
}

export {
    validateAudioFormat,
    validateAudioLoudness,
}