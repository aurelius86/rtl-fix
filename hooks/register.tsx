import type { Register } from 'claude-code'

import { DIALOG_MAX, fixText, isolatePlan, hasArabic, isolateLine, orderOutput, orderQuestions, originalsOf, restoreOriginals, tooLongForDialog } from './rtl'

// Display only: the stored messages and what the model reads are unchanged.
// What a tool row draws as output: the answer card of a question gets its
// original strings back; any other tool's mixed Arabic lines are pre-ordered.
const toolOutput = (tool: string, output: unknown, input?: any): unknown => {
  if (output === undefined || !hasArabic(JSON.stringify(output) ?? '')) return output
  if (tool === 'AskUserQuestion') return Array.isArray(input?.questions) ? restoreOriginals(originalsOf(input.questions), output) : output
  return orderOutput(output)
}

// The note the model reads after a question's result: each answer in the
// user's own text, a multi-select one comma-joined.
export const answerNote = (answers: Record<string, unknown>): string =>
  'rtl-fix: the answer above is in display order for right-to-left text. In the original text, the user answered:\n' +
  Object.entries(answers).map(([q, a]) => `"${q}"="${Array.isArray(a) ? a.join(', ') : a}"`).join('\n')

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = fixText(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  // The user row on the desktop is a fixed left-to-right box, so the RLM that
  // fixes the replies doesn't reorder it. Each Arabic line is wrapped in an
  // RLI…PDI isolate instead, which keeps "Arabic 1, English, Arabic 2" in order.
  // The engine still draws the row: drawing it ourselves (right-aligned) lost
  // the bubble AND the attached images, which props.text doesn't mention.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (!hasArabic(e.props.text)) return next(e)
    const text = e.props.text.split('\n').map(isolateLine).join('\n')
    return next({ ...e, props: { ...e.props, text } })
  })

  // The question dialog lays every line out left-to-right and draws bidi marks
  // as '�', so instead of marks the runs of each mixed line are pre-ordered
  // (visualOrder) to read right-to-left. Same length, so the schema still holds.
  on('ui.render', { component: 'AskUserQuestion' }, ($, e, next) => {
    if (!hasArabic(JSON.stringify(e.props.questions))) return next(e)
    return next({ ...e, props: { ...e.props, questions: orderQuestions(e.props.questions) } })
  })

  // The dialog answers with the pre-ordered strings it drew. That record is
  // what the desktop answer card draws, and the card is a left-to-right box
  // no render hook reaches, so the record KEEPS the pre-ordered strings (the
  // card reads right). The model gets the originals beside it, as context:
  // without them "ارفض PR-41 واقبل PR-42" reads as "PR-42 واقبل PR-41 ارفض".
  // The plan pane draws the plan from what the Write/Edit of the plan file SAID
  // (the recorded tool input), not from the file on disk, and a fixed
  // left-to-right box ignores an RLM (desktop bundle, read 2026-10-10; a
  // rewrite of ExitPlanMode's `plan` did not reach it, seen live). So a write
  // with bare Arabic lines is refused, carrying the isolated text to write.
  const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e: any, next) => {
    const field = e.tool === 'Write' ? 'content' : 'new_string'
    const text = e[field]
    if (typeof e.file_path !== 'string' || !PLAN_FILE.test(e.file_path) || typeof text !== 'string') return next(e)
    const fixed = isolatePlan(text)
    if (fixed === text) return next(e)
    return {
      deny:
        `rtl-fix: the plan pane shows Arabic left-to-right unless each Arabic line is wrapped in RLI…PDI ` +
        `(list markers inside the wrapper). Call ${e.tool} again with this exact ${field}:\n` + fixed,
    }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    // A long mixed option would wrap in the wrong line order (see tooLongForDialog;
    // a long question is cut into lines instead).
    const long = Array.isArray(e.questions) ? tooLongForDialog(e.questions) : []
    if (long.length)
      return {
        deny:
          `rtl-fix: the question dialog cannot show a mixed Arabic/English option label or description longer than ${DIALOG_MAX} characters ` +
          `(it wraps in the wrong order). Ask again with shorter labels/descriptions (the question itself may be long), ` +
          `and put the details in your message before the question. Too long: ` +
          long.map(s => `"${s}"`).join(', '),
      }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || !Array.isArray(e.questions)) return ran
    const answers: any = restoreOriginals(originalsOf(e.questions), (ran.result as any)?.answers)
    if (!answers || JSON.stringify(answers) === JSON.stringify((ran.result as any)?.answers)) return ran
    // A multi-select answer reads last-label-first on the card (the engine
    // joins the drawn labels left-to-right). Returning a result of our own to
    // fix that does NOT work: the card then draws the originals, left-to-right
    // (seen live 2026-10-09). So the engine's record is passed on untouched.
    return { ...ran, context: [...(ran.context ?? []), answerNote(answers)] }
  })

  // The answer card under an answered question shows the pre-ordered strings;
  // it handles right-to-left itself, so put the originals back for it.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const output = toolOutput(e.props.tool, e.props.output, e.props.input)
    // An Edit/Write row may draw its diff from the input: its new/old text gets
    // the same display-only reordering (the file itself is untouched).
    const input = EDIT_TOOLS.has(e.props.tool) ? orderOutput(e.props.input) : e.props.input
    if (output === e.props.output && input === e.props.input) return next(e)
    return next({ ...e, props: { ...e.props, output, input } })
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    const output = toolOutput(e.props.tool, e.props.output)
    return output === e.props.output ? next(e) : next({ ...e, props: { ...e.props, output } })
  })
}
