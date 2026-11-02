#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { selectModel, publicAIError, PROVIDER_IDS, type ProviderId } from "@banger/agent";
import { openProject, ProjectSession, type SelectedModel, type HarnessEvent } from "./index.js";

const help = `Usage: banger-agent <project-directory> [task] [options]

Open a music project and edit its .banger files with a coding agent.

  --interactive, -i      Keep the session open for follow-up edits
  --provider <provider>  openai, anthropic, vercel, meta, grok (default: openai)
  --model <model>        Model ID, or set BANGER_MODEL
  --active <path>        Current .banger file, relative to the project
  --json                Emit newline-delimited JSON events and result
  --help, -h            Show help

Set BANGER_API_KEY or OPENAI_API_KEY for the selected provider.
Example: BANGER_MODEL=gpt-5.4 banger-agent ./songs "Make the bass quieter"
Changes are saved after each successful compile. Ctrl-C stops the task.
`;
export async function runCli(argv: string[], dependencies: {
  selected?: SelectedModel;
  env?: NodeJS.ProcessEnv;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
} = {}): Promise<number> {
  const output = dependencies.stdout ?? (text => process.stdout.write(text));
  const errorOutput = dependencies.stderr ?? (text => process.stderr.write(text));
  let activeController: AbortController | undefined;
  const cancel = () => activeController?.abort();
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
      interactive: { type: "boolean", short: "i" }, provider: { type: "string" }, model: { type: "string" },
      active: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
    } });
    if (values.help) { output(help); return 0; }
    if (!positionals[0]) { errorOutput(help); return 2; }
    const prompt = positionals.slice(1).join(" ").trim();
    if (!prompt && !values.interactive) { errorOutput("Provide a task or use --interactive.\n"); return 2; }
    const env = dependencies.env ?? process.env;
    const provider = values.provider ?? env.BANGER_PROVIDER ?? "openai";
    if (!PROVIDER_IDS.includes(provider as ProviderId)) { errorOutput("Choose a supported provider.\n"); return 2; }
    const model = values.model ?? env.BANGER_MODEL;
    const key = env.BANGER_API_KEY ?? (provider === "openai" ? env.OPENAI_API_KEY : undefined);
    if (!dependencies.selected && (!model || !key)) { errorOutput("Set BANGER_MODEL and BANGER_API_KEY, or OPENAI_API_KEY for OpenAI.\n"); return 2; }
    const selected = dependencies.selected ?? selectModel({ provider: provider as ProviderId, model: model!, key: key! });
    const workspace = await openProject(positionals[0]);
    const onEvent = (event: HarnessEvent) => {
      if (values.json) output(`${JSON.stringify(event)}\n`);
      else if (event.type === "file-changed") output(`Saved ${event.file.path}\n`);
      else if (event.type === "tool-result" && !event.ok) errorOutput(`${event.name}: ${event.error}\n`);
    };
    const session = new ProjectSession({ workspace, selected, onEvent });
    process.on("SIGINT", cancel);
    const run = async (task: string) => {
      activeController = new AbortController();
      try {
        const result = await session.run(task, { signal: activeController.signal, activeFile: values.active });
        output(values.json ? `${JSON.stringify({ type: "result", ...result })}\n` : `${result.text}\n`);
        return result.status === "completed" ? 0 : 1;
      } catch (error) {
        errorOutput(`${publicAIError(error)}\n`);
        return activeController.signal.aborted ? 130 : 1;
      } finally { activeController = undefined; }
    };
    let code = prompt ? await run(prompt) : 0;
    if (values.interactive) {
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (true) {
          let next: string;
          try { next = await reader.question("banger> "); } catch { break; }
          if (["/exit", "/quit"].includes(next.trim())) break;
          if (next.trim() === "/clear") { session.clearHistory(); continue; }
          if (next.trim()) code = await run(next);
        }
      } finally { reader.close(); }
    }
    return code;
  } catch {
    errorOutput("Could not open the project or parse the command. Check the directory and use --help.\n");
    return 2;
  } finally { process.off("SIGINT", cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCli(process.argv.slice(2));
