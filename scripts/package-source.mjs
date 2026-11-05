import { readdirSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath,['scripts/check-public.mjs'],{stdio:'inherit'});
const out=resolve('release'); rmSync(out,{recursive:true,force:true});mkdirSync(join(out,'wiliot-customer-app'),{recursive:true});
const skip=new Set(['node_modules','dist','runtime','.git','.databricks','release','customer-config.json','databricks.yml','.env']);
function copy(dir,rel='') {
 for(const e of readdirSync(dir,{withFileTypes:true})) {
  const r=join(rel,e.name);
  if(skip.has(e.name) || (e.name.startsWith('.env') && e.name!=='.env.example') || ['server/deployment-config.json','client/src/customer-config.json'].includes(r)) continue;
  if(e.isDirectory()) copy(join(dir,e.name),r);
  else {mkdirSync(join(out,'wiliot-customer-app',rel),{recursive:true});cpSync(join(dir,e.name),join(out,'wiliot-customer-app',r));}
 }
}
copy('.');execFileSync('tar',['-czf',join(out,'wiliot-customer-app.tar.gz'),'-C',out,'wiliot-customer-app']);
console.log('Created release/wiliot-customer-app.tar.gz containing source and example settings only.');
