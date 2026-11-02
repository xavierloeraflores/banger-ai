import { CompileError, tokenize, type Token } from './lexer.js';
import { validateMusicProgram, validateEffect, type MusicBus, type MusicSection, type TimelineEntry, type MusicPattern, type Groove, type AutomationCurve, type AutomationTarget, type PianoNote, INSTRUMENT_NAMES, MUSIC_LIMITS, SOUND_NAMES, isTrackName, type InstrumentName, type MusicProgram, type MusicTrack, type MusicEffect, type SoundName, type Step } from './model.js';
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
          const track = this.track(name);
          program.tracks.push(track);
          break;
        }
        case 'bus': {
          const name = this.identifier();
          (program.buses ??= []).push(this.bus(name)); break;
        }
        case 'section': {
          const name = this.identifier();
          (program.sections ??= []).push(this.section(name)); break;
        }
        case 'song': {
          if (program.timeline) this.error('Song is already declared', token);
          program.timeline = this.song(); break;
        }
        default: this.error(`Unknown statement '${token.text}'`, token);
      }
    }
    try { validateMusicProgram(program); }
    catch (error) { this.error((error as Error).message); }
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
      notes.push(note);
    }
    this.expect('}');
    if (this.tokens[this.cursor].text === ';') this.take();
    return notes;
  }
  private endBlock(): void {
    this.expect('}');
    if (this.tokens[this.cursor].text === ';') this.take();
  }
  private numeric(): number { const token = this.token; return this.number(this.expression(), token); }
  private effect(): MusicEffect {
    const kind = this.identifier();
    const defaults: Record<string, Record<string, number | string>> = {
      reverb: { mix: .2 }, delay: { mix: .25, time: .25, feedback: .35 }, filter: { cutoff: 2000, resonance: 1 },
      eq: { low: 0, mid: 0, high: 0 }, compressor: { threshold: -24, ratio: 4, attack: .01, release: .1, knee: 20 },
      distortion: { amount: .2, mix: .5 },
    };
    if (!Object.hasOwn(defaults, kind.text)) this.error(`Unknown effect '${kind.text}'`, kind);
    const parameters = { ...defaults[kind.text] }, seen = new Set<string>();
    this.expect('{');
    while (this.token.text !== '}') {
      const parameter = this.identifier();
      if (seen.has(parameter.text)) this.error(`Duplicate parameter '${parameter.text}'`, parameter);
      seen.add(parameter.text);
      if (kind.text === 'compressor' && parameter.text === 'sidechain') parameters.sidechain = this.identifier().text;
      else {
        if (!Object.hasOwn(parameters, parameter.text)) this.error(`Unknown ${kind.text} parameter '${parameter.text}'`, parameter);
        parameters[parameter.text] = this.numeric();
      }
      this.expect(';');
    }
    this.endBlock();
    const effect = { kind: kind.text, ...parameters } as unknown as MusicEffect;
    try { validateEffect(effect); } catch (error) { this.error((error as Error).message, kind); }
    return effect;
  }
  private automation(): AutomationCurve {
    const token = this.token;
    const target = this.string(this.expression(), token) as AutomationTarget;
    const curve: AutomationCurve = { target, points: [] };
    this.expect('{');
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (property.text === 'interpolation') {
        if (curve.interpolation !== undefined) this.error('Duplicate interpolation', property);
        const mode = this.identifier();
        if (mode.text !== 'linear' && mode.text !== 'step') this.error('Interpolation must be linear or step', mode);
        curve.interpolation = mode.text;
      } else if (property.text === 'point') {
        const token = this.token, beat = this.number(this.expression(2), token), value = this.numeric();
        curve.points.push({ beat, value });
        if (curve.points.length > MUSIC_LIMITS.points) this.error('Too many automation points', property);
      } else this.error(`Unknown automation property '${property.text}'`, property);
      this.expect(';');
    }
    this.endBlock(); return curve;
  }
  private groove(): Groove {
    const groove: Groove = {}, seen = new Set<string>();
    this.expect('{');
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (!['quantize', 'swing', 'humanize', 'seed'].includes(property.text)) this.error(`Unknown groove property '${property.text}'`, property);
      if (seen.has(property.text)) this.error(`Duplicate groove property '${property.text}'`, property);
      seen.add(property.text);
      groove[property.text as keyof Groove] = this.numeric(); this.expect(';');
    }
    this.endBlock(); return groove;
  }
  private mixerProperty(item: MusicTrack | MusicBus, property: Token): boolean {
    switch (property.text) {
      case 'effect': (item.effects ??= []).push(this.effect()); return true;
      case 'automation': (item.automation ??= []).push(this.automation()); return true;
      case 'send': {
        const bus = this.identifier().text, gain = this.numeric();
        (item.sends ??= []).push({ bus, gain }); this.expect(';'); return true;
      }
      case 'gain': item.gain = this.numeric(); this.expect(';'); return true;
      case 'pan': item.pan = this.numeric(); this.expect(';'); return true;
      default: return false;
    }
  }
  private steps(kind: string): Step[] {
    const token = this.token, words = this.string(this.expression(), token).trim().split(/\s+/);
    if (!words[0] || words.length > MUSIC_LIMITS.steps) this.error('Patterns must have 1 to 64 steps', token);
    this.expect(';');
    return words.map((word): Step => {
      if (word === '.') return null;
      if (kind === 'rhythm') {
        if (word !== 'x') this.error(`Invalid rhythm token '${word}'`, token);
        return { kind: 'hit' };
      }
      return { kind: 'note', midi: this.pitch(word, token) };
    });
  }
  private phrase(name: Token): { pattern: MusicPattern; kind: string } {
    const pattern: MusicPattern = { name: name.text, steps: [] };
    let kind = '';
    this.expect('{');
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (property.text === 'bars') {
        if (pattern.bars !== undefined) this.error('Duplicate bars', property);
        pattern.bars = this.numeric(); this.expect(';');
      } else if (['rhythm', 'notes', 'piano'].includes(property.text)) {
        if (kind) this.error('A pattern can have only one rhythm, notes or piano block', property);
        kind = property.text;
        if (kind === 'piano') pattern.pianoRoll = this.piano();
        else pattern.steps = this.steps(kind);
      } else this.error(`Unknown pattern property '${property.text}'`, property);
    }
    this.endBlock();
    if (!kind) this.error('A pattern requires rhythm, notes or piano', name);
    return { pattern, kind };
  }
  private track(name: Token): MusicTrack {
    this.expect('{');
    const track = { name: name.text, gain: 1, steps: [] } as unknown as MusicTrack;
    const seen = new Set<string>(), patternKinds: string[] = [];
    let baseKind = '';
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (!['effect', 'pattern', 'send', 'automation'].includes(property.text) && seen.has(property.text)) this.error(`Duplicate property '${property.text}'`, property);
      seen.add(property.text);
      if (this.mixerProperty(track, property)) continue;
      switch (property.text) {
        case 'sound': case 'instrument': {
          if (track.source) this.error('A track can have only one source', property);
          const token = this.token, selected = this.string(this.expression(), token);
          if (property.text === 'sound') {
            if (!SOUND_NAMES.includes(selected as SoundName)) this.error(`Unknown sound '${selected}'`, token);
            track.source = { kind: 'sound', name: selected as SoundName };
          } else {
            if (!INSTRUMENT_NAMES.includes(selected as InstrumentName)) this.error(`Unknown instrument '${selected}'`, token);
            track.source = { kind: 'instrument', name: selected as InstrumentName };
          }
          this.expect(';'); break;
        }
        case 'bars': track.bars = this.numeric(); this.expect(';'); break;
        case 'output': track.output = this.identifier().text; this.expect(';'); break;
        case 'groove': track.groove = this.groove(); break;
        case 'pattern': {
          const result = this.phrase(this.identifier());
          (track.patterns ??= []).push(result.pattern); patternKinds.push(result.kind); break;
        }
        case 'rhythm': case 'notes': case 'piano': {
          if (baseKind) this.error('A track can have only one base pattern', property);
          baseKind = property.text;
          if (baseKind === 'piano') track.pianoRoll = this.piano(); else track.steps = this.steps(baseKind);
          break;
        }
        default: this.error(`Unknown track property '${property.text}'`, property);
      }
    }
    this.endBlock();
    if (!track.source || !baseKind) this.error('A track requires a source and a pattern', name);
    for (const kind of [baseKind, ...patternKinds]) if ((track.source.kind === 'sound') !== (kind === 'rhythm')) this.error('Use rhythm with sound, and notes or piano with instrument', name);
    return track;
  }
  private bus(name: Token): MusicBus {
    const bus: MusicBus = { name: name.text, gain: 1 }, seen = new Set<string>();
    this.expect('{');
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (!['effect', 'send', 'automation'].includes(property.text) && seen.has(property.text)) this.error(`Duplicate property '${property.text}'`, property);
      seen.add(property.text);
      if (!this.mixerProperty(bus, property)) this.error(`Unknown bus property '${property.text}'`, property);
    }
    this.endBlock(); return bus;
  }
  private section(name: Token): MusicSection {
    const section: MusicSection = { name: name.text, bars: 1, tracks: [] };
    let hasBars = false;
    this.expect('{');
    while (this.token.text !== '}') {
      const property = this.identifier();
      if (property.text === 'bars') {
        if (hasBars) this.error('Duplicate bars', property);
        hasBars = true; section.bars = this.numeric();
      } else if (property.text === 'play') {
        const track = this.identifier().text;
        const pattern = this.token.kind === 'identifier' ? this.identifier().text : undefined;
        section.tracks.push({ track, ...(pattern === undefined ? {} : { pattern }) });
      } else this.error(`Unknown section property '${property.text}'`, property);
      this.expect(';');
    }
    this.endBlock(); return section;
  }
  private song(): TimelineEntry[] {
    const timeline: TimelineEntry[] = [];
    this.expect('{');
    while (this.token.text !== '}') {
      this.expect('play');
      const section = this.identifier().text;
      const repeats = this.token.text === ';' ? undefined : this.numeric();
      timeline.push({ section, ...(repeats === undefined ? {} : { repeats }) }); this.expect(';');
    }
    this.endBlock(); return timeline;
  }
}

export function compileMusic(source: string): MusicProgram {
  if (typeof source !== 'string' || source.length > MUSIC_LIMITS.sourceLength)
    throw new CompileError('Source must be a string of at most 65536 characters', { line: 1, column: 1, offset: 0 });
  return new Parser(tokenize(source)).parse();
}
