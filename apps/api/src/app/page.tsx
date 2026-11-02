import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Producer} from '@banger/www/studio';
export default function Page() {
  const source=readFileSync(resolve(process.cwd(),'../../examples/night-drive.banger'),'utf8');
  return <Producer initialFile={{name:'night-drive.banger',source}} />;
}
