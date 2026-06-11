import * as v from "valibot";

const NormalizationInputSchema = v.object({
    input_i: v.string(),
    input_lra: v.string(),
    input_tp: v.string(),
    input_thresh: v.string(),
    target_offset: v.string(),
});

const StreamSchema = v.looseObject({
    index: v.pipe(v.number(), v.integer()),
    codec_type: v.string(),
});

const VideoStreamSchema = v.object({
    ...StreamSchema.entries,
    codec_type: v.literal("video"),
    codec_name: v.string(),
    profile: v.string(),
    width: v.number(),
    height: v.number(),
    pix_fmt: v.string(),
    color_primaries: v.optional(v.string()),
    color_range: v.optional(v.string()),
    color_space: v.optional(v.string()),
    color_transfer: v.optional(v.string()),
});

const AudioStreamSchema = v.object({
    ...StreamSchema.entries,
    codec_type: v.literal("audio"),
    codec_name: v.string(),
    channels: v.number(),
    channel_layout: v.string(),
    sample_rate: v.string(),
});

const MediaStreamSchema = v.variant("codec_type", [VideoStreamSchema, AudioStreamSchema]);

const MediaAnalysisSchema = v.object({
    format: v.object({
        duration: v.string(),
        bit_rate: v.string(),
    }),
    streams: v.pipe(
        v.array(StreamSchema),
        v.filterItems((item) => ["video", "audio"].includes(item.codec_type)),
        v.array(MediaStreamSchema),
    ),
});

type NormalizationInput = v.InferOutput<typeof NormalizationInputSchema>;
type AudioStream = v.InferOutput<typeof AudioStreamSchema>;
type VideoStream = v.InferOutput<typeof VideoStreamSchema>
type MediaStream = v.InferOutput<typeof MediaStreamSchema>;
type MediaAnalysis = v.InferOutput<typeof MediaAnalysisSchema>;

export {
    type AudioStream,
    type MediaAnalysis,
    type MediaStream,
    type NormalizationInput,
    type VideoStream,
    MediaAnalysisSchema,
    NormalizationInputSchema,
};
