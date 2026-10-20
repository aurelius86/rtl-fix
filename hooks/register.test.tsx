import { expect, test } from 'claude-code/testing'

import { PDI, RLI, RLM, isolateLine, isolatePlan } from './rtl'

test('an Arabic assistant message is drawn with the RLM; an English one is passed as is', async ($, on) => {
  const seen: string[] = []
  on('ui.render', { component: 'AssistantMessage' }, (hook$: any, e: any) => {
    seen.push(e.props.text)
    const { Text } = hook$.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const text of ['✅ سكّرت', 'Done']) {
      const ui = await ($ as any).ui.mount({ plugin: 'rtl-fix', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
      await ui.unmount()
    }
  }
  expect(seen).toEqual([`${RLM}✅ سكّرت`, 'Done', `${RLM}✅ سكّرت`, 'Done'])
})

const USER = (text: string, isExpanded = true) => ({
  plugin: 'rtl-fix',
  component: 'UserMessage' as const,
  props: { text, isExpanded, origin: { kind: 'prompt' } },
})

test('an Arabic user message keeps the engine drawing, each Arabic line isolated; English untouched', async ($, on) => {
  const seen: string[] = []
  on('ui.render', { component: 'UserMessage' }, (hook$: any, e: any) => {
    seen.push(e.props.text)
    const { Text } = hook$.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  for (const text of ['عربي 1 see عربي 2\nline', 'hello']) {
    const ui = await ($ as any).ui.mount({ ...USER(text), surface: 'desktop' })
    await ui.unmount()
  }
  expect(seen).toEqual([`${RLI}عربي 1 see عربي 2${PDI}\nline`, 'hello'])
})

test('a mixed Arabic/English user line is isolated as one right-to-left run', async () => {
  expect(isolateLine('عربي 1 see عربي 2')).toBe(`${RLI}عربي 1 see عربي 2${PDI}`)
  expect(isolateLine('only English')).toBe('only English')
  expect(isolateLine(isolateLine('عربي'))).toBe(`${RLI}عربي${PDI}`)
})

test('a plan file written with bare Arabic lines is refused, with the isolated text to write instead', async ($, on) => {
  let wrote = 0
  on('tool.call', { tool: 'Write' }, () => { wrote++; return { result: 'ok' } })
  const plan = '# Plan\n## الخطوات\n1. أول خطوة\nEnglish line'
  const ran: any = await ($ as any).tool.call({ tool: 'Write', file_path: '/Users/x/.claude/plans/a-b-c.md', content: plan })
  expect(wrote).toBe(0)
  expect(String(ran.deny)).toContain(isolatePlan(plan))
  // The isolated text goes through; so do other files and plans with no Arabic.
  await ($ as any).tool.call({ tool: 'Write', file_path: '/Users/x/.claude/plans/a-b-c.md', content: isolatePlan(plan) })
  await ($ as any).tool.call({ tool: 'Write', file_path: '/Users/x/notes.md', content: plan })
  await ($ as any).tool.call({ tool: 'Write', file_path: '/Users/x/.claude/plans/e.md', content: '# English plan' })
  expect(wrote).toBe(3)
})

test('an Edit to a plan file with a bare Arabic new_string is refused the same way', async ($, on) => {
  let edited = 0
  on('tool.call', { tool: 'Edit' }, () => { edited++; return { result: 'ok' } })
  const ran: any = await ($ as any).tool.call({ tool: 'Edit', file_path: '/Users/x/.claude/plans/a.md', old_string: 'x', new_string: '- عنصر جديد' })
  expect(edited).toBe(0)
  expect(String(ran.deny)).toContain(isolatePlan('- عنصر جديد'))
})

test('question dialog: passed and answered untouched (the render hook is gone too), the app lays it out right-to-left itself (2.1.299, measured live 2026-10-20)', async ($, on) => {
  const questions = [{ question: 'هل بتقرا هالسطر صح: افتح ملف README؟', header: 'فحص', multiSelect: false,
    options: [{ label: 'افتح README بس', description: 'بيبدا بـ «مرحبا» وبيخلص بـ «هون؟»' },
      { label: 'إي', description: 'أنشر rtl-fix كـ repo عام (public) باسم aurelius86/rtl-fix؟ بيبلّش بـ history جديد من commit واحد، والـ author هو noreply' }] }]
  // A long mixed option is no longer refused, and the answer comes back with no note.
  const answers = { [questions[0].question]: questions[0].options[0].label }
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions, answers } }))
  const ran: any = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions })
  expect(ran.deny).toBeUndefined()
  expect(ran.result.answers).toEqual(answers)
  expect(ran.context ?? []).toEqual([])
})
