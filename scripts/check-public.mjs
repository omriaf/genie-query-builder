import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const excluded = new Set(['node_modules','dist','runtime','.git','.databricks','release']);
const localFiles = new Set(['customer-config.json','server/deployment-config.json','client/src/customer-config.json','databricks.yml']);
const rules = [
 /https?:\/\/npm-proxy\.[^\s"']+/i,
 /https?:\/\/adb-\d+\.[^\s"']+/i,
 /[A-Z0-9._%+-]+@databricks\.com/i,
 /\/Users\/[a-z][a-z0-9._-]+\//i,
 /(?:dapi)[a-f0-9]{24,}/i,
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 new RegExp('\\b(?:super' + 'powers?|omni' + 'gent)\\b', 'i'),
];
const findings=[]; let count=0;
function walk(dir) {
 for(const e of readdirSync(dir,{withFileTypes:true})) {
  if(excluded.has(e.name) || e.name.startsWith('.env') && e.name!=='.env.example') continue;
  const path=join(dir,e.name), rel=relative('.',path);
  if(localFiles.has(rel)) continue;
  if(e.isDirectory()) walk(path);
  else if(!/\.(png|ico|jpg|woff2?)$/.test(path)) {
   count++; const value=readFileSync(path,'utf8');
   for (let i=0;i<rules.length;i++) if(rules[i].test(value)) findings.push(`${rel}: rule ${i+1}`);
  }
 }
}
walk('.');
if(findings.length) { console.error(findings.join('\n')); process.exit(1); }
console.log(`Public-source check passed (${count} text files). Local customer configuration and build/dependency directories excluded. Review third-party licensing before publishing.`);
