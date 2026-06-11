import { input } from "@inquirer/prompts";

function seekTime(ss?: string, to?: string): string {
    if (ss === undefined) {
        return `-to ${to}`;
    } else if (to === undefined) {
        return `-ss ${ss}`;
    } else {
        return `-ss ${ss} -to ${to}`;
    }
}

function seek(ss: string, to: string, sourceFile: string): string {
    if (sourceFile.endsWith(".m2ts")) {
        return `-i "${sourceFile}" ${seekTime(ss, to)}`;
    }

    return `${seekTime(ss, to)} -i "${sourceFile}"`;
}

function output(ss: string): Promise<string> {
    return input({
        message: "Enter output file name",
        validate: (value) => value.split(',').length === ss.split(',').length || "Please enter the same amount of text splitted by a comma",
    });
}

export { seek, output };
