import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const example = process.argv.includes('--example');
const path = example ? 'customer-config.example.json' : (process.argv[2] ?? 'customer-config.json');
const input = JSON.parse(readFileSync(path, 'utf8'));
const c = {
 ...input,
 advisor_endpoint: input.advisor_endpoint ?? 'databricks-claude-haiku-4-5',
 advisor_input_usd_per_million: input.advisor_input_usd_per_million ?? 0,
 advisor_output_usd_per_million: input.advisor_output_usd_per_million ?? 0,
 enable_customer_view: false, customer_view_customer: 'customer',
 customer_view_schema: `${input.catalog}.${input.schema}`, dashboard_embed_url: '',
 customers: [{id:'customer', name:input.customer_name ?? 'My customer',
  genie_space_id:input.genie_space_id, catalog:input.catalog, schema:input.schema,
  questions:input.questions ?? ['Summarize the key metrics available in this data.']}],
};
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const ident = v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
assert(/^[a-z][a-z0-9-]{1,45}$/.test(c.app_name), 'app_name must use lowercase letters, digits and hyphens (2–46 characters)');
assert(/^[a-z0-9]{16}$/i.test(c.warehouse_id), 'warehouse_id must be 16 alphanumeric characters');
assert(typeof c.advisor_endpoint === 'string' && /^[a-zA-Z0-9_.-]+$/.test(c.advisor_endpoint), 'Invalid advisor_endpoint');
assert(c.telemetry_table?.split('.').length === 3 && c.telemetry_table.split('.').every(ident), 'telemetry_table must be catalog.schema.table (simple SQL identifiers)');
assert(c.customer_view_schema?.split('.').length === 2 && c.customer_view_schema.split('.').every(ident), 'customer_view_schema must be catalog.schema');
assert(Array.isArray(c.customers) && c.customers.length > 0, 'At least one customer is required');
const seen = new Set();
for (const t of c.customers) {
 assert(ident(t.id) && !seen.has(t.id), 'Customer IDs must be unique simple identifiers'); seen.add(t.id);
 assert(typeof t.name === 'string' && t.name.length > 0, 'Customer name is required');
 assert(/^[a-f0-9]{32}$/i.test(t.genie_space_id), 'Each genie_space_id must be 32 hex characters');
 assert(ident(t.catalog) && ident(t.schema), 'Customer catalog and schema must be simple SQL identifiers');
 assert(Array.isArray(t.questions) && t.questions.every(q => typeof q === 'string'), 'questions must be a string array');
}
assert(typeof c.enable_customer_view === 'boolean', 'enable_customer_view must be a boolean');
assert(seen.has(c.customer_view_customer), 'customer_view_customer must match a configured customer ID');
for (const key of ['advisor_input_usd_per_million','advisor_output_usd_per_million']) assert(typeof c[key] === 'number' && Number.isFinite(c[key]) && c[key] >= 0, key + ' must be a nonnegative number');
if (c.dashboard_embed_url) assert(new URL(c.dashboard_embed_url).protocol === 'https:', 'Dashboard embed URL must use HTTPS');
if (!example) assert(c.warehouse_id !== '0000000000000000' && c.customers.every(t => !/^0+$/.test(t.genie_space_id)), 'Replace example resource IDs before configuring a real deployment');
// Browser subset deliberately omits warehouse IDs, Genie IDs and catalog locations.
const browser = Object.fromEntries(['customer_view_customer','enable_customer_view','dashboard_embed_url','advisor_endpoint','advisor_input_usd_per_million','advisor_output_usd_per_million'].map(k=>[k,c[k]]));
browser.customers = c.customers.map(({id,name,questions})=>({id,name,questions}));
writeFileSync('server/deployment-config.json', JSON.stringify(c,null,2)+'\n');
writeFileSync('client/src/customer-config.json', JSON.stringify(browser,null,2)+'\n');
// JSON is valid YAML and avoids interpolation/escaping bugs in customer-supplied labels.
const resources = [
 {name:'sql-warehouse', sql_warehouse:{id:c.warehouse_id,permission:'CAN_USE'}},
 {name:'advisor-model',serving_endpoint:{name:c.advisor_endpoint,permission:'CAN_QUERY'}},
 ...c.customers.map((t,i)=>({name:`customer-genie-${i+1}`,genie_space:{name:t.name,space_id:t.genie_space_id,permission:'CAN_RUN'}})),
];
const bundle = {bundle:{name:'genie-query-builder'},sync:{include:['runtime/**'],exclude:['node_modules/**','client/**','server/**','scripts/**','customer-config.json','.env*']},resources:{apps:{app:{name:c.app_name,description:'Natural language SQL builder and usage tracking',source_code_path:'./runtime',resources}}},targets:{dev:{default:true}}};
writeFileSync('databricks.yml',JSON.stringify(bundle,null,2)+'\n');
mkdirSync('runtime',{recursive:true});
writeFileSync('runtime/app.yaml', 'command: ["node", "dist/server.js"]\nenv:\n  - name: NODE_ENV\n    value: production\n  - name: DATABRICKS_WAREHOUSE_ID\n    valueFrom: sql-warehouse\n');
console.log(example ? 'Configured sanitized example for local checks only.' : 'Configuration generated. Run npm run stage, then validate/deploy using your chosen profile.');
