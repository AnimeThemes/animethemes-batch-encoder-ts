import * as v from "valibot";

const ConfigSchema = v.strictObject({
    allowedFileTypes: v.optional(v.string(), ".avi,.m2ts,.mkv,.mp4,.wmv"),
    encodingModes: v.optional(v.string(), "VBR,CBR"),
    crfs: v.optional(v.string(), "12,15,18,21,24"),
    cbrBitrates: v.optional(v.string(), "5600"),
    cbrMaxBitrates: v.optional(v.string(), "6400"),
    threads: v.optional(v.pipe(v.number(), v.integer()), 4),
    limitSizeEnable: v.optional(v.boolean(), true),
    alternateSourceFiles: v.optional(v.boolean(), false),
    createPreview: v.optional(v.boolean(), false),
    includeUnfiltered: v.optional(v.boolean(), true),
    videoFilters: v.optional(v.record(v.string(), v.string()), {
        nuked: "hqdn3d=0:0:3:3,gradfun,unsharp",
        lightdenoise: "hqdn3d=0:0:3:3",
        heavydenoise: "hqdn3d=1.5:1.5:6:6",
        unsharp: "unsharp",
    }),
    defaultVideoStream: v.optional(v.string()),
    defaultAudioStream: v.optional(v.string()),
});

type Config = v.InferOutput<typeof ConfigSchema>;

function parseConfig(config: any): Config {
    return v.parse(ConfigSchema, config);
}

function getDefaultConfig(): Config {
    return v.getDefaults(ConfigSchema);
}

export { parseConfig, getDefaultConfig, type Config };
