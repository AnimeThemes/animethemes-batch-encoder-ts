import { input } from "@inquirer/prompts";

const timeCodeFormat = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)/;
const valueFormat = /(\d+(?:\.\d+)?)(s|ms|us)?/;

function parseDuration(duration: string): number {
    const timeCodeMatches = duration.match(timeCodeFormat);

    if (timeCodeMatches) {
        const [, hoursMatch, minutesMatch, secondsMatch] = timeCodeMatches;
        const hours = hoursMatch ? parseInt(hoursMatch) : 0;
        const minutes = minutesMatch ? parseInt(minutesMatch) : 0;
        const seconds = secondsMatch ? parseFloat(secondsMatch) : 0;

        return hours * 3600 + minutes * 60 + seconds;
    }

    const valueMatches = duration.match(valueFormat);

    if (valueMatches) {
        const [, valueMatch, unit = "s"] = valueMatches;
        const value = valueMatch ? parseFloat(valueMatch) : 0;

        switch (unit) {
            case "s":
                return value;
            case "ms":
                return value / 1000;
            case "us":
                return value / 1000000;
        }
    }

    throw new Error(`Invalid duration: ${duration}`);
}

function isValidDuration(duration: string): boolean {
    return duration.split(",")
        .every(value => value.match(timeCodeFormat) !== null || value.match(valueFormat) !== null)
}

function promptDuration(message: string, previous: string|null = null): Promise<string> {
    return input({
        message,
        validate: (value) => {
            if (! isValidDuration(value)) {
                return "Please enter a valid duration. See FFmpeg documentation for accepted formats: https://ffmpeg.org/ffmpeg-utils.html#time-duration-syntax";
            }

            if (previous && value.split(',').length !== previous.split(',').length) {
                return "Please enter the same amount of text splitted by a comma";
            }

            return true;
        }
    });
}

export { parseDuration, promptDuration };
