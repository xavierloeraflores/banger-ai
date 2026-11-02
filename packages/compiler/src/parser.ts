import { CompileError, tokenize, type Token } from './lexer.js';
import { validatePianoNote, type PianoNote, INSTRUMENT_NAMES, MUSIC_LIMITS, SOUND_NAMES, isTrackName, type InstrumentName, type MusicProgram, type MusicTrack, type ReverbEffect, type SoundName, type Step } from './model.js';
type Value = string | number;
const pitchClasses: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

class Parser {
  private cursor = 0;
  private readonly variables = new Map<string, Value>();
  constructor(private readonly tokens: Token[]) {}
  private get token(): Token { return this.tokens[this.cursor]; }
  private take(): Token { return this.tokens[this.cursor++]; }
  private error(message: string, token = this.token): never { throw new CompileError(message, token); }
  private expect(text: string): Token {
    if (this.token.text !== text) this.error(`Expected '${text}', found '${this.token.text || 'end of file'}'`);
    return this.take();
  }
  private identifier(): Token {
    if (this.token.kind !== 'identifier') this.error('Expected an identifier');
    return this.take();
  }
  private number(value: Value, token: Token): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) this.error('Expected a finite number', token);
    return value;
  }
  private string(value: Value, token: Token): string {
    if (typeof value !== 'string') this.error('Expected a string', token);
    return value;
  }
  private unit(value: Value, token: Token): number {
    const result = this.number(value, token);
    if (result < 0 || result > 1) this.error('Expected a value between 0 and 1', token);
    return result;
  }
  private expression(min = 0, depth = 0): Value {
    if (depth > 64) this.error('Expression nesting exceeds 64 levels');
    const token = this.take();
    let left: Value;
    if (token.text === '+' || token.text === '-') {
      left = this.number(this.expression(3, depth + 1), token) * (token.text === '-' ? -1 : 1);
    } else if (token.text === '(') { left = this.expression(0, depth + 1); this.expect(')'); }
    else if (token.kind === 'number') left = this.number(Number(token.text), token);
    else if (token.kind === 'string') {
      try { left = JSON.parse(token.text) as string; }
      catch { this.error('Invalid string literal', token); }
    }
    else if (token.kind === 'identifier') {
      const value = this.variables.get(token.text);
      if (value === undefined) this.error(`Unknown variable '${token.text}'`, token);
      left = value;
    } else this.error('Expected a number, string, variable, or expression', token);
    while (true) {
      const op = this.token;
      const precedence = op.text === '+' || op.text === '-' ? 1 : op.text === '*' || op.text === '/' ? 2 : 0;
      if (!precedence || precedence <= min) break;
      this.take();
      const right = this.number(this.expression(precedence, depth + 1), op);
      const lhs = this.number(left, op);
      if (op.text === '/' && right === 0) this.error('Division by zero', op);
      left = this.number(op.text === '+' ? lhs + right : op.text === '-' ? lhs - right : op.text === '*' ? lhs * right : lhs / right, op);
    }
    return left;
  }
  parse(): MusicProgram {
    const program: MusicProgram = { tempo: 120, meter: { numerator: 4, denominator: 4 }, tracks: [] };
    const declarations = new Set<string>(), names = new Set<string>();
    while (this.token.kind !== 'eof') {
      const token = this.identifier();
      switch (token.text) {
        case 'let': {
          const name = this.identifier();
          if (this.variables.has(name.text)) this.error(`Variable '${name.text}' is already declared`, name);
          this.expect('=');
          this.variables.set(name.text, this.expression());
          this.expect(';');
          break;
        }
        case 'tempo': {
          if (declarations.has('tempo')) this.error('Tempo is already declared', token);
          declarations.add('tempo');
          program.tempo = this.number(this.expression(), token);
          if (program.tempo < MUSIC_LIMITS.minTempo || program.tempo > MUSIC_LIMITS.maxTempo) this.error('Tempo must be between 20 and 300 BPM', token);
          this.expect(';');
          break;
        }
        case 'meter': {
          if (declarations.has('meter')) this.error('Meter is already declared', token);
          declarations.add('meter');
          this.expect('4'); this.expect('/'); this.expect('4'); this.expect(';');
          break;
        }
        case 'track': {
          if (program.tracks.length >= MUSIC_LIMITS.tracks) this.error('A program can have at most 16 tracks', token);
          const name = this.identifier();
          if (!isTrackName(name.text)) this.error('Track names must have 1 to 64 characters', name);
          if (names.has(name.text)) this.error(`Duplicate track '${name.text}'`, name);
          names.add(name.text);
          program.tracks.push(this.track(name));
          break;
        }
        default: this.error(`Unknown statement '${token.text}'`, token);
      }
    }
    return program;
  }
  private pitch(word: string, token: Token): number {
    const match = /^([A-G])([#b]?)(-?\d)$/.exec(word);
    if (!match) this.error(`Invalid note '${word}'`, token);
    const midi = (Number(match[3]) + 1) * 12 + pitchClasses[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    if (midi < 0 || midi > 127) this.error(`Note '${word}' is outside MIDI range 0 to 127`, token);
    return midi;
  }
  private piano(): PianoNote[] {
    this.expect('{');
    const notes: PianoNote[] = [];
    while (this.token.text !== '}') {
      const token = this.expect('note');
      if (notes.length >= MUSIC_LIMITS.notes) this.error('Piano rolls support at most 128 notes', token);
      const midi = this.pitch(this.string(this.expression(), token), token);
      this.expect('start'); const start = this.number(this.expression(), token);
      this.expect('duration'); const duration = this.number(this.expression(), token);
      this.expect('velocity'); const velocity = this.unit(this.expression(), token);
      this.expect(';');
      const note = { midi, start, duration, velocity };
      try { validatePianoNote(note); }
      catch (error) { this.error((error as Error).message, token); }
      notes.push(note);
    }
    this.expect('}');
    if (this.tokens[this.cursor].text === ';') this.take();
    return notes;
  }
  private track(name: Token): MusicTrack {
    this.expect('{');
    let source: MusicTrack['source'] | undefined, steps: Step[] | undefined, patternKind: string | undefined;
    let pianoRoll: PianoNote[] | undefined;
    let gain = 1;
    const seen = new Set<string>(), effects: ReverbEffect[] = [];
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (seen.has(property.text)) this.error(`Duplicate property '${property.text}'`, property);
      seen.add(property.text);
      if (property.text === 'piano') {
        if (steps) this.error('A track can have only one pattern', property);
        pianoRoll = this.piano(); steps = []; patternKind = 'piano';
        continue;
      }
      if (property.text === 'effect') {
        this.expect('reverb'); this.expect('{');
        let mix = 0.2;
        if (this.token.text !== '}') { this.expect('mix'); mix = this.unit(this.expression(), property); this.expect(';'); }
        this.expect('}');
        if (this.tokens[this.cursor].text === ';') this.take();
        effects.push({ kind: 'reverb', mix });
        continue;
      }
      const valueToken = this.token;
      const value = this.expression();
      this.expect(';');
      switch (property.text) {
        case 'sound':
        case 'instrument': {
          if (source) this.error('A track can have only one source', property);
          const selected = this.string(value, valueToken);
          if (property.text === 'sound') {
            if (!SOUND_NAMES.includes(selected as SoundName)) this.error(`Unknown sound '${selected}'`, valueToken);
            source = { kind: 'sound', name: selected as SoundName };
          } else {
            if (!INSTRUMENT_NAMES.includes(selected as InstrumentName)) this.error(`Unknown instrument '${selected}'`, valueToken);
            source = { kind: 'instrument', name: selected as InstrumentName };
          }
          break;
        }
        case 'rhythm':
        case 'notes': {
          if (steps) this.error('A track can have only one pattern', property);
          const words = this.string(value, valueToken).trim().split(/\s+/);
          if (!words[0] || words.length > MUSIC_LIMITS.steps) this.error('Patterns must have 1 to 64 steps', valueToken);
          patternKind = property.text;
          steps = words.map((word): Step => {
            if (word === '.') return null;
            if (property.text === 'rhythm') {
              if (word !== 'x') this.error(`Invalid rhythm token '${word}'`, valueToken);
              return { kind: 'hit' };
            }
            const midi = this.pitch(word, valueToken);
            return { kind: 'note', midi };
          });
          break;
        }
        case 'gain': gain = this.unit(value, valueToken); break;
        default: this.error(`Unknown track property '${property.text}'`, property);
      }
    }
    this.expect('}');
    if (this.tokens[this.cursor].text === ';') this.take();
    if (!source || !steps) this.error('A track requires a source and a pattern', name);
    if ((source.kind === 'sound') !== (patternKind === 'rhythm')) this.error('Use rhythm with sound, and notes or piano with instrument', name);
    return { name: name.text, source, steps, gain, ...(pianoRoll === undefined ? {} : { pianoRoll }), ...(effects.length ? { effects } : {}) };
  }
}

export function compileMusic(source: string): MusicProgram {
  if (typeof source !== 'string' || source.length > MUSIC_LIMITS.sourceLength)
    throw new CompileError('Source must be a string of at most 65536 characters', { line: 1, column: 1, offset: 0 });
  return new Parser(tokenize(source)).parse();
}
