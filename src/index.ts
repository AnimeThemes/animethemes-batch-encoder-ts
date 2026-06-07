import { select } from "@inquirer/prompts";
import { Command } from "commander";
import * as v from "valibot";

import { execute } from "@/command/execute";
import { generate } from "@/command/generate.ts";
import { ensureInstalled, update, VERSION } from "@/system";

if (process.env.NODE_ENV !== "development" && await ensureInstalled()) {
    process.exit(0);
}

const program = new Command();

program
    .name("batch-encoder")
    .version(VERSION)
    .description("Generate/Execute FFmpeg commands for files in acting directory")
    .action(withErrorHandling(selectMode));

program
    .option("--config-file <file>", "Name of config file", "config.json")
    .option("-f, --file <file>", "Name of file commands are written to", "commands.txt");

program
    .command("generate")
    .alias("g")
    .description("Generate commands and write to file")
    .action((args) => withErrorHandling(() => generate({...args, ...program.opts()}))());

program
    .command("execute")
    .alias("e")
    .description("Execute commands")
    .action((args) => withErrorHandling(() => execute({...args, ...program.opts()}))());

program
    .command("update")
    .description("Update the CLI to the latest version")
    .action(async () => {
        await update();
    });

await program.parseAsync();

function withErrorHandling(action: () => Promise<void>) {
    return async () => {
        try {
            await action();
        } catch (error) {
            if (error instanceof v.ValiError) {
                console.error(v.summarize(error.issues));
                return;
            }

            if (error instanceof Error) {
                console.error(error.message);
                return;
            }

            throw error;
        }
    };
}

async function selectMode() {
    const runMode = await select({
        message: "Select mode",
        choices: [
            {
                name: "Generate commands",
                value: generate,
            },
            {
                name: "Execute commands",
                value: execute,
            },
        ],
    });

    await runMode(program.opts());
}
