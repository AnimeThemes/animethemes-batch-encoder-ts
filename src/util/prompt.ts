import * as prompts from "@inquirer/prompts";
import { isValidDuration } from "@/ffmpeg/duration";

// Inquirer is not exporting the type, so we have to get it from the function.
type InputConfig = Parameters<typeof prompts.input>[0];

function duration(config: InputConfig) {
    return prompts.input({
        ...config,
        validate: (value) => {
            if (!isValidDuration(value)) {
                return "Please enter a valid duration. See FFmpeg documentation for accepted formats: https://ffmpeg.org/ffmpeg-utils.html#time-duration-syntax";
            }

            if (config.validate) {
                return config.validate(value);
            }

            return true;
        },
    });
}

export { duration };
