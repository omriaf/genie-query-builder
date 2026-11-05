import { readdirSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath,['scripts/check-public.mjs'],{stdio:'inherit'});
const out=resolve('release'); rmSync(out,{recursive:true,force:true});mkdirSync(join(out,'genie-query-builder'),{recursive:true});
const skip=new Set(['node_modules','dist','runtime','.git','.databricks','release','customer-config.json','databricks.yml','.env']);
function copy(dir,rel='') {
 for(const e of readdirSync(dir,{withFileTypes:true})) {
  const r=join(rel,e.name);
  if(skip.has(e.name) || (e.name.startsWith('.env') && e.name!=='.env.example') || ['server/deployment-config.json','client/src/customer-config.json'].includes(r)) continue;
  if(e.isDirectory()) copy(join(dir,e.name),r);
  else {mkdirSync(join(out,'genie-query-builder',rel),{recursive:true});cpSync(join(dir,e.name),join(out,'genie-query-builder',r));}
 }
}
copy('.');execFileSync('tar',['-czf',join(out,'genie-query-builder.tar.gz'),'-C',out,'genie-query-builder']);
console.log('Created release/genie-query-builder.tar.gz containing source and example settings only.');
