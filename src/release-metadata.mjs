import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Public deployment identity only. Never expose environment variables or configuration.
const packageInfo=JSON.parse(readFileSync(fileURLToPath(new URL('../package.json',import.meta.url)),'utf8'));
const shaPattern=/^[0-9a-f]{40}$/i;
export function releaseMetadata({releaseSha=process.env.RADAR_RELEASE_SHA}={}){
 const sha=typeof releaseSha==='string'?releaseSha.trim().toLowerCase():'';
 return {application:'opportunity-radar',version:packageInfo.version,
  commit:shaPattern.test(sha)?sha:null,identified:shaPattern.test(sha)};
}
