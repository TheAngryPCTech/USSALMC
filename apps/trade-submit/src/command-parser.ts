// command-parser.ts — parse the bot-style command that a future Discord/Twitch
// bot will pass through verbatim. Getting this right now means wiring a bot
// later is just: take the raw message, call parseTradeCommand(), forward.
//
// Format:  !trade submit <commodity> <origin> <destination> <buy> <sell>
// Names may be multi-word if quoted:  "Port Olisar"
// The two trailing tokens are always numeric (buy, sell).

export interface ParsedTradeCommand {
  ok: boolean;
  error?: string;
  command?: 'submit';
  commodity?: string;
  origin?: string;
  destination?: string;
  buy?: number;
  sell?: number;
}

// tokenize respecting double quotes
function tokenize(s: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

function parseNum(tok: string): number | null {
  // accept 1234, 1,234, 1.5k, 1500aUEC
  const cleaned = tok.replace(/[, ]/g, '').replace(/auec$/i, '');
  let mult = 1;
  let core = cleaned;
  if (/k$/i.test(core)) { mult = 1_000; core = core.slice(0, -1); }
  else if (/m$/i.test(core)) { mult = 1_000_000; core = core.slice(0, -1); }
  const n = parseFloat(core);
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

export function parseTradeCommand(raw: string): ParsedTradeCommand {
  const text = (raw || '').trim();
  if (!text.startsWith('!trade')) {
    return { ok: false, error: 'Command must start with "!trade".' };
  }
  const tokens = tokenize(text);
  // tokens[0] = "!trade", tokens[1] = subcommand
  if (tokens.length < 2 || tokens[1].toLowerCase() !== 'submit') {
    return { ok: false, error: 'Usage: !trade submit <commodity> <origin> <destination> <buy> <sell>' };
  }
  const args = tokens.slice(2);
  if (args.length < 5) {
    return { ok: false, error: `Expected 5 arguments (commodity, origin, destination, buy, sell); got ${args.length}. Quote multi-word names, e.g. "Port Olisar".` };
  }
  // last two tokens are numeric prices; everything before splits into 3 names.
  // If names weren't quoted and there are >5 args, we still take the last two as
  // prices and reject ambiguity in the middle to avoid silently guessing.
  const sellTok = args[args.length - 1];
  const buyTok = args[args.length - 2];
  const buy = parseNum(buyTok);
  const sell = parseNum(sellTok);
  if (buy === null || sell === null) {
    return { ok: false, error: `Buy and sell must be numbers. Got buy="${buyTok}", sell="${sellTok}".` };
  }
  const nameArgs = args.slice(0, args.length - 2);
  if (nameArgs.length !== 3) {
    return { ok: false, error: `Ambiguous names — expected exactly commodity, origin, destination. Quote multi-word names, e.g. "Laranite" "Area18" "Port Tressler".` };
  }
  return {
    ok: true, command: 'submit',
    commodity: nameArgs[0], origin: nameArgs[1], destination: nameArgs[2],
    buy, sell,
  };
}
