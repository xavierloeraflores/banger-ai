import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {WebStudio} from './web-studio';
export default function Page() {
  const source=readFileSync(resolve(process.cwd(),'../../examples/night-drive.banger'),'utf8');
  return <WebStudio initialFile={{name:'night-drive.banger',source}} />;
}
