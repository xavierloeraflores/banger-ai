export interface Position { line: number; column: number; offset: number }
export class CompileError extends SyntaxError {
  readonly line: number;
  readonly column: number;
  readonly position: Position;
  constructor(message: string, position: Position) {
    super(`${message} at ${position.line}:${position.column}`);
    this.name = 'CompileError';
    this.line = position.line;
    this.column = position.column;
    this.position = { ...position };
  }
}
export interface Token extends Position { kind: 'number' | 'string' | 'identifier' | 'symbol' | 'eof'; text: string }
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|\/\/[^\r\n]*|"(?:[^"\\\r\n]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[{}+*/()=;-]/gy;
  let offset = 0, line = 1, column = 1;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const text = pattern.exec(source)?.[0];
    if (!text) throw new CompileError(source[offset] === '"' ? 'Invalid or unterminated string' : `Unexpected character ${JSON.stringify(source[offset])}`, { line, column, offset });
    if (!/^\s/.test(text) && !text.startsWith('//')) {
      const kind = text[0] === '"' ? 'string' : /^[\d.]/.test(text) ? 'number' : /^[A-Za-z_]/.test(text) ? 'identifier' : 'symbol';
      tokens.push({ kind, text, line, column, offset });
      if (tokens.length > 16384) throw new CompileError('Too many tokens', { line, column, offset });
    }
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 1) { line += lines.length - 1; column = lines[lines.length - 1].length + 1; }
    else column += text.length;
    offset += text.length;
  }
  tokens.push({ kind: 'eof', text: '', line, column, offset });
  return tokens;
}
