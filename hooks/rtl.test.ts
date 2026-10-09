import { expect, test } from 'claude-code/testing'

import { DIALOG_MAX, PDI, RLI, RLM, isolatePlan, ornate, tooLongForDialog, wrapChunks, fixText, orderOutput, orderOutputLine, orderQuestions, originalsOf, restoreOriginals, visualOrder } from './rtl'

test('English text is untouched', () => {
  const text = '✅ **Done.** Tests pass.\n- one\n- two'
  expect(fixText(text)).toBe(text)
})

test('an Arabic line gets an RLM after its markdown marker', () => {
  expect(fixText('✅ **سكّرت** PR-42')).toBe(`${RLM}✅ **سكّرت** PR-42`)
  expect(fixText('- **الحل:** زر')).toBe(`- ${RLM}**الحل:** زر`)
  expect(fixText('1. اكتب `/my-command`')).toBe(`1. ${RLM}اكتب \`/my-command\``)
  expect(fixText('## عنوان')).toBe(`## ${RLM}عنوان`)
  expect(fixText('> اقتباس')).toBe(`> ${RLM}اقتباس`)
})

test('only Arabic lines change in a mixed message', () => {
  expect(fixText('سطر عربي\nEnglish line')).toBe(`${RLM}سطر عربي\nEnglish line`)
})

test('code fences are left alone, table cells get the RLM, and a second pass changes nothing', () => {
  const text = 'شرح\n```bash\necho "مرحبا"\n```\n| عمود | col |'
  const once = fixText(text)
  expect(once).toBe(`${RLM}شرح\n\`\`\`bash\necho "مرحبا"\n\`\`\`\n| \u2067عمود\u2069 | col |`)
  expect(fixText(once)).toBe(once)
})

test('visualOrder turns the run order round, keeps each run intact, moves end punctuation first', async () => {
  expect(visualOrder('كيف طلع السؤال بالـ dialog، وهل كلمة Mac mini بمحلها؟')).toBe(
    'بمحلها؟ Mac mini وهل كلمة ،dialog كيف طلع السؤال بالـ',
  )
  expect(visualOrder('عربي 1 see عربي 2')).toBe('عربي 2 see عربي 1')
  expect(visualOrder('كلو عربي')).toBe('كلو عربي')
  expect(visualOrder('all English here')).toBe('all English here')
})

test('brackets stay with the run they enclose', async () => {
  expect(visualOrder('شو رأيك بالـ mod (rtl-fix)، وهل الأقواس (هون عربي) طالعة صح؟')).toBe(
    'وهل الأقواس (هون عربي) طالعة صح؟ ،mod (rtl-fix) شو رأيك بالـ',
  )
})

test('a Latin bracket group at the end of the line keeps both brackets', async () => {
  expect(visualOrder('الأقواس زابطة (ok)')).toBe('(ok) الأقواس زابطة')
  expect(visualOrder('(ok) الأقواس زابطة')).toBe('الأقواس زابطة (ok)')
})

test('in an Arabic message every list item is marked, so an English first item does not flip the list', async () => {
  expect(fixText('النشر:\n- **License:** MIT.\n- **README:** إنكليزي وعربي.')).toBe(
    `${RLM}النشر:\n- ${RLM}**License:** MIT.\n- ${RLM}**README:** إنكليزي وعربي.`,
  )
  expect(fixText('- **License:** MIT.')).toBe('- **License:** MIT.')
})

test('a bracket group mixing Arabic and English keeps both brackets on the right sides', async () => {
  expect(visualOrder('كل قوس بمحله (عربي أو English)')).toBe('(English كل قوس بمحله (عربي أو')
  expect(visualOrder('شوف (English أو عربي) هون')).toBe('أو عربي) هون English) شوف')
})

test('the answer card gets the original question and answer back', () => {
  const original = [{ question: 'كل قوس بمحله (عربي أو English) طالعة صح؟', header: 'x', options: [{ label: 'تمام (ok)', description: 'd' }] }]
  const [q]: any = orderQuestions(original)
  expect(q.question).not.toBe(original[0].question)
  expect(q.options[0].label).not.toBe('تمام (ok)')
  const output = { questions: [q], answers: { [q.question]: q.options[0].label } }
  expect(restoreOriginals(originalsOf(original), output)).toEqual({
    questions: original,
    answers: { [original[0].question]: 'تمام (ok)' },
  })
})

test('tool output: a line starting in Arabic is reordered even when its English is longer', () => {
  expect(orderOutputLine('هل الـ sandbox (CT301) شغّال؟')).toBe('شغّال؟ sandbox (CT301) هل الـ')
  expect(orderOutputLine('الـ API رجّع 404 Not Found')).not.toBe('الـ API رجّع 404 Not Found')
  expect(orderOutputLine('This line is English with one Arabic word: مرحبا')).toBe('This line is English with one Arabic word: مرحبا')
})

test("tool output: grep's bare 'N:' prefix stays first", () => {
  expect(orderOutputLine('1:فتحت PR-42 وسكّرته')).toBe('1:وسكّرته PR-42 فتحت')
})

test("'؟' stays at the end of its Arabic word", async () => {
  expect(visualOrder('هل الـ card تحت السؤال (مع الجواب) طالع صح هلق؟')).toBe(
    'تحت السؤال (مع الجواب) طالع صح هلق؟ card هل الـ',
  )
})

test('tool output: mixed lines pre-ordered, pure lines and non-strings untouched', async () => {
  const out: any = orderOutput({
    stdout: 'هيدا سطر عربي فيه English بالنص وبيخلص بعربي.\nEnglish only line.\nكلو عربي.',
    code: 0,
  })
  expect(out.stdout.split('\n')).toEqual([
    '.بالنص وبيخلص بعربي English هيدا سطر عربي فيه',
    'English only line.',
    'كلو عربي.',
  ])
  expect(out.code).toBe(0)
})

test("tool output: Read's line numbers stay first; list markers move to the end", async () => {
  expect(orderOutputLine('1\tهيدا سطر عربي فيه English بالنص.')).toBe('1\t.بالنص English هيدا سطر عربي فيه')
  expect(orderOutputLine('3\t1. أول خطوة: شغّل plugin test')).toBe('3\tplugin test أول خطوة: شغّل \u200E1.')
  expect(orderOutputLine('4\tEnglish only line.')).toBe('4\tEnglish only line.')
  expect(orderOutputLine('- كلو عربي')).toBe('كلو عربي \u200E-')
})

test('tool output: grep prefixes stay first; mostly-English lines are left alone', async () => {
  expect(orderOutputLine('/tmp/a.md:1:هيدا سطر عربي فيه English بالنص.')).toBe('/tmp/a.md:1:.بالنص English هيدا سطر عربي فيه')
  const json = '  "body": "Note, 2026-09-26: \\"ترجم للعربي\\" I had written a long reply in English.",'
  expect(orderOutputLine(json)).toBe(json)
})

test('a table in an Arabic message: Arabic cells isolated; separator, empty and English cells untouched', async () => {
  const table = '| | **Fork** | **زر** |\n|---|---|---|\n| شو بتعرف | كل المحادثة | بس الـ prompt |'
  expect(fixText(table)).toBe(
    `| ${RLM} | **Fork** | \u2067**زر**\u2069 |\n|---|---|---|\n| \u2067شو بتعرف\u2069 | \u2067كل المحادثة\u2069 | \u2067بس الـ prompt\u2069 |`,
  )
  expect(fixText('| a | b |\n|---|---|')).toBe('| a | b |\n|---|---|')
})

test('a long mixed QUESTION is cut into lines joined by \\n, each pre-ordered on its own (the dialog keeps \\n, seen live)', () => {
  const long = 'أنشر rtl-fix كـ repo عام (public) باسم aurelius86/rtl-fix؟ بيبلّش بـ history جديد من commit واحد، والـ author هو الـ noreply تبع GitHub.'
  const [q]: any = orderQuestions([{ question: long, header: 'x', options: [{ label: 'انشر public هلق', description: 'd' }] }])
  const chunks = wrapChunks(long)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.join(' ')).toBe(long)
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DIALOG_MAX)
  expect(q.question).toBe(chunks.map(c => visualOrder(ornate(c), true)).join('\n'))
  expect(q.options[0].label).toBe(visualOrder('انشر public هلق'))
  expect(originalsOf([{ question: long, header: 'x', options: [] }]).get(q.question)).toBe(long)
  // A long question is no longer refused; a pure Arabic one is left whole.
  expect(tooLongForDialog([{ question: long, header: 'x', options: [] }])).toEqual([])
  const pure = 'هيدا سؤال طويل كتير بس كلو عربي وما فيه ولا كلمة إنكليزية أبداً لحتى يضل يلتف صح'
  const [p]: any = orderQuestions([{ question: pure, header: 'x', options: [] }])
  expect(p.question).toBe(pure)
})

test('a long mixed option label or description is still flagged (\\n there is untested)', () => {
  const long = 'بيبلّش بـ history جديد من commit واحد، والـ author هو الـ noreply تبع GitHub، والاسم اللي بيطلع هو Aurelius بس'
  expect(long.length).toBeGreaterThan(DIALOG_MAX)
  const qs = [{ question: 'سؤال؟', header: 'x', options: [{ label: 'إي', description: long }, { label: long, description: 'd' }] }]
  expect(tooLongForDialog(qs)).toEqual([long, long])
  expect(tooLongForDialog([{ question: 'سؤال؟', header: 'x', options: [{ label: 'انشر public هلق', description: 'd' }] }])).toEqual([])
})

test('a dialog bracket pair around Arabic becomes the ornate pair, which the bidi bracket rule leaves alone (measured 12/12 vs 7/12)', () => {
  expect(ornate('هو الـ noreply (ما بيبيّن) والاسم')).toBe('هو الـ noreply \uFD3Fما بيبيّن\uFD3E والاسم')
  const [q]: any = orderQuestions([{ question: '(ما بيبيّن الإيميل)، والاسم هو', header: 'x', options: [{ label: 'تمام (ok)', description: 'English (only)' }] }])
  // The pair opens the line, so its edges are ordered too: the opener goes to the line's end.
  expect(q.question).toBe(visualOrder('\uFD3Fما بيبيّن الإيميل\uFD3E، والاسم هو', true))
  expect(q.question.endsWith('\uFD3F')).toBe(true)
  // A pair around English keeps its brackets.
  expect(q.options[0].label).toBe(visualOrder('تمام (ok)'))
  // An English-only string is left alone, brackets and all.
  expect(q.options[0].description).toBe('English (only)')
  // The answer still maps back to the original text.
  expect(originalsOf([{ question: 'x', header: 'x', options: [{ label: 'تمام (ok)', description: 'd' }] }]).get(q.options[0].label)).toBe('تمام (ok)')
})

test('a dialog line cut from a long question that starts with an Arabic bracket group gets its edges ordered too', () => {
  // 99 characters of filler, so the bracket group opens the second line.
  const long = 'كلمة word '.repeat(10).trimEnd() + ' (ما بيبيّن الإيميل)، والاسم اللي بيطلع هو'
  const [q]: any = orderQuestions([{ question: long, header: 'x', options: [] }])
  const lines: string[] = q.question.split('\n')
  const chunks = wrapChunks(ornate(long))
  const pure = chunks.find(c => !/[A-Za-z]/.test(c))!
  expect(pure.startsWith('\uFD3F')).toBe(true)
  // The leading ornate bracket moves to the line's end, where a left-to-right box shows it at the right edge.
  expect(lines[chunks.indexOf(pure)].endsWith('\uFD3F')).toBe(true)
})

test('a plan: each Arabic line isolated RTL, list markers moved inside, fences and English untouched', () => {
  const plan = [
    '# Plan title',
    '## الخطة: نصلّح rtl-fix',
    'هيدا سطر عربي فيه English.',
    '- عنصر أول فيه `code`',
    '2. خطوة تانية',
    '```',
    'echo عربي',
    '```',
    'English only line.',
  ].join('\n')
  expect(isolatePlan(plan).split('\n')).toEqual([
    '# Plan title',
    `## ${RLI}الخطة: نصلّح rtl-fix${PDI}`,
    `${RLI}هيدا سطر عربي فيه English.${PDI}`,
    `${RLI}▪ عنصر أول فيه \`code\`${PDI}  `,
    `${RLI}2\\. خطوة تانية${PDI}  `,
    '```',
    'echo عربي',
    '```',
    'English only line.',
  ])
  // Idempotent: a plan already written with the marks is left as it is.
  expect(isolatePlan(isolatePlan(plan))).toBe(isolatePlan(plan))
})
