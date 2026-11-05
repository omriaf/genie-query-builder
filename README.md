# Genie Query Builder — single-customer edition

Turn business questions into SQL that can be reused in your dashboard platform. This standalone app connects **one customer to one existing Databricks Genie agent** (also called a Genie space).

Two pages are included:

- **Query Builder:** ask a question, read the answer, copy formatted SQL, inspect results and see a suggested chart. An AI advisor suggests data additions or query-design improvements.
- **Tracking Calls:** inspect completed questions, user attribution, response time, SQL preview time and advisor token usage.

No customer selector, custom dashboard data contract, or embedded-dashboard setup is required.

## 1. What you must provide

Prepare these resources **in your own Databricks workspace** before deployment:

| Item | Where to get it / what it means |
|---|---|
| Workspace URL | Your workspace browser address, e.g. `https://YOUR_WORKSPACE_HOST`. Used when logging into the CLI. |
| SQL warehouse ID | Open SQL Warehouses → your warehouse → connection details. A 16-character ID, not its name or HTTP path. |
| Genie agent/space ID | Open your prepared Genie agent. Copy its 32-character ID from the URL. First confirm it answers questions correctly in the Databricks UI. |
| Data catalog and schema | The existing governed data location used by that Genie agent, e.g. `customer_catalog.customer_data`. Used to provide live metadata to the advisor. |
| Telemetry schema | A pre-created schema where the app can create its interaction log table, e.g. `customer_catalog.app_telemetry`. |
| Advisor serving endpoint | An existing endpoint supporting chat messages and JSON responses. The example uses `databricks-claude-haiku-4-5`; verify availability in your workspace or supply a compatible endpoint. |
| Deployment permissions | Permission to create a Databricks App, attach the warehouse/Genie/model resources, and grant its service principal access to the approved data. Your administrator may handle the grants. |

On your computer, install **Node.js 22+**, npm, Git and a current Databricks CLI supporting Apps and Genie bundle resources.

**You do not need to provide a PAT, client secret, embedded dashboard, or additional customers.** Databricks Apps supplies its runtime service-principal credentials. Local development uses your explicitly selected CLI profile.

## 2. Fill in one configuration file

```bash
git clone https://github.com/omriaf/wiliot-genie-query-builder.git
cd wiliot-genie-query-builder
npm ci --ignore-scripts
cp customer-config.example.json customer-config.json
```

Edit `customer-config.json`:

```json
{
  "app_name": "customer-query-builder",
  "customer_name": "My customer",
  "warehouse_id": "REPLACE_WITH_WAREHOUSE_ID",
  "genie_space_id": "REPLACE_WITH_GENIE_SPACE_ID",
  "catalog": "customer_catalog",
  "schema": "customer_data",
  "telemetry_table": "customer_catalog.app_telemetry.query_calls",
  "advisor_endpoint": "databricks-claude-haiku-4-5",
  "questions": ["Show the daily active tag count over the last 14 days"]
}
```

Replace the resource IDs, catalog/schema, and endpoint with your own values. Use a **new unique app name** so you do not replace another app. Choose suggested questions matching your data; they are editable shortcuts, not a required schema.

The app creates `telemetry_table` on first startup, but **its catalog and schema must already exist**. Choose a fresh table name. Catalog, schema and table names currently accept simple identifiers: letters, digits and underscores, starting with a letter or underscore.

Optional fields: `advisor_input_usd_per_million` and `advisor_output_usd_per_million`. Supply your reference token prices if you want advisor dollar estimates. They default to zero and the UI explains that pricing is unconfigured. **These fields are token prices, not DBU prices.**

Configuration, credentials and generated deployment files are git-ignored. Never put secrets in the JSON file.

## 3. Build and create the app

```bash
npm run configure
npm run stage
npm test

databricks auth login --host https://YOUR_WORKSPACE_HOST --profile YOUR_PROFILE
databricks bundle validate --strict --target dev --profile YOUR_PROFILE
databricks bundle deploy --target dev --profile YOUR_PROFILE
databricks apps get YOUR_APP_NAME --profile YOUR_PROFILE
```

Use your own chosen CLI profile in every command. `configure` validates settings and generates the bundle; `stage` builds a bundled runtime. The bundle creates the App and attaches your existing warehouse, Genie agent and model endpoint. It does **not** create business data, views, Genie agents or serving endpoints.

## 4. Give the app permission to read data

From `apps get` or the Apps UI, obtain the new app's **service-principal application ID**. Ask your administrator to grant it the following, substituting your names:

```sql
GRANT USE CATALOG ON CATALOG customer_catalog TO `APP_SERVICE_PRINCIPAL_APPLICATION_ID`;
GRANT USE SCHEMA ON SCHEMA customer_catalog.customer_data TO `APP_SERVICE_PRINCIPAL_APPLICATION_ID`;
-- Repeat for every approved object the Genie agent needs.
GRANT SELECT ON TABLE customer_catalog.customer_data.approved_view TO `APP_SERVICE_PRINCIPAL_APPLICATION_ID`;

GRANT USE SCHEMA ON SCHEMA customer_catalog.app_telemetry TO `APP_SERVICE_PRINCIPAL_APPLICATION_ID`;
GRANT CREATE TABLE ON SCHEMA customer_catalog.app_telemetry TO `APP_SERVICE_PRINCIPAL_APPLICATION_ID`;
```

For a telemetry table created by another identity, also grant `SELECT` and `MODIFY` on that table. Repeat catalog grants when using multiple catalogs. Use approved tables/views rather than broad raw-data grants.

The bundle requests `CAN_USE` for the warehouse, `CAN_RUN` for Genie and `CAN_QUERY` for the endpoint. These attachments do not replace Unity Catalog grants. Also verify the Genie agent's configured warehouse and data permissions.

## 5. Start and verify

```bash
databricks bundle run app --target dev --profile YOUR_PROFILE
databricks apps get YOUR_APP_NAME --profile YOUR_PROFILE
```

Open the returned app URL. Ask a question you already verified in Genie. Confirm the answer, formatted SQL, preview and chart. Open Tracking Calls after processing finishes and refresh to see the completed interaction.

`bundle deploy` creates/synchronizes resources; **`bundle run app` deploys and starts the code**. Both are required. After changing configuration or code, run configure, stage, validate, deploy and run again.

| Symptom | Check |
|---|---|
| Configuration fails | Replace placeholder IDs; confirm JSON syntax and catalog/schema naming. |
| Genie permission error | Correct space ID, resource attachment and app service-principal permissions. |
| SQL preview fails | Warehouse access and SELECT/USE permissions on every referenced object. |
| Advisor unavailable | Endpoint exists, supports the expected messages response, and app has CAN_QUERY. Genie results can still appear if advisor enrichment fails. |
| Tracking empty | Telemetry schema exists; app can create/write its table. Writes are asynchronous. |
| User is unknown | Apps supplies trusted identity headers; local development may not. |
| Estimated costs are zero | Token prices default to zero. Configure your own reference rates. |

## What the tracking means

- Each completed run logs the question preview, Genie conversation ID, customer label, proxy-supplied user email, timings, recommendation and advisor tokens. Failed/aborted runs are not a complete audit trail.
- SQL time measures the app's preview execution, including statement submission/polling. It is distinct from Genie processing and is not a guaranteed production dashboard runtime. The app may rerun generated SQL for preview.
- Advisor token counts come from the endpoint response; missing usage may appear as zero. Dollar figures are reference-price estimates, not invoices.
- **Genie token counts, DBUs and costs are not inferred.** Genie cost is unavailable. SQL warehouse and Apps compute charges require separate billing reconciliation.
- Recent question history is browser-local. Tracking Calls uses a Delta table. Questions, result history and identities may contain sensitive information; choose appropriate retention and access controls.

The advisor uses public Databricks guidance fetched from GitHub and live data metadata. Installation needs public npm access; runtime knowledge loading needs access to the public URLs in `server/advisor.ts`. Recommendations are suggestions for administrator review. Metric views define governed metrics; materialization and performance improvements require separate evaluation.

## GitHub handoff

```bash
npm run check:public
npm run package:source
```

Upload the contents of **`release/wiliot-customer-app/`** to the repository, or extract `release/wiliot-customer-app.tar.gz`. This clean source copy excludes local configuration, environment files, generated bundles, runtime builds, dependencies and development history. It includes this README, example configuration, source, tests and lockfile. No repository is published automatically.

The source scan checks for common credential/private-workspace/developer-path patterns; review files and third-party licenses before publication. Wiliot branding requires permission to redistribute. Choose an appropriate source license before making the repository public; no trademark or third-party license rights are granted here.

For build-only verification without real IDs: `node scripts/configure.mjs --example`, then `npm run stage` and `npm test`. Example mode does not produce a working customer deployment.

For local development, copy `.env.example` to `.env`, set your chosen CLI profile and run `npm run dev`. Your local identity needs equivalent permissions.

## Scope

This is a trusted-user demonstration. One Genie agent does not automatically enforce end-user data entitlements. Runtime queries use the app identity. Limit app access to intended users; add server-side authorization before exposing sensitive data externally. Tracking Calls should be restricted appropriately. No broad Databricks token is returned to the browser by this app's custom routes.

DAB is the recommended repeatable deployment. Direct Apps deployment can use the staged `runtime/` directory with equivalent resource attachments and grants. Running on Wiliot-managed hosting requires adapting authentication, verified user identity and authorization.
