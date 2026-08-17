import * as v from "valibot";

const ConfigSchema = v.strictObject({
    allowedFileTypes: v.optional(v.array(v.string()), [".avi", ".m2ts", ".mkv", ".mp4", ".wmv"]),
    encodingModes: v.optional(v.array(v.string()), ["VBR", "CBR", "CQ"]),
    crfs: v.optional(v.array(v.number()), [12, 15, 18, 21, 24]),
    cbrBitrates: v.optional(v.array(v.number()), [5600]),
    cbrMaxBitrates: v.optional(v.array(v.number()), [6400]),
    threads: v.optional(v.pipe(v.number(), v.integer()), 4),
    limitSizeEnable: v.optional(v.boolean(), true),
    videoFilters: v.optional(v.record(v.string(), v.string()), {
        "": "",
        "720p": "scale=-1:720",
        "nuked-720p": "scale=-1:720,hqdn3d=0:0:3:3,gradfun,unsharp",
        "nuked": "hqdn3d=0:0:3:3,gradfun,unsharp",
        "lightdenoise": "hqdn3d=0:0:3:3",
        "heavydenoise": "hqdn3d=1.5:1.5:6:6",
        "unsharp": "unsharp"
    }),
});

type Config = v.InferOutput<typeof ConfigSchema>;

function parseConfig(config: Config): Config {
    return v.parse(ConfigSchema, config);
}

function getDefaultConfig(): v.InferDefaults<typeof ConfigSchema> & Config {
    return v.getDefaults(ConfigSchema);
}

export { parseConfig, getDefaultConfig, type Config };
