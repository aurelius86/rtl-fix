import type { Register } from 'claude-code'

import { fixText, isolatePlan, hasArabic, isolateLine, orderOutput } from './rtl'

// Display only: the stored messages and what the model reads are unchanged.
// What a tool row draws as output: mixed Arabic lines are pre-ordered. The
// question dialog and its answer card are left alone: since Claude Code
// 2.1.299 the app lays them out right-to-left itself, and a pre-ordered
// question or option read from the middle (measured live 2026-10-20).
const toolOutput = (tool: string, output: unknown): unknown => {
  if (output === undefined || tool === 'AskUserQuestion' || !hasArabic(JSON.stringify(output) ?? '')) return output
  return orderOutput(output)
}

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

  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const output = toolOutput(e.props.tool, e.props.output)
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
