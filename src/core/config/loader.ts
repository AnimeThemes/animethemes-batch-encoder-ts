import type { BunFile } from "bun";
import { mkdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as v from "valibot";

import { type Config, getDefaultConfig, parseConfig } from "./schema.ts";

async function loadConfig(workDir: string, configFilename: string): Promise<Config> {
    const [localConfig, globalConfig] = await Promise.all([
        getLocalConfigFile(workDir, configFilename).then((file) => file && loadConfigFromFile(file)),
        getGlobalConfigFile(configFilename).then((file) => file && loadConfigFromFile(file)),
    ]);

    const config = [localConfig, globalConfig].find((config) => config !== null);

    return config!;
}

async function getLocalConfigFile(workDir: string, configFilename: string): Promise<BunFile | null> {
    const configPath = path.join(workDir, configFilename);
    const configFile = Bun.file(configPath);

    if (await configFile.exists()) {
        return configFile;
    }

    return null;
}

async function getGlobalConfigFile(configFilename: string): Promise<BunFile> {
    const configDir = `${os.homedir()}/.config/batch-encoder`;
    const defaultConfigFile = Bun.file(`${configDir}/config.json`);

    // Create default config file on first use.
    if (!(await defaultConfigFile.exists())) {
        await mkdir(configDir, { recursive: true });
        await Bun.write(defaultConfigFile, JSON.stringify(getDefaultConfig(), null, 4));
    }

    const configFile = Bun.file(`${configDir}/${configFilename}`);

    return await configFile.exists()
        ? configFile
        : defaultConfigFile;
}

async function loadConfigFromFile(file: BunFile): Promise<Config> {
    try {
        const configJson = await file.json();

        return parseConfig(configJson);
    } catch (error) {
        if (error instanceof v.ValiError) {
            console.error(`Invalid config file: ${file.name}`);
            console.error(v.summarize(error.issues));
        } else {
            console.error(`Could not load config file: ${file.name}`);
        }

        throw error;
    }
}

export { loadConfig };
