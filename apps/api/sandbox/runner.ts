import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { openProject, ProjectSession, type HarnessEvent } from "@banger/harness";
import { selectModel, publicAIError, type ProviderId } from "@banger/agent";
const root = '/vercel/sandbox';
// An atomic directory claim prevents a replayed launch from invoking the model twice.
try { await mkdir(`${root}/run-lock`); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') process.exit(0); throw error; }
const atomic = async (path: string, value: unknown) => { await writeFile(`${path}.tmp`, JSON.stringify(value)); await rename(`${path}.tmp`, path); };
const activity: string[] = [];
let queue = Promise.resolve();
try {
  const input = JSON.parse(await readFile(`${root}/input.json`, 'utf8')) as { files: {path:string;source:string}[]; prompt:string; activeFile?:string };
  await mkdir(`${root}/project`, { recursive: true });
  // Only the service writes this input. The harness independently checks all paths and source.
  for (const file of input.files) {
    await mkdir(dirname(`${root}/project/${file.path}`), { recursive: true });
    await writeFile(`${root}/project/${file.path}`, file.source, { flag: 'wx' });
  }
  const workspace = await openProject(`${root}/project`);
  const onEvent = (event: HarnessEvent) => {
    const text = event.type === 'tool-start' ? `${event.name}${event.path ? `: ${event.path}` : ''}` : event.type === 'file-changed' ? `Validated ${event.file.path}` : event.type === 'text' ? event.text.slice(0, 1000) : '';
    if (text) activity.push(text);
    while (activity.length > 40) activity.shift();
    queue = queue.then(() => atomic(`${root}/progress.json`, { activity: [...activity] }));
  };
  const session = new ProjectSession({ workspace, selected: selectModel({ provider: (process.env.BANGER_PROVIDER ?? 'openai') as ProviderId, model: process.env.BANGER_MODEL!, key: process.env.BANGER_API_KEY! }), onEvent });
  const result = await session.run(input.prompt, { activeFile: input.activeFile });
  await queue;
  const files = await Promise.all((await workspace.list()).map(path => workspace.read(path)));
  await atomic(`${root}/result.json`, { status: result.status, text: result.text, files });
} catch (error) {
  await queue.catch(() => undefined);
  await atomic(`${root}/result.json`, { status: 'failed', error: publicAIError(error) });
  process.exitCode = 1;
}
