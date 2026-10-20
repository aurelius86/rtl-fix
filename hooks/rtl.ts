// The renderer picks a line's direction from its first strong character. A
// line like "✅ **الحل…" or "PR-42 سكّرت…" starts with a symbol or Latin text, so
// it is laid out left-to-right. An RLM (U+200F, invisible, strongly RTL) put
// at the start of each Arabic line, after its markdown marker, makes the
// first strong character right-to-left. Lines with no Arabic are untouched.

export const RLM = '‏'
export const LRM = '\u200E'
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
// Markdown that must stay at the very start of the line to keep its meaning.
const PREFIX = /^(\s*(?:(?:[-*+]|\d+[.)])\s+|#{1,6}\s+|>\s?)*)/
const FENCE = /^\s*(```|~~~)/

export const hasArabic = (text: string): boolean => ARABIC.test(text)

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/
// The first letter of the text, if it is Arabic (what sets a block's direction).
const FIRST_STRONG_ARABIC = /^[^A-Za-z\p{Script=Arabic}]*\p{Script=Arabic}/u

// A list takes its direction from its FIRST item, so in a message with Arabic an
// English item ("- **License:** MIT.") at the top turned the whole list
// left-to-right. `inArabicMessage` marks every list item in such a message.
// A table row in a message with Arabic: each Arabic cell is isolated so its
// mixed text reads right-to-left. The '|' structure, the |---| separator row
// and English-only cells are untouched. (The column order stays left-to-right:
// the table's own direction is the app's.)
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
export const fixTableRow = (line: string): string => {
  if (TABLE_SEPARATOR.test(line)) return line
  return line
    .split('|')
    .map((cell, i, all) => {
      const isEdge = (i === 0 || i === all.length - 1) && cell.trim() === ''
      // The table takes its direction from its FIRST cell (seen live:
      // a table whose first cell was Arabic came out right-to-left, one whose
      // first cell was empty did not). So the first cell of every row gets an
      // RLM, even when empty or English, and the whole table runs RTL.
      const isFirst = all[0].trim() === '' ? i === 1 : i === 0
      if (isFirst && !hasArabic(cell) && !cell.includes(RLM)) {
        const [, lead, body, trail] = cell.match(/^(\s*)(.*?)(\s*)$/s)!
        return `${lead || ' '}${RLM}${body}${trail || ' '}`
      }
      // Table cells keep a fixed left-to-right direction (an RLM does nothing there),
      // so an Arabic cell is wrapped in an RLI…PDI isolate.
      if (isEdge || !hasArabic(cell) || cell.includes(RLI)) return cell
      const [, lead, body, trail] = cell.match(/^(\s*)(.*?)(\s*)$/s)!
      return `${lead}${RLI}${body}${PDI}${trail}`
    })
    .join('|')
}

export const fixLine = (line: string, inArabicMessage = false): string => {
  if (line.trimStart().startsWith('|')) return inArabicMessage ? fixTableRow(line) : line
  const isItem = inArabicMessage && LIST_ITEM.test(line)
  const prefix = line.match(PREFIX)?.[1] ?? ''
  const rest = line.slice(prefix.length)
  // In an English reply a list stays left-to-right: its first item sets the
  // direction of the whole list, so an item starting in Arabic flipped it and
  // the English items after it (seen live 2026-10-20). Such an item gets an LRM.
  if (!inArabicMessage && LIST_ITEM.test(line)) {
    if (rest.startsWith(LRM) || !FIRST_STRONG_ARABIC.test(rest)) return line
    return `${prefix}${LRM}${rest}`
  }
  // Only a MOSTLY Arabic line turns right-to-left: one Arabic name in an
  // English sentence flipped the whole line, its full stop jumping to the front.
  if (!isItem && !(hasArabic(line) && mostlyArabic(rest))) return line
  return rest.startsWith(RLM) ? line : `${prefix}${RLM}${rest}`
}

// A reply counts as Arabic (its list items and tables run right-to-left) only
// when it is MOSTLY Arabic: an English reply quoting one Arabic title is not.
export const fixText = (text: string): string => {
  if (!hasArabic(text)) return text
  const arabicMessage = mostlyArabic(text.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, ''))
  let inFence = false
  return text
    .split('\n')
    .map(line => {
      if (FENCE.test(line)) {
        inFence = !inFence
        return line
      }
      return inFence ? line : fixLine(line, arabicMessage)
    })
    .join('\n')
}

// A user row on the desktop is a left-to-right box: its paragraph direction
// is fixed, so an RLM at the start doesn't reorder it, and "Arabic 1, English,
// Arabic 2" comes out as "Arabic 2, English, Arabic 1" read from the right.
// An RLI (U+2067) … PDI (U+2069) isolate around the whole line forces that
// line to be laid out right-to-left inside the box.
export const RLI = '\u2067'
export const PDI = '\u2069'

export const isolateLine = (line: string): string =>
  !hasArabic(line) || line.startsWith(RLI) ? line : `${RLI}${line}${PDI}`

// For surfaces that lay every line out left-to-right AND may draw bidi marks
// as '�' (tool output): pre-order the runs instead. Each Arabic
// run is still drawn right-to-left inside itself, so only the ORDER of the
// runs needs turning round: "A1 E A2" is sent as "A2 E A1", which, laid out
// left-to-right and read from the right, gives A1, E, A2. The line's trailing
// punctuation ("؟", "،") moves to the front, where an RTL reading ends.
const LATIN = /[A-Za-z]/
const DIGIT = /[0-9]/
// Arabic LETTERS only: '،', '؛' and '؟' sit in the same block but are punctuation.
const ARABIC_LETTER = /(?=\p{Script=Arabic})[\p{L}\p{M}\p{N}]/u
// The tatweel 'ـ' (as in "بالـ") is script Common but belongs to its word.
// '؟' (U+061F) and '؛' (U+061B) are strong right-to-left characters (bidi class
// AL), not neutral punctuation like '،' or '?': the renderer makes them part of
// the Arabic word they touch. So they stay in their Arabic run; moved to the
// front, '؟' stuck to the START of the next Arabic word instead.
const ARABIC_STRONG_PUNCT = '\u061F\u061B'
const runKind = (ch: string): 'ar' | 'lat' | 'n' =>
  ARABIC_LETTER.test(ch) || ch === '\u0640' || ARABIC_STRONG_PUNCT.includes(ch) ? 'ar' : LATIN.test(ch) ? 'lat' : 'n'

export const visualOrder = (line: string): string => {
  if (!hasArabic(line) || !LATIN.test(line)) return line
  // Brackets are never lead/trail punctuation: "(ok)" at the end of a line must
  // keep its ")" for the pairing below, or it comes out as ")ok(".
  const lead = line.match(/^[^\p{L}\p{N}()[\]{}\u061F\u061B]*/u)?.[0] ?? ''
  const trail = line.slice(lead.length).match(/[^\p{L}\p{N}()[\]{}\u061F\u061B]*$/u)?.[0] ?? ''
  const body = line.slice(lead.length, line.length - trail.length)
  // Split into runs: a run is letters/digits of one script plus the neutrals
  // between them; the neutrals between two different scripts are separators.
  const parts: { kind: 'ar' | 'lat' | 'sep'; text: string; at: number }[] = []
  // A digit takes the script of the last letter before it ("عربي 1" stays one
  // Arabic run), or of the next one when the line starts with it.
  const kinds = [...body].map(runKind)
  let last: 'ar' | 'lat' | null = null
  for (let k = 0; k < body.length; k++) {
    if (DIGIT.test(body[k])) kinds[k] = last ?? (kinds.slice(k).find(x => x !== 'n') as 'ar' | 'lat') ?? 'lat'
    else if (kinds[k] !== 'n') last = kinds[k] as 'ar' | 'lat'
  }
  // A bracket pair belongs to the run it encloses: "(rtl-fix)" stays inside
  // its Latin run, "(هون عربي)" inside its Arabic one (where the renderer
  // mirrors the glyphs itself). Left neutral, they landed on the wrong side.
  const open: number[] = []
  const flip = new Set<number>()
  for (let k = 0; k < body.length; k++) {
    if ('([{'.includes(body[k])) open.push(k)
    else if (')]}'.includes(body[k]) && open.length) {
      const o = open.pop()!
      const inside = kinds.slice(o + 1, k).filter(x => x !== 'n')
      if (!inside.length) continue
      // A mixed group "(عربي أو English)": each bracket joins the script next to
      // it. The Arabic side is mirrored by the renderer; a bracket that lands in
      // a Latin run is mirrored and moved to the run's other end here (flip).
      kinds[o] = inside[0]
      kinds[k] = inside[inside.length - 1]
      if (kinds[o] !== kinds[k]) for (const b of [o, k]) if (kinds[b] === 'lat') flip.add(b)
    }
  }
  let i = 0
  while (i < body.length) {
    const kind = kinds[i]
    if (kind === 'n') {
      let j = i
      while (j < body.length && kinds[j] === 'n') j++
      parts.push({ kind: 'sep', text: body.slice(i, j), at: i })
      i = j
      continue
    }
    let j = i + 1
    let end = j
    while (j < body.length) {
      const k = kinds[j]
      if (k === kind) end = j + 1
      else if (k !== 'n') break
      j++
    }
    parts.push({ kind, text: body.slice(i, end), at: i })
    i = end
  }
  // Merge separators that sit between two runs of the same script into them.
  const merged: typeof parts = []
  for (const p of parts) {
    const prev = merged[merged.length - 1]
    if (p.kind !== 'sep' && prev?.kind === 'sep' && merged[merged.length - 2]?.kind === p.kind) {
      merged.pop()
      merged[merged.length - 1].text += prev.text + p.text
    } else merged.push({ ...p })
  }
  // A separator between scripts is reversed too, so "dialog، وهل" keeps the
  // comma right after "dialog" when read from the right.
  const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' }
  const text = (p: { kind: string; text: string; at: number }) => {
    if (p.kind === 'sep') return [...p.text].reverse().join('')
    let out = p.text
    const end = p.at + p.text.length - 1
    if (p.kind === 'lat' && flip.has(end)) out = MIRROR[out[out.length - 1]] + out.slice(0, -1)
    if (p.kind === 'lat' && flip.has(p.at)) out = out.slice(1) + MIRROR[p.text[0]]
    return out
  }
  // Edge punctuation crosses to the other side, where the left-to-right box
  // draws it unmirrored: a closing '»' at the left edge reads as an opening
  // one (seen live in the dialog, 2026-10-20), so a guillemet changes shape.
  const edge = (p: string) => [...p].reverse().map(c => (c === '«' ? '»' : c === '»' ? '«' : c)).join('')
  return edge(trail) + merged.reverse().map(text).join('') + edge(lead)
}

// Tool output (Bash stdout, Read content, …) is drawn as a left-to-right code
// block in a fixed-width font: mixed lines come out with their runs reversed.
// Bidi marks risk showing as '�' there, so each mixed line is pre-ordered
// (visualOrder) for display only. Pure Arabic or pure Latin lines pass as is.
// One output line. A leading "N\t" (Read's line number) stays first and
// untouched, or the viewer can't take it into its gutter. A list marker
// ("- ", "1. ") moves to the END: in a left-to-right view that is where a
// right-to-left reading starts.
// A line is reordered only when its letters are MOSTLY Arabic. In a mostly
// English line (a JSON note quoting a few Arabic words) left-to-right is the
// right order, and reordering it scrambled the English.
const mostlyArabic = (text: string): boolean => {
  const first = text.match(/[A-Za-z]|\p{Script=Arabic}/u)?.[0]
  if (first && !/[A-Za-z]/.test(first)) return true
  const ar = (text.match(/\S*\p{Script=Arabic}\S*/gu) ?? []).length
  const lat = (text.match(/\S*[A-Za-z]\S*/g) ?? []).length - (text.match(/\S*(?=[^\s]*[A-Za-z])(?=[^\s]*\p{Script=Arabic})\S*/gu) ?? []).length
  return ar >= lat
}

export const orderOutputLine = (line: string): string => {
  if (!hasArabic(line)) return line
  // A location prefix stays first and untouched: Read's "N\t", or grep's
  // "path:N:" / "N:" (a reordered path came out backwards).
  const m = line.match(/^(\s*\d+\t|[^\s]*?:\d+[:-]|\d+:(?=\S))?(\s*(?:[-*+]|\d+[.)])\s+)?(.*)$/s)!
  const [, num = '', marker = '', rest] = m
  if (!mostlyArabic(rest)) return line
  const body = visualOrder(rest)
  // An LRM before the marker: a digit right after Arabic letters joins their
  // run (it becomes an Arabic number) and "1." landed inside the line.
  return marker ? `${num}${body} \u200E${marker.trim()}` : `${num}${body}`
}

export const orderOutput = (value: unknown): unknown => {
  if (typeof value === 'string') return hasArabic(value) ? value.split('\n').map(orderOutputLine).join('\n') : value
  if (Array.isArray(value)) return value.map(orderOutput)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, orderOutput(v)]))
  return value
}

// The plan pane is a fixed left-to-right box that ignores an RLM, but an
// RLI…PDI isolate around a line lays it out right-to-left (found by hand,
// 2026-10-09). A markdown list marker outside the isolate keeps the item
// left-to-right, so a list item's marker goes inside it as plain text ("▪", an
// escaped "1\.") with two trailing spaces to keep the line on its own.
const PLAN_HEADING = /^(#{1,6}\s+)(.*)$/
const PLAN_BULLET = /^\s*[-*+]\s+(.*)$/
const PLAN_NUMBER = /^\s*(\d+)[.)]\s+(.*)$/
export const isolatePlan = (plan: string): string => {
  let inFence = false
  return plan
    .split('\n')
    .map(line => {
      if (FENCE.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence || !hasArabic(line) || line.includes(RLI)) return line
      const h = line.match(PLAN_HEADING)
      if (h) return `${h[1]}${RLI}${h[2]}${PDI}`
      const b = line.match(PLAN_BULLET)
      if (b) return `${RLI}▪ ${b[1]}${PDI}  `
      const n = line.match(PLAN_NUMBER)
      if (n) return `${RLI}${n[1]}\\. ${n[2]}${PDI}  `
      return `${RLI}${line}${PDI}`
    })
    .join('\n')
}
