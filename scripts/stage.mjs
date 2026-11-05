import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
rmSync('runtime/dist',{recursive:true,force:true});
rmSync('runtime/client',{recursive:true,force:true});
mkdirSync('runtime/client',{recursive:true});
cpSync('dist','runtime/dist',{recursive:true});
cpSync('client/dist','runtime/client/dist',{recursive:true});
// Preserve the original application's bundled static-file layout as well.
cpSync('client/dist','runtime/dist',{recursive:true});
writeFileSync('runtime/package.json',JSON.stringify({name:'customer-query-builder-runtime',private:true,type:'module'}));
console.log('Runtime staged with bundled dependencies; no source credentials or development tooling copied.');
