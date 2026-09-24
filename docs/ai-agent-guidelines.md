# AI Agent Guidelines — Answering From the USSALMC Knowledge Base

For any AI agent that answers questions using this project's data (via the
`/v1` API directly, the `apps/openclaw-mcp` tools, or any future
integration) — not tied to any one bot's persona or orchestration system.
These are hard-won rules from real, live failures caught and fixed during
development (see `decisions-log.md` for the incidents behind each one) —
not stylistic preferences.

## The one rule everything else follows from

**Never state a fact — a name, a stat, a price, a lore relationship —
unless you can see it in an actual tool/API result from this turn.** A
wrong specific answer is worse than no answer. If you don't have a
confirmed hit, say so plainly ("I don't have a confirmed answer for that")
instead of filling the gap with something plausible-sounding.

## Concrete failure patterns already caught, and their fixes

- **Don't invent a name when your first search misses.** A failed
  `search` query usually means the query was wrong (bad premise, wrong
  pairing, wrong term) — not that the answer doesn't exist. Retry with a
  broader query or browse by category before answering. Never fabricate a
  face-saving story if corrected on a wrong guess.
- **Don't reach past correct tool results for an invented explanation.**
  Confirmed live: asked about a faction's missions, the search tool
  correctly returned real matching results, and the answer given anyway
  invented a detailed, false faction-hierarchy explanation that
  contradicted its own tool output. If your results already answer the
  question, use them.
- **A structured classification field is authoritative; title text is
  not.** E.g. a mission's `mission_type` attribute is the real gameplay
  category — a title-text search for a keyword can miss real matches
  entirely and lead to a false "this doesn't exist" conclusion. Check the
  structured field before concluding something isn't offered.
- **Never claim a tool "isn't available" from memory of a past failure.**
  A failed call is a reason to retry or re-check tool discovery — not to
  assert (possibly wrongly) what you do or don't have access to. If still
  unsure, say the call failed and you don't know why.
- **Don't skip tool use just because a message is short.** A terse,
  command-like message is a clearer signal to use a tool, not a weaker
  one — don't require a full sentence before reaching for one.
- **Many in-game terms double as ordinary real-world words** (commodities:
  gold, titanium, hydrogen; ships/locations: constellation, reclaimer,
  hercules, gateway). Don't assume a question is real-world just because
  the phrasing sounds generic — check the KB first.
- **Volatile data (prices, trade routes) always needs its freshness
  surfaced.** Never state a price as current fact without also conveying
  how old it is.
- **Community-sourced content stays labeled as such, but isn't a lesser
  citizen of the KB.** Guides/missions sourced from community sites don't
  need every answer caveated with which video/creator/site it came from —
  normal confidence/source handling is enough. But their confidence never
  exceeds `community` on the ladder (`community` → `corroborated` →
  `confirmed`).
- **Procedurally-templated content (e.g. mission titles like
  `"[TARGET] needs stomping"`) should stay in its literal templated
  form** — the bracketed placeholder is genuinely how the game represents
  it before a real value is rolled. Don't invent what it might resolve to.

## Where the real categories are (check `list_categories`/`GET /v1/categories` for current counts)

- `guide` — step-by-step task walkthroughs (mining, quantum travel,
  docking, combat, ...). Teach from the structured `steps` in your own
  words; don't paste raw JSON.
- `quest` — real mission/contract templates (bounty hunting, delivery,
  salvage, mercenary, ...), each with real reward/XP/standing
  requirements. Report numbers exactly as returned, never estimated.
- Signature identification (mining scan values → ore) is its own endpoint
  (`GET /v1/mining/signature`), not a general KB entity lookup.

## Related

- `CLAUDE.md` — project conventions for anyone *building* this codebase.
- `decisions-log.md` — the specific incidents each rule above came from,
  with full verification detail.
