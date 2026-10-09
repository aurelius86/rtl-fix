import { expect, test } from 'claude-code/testing'

import { PDI, RLI, RLM, isolateLine, isolatePlan, isolateQuestions, orderQuestions, originalsOf, restoreOriginals } from './rtl'

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

test('question dialog: each Arabic string is isolated, English and long headers kept', async () => {
  const [q]: any = isolateQuestions([
    {
      question: 'بدك الـ my-plugin عالـ Mac mini؟',
      header: 'تجربة RTL',
      multiSelect: false,
      options: [
        { label: 'عالـ laptop بس', description: 'ما منغيّر شي على السيرفر' },
        { label: 'Both', description: 'English only' },
      ],
    },
  ])
  expect(q.question).toBe(`${RLI}بدك الـ my-plugin عالـ Mac mini؟${PDI}`)
  expect(q.header).toBe(`${RLI}تجربة RTL${PDI}`)
  expect(q.options[0].label).toBe(`${RLI}عالـ laptop بس${PDI}`)
  expect(q.options[1]).toEqual({ label: 'Both', description: 'English only' })
  const [long]: any = isolateQuestions([{ question: 'x', header: 'عنوان طويل جداً', options: [] }])
  expect(long.header).toBe('عنوان طويل جداً')
})

test('question dialog: the answer reaches the model with the original label, not the pre-ordered one', async ($, on) => {
  const original = { question: 'هل الـ sandbox شغّال؟', header: 'تست', multiSelect: false,
    options: [{ label: 'ارفض PR-41 واقبل PR-42', description: 'd' }, { label: 'إي', description: 'd' }] }
  // The dialog as drawn (what the plugin's AskUserQuestion render hands the engine).
  const [drawn]: any = orderQuestions([original])
  expect(drawn.options[0].label).toBe('PR-42 واقبل PR-41 ارفض')
  // The engine answers with what the dialog drew.
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({
    result: { questions: [drawn], answers: { [drawn.question]: drawn.options[0].label } },
  }))
  const ran: any = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: [original] })
  // The record keeps what the dialog drew (the desktop answer card reads it);
  // the model gets the original answer beside it.
  expect(ran.result.answers).toEqual({ [drawn.question]: drawn.options[0].label })
  expect(ran.context.at(-1)).toContain('"هل الـ sandbox شغّال؟"="ارفض PR-41 واقبل PR-42"')
})

test('a multi-select answer (labels joined) gets each original label back', () => {
  const original = [{ question: 'شو بدك؟', header: 'x', multiSelect: true, options: [{ label: 'merge الـ fix', description: 'd' }, { label: 'اعمل promote', description: 'd' }] }]
  const [q]: any = orderQuestions(original)
  const joined = `${q.options[0].label}, ${q.options[1].label}`
  expect(restoreOriginals(originalsOf(original), joined)).toBe('merge الـ fix, اعمل promote')
})

test('multi-select: the model gets the original labels, comma-joined, as context', async ($, on) => {
  const original = { question: 'شو بدك نعمل بالـ sandbox؟', header: 'x', multiSelect: true,
    options: [{ label: 'اعمل merge للـ fix', description: 'd' }, { label: 'اعمل promote', description: 'd' }, { label: 'ارفض PR-41', description: 'd' }] }
  const [drawn]: any = orderQuestions([original])
  // The engine's record holds a multi-select answer as an array of the labels it drew.
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({
    result: { questions: [drawn], answers: { [drawn.question]: [drawn.options[0].label, drawn.options[1].label] } },
  }))
  const ran: any = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: [original] })
  expect(ran.context.at(-1)).toContain('"شو بدك نعمل بالـ sandbox؟"="اعمل merge للـ fix, اعمل promote"')
  // The engine's record is passed on untouched: the desktop card draws it.
  expect(ran.result.answers[drawn.question]).toEqual([drawn.options[0].label, drawn.options[1].label])
})

test('a question whose mixed option is too long for the dialog is refused before the dialog opens', async ($, on) => {
  let opened = false
  on('tool.call', { tool: 'AskUserQuestion' }, () => { opened = true; return { result: { answers: {} } } })
  const long = 'أنشر rtl-fix كـ repo عام (public) باسم aurelius86/rtl-fix؟ بيبلّش بـ history جديد من commit واحد، والـ author هو noreply'
  const ran: any = await ($ as any).tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'سؤال؟', header: 'x', multiSelect: false, options: [{ label: 'إي', description: long }, { label: 'لا', description: 'd' }] }] })
  expect(opened).toBe(false)
  expect(String(ran.deny)).toContain('rtl-fix')
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
