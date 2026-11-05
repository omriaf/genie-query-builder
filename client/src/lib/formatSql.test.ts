import { describe, expect, it } from 'vitest';
import { formatSql } from './formatSql';

// Mark actual SQL syntax explicitly, independently of the formatter. The safety
// oracle may change ONLY these tokens' case; all identifiers, literals, quoted
// identifiers, comments/hints, and symbols must remain byte-identical and ordered.
function fixture(name: string, annotated: string, lines: string[]) {
  return {
    name,
    sql: annotated.replace(/«(.*?)»/g, '$1'),
    safeTokens: annotated.replace(/«(.*?)»/g, (_, keyword: string) => keyword.toUpperCase()),
    formatted: lines.join('\n'),
  };
}

// Independent lexer for the fixture corpus, not an import of production internals.
// Whitespace OUTSIDE quoted content/comments is the only ignored information.
function significantTokens(sql: string): string[] {
  return sql.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|''|[^'\\])*'|`(?:``|[^`])*`|"(?:\\[\s\S]|""|[^"\\])*"|[\p{L}\p{N}_$]+|[^\s]/gu) ?? [];
}

const cases = [
  fixture('select/from/where and one column per line',
    "«select» tag_id, zone «from» readings «where» active = «true» «and» zone = 'Stockroom' «or» zone «is» «null»", [
      'SELECT', '  tag_id,', '  zone', 'FROM readings', 'WHERE active = TRUE', "  AND zone = 'Stockroom'", '  OR zone IS NULL',
    ]),
  fixture('joins and ON conditions',
    '«select» a.id, b.zone «from» assets a «left» «join» readings b «on» a.id = b.id «and» b.active = «true» «inner» «join» zones z «on» b.zone = z.id «or» z.id «is» «null»', [
      'SELECT', '  a.id,', '  b.zone', 'FROM assets a', 'LEFT JOIN readings b', 'ON a.id = b.id', '  AND b.active = TRUE',
      'INNER JOIN zones z', 'ON b.zone = z.id', '  OR z.id IS NULL',
    ]),
  fixture('multiple CTEs with indented bodies',
    '«with» active «as» («select» tag_id, zone «from» readings «where» active = «true» «and» battery > 10), totals «as» («select» zone, «count»(*) «as» tags «from» active «group» «by» zone) «select» zone, tags «from» totals «order» «by» tags «desc» «limit» 10', [
      'WITH', 'active AS (', '  SELECT', '    tag_id,', '    zone', '  FROM readings', '  WHERE active = TRUE', '    AND battery > 10', '),',
      'totals AS (', '  SELECT', '    zone,', '    COUNT(*) AS tags', '  FROM active', '  GROUP BY zone', ')',
      'SELECT', '  zone,', '  tags', 'FROM totals', 'ORDER BY tags DESC', 'LIMIT 10',
    ]),
  fixture('literal clause words, escaped quotes, and internal whitespace',
    "«select» 'hello from there, and where' «as» label, 'it''s from here\n and there' «as» text «from» readings «where» zone = 'a\\' from b'", [
      'SELECT', "  'hello from there, and where' AS label,", "  'it''s from here\n and there' AS text", 'FROM readings', "WHERE zone = 'a\\' from b'",
    ]),
  fixture('backticks and metric-view measures',
    '«select» `Location Zone`, «measure»(`Active Tag Count`), `a`` from b` «from» `my catalog`.`my schema`.`my view` «group» «by» `Location Zone`', [
      'SELECT', '  `Location Zone`,', '  MEASURE(`Active Tag Count`),', '  `a`` from b`', 'FROM `my catalog`.`my schema`.`my view`', 'GROUP BY `Location Zone`',
    ]),
  fixture('grouping/having/union/order/limit',
    '«select» zone, «count»(*) «from» readings «group» «by» zone «having» «count»(*) > 1 «and» «count»(*) < 10 «union» «all» «select» zone, 0 «from» empty «union» «select» zone, 1 «from» other «order» «by» zone «limit» 20', [
      'SELECT', '  zone,', '  COUNT(*)', 'FROM readings', 'GROUP BY zone', 'HAVING COUNT(*) > 1', '  AND COUNT(*) < 10', 'UNION ALL',
      'SELECT', '  zone,', '  0', 'FROM empty', 'UNION', 'SELECT', '  zone,', '  1', 'FROM other', 'ORDER BY zone', 'LIMIT 20',
    ]),
  fixture('function commas, CASE, nested queries, and deeper predicate indentation',
    "«select» «coalesce»(a, b), «case» «when» a = 1 «and» b = 2 «then» 'yes' «else» 'no' «end» «as» label «from» («select» a, b «from» readings) r «where» a «between» 1 «and» 3 «and» (b = 2 «or» b = 4)", [
      'SELECT', '  COALESCE(a, b),', "  CASE WHEN a = 1 AND b = 2 THEN 'yes' ELSE 'no' END AS label", 'FROM (', '  SELECT', '    a,', '    b',
      '  FROM readings', ') r', 'WHERE a BETWEEN 1 AND 3', '  AND (b = 2', '    OR b = 4)',
    ]),
  fixture('comments remain opaque and line comments cannot swallow SQL',
    '«select» a, -- from where\n b /* and select */ «from» readings «where» a >= 1 -- or hidden\n «and» b != 2', [
      'SELECT', '  a,', '  -- from where', '  b /* and select */', 'FROM readings', 'WHERE a >= 1 -- or hidden', '  AND b != 2',
    ]),
  fixture('window ORDER BY stays inline and aliases stay lowercase',
    '«select» «count»(*) «as» count, «row_number»() «over» («partition» «by» zone «order» «by» ts) «as» rn «from» t «where» payload:end > :limit «and» ts «between» 1 «and» 2', [
      'SELECT', '  COUNT(*) AS count,', '  ROW_NUMBER() OVER (PARTITION BY zone ORDER BY ts) AS rn', 'FROM t', 'WHERE payload:end > :limit', '  AND ts BETWEEN 1 AND 2',
    ]),
  fixture('EXTRACT/TRIM/SUBSTRING argument FROM stays inline',
    "«select» «extract»(year «from» ts), «trim»(«both» ' ' «from» x), «substring»(x «from» 1) «from» t", [
      'SELECT', '  EXTRACT(year FROM ts),', "  TRIM(BOTH ' ' FROM x),", '  SUBSTRING(x FROM 1)', 'FROM t',
    ]),
  fixture('IS DISTINCT FROM and IS NOT DISTINCT FROM stay inline',
    '«select» a «is» «distinct» «from» b «as» changed «from» t «where» a «is» «not» «distinct» «from» b «and» c > 1', [
      'SELECT', '  a IS DISTINCT FROM b AS changed', 'FROM t', 'WHERE a IS NOT DISTINCT FROM b', '  AND c > 1',
    ]),
  ...['ROLLUP', 'CUBE'].map((extension) => fixture(`WITH ${extension} stays with GROUP BY`,
    `«select» zone, «sum»(value) «from» t «group» «by» zone «with» «${extension.toLowerCase()}»`, [
      'SELECT', '  zone,', '  SUM(value)', 'FROM t', `GROUP BY zone WITH ${extension}`,
    ])),
  fixture('bare identifiers, function aliases, parameters, variant keys, and casts keep case',
    '«select» first, last, row, range, current, end, offset, partition, count, sum, min, max, data:count, payload:end, x::int, «count»(*) «as» count, «sum»(x) «as» sum «from» names «where» d > :limit «and» e = :end', [
      'SELECT', '  first,', '  last,', '  row,', '  range,', '  current,', '  end,', '  offset,', '  partition,', '  count,', '  sum,', '  min,', '  max,',
      '  data:count,', '  payload:end,', '  x::int,', '  COUNT(*) AS count,', '  SUM(x) AS sum', 'FROM names', 'WHERE d > :limit', '  AND e = :end',
    ]),
  fixture('aliases and params remain protected across comments',
    '«select» «count»(*) «as» /* alias */ count «from» t «where» data: /* key */ end > : /* param */ limit', [
      'SELECT', '  COUNT(*) AS /* alias */ count', 'FROM t', 'WHERE data: /* key */ end > : /* param */ limit',
    ]),
  fixture('window identifiers are not frame keywords',
    '«select» «sum»(count) «over» («partition» «by» range «order» «by» current) «as» first «from» names', [
      'SELECT', '  SUM(count) OVER (PARTITION BY range ORDER BY current) AS first', 'FROM names',
    ]),
  fixture('window frame syntax stays inline',
    '«select» «sum»(x) «over» («order» «by» ts «rows» «between» «unbounded» «preceding» «and» «current» «row») «from» t', [
      'SELECT', '  SUM(x) OVER (ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)', 'FROM t',
    ]),
  fixture('parenthesized select items and scalar subqueries are indented',
    '«select» (a+b) «as» c, («select» «max»(x) «from» u) «as» max «from» t', [
      'SELECT', '  (a+b) AS c,', '  (', '    SELECT', '      MAX(x)', '    FROM u', '  ) AS max', 'FROM t',
    ]),
  fixture('line comment directly before a scalar subquery close',
    '«select» («select» a «from» t -- keep ) from\n) «as» a «from» u', [
      'SELECT', '  (', '    SELECT', '      a', '    FROM t -- keep ) from', '  ) AS a', 'FROM u',
    ]),
  fixture('optimizer hint remains byte-identical',
    '«select» /*+ BROADCAST(t) */ t.id «from» t «join» u «on» t.id=u.id', [
      'SELECT', '  /*+ BROADCAST(t) */ t.id', 'FROM t', 'JOIN u', 'ON t.id=u.id',
    ]),
  fixture('backslashes do not escape backtick closing delimiters',
    '«select» `path\\`, `Location Zone`, `a``b` «from» t', [
      'SELECT', '  `path\\`,', '  `Location Zone`,', '  `a``b`', 'FROM t',
    ]),
  fixture('outer BETWEEN survives CASE and parenthesis scopes',
    '«select» x «from» t «where» x «between» «case» «when» a «between» 1 «and» 2 «and» b=1 «then» 1 «else» 0 «end» «and» (3+4) «and» y=2', [
      'SELECT', '  x', 'FROM t', 'WHERE x BETWEEN CASE WHEN a BETWEEN 1 AND 2 AND b=1 THEN 1 ELSE 0 END AND (3+4)', '  AND y=2',
    ]),
  fixture('CASE BETWEEN does not leak into the surrounding predicate',
    '«select» x «from» t «where» «case» «when» a «between» 1 «and» 2 «then» «true» «else» «false» «end» «and» (b «between» 2 «and» 3 «or» c=1) «and» d=2', [
      'SELECT', '  x', 'FROM t', 'WHERE CASE WHEN a BETWEEN 1 AND 2 THEN TRUE ELSE FALSE END', '  AND (b BETWEEN 2 AND 3', '    OR c=1)', '  AND d=2',
    ]),
  fixture('symbol adjacency, literal prefixes, and qualified names',
    '«select» r\'from here\', "from where", t.limit, 1.25, a::int «from» t «where» a>=1 «and» b<>2;', [
      'SELECT', '  r\'from here\',', '  "from where",', '  t.limit,', '  1.25,', '  a::int', 'FROM t', 'WHERE a>=1', '  AND b<>2;',
    ]),
  ...['LEFT SEMI JOIN', 'RIGHT SEMI JOIN', 'LEFT ANTI JOIN', 'RIGHT ANTI JOIN', 'SEMI JOIN', 'ANTI JOIN',
    'NATURAL LEFT JOIN', 'NATURAL RIGHT OUTER JOIN', 'NATURAL JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'JOIN', 'LEFT OUTER JOIN']
    .map((join) => fixture(`${join} is one clause`,
      `«select» a.id «from» a ${join.toLowerCase().split(' ').map((part) => `«${part}»`).join(' ')} b «on» a.id = b.id`, [
        'SELECT', '  a.id', 'FROM a', `${join} b`, 'ON a.id = b.id',
      ])),
  ...['EXCEPT', 'INTERSECT', 'MINUS'].map((operator) => fixture(`${operator} is a set operator`,
    `«select» x «from» a «${operator.toLowerCase()}» «select» x «from» b`, [
      'SELECT', '  x', 'FROM a', operator, 'SELECT', '  x', 'FROM b',
    ])),
  ...['count', 'sum', 'avg', 'min', 'max', 'cast', 'try_cast', 'coalesce', 'measure', 'first', 'last',
    'row', 'range', 'current', 'end', 'offset', 'partition', 'limit', 'with', 'Count', 'First']
    .map((identifier) => fixture(`preserves ${identifier} in every identifier position`,
      `«select» ${identifier}, payload:${identifier}, x::int «as» ${identifier} «from» t «where» x > :${identifier}`, [
        'SELECT', `  ${identifier},`, `  payload:${identifier},`, `  x::int AS ${identifier}`, 'FROM t', `WHERE x > :${identifier}`,
      ])),
  fixture('limit column starts the WHERE expression',
    '«select» a «from» t «where» limit > 5', [
      'SELECT', '  a', 'FROM t', 'WHERE limit > 5',
    ]),
  fixture('limit column after AND and ORDER BY',
    '«select» a «from» t «where» x = 1 «and» limit = 2 «order» «by» limit', [
      'SELECT', '  a', 'FROM t', 'WHERE x = 1', '  AND limit = 2', 'ORDER BY limit',
    ]),
  fixture('limit column in GROUP BY',
    '«select» a «from» t «group» «by» limit, offset', [
      'SELECT', '  a', 'FROM t', 'GROUP BY limit, offset',
    ]),
  ...['HAVING', 'QUALIFY', 'ON'].map((clause) => fixture(`limit column in ${clause}`,
    `«select» a «from» t ${clause === 'ON' ? '«join» u ' : ''}«${clause.toLowerCase()}» limit > 5`, [
      'SELECT', '  a', 'FROM t', ...(clause === 'ON' ? ['JOIN u'] : []), `${clause} limit > 5`,
    ])),
  ...['having', 'qualify', 'offset', 'union', 'except', 'intersect', 'minus'].map((name) => fixture(`${name} column in WHERE and GROUP/ORDER BY`,
    `«select» a «from» t «where» ${name} = 1 «or» ${name} > 2 «group» «by» ${name}, a «order» «by» ${name}`, [
      'SELECT', '  a', 'FROM t', `WHERE ${name} = 1`, `  OR ${name} > 2`, `GROUP BY ${name}, a`, `ORDER BY ${name}`,
    ])),
  ...['minus', 'union', 'except', 'intersect', 'having', 'qualify', 'offset', 'limit'].map((name) => fixture(`${name} is an implicit select alias`,
    `«select» x, a - b ${name} «from» t`, [
      'SELECT', '  x,', `  a - b ${name}`, 'FROM t',
    ])),
  ...['=', '<', '>', '<=', '>=', '<>', '!=', '+', '-', '*', '/', '%'].flatMap((operator) =>
    ['limit', 'having', 'qualify', 'offset', 'union', 'except', 'intersect', 'minus'].map((name) => fixture(`${name} after ${operator} is an operand`,
      `«select» a «from» t «where» x ${operator} ${name} «and» a = ${name}`, [
        'SELECT', '  a', 'FROM t', `WHERE x ${operator} ${name}`, `  AND a = ${name}`,
      ]))),
  fixture('limit operands in parentheses, NOT, IS, IN, and BETWEEN',
    '«select» a «from» t «where» (limit > 1) «and» «not» limit «and» a «is» limit «and» a «in» (limit, offset) «and» a «between» limit «and» offset', [
      'SELECT', '  a', 'FROM t', 'WHERE (limit > 1)', '  AND NOT limit', '  AND a IS limit', '  AND a IN (limit, offset)', '  AND a BETWEEN limit AND offset',
    ]),
  fixture('earlier function/window/variant/parameter example remains unchanged',
    '«select» «count»(*) «as» count, «row_number»() «over» («partition» «by» zone «order» «by» ts) «as» rn «from» t «where» payload:end > :limit «and» ts «between» 1 «and» 2', [
      'SELECT', '  COUNT(*) AS count,', '  ROW_NUMBER() OVER (PARTITION BY zone ORDER BY ts) AS rn', 'FROM t',
      'WHERE payload:end > :limit', '  AND ts BETWEEN 1 AND 2',
    ]),
  ...['having', 'qualify'].map((name) => fixture(`${name} table name is not a clause`,
    `«select» a «from» ${name} «where» a > 1`, ['SELECT', '  a', `FROM ${name}`, 'WHERE a > 1'])),
  fixture('LIMIT and OFFSET clauses',
    '«select» a «from» t «limit» 10 «offset» 5', [
      'SELECT', '  a', 'FROM t', 'LIMIT 10', 'OFFSET 5',
    ]),
  fixture('LIMIT named parameter',
    '«select» a «from» t «limit» :limit «offset» :offset', [
      'SELECT', '  a', 'FROM t', 'LIMIT :limit', 'OFFSET :offset',
    ]),
  fixture('LIMIT ALL', '«select» a «from» t «limit» «all»', ['SELECT', '  a', 'FROM t', 'LIMIT ALL']),
  fixture('LIMIT parenthesized value', '«select» a «from» t «limit» (10)', ['SELECT', '  a', 'FROM t', 'LIMIT (10)']),
  fixture('LIMIT without a recognizable value stays conservative',
    '«select» a «from» t «where» x = 1 «and» limit', ['SELECT', '  a', 'FROM t', 'WHERE x = 1', '  AND limit']),
  fixture('clause-position checks skip comments',
    '«select» a «from» t «where» /* operand */ limit /* comparison */ > 5 «order» «by» /* item */ limit', [
      'SELECT', '  a', 'FROM t', 'WHERE /* operand */ limit /* comparison */ > 5', 'ORDER BY /* item */ limit',
    ]),
  ...['UNION', 'EXCEPT', 'INTERSECT', 'MINUS'].map((operator) => fixture(`parenthesized top-level ${operator}`,
    `(«select» a «from» t) «${operator.toLowerCase()}» («select» b «from» u)`, [
      '(', '  SELECT', '    a', '  FROM t', ')', operator, '(', '  SELECT', '    b', '  FROM u', ')',
    ])),
  fixture('final line comment has no generated trailing newline',
    '«select» a «from» t -- final note  \n', ['SELECT', '  a', 'FROM t -- final note  ']),
  fixture('AND comment operand has continuation indentation',
    '«select» a «from» t «where» x = 1 «and» -- note\n limit = 2', [
      'SELECT', '  a', 'FROM t', 'WHERE x = 1', '  AND -- note', '  limit = 2',
    ]),
  fixture('nested OR comment operand has continuation indentation',
    '«select» a «from» t «where» x = 1 «and» (a = 1 «or» -- note\n b = 2)', [
      'SELECT', '  a', 'FROM t', 'WHERE x = 1', '  AND (a = 1', '    OR -- note', '    b = 2)',
    ]),
  ...['desc', 'asc', 'like', 'exists', 'in', 'is'].flatMap((name) => [
    fixture(`${name} at the start of a select list`, `«select» ${name}, x «from» t`, ['SELECT', `  ${name},`, '  x', 'FROM t']),
    fixture(`${name} at the end of a select list`, `«select» x, ${name} «from» t`, ['SELECT', '  x,', `  ${name}`, 'FROM t']),
    fixture(`${name} before AS in a select list`, `«select» x, ${name} «as» label «from» t`, ['SELECT', '  x,', `  ${name} AS label`, 'FROM t']),
  ]),
  fixture('wildcards still allow FROM clauses', '«select» * «from» t', ['SELECT', '  *', 'FROM t']),
  fixture('qualified wildcard still allows FROM clauses', '«select» t.* «from» t', ['SELECT', '  t.*', 'FROM t']),
  fixture('empty input', ' \n ', []),
];

describe('formatSql', () => {
  it.each(cases)('formats $name and is idempotent', ({ sql, formatted }) => {
    expect(formatSql(sql)).toBe(formatted);
    expect(formatSql(formatSql(sql))).toBe(formatted);
  });

  it.each(cases)('semantic-safety property: $name', ({ sql, safeTokens }) => {
    // Exact token equality, not blanket case-insensitive SQL equality: an alias
    // named count is NOT interchangeable with COUNT, unlike the function token.
    expect(significantTokens(formatSql(sql))).toEqual(significantTokens(safeTokens));
  });

  it.each([null, undefined, ''])('returns empty SQL for %s', (sql) => {
    expect(formatSql(sql)).toBe('');
  });
});
