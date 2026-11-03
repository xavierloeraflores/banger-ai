import { INIT_SYNTH } from "@banger/compiler";

const keywords = new Set([
  "let", "tempo", "meter", "master", "metronome", "activePattern", "chain",
  "track", "bus", "section", "song", "play", "bars", "pattern", "sound", "instrument",
  "rhythm", "notes", "piano", "note", "start", "duration", "velocity", "gain", "pan",
  "mute", "solo", "output", "send", "effect", "automation", "interpolation", "point",
  "groove", "quantize", "swing", "humanize", "seed", "synth", "modular", "patch", "lock",
  "time", "feedback", "low", "mid", "high", "threshold", "ratio", "knee", "amount", "sidechain",
  ...Object.keys(INIT_SYNTH),
]);
const values = new Set(["on", "off", "linear", "step", "filter", "eq", "delay", "reverb", "distortion", "compressor"]);

export interface SourceToken {
  text: string;
  offset: number;
  kind: "plain" | "comment" | "string" | "number" | "keyword" | "value" | "identifier" | "symbol";
  error: boolean;
}

// Unlike the compiler lexer, keep rendering after incomplete strings and invalid
// characters so a draft remains highlighted while the user is typing.
export function highlightBanger(source: string, errorOffset?: number): SourceToken[] {
  const pattern = /\s+|\/\/[^\r\n]*|"(?:[^"\\\r\n]|\\[^\r\n])*(?:"|(?=\r|\n|$))|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^]/g;
  const tokens: SourceToken[] = [];
  for (const match of source.matchAll(pattern)) {
    const text = match[0], offset = match.index;
    const kind: SourceToken["kind"] = /^\s/.test(text) ? "plain"
      : text.startsWith("//") ? "comment"
      : text.startsWith('"') ? "string"
      : /^(?:\d|\.\d)/.test(text) ? "number"
      : keywords.has(text) ? "keyword"
      : values.has(text) ? "value"
      : /^[A-Za-z_]/.test(text) ? "identifier" : "symbol";
    const error = errorOffset !== undefined && offset <= errorOffset && errorOffset < offset + text.length;
    if (error && kind === "plain") {
      const index = errorOffset - offset;
      if (index) tokens.push({ text: text.slice(0, index), offset, kind, error: false });
      tokens.push({ text: text[index], offset: errorOffset, kind, error: true });
      if (index + 1 < text.length) tokens.push({ text: text.slice(index + 1), offset: errorOffset + 1, kind, error: false });
    } else tokens.push({ text, offset, kind, error });
  }
  // Give a missing expression or closing delimiter at EOF a visible underline,
  // including on an empty final line. This character is never part of the input.
  tokens.push({ text: " ", offset: source.length, kind: "plain", error: errorOffset === source.length });
  return tokens;
}
