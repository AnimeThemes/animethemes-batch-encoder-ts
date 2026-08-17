import { semver } from "bun";
import * as v from "valibot";

import type { WebmFormat } from "./specs";

const ExpectedStreamSchema = v.looseObject({
    index: v.pipe(v.number(), v.integer()),
    codec_type: v.string(),
    tags: v.object({
        ENCODER: v.string("Extraneous source file metadata"),
        DURATION: v.string("Extraneous source file metadata"),
    }),
});

const ExpectedAudioStreamSchema = v.object({
    ...ExpectedStreamSchema.entries,
    codec_type: v.literal("audio"),
    // Audio must use the Opus format.
    codec_name: v.literal("opus", "Incorrect codec name. Expected: opus."),
    // Audio must use a two channel stereo mix.
    channels: v.pipe(
        v.number(),
        v.literal(2, "Expected 2 audio channels.")
    ),
    // Audio must use a two channel stereo mix.
    channel_layout: v.literal("stereo", "Incorrect audio layout"),
    // Audio must use a sampling rate of 48k.
    sample_rate: v.pipe(
        v.string(),
        v.transform(Number),
        v.minValue(48000, "Expected sample rate to be at least 48000.")
    ),
});

const acceptedColorSpaces = ["bt709", "smpte170m", "bt470bg"];

const ExpectedVideoStreamSchema = v.object({
    ...ExpectedStreamSchema.entries,
    codec_type: v.literal("video"),
    // Videos must use the VP9 video codec.
    codec_name: v.literal("vp9", "Incorrect video codec"),
    // Videos must use the yuv420p pixel format.
    pix_fmt: v.literal("yuv420p", "Incorrect pixel format"),
    // Videos must identify colorspace
    color_space: v.picklist(acceptedColorSpaces, "Unexpected color_space"),
    color_transfer: v.picklist(acceptedColorSpaces, "Unexpected color_transfer"),
    color_primaries: v.picklist(acceptedColorSpaces, "Unexpected color_primaries"),
    height: v.pipe(
        v.number(),
        v.check(value => Number.isFinite(value), "Invalid video height")
    ),
    // Videos must be encoded at the same framerate as the source file.
    // Motion interpolated videos (60FPS converted) are not allowed.
    avg_frame_rate: v.picklist([
        "24000/1001",
        "2997/125",
        "23976/1000",
        "24/1",
        "30000/1001",
        "19001/634",
        "1990/83",
        "2997/100",
        "30/1",
    ], "Unexpected framerate"),
});

const ExpectedMediaStreamSchema = v.variant("codec_type", [ExpectedVideoStreamSchema, ExpectedAudioStreamSchema]);

const ExpectedMediaSchema = v.pipe(
    v.object({
        streams: v.pipe(
            v.array(ExpectedStreamSchema),
            // There exists 1 video stream and 1 audio stream
            v.length(2, ""),
            v.filterItems((item) => ["video", "audio"].includes(item.codec_type)),
            v.array(ExpectedMediaStreamSchema)
        ),
        format: v.object({
            tags: v.object({
                ENCODER: v.pipe(
                    v.string("Extraneous source file metadata"),
                    // Files must use FFmpeg.
                    v.startsWith("Lavf", "Incorrect Encoder"),
                    // Files must use at least this FFmpeg version.
                    v.check(value => semver.order(value.replace(/^Lavf/, ""), "61.7.100") >= 0, "Build is out of date")
                ),
            }),
            // Files must use the WebM container.
            format_name: v.literal("matroska,webm", "Incorrect file format"),
            bit_rate: v.pipe(
                v.string(),
                v.transform(Number),
                v.check(value => Number.isFinite(value), "Invalid bit_rate")
            ),
        }),
        // Files must erase source menu data using -map_chapters -1.
        chapters: v.pipe(
            v.array(v.unknown()),
            v.empty("Extraneous menu data"),
        ),
    }),
    // Test if the file size violates an approximation of the restrictions.
    v.check(media => {
        const videoStream = media.streams.find((stream): stream is v.InferOutput<typeof ExpectedVideoStreamSchema> => stream.codec_type === "video")!;

        return media.format.bit_rate < videoStream.height * 5000 + 683300;
    }, "File size restriction violated")
);

function validateMedia(webmFormat: WebmFormat): v.SafeParseResult<typeof ExpectedMediaSchema> {
    return v.safeParse(ExpectedMediaSchema, webmFormat);
}

export { validateMedia };