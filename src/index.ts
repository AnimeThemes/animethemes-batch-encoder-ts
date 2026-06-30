import { select } from "@inquirer/prompts";
import { Command } from "commander";
import * as v from "valibot";

import { execute } from "@/command/execute";
import { generate } from "@/command/generate.ts";
import { install } from "@/command/install";
import { update, VERSION } from "@/command/update";
import { validate } from "@/command/validate";

const program = new Command();

program
    .name("batch-encoder")
    .version(VERSION)
    .description("Generate/Execute FFmpeg commands for files in acting directory")
    .action(withErrorHandling(selectMode));

program
    .option("--config-file <file>", "Name of config file", "config.json")
    .option("-f, --file <file>", "Name of file commands are written to", "commands.txt")
    .option("--split", "If you want to split each output on its own file", false);

program
    .command("generate")
    .alias("g")
    .description("Generate commands and write to file")
    .action((args) => withErrorHandling(() => generate({ ...args, ...program.opts() }))());

program
    .command("execute")
    .alias("e")
    .description("Execute commands")
    .action(() => withErrorHandling(() => execute())());

program
    .command("validate")
    .description("Verify WebM(s) Against AnimeThemes Encoding Standards")
    .action(() => withErrorHandling(() => validate())());

program
    .command("install")
    .description("Install the script globally")
    .action(async () => await install());

program
    .command("update")
    .description("Update the CLI to the latest version")
    .action(async () => await update());

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
                description: "Generates commands from input files in the current directory. The user will be prompted for values that are not determined programmatically, such as inclusion/exclusion of a source file candidate, start time, end time, output file name and new audio filters.",
                value: generate,
            },
            {
                name: "Execute commands",
                description: "Executes commands from file in the current directory in parallel.",
                value: execute,
            },
            {
                name: "Verify WebM(s) Against AnimeThemes Encoding Standards",
                description: "Test success/failure does **NOT** guarantee acceptance/rejection of submissions. In some tests, we are determining the correctness of our file properties. In other tests, we are flagging uncommon property values for inspection.",
                value: validate,
            },
            {
                name: "Install Batch Encoder",
                description: "Install the script on the home directory and add batch-encoder as a Windows PATH.",
                value: async () => {
                    await install();
                },
            },
            {
                name: "Update Batch Encoder",
                description: "Searches for the latest release in the GitHub repository and update the script. Restarting the CMD is required.",
                value: update,
            },
        ],
    });

    await runMode(program.opts());
}
