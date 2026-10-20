import { expect, test } from 'claude-code/testing'

import { PDI, RLI, RLM, isolatePlan, fixText, orderOutput, orderOutputLine, visualOrder } from './rtl'

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

test('an English reply quoting a few Arabic words stays left-to-right (seen live after the 2026-10-13 desktop update)', async () => {
  const text =
    'The ERP session "متابعة مشروع ERP" had already finished, so I picked up from where it stopped.\n\n' +
    '**Two candidates for the next step:**\n' +
    '- **PR-12, the platform blueprint:** already in progress.\n' +
    '- **PR-15, service centres:** your latest idea, not started yet.'
  expect(fixText(text)).toBe(text)
  // An Arabic-led line inside that English reply still turns right-to-left.
  expect(fixText('English intro.\nالخطوة الجاية: PR-12')).toBe(`English intro.\n${RLM}الخطوة الجاية: PR-12`)
})

test('a guillemet moved to the other edge of a pre-ordered line is mirrored, so a sentence read from the right ends in « (seen live 2026-10-20)', () => {
  expect(visualOrder('«مرحبا» يا Claude').endsWith('»')).toBe(true)
  expect(visualOrder('شوف README «هون»').startsWith('«')).toBe(true)
})

test('in an English reply a list whose first item starts in Arabic stays left-to-right: each such item gets an LRM (seen live 2026-10-20)', () => {
  const LRM = '‎'
  const text = 'Check each line:\n1. «هل الـ sandbox (CT301) شغّال؟»\n2. «افتح ملف README» (in the box, the number goes last)\n3. The English line stays left-to-right.'
  const lines = fixText(text).split('\n')
  expect(lines[1]).toBe(`1. ${LRM}«هل الـ sandbox (CT301) شغّال؟»`)
  expect(lines[2]).toBe(`2. ${LRM}«افتح ملف README» (in the box, the number goes last)`)
  expect(lines[3]).toBe('3. The English line stays left-to-right.')
  // A plain (non-list) Arabic line in the same reply still turns right-to-left.
  expect(fixText('Done.\nشغّلنا الـ tests على الـ server').split('\n')[1]).toBe(`${RLM}شغّلنا الـ tests على الـ server`)
})
