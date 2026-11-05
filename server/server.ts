import { analytics, createApp, createWorkspaceClient, server } from '@databricks/appkit';
import { randomUUID } from 'node:crypto';
import { formatLiveSchema, getAdvisorInsights, loadSkills } from './advisor';
import { fetchWithSchemaCache } from './schema-cache';
import type { SchemaCacheEntry } from './schema-cache';
import { writeSseSafely } from './sse-response';
import {
  calculateFmapiCost,
  buildCostStatsQueries,
  CREATE_COST_TABLE_SQL,
  createCostInsertSql,
  mapCostStats,
} from './costs';
import { config, identifier } from './deployment-config';

export function getUserEmail(req: import('express').Request): string {
  const email = req.headers['x-forwarded-email'] as string | undefined;
  if (email?.includes('@')) return email;
  return 'unknown';
}

void loadSkills();

const CUSTOMER_SPACES: Record<string, string> = Object.fromEntries(config.customers.map(c => [c.id, c.genie_space_id]));
const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID ?? config.warehouse_id;
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 60_000;
const SCHEMA_TTL_MS = 5 * 60 * 1_000;
type LiveSchema = string;
const schemaCache = new Map<string, SchemaCacheEntry<LiveSchema>>();


type DatabricksColumn = { name: string; type_name?: string; type_text?: string };
type ChartSuggestion =
  | { type: 'line' | 'bar' | 'horizontal_bar'; x: string; y: string; rationale: string }
  | { type: 'stat'; value: string; rationale: string }
  | { type: 'table'; rationale: string };
type Feedback = { level: 'info' | 'warning'; title: string; message: string } | null;
type GenieMessage = {
  status?: string;
  error?: { error?: string; message?: string };
  attachments?: Array<{
    text?: { content?: string };
    query?: { query?: string; description?: string };
  }>;
  conversation_id?: string;
  message_id?: string;
};
type StatementResponse = {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: DatabricksColumn[] } };
  result?: { data_array?: unknown[][] };
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isNumericColumn(column: DatabricksColumn): boolean {
  return /(?:BYTE|SHORT|INT|LONG|FLOAT|DOUBLE|DECIMAL|NUMERIC|NUMBER)/i.test(
    `${column.type_name ?? ''} ${column.type_text ?? ''}`,
  );
}

function isCategoryColumn(column: DatabricksColumn): boolean {
  return /(?:STRING|CHAR|VARCHAR)/i.test(`${column.type_name ?? ''} ${column.type_text ?? ''}`);
}

export function suggestChart(
  _sql: string,
  columns: DatabricksColumn[],
  rowCount = 0,
): ChartSuggestion {
  const dateColumn = columns.find((column) => /date|day|week|month|year/i.test(column.name));
  const numericColumn = columns.find(isNumericColumn);
  const categoryColumn = columns.find(isCategoryColumn);
  if (dateColumn && numericColumn) {
    return {
      type: 'line', x: dateColumn.name, y: numericColumn.name,
      rationale: 'Time-series data — line chart shows trend over time',
    };
  }
  if (categoryColumn && numericColumn && rowCount <= 20) {
    return {
      type: 'bar', x: categoryColumn.name, y: numericColumn.name,
      rationale: 'Category comparison — bar chart compares values across groups',
    };
  }
  if (categoryColumn && numericColumn) {
    return {
      type: 'horizontal_bar', x: numericColumn.name, y: categoryColumn.name,
      rationale: 'Many categories — horizontal bar is easier to read',
    };
  }
  if (columns.length === 1 && numericColumn) {
    return { type: 'stat', value: numericColumn.name, rationale: 'Single metric — display as a KPI stat' };
  }
  return { type: 'table', rationale: 'Multi-column result — table is the clearest presentation' };
}

export function generateFeedback(customerId: string, sql: string): Feedback {
  const joinCount = (sql.toUpperCase().match(/\bJOIN\b/g) ?? []).length;
  if (customerId === 'healthco' && joinCount >= 2) {
    return {
      level: 'warning', title: 'Raw table query detected',
      message: 'This query joins 3+ raw tables. Ask your admin to create a Metric View for this use case — it will make metric definitions consistent and easier for dashboard tools to consume. Performance improvements require separate measurement.',
    };
  }
  if (joinCount > 0) {
    return {
      level: 'info', title: 'Query optimization available',
      message: 'This query could benefit from a pre-defined Metric View. Ask your admin to define this as a reusable metric for consistent definitions; evaluate materialization separately if performance requires it.',
    };
  }
  return null;
}

function previewSql(sql: string): string {
  const cleanSql = sql.trim().replace(/;+\s*$/, '');
  return /\bLIMIT\s+\d+\b/i.test(cleanSql) ? cleanSql : `${cleanSql}\nLIMIT 50`;
}

function terminalError(payload: GenieMessage | StatementResponse): string {
  if ('error' in payload && payload.error) {
    return payload.error.error ?? payload.error.message ?? 'Databricks request failed';
  }
  if (typeof payload.status === 'object') {
    return payload.status.error?.message ?? 'SQL statement failed';
  }
  return 'Databricks request failed';
}

await createApp({
  plugins: [analytics(), server()],
  async onPluginsReady(appkit) {
    const workspaceClient = createWorkspaceClient();
    const host = (await workspaceClient.config.getHost()).toString().replace(/\/$/, '');

    async function databricksRequest<T>(path: string, init?: RequestInit): Promise<T> {
      const headers = new Headers(init?.headers);
      headers.set('Content-Type', 'application/json');
      await workspaceClient.config.authenticate(headers);
      const response = await fetch(`${host}${path}`, { ...init, headers });
      const body = (await response.json().catch(() => ({}))) as T & {
        message?: string;
        error_code?: string;
      };
      if (!response.ok) {
        throw new Error(body.message ?? body.error_code ?? `Databricks API returned ${response.status}`);
      }
      return body;
    }

    async function pollGenieMessage(spaceId: string, conversationId: string, messageId: string) {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const message = await databricksRequest<GenieMessage>(
          `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}`,
        );
        if (message.status === 'COMPLETED') return message;
        if (message.status === 'FAILED' || message.status === 'CANCELLED') {
          throw new Error(terminalError(message));
        }
        await sleep(POLL_INTERVAL_MS);
      }
      throw new Error('Genie did not complete within 60 seconds. Please try again.');
    }

    async function executePreview(statement: string) {
      let response = await databricksRequest<StatementResponse>('/api/2.0/sql/statements', {
        method: 'POST',
        body: JSON.stringify({
          warehouse_id: WAREHOUSE_ID,
          statement,
          wait_timeout: '10s',
          disposition: 'INLINE',
          format: 'JSON_ARRAY',
        }),
      });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (response.status?.state === 'PENDING' || response.status?.state === 'RUNNING') {
        if (Date.now() >= deadline) throw new Error('SQL preview did not complete within 60 seconds.');
        await sleep(POLL_INTERVAL_MS);
        response = await databricksRequest<StatementResponse>(`/api/2.0/sql/statements/${response.statement_id}`);
      }
      if (response.status?.state !== 'SUCCEEDED') throw new Error(terminalError(response));
      return response;
    }

    async function fetchLiveSchema(customerId: string): Promise<LiveSchema> {
      const customer = config.customers.find(c => c.id === customerId)!;
      const schemaName = customer.schema;
      const catalog = identifier(customer.catalog);
      const mvSql = `
        SELECT table_name, comment
        FROM ${catalog}.information_schema.tables
        WHERE table_schema = '${schemaName}'
          AND table_type = 'VIEW'
          AND table_name LIKE 'mv_%'
      `;
      const viewSql = `
        SELECT table_name
        FROM ${catalog}.information_schema.tables
        WHERE table_schema = '${schemaName}'
          AND table_type = 'VIEW'
          AND table_name LIKE 'vw_%'
      `;
      const colSql = `
        SELECT table_name, column_name, data_type
        FROM ${catalog}.information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name NOT LIKE 'mv_%'
          AND table_name NOT LIKE 'vw_%'
        ORDER BY table_name, ordinal_position
      `;
      try {
        const [metricViews, goldViews, columns] = await Promise.all([
          executePreview(mvSql), executePreview(viewSql), executePreview(colSql),
        ]);
        return formatLiveSchema(
          metricViews.result?.data_array ?? [],
          goldViews.result?.data_array ?? [],
          columns.result?.data_array ?? [],
        );
      } catch (error) {
        console.warn(`[advisor] schema info unavailable for ${customerId}`, error);
        return 'Live schema information is unavailable for this query.';
      }
    }

    async function fetchLiveSchemaWithCache(customerId: string): Promise<LiveSchema> {
      return fetchWithSchemaCache(schemaCache, customerId, fetchLiveSchema, SCHEMA_TTL_MS);
    }

    const telemetryReady = executePreview(CREATE_COST_TABLE_SQL).catch((error) => {
      console.error('[costs] unable to initialize query cost table', error);
    });

    appkit.server.extend((app) => {
      app.post('/api/genie-query', async (req, res) => {
        const userEmail = getUserEmail(req);
        const requestStartedAt = Date.now();
        try {
          const body: unknown = req.body;
          const customerId =
            body && typeof body === 'object' && 'customer_id' in body && typeof body.customer_id === 'string'
              ? body.customer_id
              : '';
          const question =
            body && typeof body === 'object' && 'question' in body && typeof body.question === 'string'
              ? body.question.trim()
              : '';
          const spaceId = CUSTOMER_SPACES[customerId];
          if (!spaceId) return void res.status(400).json({ error: 'Select a valid customer tenant.' });
          if (!question) return void res.status(400).json({ error: 'Question is required.' });

          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();

          const schemaPromise = fetchLiveSchemaWithCache(customerId);

          const started = await databricksRequest<GenieMessage>(
            `/api/2.0/genie/spaces/${spaceId}/start-conversation`,
            { method: 'POST', body: JSON.stringify({ content: question }) },
          );
          if (!started.conversation_id || !started.message_id) {
            throw new Error('Genie did not return conversation identifiers.');
          }
          const genieStart = Date.now();
          const message = await pollGenieMessage(spaceId, started.conversation_id, started.message_id);
          const genieMs = Date.now() - genieStart;
          const attachments = message.attachments ?? [];
          const sql = attachments.find((attachment) => attachment.query?.query)?.query?.query ?? '';
          const fullAnswer = attachments
            .map((attachment) => attachment.text?.content ?? attachment.query?.description)
            .filter((value): value is string => Boolean(value))
            .join('\n\n');
          // Genie API does not expose billable token or DBU usage.
          const genieInputTokensEst = null;
          const genieOutputTokensEst = null;
          const genieCostEstUsd = null;
          const sqlExecStart = Date.now();
          const statement = sql ? await executePreview(previewSql(sql)) : null;
          const sqlExecutionMs = sql ? Date.now() - sqlExecStart : 0;
          const columns = statement?.manifest?.schema?.columns ?? [];
          const previewRows = statement?.result?.data_array ?? [];
          const payload = {
            full_answer: fullAnswer,
            genie_answer: fullAnswer,
            sql: sql || null,
            columns,
            preview_rows: previewRows.slice(0, 50),
            chart_suggestion: sql ? suggestChart(sql, columns, previewRows.length) : null,
            advisor: null,
            feedback: sql ? generateFeedback(customerId, sql) : null,
          };
          writeSseSafely(res, [`data: ${JSON.stringify({ phase: 'genie', ...payload })}\n\n`]);

          const liveSchema = await schemaPromise;
          let advisor = null;
          let inputTokens = 0;
          let outputTokens = 0;
          try {
            const advisorHost = process.env.DATABRICKS_HOST ?? host;
            let advisorToken = process.env.DATABRICKS_TOKEN;
            if (!advisorToken) {
              const authHeaders = new Headers();
              await workspaceClient.config.authenticate(authHeaders);
              advisorToken = authHeaders.get('Authorization')?.replace(/^Bearer\s+/i, '');
            }
            if (!advisorToken) throw new Error('Databricks token is unavailable');
            const insights = await getAdvisorInsights({
              customerId,
              question,
              genieAnswer: fullAnswer,
              sql,
              columns,
              rowCount: previewRows.length,
              liveSchema,
              host: advisorHost,
              token: advisorToken,
            });
            advisor = insights.result;
            inputTokens = insights.usage.inputTokens;
            outputTokens = insights.usage.outputTokens;
          } catch (error) {
            console.warn('[advisor] insight generation failed', error);
          }
          // Start cost logging before SSE writes, which can fail after a client disconnects.
          const recommendation = advisor?.recommendation;
          void telemetryReady.then(() => executePreview(createCostInsertSql({
            id: randomUUID(),
            customerId,
            questionPreview: question.slice(0, 120),
            conversationId: started.conversation_id!,
            userEmail,
            hasSql: Boolean(sql),
            hasRecommendation: Boolean(recommendation?.type),
            recType: recommendation?.type ?? null,
            inputTokens,
            outputTokens,
            costUsd: calculateFmapiCost(inputTokens, outputTokens),
            durationMs: Date.now() - requestStartedAt,
            sqlExecutionMs,
            genieMs,
            answerLength: fullAnswer.length,
            genieInputTokensEst,
            genieOutputTokensEst,
            genieCostEstUsd,
          }))).catch((error) => {
            console.error('[costs] unable to log query cost', error);
          });

          writeSseSafely(res, [
            `data: ${JSON.stringify({ phase: 'complete', advisor })}\n\n`,
            'data: [DONE]\n\n',
          ], true);
        } catch (error) {
          console.error('Genie query failed', error);
          const message = error instanceof Error ? error.message : 'Unable to run the Genie query.';
          if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ phase: 'error', error: message })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            res.status(500).json({ error: message });
          }
        }
      });

      app.get('/api/cost-stats', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const tz = typeof req.query.tz === 'string' && req.query.tz.length > 0
          ? req.query.tz
          : 'UTC';
        try {
          const resultSets: unknown[][][] = [];
          for (const query of buildCostStatsQueries(tz)) {
            const result = await executePreview(query);
            resultSets.push(result.result?.data_array ?? []);
          }
          res.json(mapCostStats(resultSets));
        } catch (error) {
          console.error('[costs] unable to fetch dashboard statistics', error);
          res.status(500).json({ error: 'Unable to load cost statistics.' });
        }
      });
    });
  },
});
