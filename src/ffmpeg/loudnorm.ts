import { $ } from "bun";
import { parseArgsStringToArgv } from "string-argv";
import * as v from "valibot";

import { getAudioResampling } from "@/ffmpeg/audioFilter";
import { type AudioStream, type NormalizationInput, NormalizationInputSchema } from "@/ffprobe/schema";

const firstPassFilter = "loudnorm=I=-16:LRA=20:TP=-1:dual_mono=true:linear=true:print_format=json";

async function getLoudnormInput(
    seek: string,
    audioStreamIndex: number,
    audioStream: AudioStream,
): Promise<NormalizationInput> {
    const filterChain = [
        getAudioResampling(audioStream),
        firstPassFilter,
    ]
        .filter(Boolean)
        .join(",");

    const seekArgsArgv = parseArgsStringToArgv(seek);
    const output = await $`ffmpeg ${seekArgsArgv} -map 0:a:${audioStreamIndex} -af ${filterChain} -vn -sn -dn -f null /dev/null 2>&1`
        .nothrow()
        .text();

    const match = output.match(/\{[\s\S]*?\}/);

    if (!match) {
        throw new Error(`Could not find loudnorm JSON output\n${output}`);
    }

    return v.parse(NormalizationInputSchema, JSON.parse(match[0]));
}

export { getLoudnormInput };