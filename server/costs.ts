import { config, qualified } from './deployment-config';
export const INPUT_COST_PER_1K = config.advisor_input_usd_per_million / 1000;
export const OUTPUT_COST_PER_1K = config.advisor_output_usd_per_million / 1000;
export const COST_TABLE = qualified(config.telemetry_table);

export const CREATE_COST_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${COST_TABLE} (
  id STRING,
  ts TIMESTAMP,
  customer_id STRING,
  question_preview STRING,
  conversation_id STRING,
  has_sql BOOLEAN,
  has_recommendation BOOLEAN,
  rec_type STRING,
  fmapi_input_tokens INT,
  fmapi_output_tokens INT,
  fmapi_cost_usd DOUBLE,
  duration_ms INT,
  sql_execution_ms INT,
  genie_input_tokens_est INT,
  genie_output_tokens_est INT,
  genie_cost_est_usd DOUBLE,
  genie_ms INT,
  answer_length INT,
  user_email STRING
) USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'false')`;

export function buildCostStatsQueries(tz: string) {
  const safeTz = /^[A-Za-z_/+-]+$/.test(tz) ? tz : 'UTC';
  // TIMESTAMP columns are session-localized by Databricks, so the two-argument
  // overload converts from the warehouse session timezone to the browser zone.
  const safeLocal = (col: string) => `CONVERT_TIMEZONE('${safeTz}', ${col})`;

  return [
  `SELECT
  COUNT(CASE WHEN DATE(${safeLocal('ts')}) = DATE(${safeLocal('current_timestamp()')}) THEN 1 END) AS total_queries_today,
  ROUND(SUM(CASE WHEN ${safeLocal('ts')} >= DATE(${safeLocal('current_timestamp()')}) - 7 THEN COALESCE(genie_cost_est_usd, 0) + fmapi_cost_usd ELSE 0 END), 4) AS total_cost_week_usd,
  ROUND(AVG(fmapi_cost_usd), 6) AS avg_cost_per_query_usd,
  (SELECT customer_id FROM ${COST_TABLE} GROUP BY customer_id ORDER BY COUNT(*) DESC LIMIT 1) AS most_active_customer
FROM ${COST_TABLE}`,
  `SELECT customer_id, COUNT(*) AS count, ROUND(SUM(fmapi_cost_usd), 4) AS fmapi_cost_usd, ROUND(SUM(COALESCE(genie_cost_est_usd, 0)), 4) AS genie_cost_est_usd
FROM ${COST_TABLE}
WHERE ${safeLocal('ts')} >= DATE(${safeLocal('current_timestamp()')}) - 30
GROUP BY customer_id ORDER BY count DESC`,
  `SELECT DATE(${safeLocal('ts')}) AS day, COUNT(*) AS count, ROUND(SUM(fmapi_cost_usd), 4) AS fmapi_cost_usd, ROUND(SUM(COALESCE(genie_cost_est_usd, 0)), 4) AS genie_cost_est_usd
FROM ${COST_TABLE}
WHERE ${safeLocal('ts')} >= DATE(${safeLocal('current_timestamp()')}) - 14
GROUP BY DATE(${safeLocal('ts')}) ORDER BY day`,
  `SELECT ts, customer_id, question_preview, fmapi_input_tokens, fmapi_output_tokens, fmapi_cost_usd, genie_cost_est_usd, has_sql, rec_type, duration_ms, sql_execution_ms, genie_ms, answer_length, conversation_id, user_email
FROM ${COST_TABLE}
ORDER BY ts DESC LIMIT 20`,
  `SELECT user_email, COUNT(*) AS count, ROUND(SUM(fmapi_cost_usd), 4) AS cost_usd
FROM ${COST_TABLE}
WHERE ${safeLocal('ts')} >= DATE(${safeLocal('current_timestamp()')}) - 30
GROUP BY user_email ORDER BY count DESC`,
  ] as const;
}

export function calculateFmapiCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000) * INPUT_COST_PER_1K + (outputTokens / 1_000) * OUTPUT_COST_PER_1K;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export type CostLog = {
  id: string; customerId: string; questionPreview: string; conversationId: string; userEmail: string;
  hasSql: boolean; hasRecommendation: boolean; recType: string | null;
  inputTokens: number; outputTokens: number; costUsd: number; durationMs: number; sqlExecutionMs: number;
  genieMs: number; answerLength: number;
  genieInputTokensEst: number | null; genieOutputTokensEst: number | null; genieCostEstUsd: number | null;
};

export function createCostInsertSql(log: CostLog): string {
  return `INSERT INTO ${COST_TABLE} (id, ts, customer_id, question_preview, conversation_id, has_sql, has_recommendation, rec_type, fmapi_input_tokens, fmapi_output_tokens, fmapi_cost_usd, duration_ms, sql_execution_ms, genie_ms, answer_length, user_email, genie_input_tokens_est, genie_output_tokens_est, genie_cost_est_usd) VALUES (
  ${sqlString(log.id)}, current_timestamp(), ${sqlString(log.customerId)}, ${sqlString(log.questionPreview)},
  ${sqlString(log.conversationId)}, ${log.hasSql}, ${log.hasRecommendation}, ${sqlString(log.recType ?? '')},
  ${log.inputTokens}, ${log.outputTokens}, ${log.costUsd}, ${log.durationMs}, ${log.sqlExecutionMs}, ${log.genieMs}, ${log.answerLength}, ${sqlString(log.userEmail)}, ${log.genieInputTokensEst ?? 'NULL'}, ${log.genieOutputTokensEst ?? 'NULL'}, ${log.genieCostEstUsd ?? 'NULL'}
)`;
}

const numberValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const stringValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';

export function mapCostStats(resultSets: unknown[][][]) {
  const [kpiRows = [], customerRows = [], dayRows = [], recentRows = [], userRows = []] = resultSets;
  const kpi = kpiRows[0] ?? [];
  return {
    kpis: {
      total_queries_today: numberValue(kpi[0]),
      total_cost_week_usd: numberValue(kpi[1]),
      avg_cost_per_query_usd: numberValue(kpi[2]),
      most_active_customer: stringValue(kpi[3]),
    },
    by_customer: customerRows.map((row) => ({
      customer_id: stringValue(row[0]), count: numberValue(row[1]),
      fmapi_cost_usd: numberValue(row[2]),
      genie_cost_est_usd: numberValue(row[3]),
    })),
    by_day: dayRows.map((row) => ({
      day: stringValue(row[0]), count: numberValue(row[1]),
      fmapi_cost_usd: numberValue(row[2]),
      genie_cost_est_usd: numberValue(row[3]),
    })),
    by_user: userRows.map((row) => ({
      user_email: stringValue(row[0]), count: numberValue(row[1]),
      cost_usd: numberValue(row[2]),
    })),
    recent: recentRows.map((row) => ({
      ts: stringValue(row[0]), customer_id: stringValue(row[1]), question_preview: stringValue(row[2]),
      fmapi_input_tokens: numberValue(row[3]), fmapi_output_tokens: numberValue(row[4]),
      fmapi_cost_usd: numberValue(row[5]), genie_cost_est_usd: row[6] == null ? null : numberValue(row[6]),
      has_sql: Boolean(row[7]), rec_type: stringValue(row[8]),
      duration_ms: numberValue(row[9]), sql_execution_ms: numberValue(row[10]),
      genie_ms: numberValue(row[11]), answer_length: numberValue(row[12]),
      conversation_id: stringValue(row[13]),
      user_email: stringValue(row[14]),
    })),
  };
}
