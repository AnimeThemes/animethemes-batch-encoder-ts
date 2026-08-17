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

export { seek };
