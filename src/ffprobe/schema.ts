import * as v from "valibot";

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
    color_range: v.string(),
    color_space: v.string(),
    color_transfer: v.string(),
    color_primaries: v.string(),
    avg_frame_rate: v.string(),
});

const AudioStreamSchema = v.object({
    ...StreamSchema.entries,
    codec_type: v.literal("audio"),
    codec_name: v.string(),
    channels: v.number(),
    channel_layout: v.string(),
    sample_rate: v.string(),
});

// The output file chapters must be empty to pass tests,
// but we don't care about its attributes.
const ChaptersSchema = v.array(v.any());

const FormatSchema = v.object({
    format_name: v.string(),
    bit_rate: v.string(),
});

const MediaStreamSchema = v.variant("codec_type", [VideoStreamSchema, AudioStreamSchema]);

type MediaStream = v.InferOutput<typeof MediaStreamSchema>;
type MediaChapters = v.InferOutput<typeof ChaptersSchema>;
type MediaFormat = v.InferOutput<typeof FormatSchema>;

const MediaAnalysisSchema = v.object({
    streams: v.pipe(
        v.array(StreamSchema),
        v.filterItems((item) => ["video", "audio"].includes(item.codec_type)),
        v.array(MediaStreamSchema),
    ),
    chapters: ChaptersSchema,
    format: FormatSchema,
});

type MediaAnalysis = v.InferOutput<typeof MediaAnalysisSchema>;

export { type MediaAnalysis, type MediaStream, type MediaChapters, type MediaFormat, MediaAnalysisSchema };
