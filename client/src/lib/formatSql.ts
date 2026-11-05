type Token = { text: string; space: boolean; kind: 'word' | 'quoted' | 'comment' | 'symbol' };

// Quoted content and comments are opaque. Backticks escape backticks by doubling
// them, NOT with backslashes. Preserve symbol adjacency (>=, ::, literal prefixes).
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let space = false;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { space = true; i++; continue; }
    const start = i;
    let kind: Token['kind'] = 'symbol';
    const quote = sql[i];
    if (quote === "'" || quote === '`' || quote === '"') {
      kind = 'quoted';
      i++;
      while (i < sql.length) {
        if (quote !== '`' && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          break;
        }
      }
    } else if (sql.startsWith('--', i)) {
      kind = 'comment';
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
    } else if (sql.startsWith('/*', i)) {
      kind = 'comment';
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
    } else if (/[\p{L}\p{N}_$]/u.test(sql[i])) {
      kind = 'word';
      while (i < sql.length && /[\p{L}\p{N}_$]/u.test(sql[i])) i++;
    } else i++;
    tokens.push({ text: sql.slice(start, i), space, kind });
    space = false;
  }
  return tokens;
}

const FUNCTIONS = new Set('MEASURE COUNT SUM AVG MIN MAX CAST TRY_CAST COALESCE FIRST LAST ROW_NUMBER EXTRACT TRIM SUBSTRING'.split(' '));
const PREDICATES = new Set(['WHERE', 'HAVING', 'ON', 'QUALIFY']);
const SET_OPERATORS = new Set(['UNION', 'EXCEPT', 'INTERSECT', 'MINUS']);
const OPERATORS = new Set(['=', '<', '>', '!', '+', '-', '*', '/', '%', '|', '&', '^', '~']);
const EXPECT_OPERAND = new Set(['BY', 'AND', 'OR', 'NOT', 'FROM', 'JOIN', 'WHERE', 'ON', 'HAVING', 'QUALIFY', 'SELECT', 'IS', 'IN', 'BETWEEN']);

/** Conservative display formatting: change whitespace and recognized syntax only.
 * Ambiguous bare words retain their case, especially aliases and variant keys.
 */
export function formatSql(sql?: string | null): string {
  if (!sql) return '';
  const tokens = tokenize(sql);
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'symbol') return;
    if (token.text === '(') stack.push(index);
    if (token.text === ')') {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, index);
    }
  });
  function previous(index: number): number {
    do { index--; } while (tokens[index]?.kind === 'comment');
    return index;
  }
  function next(index: number): number {
    do { index++; } while (tokens[index]?.kind === 'comment');
    return index;
  }
  const rawWord = (index: number): string => tokens[index]?.kind === 'word' ? tokens[index].text.toUpperCase() : '';
  function word(index: number): string {
    const prev = previous(index);
    // AS names, qualified identifiers, named parameters, and variant keys are
    // never syntax. A double colon is a cast, not a variant-path separator.
    if (rawWord(prev) === 'AS' || tokens[prev]?.text === '.' || tokens[next(index)]?.text === '.' ||
      (tokens[prev]?.text === ':' && tokens[previous(prev)]?.text !== ':')) return '';
    return rawWord(index);
  }
  // Ambiguous clause words cannot start a clause where an operand is expected.
  function clausePosition(index: number): boolean {
    const prev = previous(index);
    const following = next(index);
    const before = tokens[prev]?.text;
    const after = tokens[following]?.text;
    return !OPERATORS.has(before) && ![',', '('].includes(before) &&
      !EXPECT_OPERAND.has(word(prev)) && !OPERATORS.has(after) && ![',', ')', '.'].includes(after);
  }
  function queryStartsAt(index: number): boolean {
    while (tokens[index]?.text === '(' && pairs.has(index)) index = next(index);
    return word(index) === 'SELECT' || word(index) === 'WITH';
  }
  let output = '';
  let lineStart = true;
  function newline() {
    if (output && !lineStart) output += '\n';
    lineStart = true;
  }
  function emit(text: string, indent: number, space = false) {
    if (lineStart) output += '  '.repeat(indent);
    else if (space) output += ' ';
    output += text;
    lineStart = false;
  }
  function render(start: number, end: number, indent: number, isQuery: boolean, initialClause = '', group = '') {
    let clause = initialClause;
    // Each CASE and parenthesis gets its own BETWEEN state. An outer BETWEEN
    // survives a CASE expression without consuming an AND inside that CASE.
    const between = [false];
    const inlineSyntax = new Set<number>();
    let windowFrame = false;
    let predicateContinuation = false;
    for (let i = start; i < end; i++) {
      const token = tokens[i];
      const keyword = word(i);
      const prev = previous(i);
      const following = next(i);
      const contentIndent = indent + (clause === 'SELECT' ? 1 : 0);
      const continuationIndent = contentIndent + (lineStart && predicateContinuation ? 1 : 0);
      if (token.kind === 'comment') {
        emit(token.text, continuationIndent, token.space);
        if (token.text.startsWith('--')) newline();
        continue;
      }
      if (token.kind === 'symbol' && token.text === '(' && pairs.has(i)) {
        const close = pairs.get(i)!;
        emit('(', continuationIndent, token.space);
        const first = next(i);
        const nestedQuery = queryStartsAt(first);
        const functionGroup = tokens[prev]?.kind === 'word' && !['IN', 'EXISTS', 'NOT', 'AND', 'OR', 'WHERE', 'HAVING', 'ON'].includes(word(prev));
        const predicateGroup = !functionGroup && PREDICATES.has(clause);
        if (nestedQuery) newline();
        render(i + 1, close, contentIndent + (nestedQuery || predicateGroup ? 1 : 0), nestedQuery,
          predicateGroup ? clause : '', word(prev));
        if (nestedQuery) newline();
        // A line comment immediately before ')' must keep its terminating newline.
        emit(')', contentIndent);
        if (isQuery && nestedQuery && !clause) clause = 'QUERY';
        i = close;
        continue;
      }
      let syntax = inlineSyntax.has(i);
      if (keyword === 'CASE') { between.push(false); syntax = true; }
      else if (between.length > 1 && ['WHEN', 'THEN', 'ELSE', 'END'].includes(keyword)) {
        syntax = true;
        if (keyword === 'END') between.pop();
        else between[between.length - 1] = false;
      }
      const inCase = between.length > 1;
      const distinctFrom = keyword === 'FROM' && rawWord(prev) === 'DISTINCT' &&
        (rawWord(previous(prev)) === 'IS' || (rawWord(previous(prev)) === 'NOT' && rawWord(previous(previous(prev))) === 'IS'));
      let major = '';
      let length = 1;
      if (isQuery && !inCase && keyword) {
        if (keyword === 'SELECT' || (keyword === 'WITH' && i === next(start - 1))) major = keyword;
        else if (keyword === 'FROM' && clause === 'SELECT' && !distinctFrom) major = keyword;
        else if (['WHERE', 'HAVING', 'QUALIFY', 'LIMIT', 'OFFSET'].includes(keyword) && clause && clause !== 'SELECT' && clause !== 'WITH' && (keyword === 'WHERE' || clausePosition(i))) {
          const limitValue = /^\d+(?:[eE]\d+)?$/.test(tokens[following]?.text ?? '') ||
            (tokens[following]?.text === ':' && tokens[next(following)]?.kind === 'word') ||
            tokens[following]?.text === '(' || word(following) === 'ALL';
          if (!['LIMIT', 'OFFSET'].includes(keyword) || limitValue) major = keyword;
        } else if (keyword === 'ON' && clause.endsWith('JOIN')) major = keyword;
        else if ((keyword === 'GROUP' || keyword === 'ORDER') && word(i + 1) === 'BY') {
          major = `${keyword} BY`; length = 2;
        } else if (SET_OPERATORS.has(keyword) && clause && clause !== 'WITH' && clausePosition(i) &&
          queryStartsAt(['ALL', 'DISTINCT'].includes(word(following)) ? next(following) : following)) {
          major = ['ALL', 'DISTINCT'].includes(word(i + 1)) ? `${keyword} ${word(i + 1)}` : keyword;
          length = major.split(' ').length;
        } else if (clause && clause !== 'SELECT' && clause !== 'WITH') {
          // Match the whole join prefix, never splitting LEFT SEMI or NATURAL LEFT.
          const joinWords = [];
          for (let j = i; j < Math.min(end, i + 4) && word(j); j++) joinWords.push(word(j));
          const match = joinWords.join(' ').match(/^(?:(?:NATURAL )?(?:(?:LEFT|RIGHT|INNER|FULL|CROSS)(?: OUTER| SEMI| ANTI)? |(?:SEMI|ANTI) )?)JOIN\b/);
          if (match) { major = match[0]; length = major.split(' ').length; }
        }
      }
      if (major) {
        clause = major;
        between[0] = false;
        predicateContinuation = false;
        newline();
        emit(major, indent);
        if (major === 'LIMIT' && word(following) === 'ALL') inlineSyntax.add(following);
        i += length - 1;
        if (major === 'SELECT' || major === 'WITH') {
          if (['DISTINCT', 'ALL', 'RECURSIVE'].includes(word(i + 1))) emit(word(++i), indent, true);
          newline();
        }
        if (SET_OPERATORS.has(keyword)) newline();
        continue;
      }
      // Inline constructs must not become clauses, even when their spelling
      // matches FROM/WITH/ORDER BY. Comments are not consumed by phrase matching.
      if (distinctFrom || (['EXTRACT', 'TRIM', 'SUBSTRING'].includes(group) && keyword === 'FROM')) syntax = true;
      if (group === 'TRIM' && ['BOTH', 'LEADING', 'TRAILING'].includes(keyword)) syntax = true;
      if (group === 'OVER') {
        if (['PARTITION', 'ORDER'].includes(keyword) && word(i + 1) === 'BY') {
          syntax = true; inlineSyntax.add(i + 1);
        }
        if (['ROWS', 'RANGE'].includes(keyword) &&
          (['BETWEEN', 'UNBOUNDED', 'CURRENT'].includes(word(i + 1)) || /^\d+$/.test(tokens[i + 1]?.text ?? ''))) {
          windowFrame = true; syntax = true;
        }
        if (windowFrame && ['UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'BETWEEN'].includes(keyword)) syntax = true;
        if (windowFrame && keyword === 'CURRENT' && word(i + 1) === 'ROW') { syntax = true; inlineSyntax.add(i + 1); }
      }
      if (clause === 'GROUP BY' && keyword === 'WITH' && ['ROLLUP', 'CUBE'].includes(word(i + 1))) {
        syntax = true; inlineSyntax.add(i + 1);
      }
      if (keyword === 'NULLS' && ['FIRST', 'LAST'].includes(word(i + 1))) { syntax = true; inlineSyntax.add(i + 1); }
      if (keyword === 'OVER' && tokens[following]?.text === '(') syntax = true;
      if (keyword === 'AS' || (FUNCTIONS.has(keyword) && tokens[following]?.text === '(')) syntax = true;
      if (['IS', 'NOT', 'NULL', 'TRUE', 'FALSE', 'IN', 'EXISTS', 'LIKE', 'RLIKE', 'ILIKE', 'DISTINCT', 'ASC', 'DESC'].includes(keyword)) syntax = true;
      if (keyword === 'BETWEEN') { between[between.length - 1] = true; syntax = true; }
      if (keyword === 'AND' || keyword === 'OR') {
        syntax = true;
        const rangeAnd = keyword === 'AND' && between[between.length - 1];
        if (rangeAnd) between[between.length - 1] = false;
        if (PREDICATES.has(clause) && !inCase && !rangeAnd) {
          newline();
          emit(keyword, indent + 1);
          predicateContinuation = true;
          continue;
        }
      }
      const bareSelectItem = clause === 'SELECT' && ['DESC', 'ASC', 'LIKE', 'EXISTS', 'IN', 'IS'].includes(keyword) &&
        (tokens[prev]?.text === ',' || rawWord(prev) === 'SELECT') &&
        (tokens[following]?.text === ',' || ['FROM', 'AS'].includes(rawWord(following)));
      if (bareSelectItem) syntax = false;
      if (token.kind === 'symbol' && token.text === ',') {
        emit(',', contentIndent);
        if (isQuery && (clause === 'SELECT' || clause === 'WITH') && !inCase) newline();
      } else emit(syntax ? keyword : token.text, continuationIndent, token.space);
    }
  }
  render(0, tokens.length, 0, true);
  // Remove only the newline we emitted after a final line comment. Never trim
  // whitespace belonging to a literal, identifier, or the comment text itself.
  return lineStart ? output.replace(/\n$/, '') : output;
}
