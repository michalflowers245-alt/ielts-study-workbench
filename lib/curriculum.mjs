const britishCouncil = 'https://takeielts.britishcouncil.org/prepare/ielts-free-practice-mock-tests/academic';
const cambridge19 = 'https://assets.cambridge.org/97810094/54735/frontmatter/9781009454735_frontmatter.pdf';
const cambridge21 = 'https://shop.cambridge.org/english/product/2700255600';
const officialSpeaking = 'https://ielts.org/cdn/ielts-downloadable-assets/ielts-sample-tests/ielts-speaking-sample-tasks-2023.pdf';
const writingSamples = 'https://takeielts.britishcouncil.org/sites/default/files/%5Bdownloads%5D/ielts-academic-writing-sample-tasks-2023.pdf';

function practiceExperience(id) {
  return `https://demo-ielts.inspera.com/player/?assessmentRunId=${id}&context=exam`;
}

function official(id, skill, title, description, url, options = {}) {
  return { id, skill, kind: 'official', title, description, url, sourceLabel: 'IELTS 官方资源', ...options };
}

function authentic(volume, skill, title, description, minutes, url) {
  return {
    id: `cambridge-${volume}-${skill}`, skill, kind: 'authentic', title, description, minutes,
    sourceLabel: 'Cambridge University Press & Assessment', url,
  };
}

function original(id, skill, title, description, prompt, options = {}) {
  return { id, skill, kind: 'original', title, description, prompt, sourceLabel: '工作台原创练习', ...options };
}

function speaking(topic, title, description, part, prompt, tags) {
  return original(`original-speaking-${topic}`, 'speaking', title, description, prompt, {
    part, tags, minutes: part === 'Part 2' ? 3 : 5,
  });
}

export const resources = [
  official('baseline-listening', 'listening', '官方机考样卷 · 听力 40 题',
    '完整 4 部分。仅播放一遍，预留约 30 分钟及机考最后 2 分钟检查。作答结束后用官方答案核对，记录正确数与错题类型。',
    practiceExperience(131012334), {
      minutes: 32,
      answerUrl: 'https://assets.ctfassets.net/unrdeg6se4ke/8gOk8aDHMcnNLLxthyKt0/36be49c5e37d33f8b70606d0bd2af1d7/IELTS_familiarisation_test_Listening_answers.pdf',
    }),
  official('baseline-reading', 'reading', '官方机考样卷 · A 类阅读 40 题',
    '完整 3 篇文章。外部计时 60 分钟，完成后再核对官方答案。保存正确数、未完成题和各篇用时。',
    practiceExperience(131013388), {
      minutes: 60,
      answerUrl: 'https://assets.ctfassets.net/unrdeg6se4ke/2ggjbjdFDSU7xXTp7Eqxjp/ef3ce074fbb5d9e47db8ee4b3ad45cb0/IELTS_familiarisation_test_Reading_answers.pdf',
    }),
  official('baseline-writing', 'writing', '官方机考样卷 · A 类写作 Task 1 + 2',
    '用 60 分钟连续完成两题。Task 1 约 20 分钟、至少 150 词，Task 2 约 40 分钟、至少 250 词。先在本机保存两题原稿，再按评分表复盘。',
    practiceExperience(131013741), { minutes: 60 }),
  official('baseline-speaking', 'speaking', '官方口语样卷 · Part 1–3',
    '请搭档提前打开考官提纲并现场追问，完整录音 11–14 分钟。独自做时可录各段练习并记录有无互动。',
    officialSpeaking, { minutes: 14, part: 'Part 1–3' }),
  official('official-listening-drills', 'listening', '听力题型样题与音频',
    '按错因找一组单选、填空或地图题。每组有对应答案，多个题型也提供录音文本。练完再开答案。',
    `${britishCouncil}/listening`, { sourceLabel: 'British Council' }),
  official('official-reading-drills', 'reading', 'A 类阅读题型样题',
    '按错因找判断、匹配或填空小题，先写证据定位再对答案。部分片段和完整机考样卷重叠，属于专项训练。',
    `${britishCouncil}/reading`, { sourceLabel: 'British Council' }),
  official('official-writing-examples', 'writing', 'A 类写作样题与考官点评',
    '对照同一题的作答、点评和得分说明。先写自己的版本，再选择一处任务回应或论证问题改写。',
    writingSamples, { sourceLabel: 'British Council' }),
  official('official-speaking-benchmarks', 'speaking', '口语 7 / 7.5 / 8 分样本',
    '打开官方页面的对应分段，先听语音和互动，再核对逐字稿和考官对四项表现的点评。',
    'https://ielts.org/organisations/ielts-for-organisations/understanding-ielts-scoring/resources-for-setting-your-ielts-scores'),
  official('official-ready', 'reading', 'IELTS Ready · 免费注册后可做全科模考',
    '注册后可用两套完整模拟练习，含听读分数和参考作答。另有口写 AI 反馈升级。保留未做过的一套用于后续完整模拟。',
    'https://ieltsregistration.britishcouncil.org/ielts-ready-registration', { sourceLabel: 'British Council' }),
  ...[[19, cambridge19], [21, cambridge21]].flatMap(([volume, url]) => [
    authentic(volume, 'listening', `剑雅 ${volume} Academic · 听力真题索引`,
      '使用本人合法取得的书和配套音频。选从未做过的 Test 1–4 之一，保存套号、Part、错题号和正确数。', 32, url),
    authentic(volume, 'reading', `剑雅 ${volume} Academic · 阅读真题索引`,
      '使用本人合法取得的书，按 Test 1–4 套号做完整 40 题。保存套号、篇章、错题编号和证据段。', 60, url),
    authentic(volume, 'writing', `剑雅 ${volume} Academic · 写作真题索引`,
      '使用本人合法取得的书，连续完成同套的 Task 1 和 Task 2。保留套号、初稿、改稿和反馈来源。', 60, url),
    authentic(volume, 'speaking', `剑雅 ${volume} Academic · 口语真题索引`,
      '使用本人合法取得的书，由搭档选未见套题并追问。保留套号、Part 和互动录音。', 14, url),
  ]),

  speaking('useful-routine', '一个让你更省时间的习惯',
    '准备 1 分钟，录 1–2 分钟。开头交代习惯，发展一个有起因和结果的具体例子。', 'Part 2',
    'Describe a habit that saves you time on a busy day. Explain when you started it, what you actually do, and why it helps. Include one occasion when you noticed the difference.',
    ['fluency', 'grammar']),
  speaking('shared-space', '社区空间如何分配',
    '请搭档依次提问并根据你的例子追问。试着把一个泛泛的说法改成具体表述。', 'Part 3',
    'Should a city make room for both quiet and social activities in the same public space? What happens when the needs of different age groups conflict? In your city, who should decide which needs take priority?',
    ['vocabulary', 'fluency']),
  speaking('changed-route', '走过一条不同的路线',
    '说清原来的路线、实际改走的路线、结果。回听时检查过去时和时间顺序。', 'Part 2',
    'Describe a time you changed your route to a familiar place. Explain what made you choose a different way, what you noticed along the way, and whether you would use that route again.',
    ['grammar', 'fluency']),
  speaking('helpful-instructions', '解释一个实用步骤',
    '先自然录一遍。回听信息重点是否清楚，再试着用停顿和句子重音突出关键步骤。', 'Part 2',
    'Describe a small task you have helped someone learn. Explain why they needed help, how you broke the task into steps, and which step was hardest to explain.',
    ['pronunciation', 'fluency']),
  speaking('repair-or-replace', '物品该修还是换',
    '解释怎样做决定。请搭档追问一个反例，换种说法澄清原意。', 'Part 3',
    'How do people decide whether to repair or replace an item? Would offering cheaper repairs always change their decisions? Under what conditions should manufacturers be required to provide spare parts?',
    ['vocabulary', 'grammar']),
  speaking('everyday-sounds', '日常环境里的声音',
    '逐题回答并录音。用对比重音让搭档辨认你描述的两种环境和各自特点。', 'Part 1',
    'What sounds do you usually hear when you start your day? Is there a sound that helps you concentrate? Where do you go when you would like some quiet?',
    ['pronunciation', 'vocabulary']),
  speaking('useful-object', '常用物品的特别用途',
    '举一个实际场景。遇到叫不出名字的部件时用形状、功能或用途解释。', 'Part 2',
    'Describe an ordinary object you have used in an unexpected way. Explain what the object was, why you used it differently, and whether the idea worked.',
    ['vocabulary', 'fluency']),
  speaking('new-community', '城市如何欢迎新居民',
    '每次先给结论，再补理由。回听从句和假设语气，也检查句尾是否容易听清。', 'Part 3',
    'How can a city make it easier for new residents to meet people? What would change if most information were available only through a phone app? Who might benefit from in-person support?',
    ['grammar', 'pronunciation']),
  speaking('shared-instructions', '把同一个要求讲给不同的人',
    '比较面对熟人和陌生人时的表达。回听停顿是否切在完整意群之间。', 'Part 3',
    'Should public instructions use the simplest possible language? In what situations might simplified instructions leave out something important? How could a local service test whether people understand its instructions?',
    ['pronunciation', 'vocabulary', 'fluency']),
  speaking('small-collection', '你曾经收集过什么',
    '按时间顺序答。回听现在和过去的表达有没有混用。', 'Part 1',
    'Did you ever collect anything when you were younger? What do you keep now that you rarely use? Are there things you would like to pass on to someone else?',
    ['grammar', 'fluency']),
  speaking('solve-a-delay', '一次临时调整',
    '说清最初计划、实际耽搁、你做了什么。回听时间连接和原因说明。', 'Part 2',
    'Describe an occasion when a delay forced you to change your plans. Explain what you had intended to do, how you adjusted, and what you would do differently next time.',
    ['grammar', 'fluency']),
  speaking('clear-directions', '怎样给别人指路',
    '用句子重音提示易混淆的方位。让搭档复述他们听到的方向。', 'Part 1',
    'How do you usually find your way in a new neighbourhood? When did you last give someone directions? What landmarks do people use near your home?',
    ['pronunciation', 'vocabulary']),
  speaking('unusual-explanation', '一种帮助你理解的解释',
    '用两种方式表达关键概念，试着用具体例子解释一个抽象词。', 'Part 2',
    'Describe an explanation that helped you understand an unfamiliar idea. Explain what confused you, how the idea was explained, and whether you can now explain it to someone else.',
    ['vocabulary', 'pronunciation']),
  speaking('borrow-or-own', '借用和购买的取舍',
    '每个问题给出条件和例外。搭档问一个新条件后再补一次回答。', 'Part 3',
    'What types of equipment make sense to share in a neighbourhood? How might sharing change how people look after it? What would make it difficult to run a successful lending scheme?',
    ['vocabulary', 'grammar']),
  speaking('quiet-services', '公共服务怎样营造安静环境',
    '给出条件和反例。回听句子重音是否让论点更好辨认。', 'Part 3',
    'When is silence important in a public building? How could a building support both people who need quiet and people who need to talk? What would change if there were only one room available?',
    ['pronunciation', 'fluency', 'grammar']),

  original('original-listening-appointment', 'listening', '听出变更后的预约信息',
    '请搭档事先写好答案并只读一次。记录 4 项信息，最后对照答案，重点查听到旧值后漏掉更正的问题。',
    'Partner: invent a short appointment update. Include the original date and the new date, the start time, the venue, and an item the visitor should bring. Learner: note the final date, time, venue and item.',
    { minutes: 6, tags: ['distractor', 'detail', 'spelling'] }),
  original('original-listening-course-room', 'listening', '分辨同一活动的两个安排',
    '请搭档一次读出安排。合上文本记录每个安排的对应信息，再逐项核对。',
    'Partner: create a short announcement about morning and evening workshops. Write down two room names, two start times and a deadline, then read the announcement once. Learner: identify the room and start time for the evening workshop and the registration deadline.',
    { minutes: 6, tags: ['detail', 'matching', 'spelling'] }),
  original('original-writing-repair', 'writing', '该不该资助社区维修点',
    '先限时写一段。用一个具体例子检验理由能否支持立场，完成后检查连接与重复用词。',
    'Some towns offer publicly funded workshops where residents can repair household items. To what extent should local governments pay for this service? Write one paragraph that explains and supports your position.',
    { minutes: 15, part: 'Task 2', tags: ['task-response', 'coherence', 'vocabulary', 'grammar'] }),
  original('original-writing-library', 'writing', '图书馆开放时间的取舍',
    '写一段比较晚间延长开放与周末延长开放的文字。用同一口径比较受益者、代价和可执行性。',
    'A public library has enough funding to extend its hours either on weekday evenings or at weekends. Compare the two choices and explain which one would be more useful in your area.',
    { minutes: 15, part: 'Task 2', tags: ['task-response', 'coherence', 'grammar'] }),
  original('original-reading-energy', 'reading', '判断作者究竟有没有说过',
    '每道题给出判断和原文证据。原文找不到足够信息时标出缺少哪条信息。',
    'In the first month of a trial, twelve library branches received reports of their electricity use. Eight branches also received advice on adjusting their opening routines. Across all twelve branches, electricity use fell by an average of four percent. The report did not compare the eight branches with the other four. The council plans to repeat the trial in winter before deciding whether to expand it.\n\nMark each statement True, False, or Not Given: (1) All twelve branches received electricity reports. (2) The report compared usage changes for the two groups of branches. (3) The winter trial will also include twelve branches.',
    { minutes: 8, tags: ['not-given', 'evidence', 'detail'] }),
  original('original-reading-park', 'reading', '把建议作者和依据配对',
    '先写每个人的判断依据，再做匹配。注意区分提议、疑问和现有数据。',
    'The town tested a walking route through an old industrial site. The planner supported keeping it because it connected two bus stops. A nearby shop owner liked the idea but questioned whether weekend foot traffic would cover the cost of staying open longer. The site manager recommended another crossing before expanding the route, using counts of people who had crossed the road away from the existing crossing.\n\nMatch each point with the planner, shop owner, or site manager: (1) a suggested safety improvement, (2) a financial uncertainty, (3) an existing transport benefit.',
    { minutes: 8, tags: ['matching', 'evidence', 'detail'] }),
];

function session(title, minutes, description, resourceId, skill) {
  return { title, minutes, description, ...(resourceId && { resourceId }), ...(skill && { skill }) };
}

export const curriculum = [
  { day: 1, focus: '第一段口语与短听写诊断',
    morning: session('续读并录下第一次 Part 2', 30, '续读手上的英语材料，回忆 3–5 个词组。准备 1 分钟，录约 2 分钟，保存完整首录。', 'original-speaking-useful-routine', 'speaking'),
    evening: session('熟悉机考和短听写', 30, '熟悉机考的输入和导航。做一组独立的短听力，再写几句说明一个决定的理由。保存两处待核点，完整样卷留到基线日。', 'original-listening-appointment', 'listening') },
  { day: 2, focus: '听力完整基线与同题重录',
    morning: session('续读后按反馈重录', 28, '先续读，再选择首录中一处已核问题做同题重录，保留前后两个版本。', 'original-speaking-useful-routine', 'speaking'),
    evening: session('听力完整样卷', 32, '全程只播放一遍，约 30 分钟作答、约 2 分钟检查。保存 40 题作答，第二天再按答案分析。', 'baseline-listening', 'listening') },
  { day: 3, focus: '陌生题口语复测与听力错题',
    morning: session('换题复测第一条口语问题', 30, '使用同样的准备与作答时限独立录一遍。回听并记录上一条已核错误是否复发。', 'original-speaking-changed-route', 'speaking'),
    evening: session('核听力答案，再写一段理由和例子', 30, '先核对基线答案，按错因回听。用剩余时间写一个 Task 2 立场段，包含理由和具体例子。', 'original-writing-repair', 'writing') },
  { day: 4, focus: '完整口语基线与对照回听',
    morning: session('口语热身与互动准备', 30, '用不同题材做短问答，检查表达和录音设置。请搭档先看官方提纲，你在开场前保持题目陌生。', 'original-speaking-everyday-sounds', 'speaking'),
    evening: session('做一次完整三部分口语', 30, '请搭档用官方提纲提问，完整录下 11–14 分钟。记录是否有现场追问和反馈来源。', 'baseline-speaking', 'speaking') },
  { day: 5, focus: '回听口语和独立题审题',
    morning: session('找出 1–2 个带时间点的问题', 30, '回放昨天的录音，标出 1–2 个可核实的问题。可用官方分档样本对照，短重录对应答句。', 'official-speaking-benchmarks', 'speaking'),
    evening: session('练题目要求与证据定位', 30, '用独立短题练阅读证据和写作审题。写下题目要求，及完成作答所需的信息或条件。', 'original-reading-energy', 'reading') },
  { day: 6, focus: 'A 类阅读完整基线',
    morning: session('阅读完整样卷', 60, '把当天早晚两段合成连续 60 分钟。完成三篇 40 题，保存各篇用时与没有做完的题号。', 'baseline-reading', 'reading'),
    evening: session('保存阅读原始作答', 0, '今天的两节已合并。把作答和各篇实际用时存入工作台，第 8 天再复核。', 'baseline-reading', 'reading') },
  { day: 7, focus: 'A 类写作完整基线',
    morning: session('写作 Task 1 和 Task 2', 60, '把当天早晚两段合成连续 60 分钟。保留两题原文和用时，先完成再看参考。', 'baseline-writing', 'writing'),
    evening: session('保存两题原稿', 0, '今天的两节已合并。确认两份初稿已记录，第 8 天按量表复盘。', 'baseline-writing', 'writing') },
  { day: 8, focus: '整理四科基线，选本周一个主攻项',
    morning: session('核对阅读和四科缺项', 30, '记录阅读正确数，从错题中找一个可复测的错因。确认听说读写各有哪份基线证据。', 'baseline-reading', 'reading'),
    evening: session('按证据定一个主攻项', 30, '对照写作量表并记录人工评估状态。先补缺项，再挑反复失分且可练的问题。差距相近时优先口语。', 'official-writing-examples', 'writing') },
  { day: 9, focus: '换题练证据与主攻弱项',
    morning: session('陌生阅读匹配练习', 30, '先为每项找到证据句再作答，保留首答及用时。', 'original-reading-park', 'reading'),
    evening: session('用 10–15 分钟专项攻克弱项', 30, '从题库挑符合第 8 天所选主攻项的题，记下纠错证据。剩余时间复盘该题。') },
  { day: 10, focus: '无提示口语复测与主攻弱项',
    morning: session('独立做一次陌生口语题', 30, '按首次条件作答，复测前先不看旧稿和提示。作答后记录旧问题有无复发。', 'original-speaking-shared-space', 'speaking'),
    evening: session('继续上一日的主攻目标', 30, '替换出 10–15 分钟，用新题检验同一个目标。完成后保留原始表现。') },
  { day: 11, focus: '陌生题口语与限时专项',
    morning: session('一段陌生题口语首答', 30, '自然录一遍，回听后给最主要的问题标时间点。留到明天再用同题重录。', 'original-speaking-helpful-instructions', 'speaking'),
    evening: session('主攻项限时练习', 30, '用同题型和同样计时的新题继续主攻，并留出约 10 分钟给另一科短练。') },
  { day: 12, focus: '同题重录与第二份可比记录',
    morning: session('针对昨天的问题同题重录', 30, '只改一两处已核问题。保留两次录音，在同一位置回听改动。', 'original-speaking-helpful-instructions', 'speaking'),
    evening: session('再做一组同条件新题', 30, '用同样的时间独立完成主攻专项，随后加练另一科。保存两个结果和实际条件。') },
  { day: 13, focus: '两类高频错误的短题迁移',
    morning: session('用未见短题复测两类错误', 30, '从记录中找出经常复发的两类问题，无提示作答。回看新题里有多少机会用到目标表达。', 'original-speaking-new-community', 'speaking'),
    evening: session('做一篇短写或听力专项', 30, '可做原创比较段，也可按本周主要错因选择其他听力短题。保存错因和原始证据。', 'original-writing-library', 'writing') },
  { day: 14, focus: '第二周复盘和下一次测量',
    morning: session('做一次陌生题口语复测', 30, '用不同题材检验发音或表达问题，留下新旧录音证据和复发记录。', 'original-speaking-shared-instructions', 'speaking'),
    evening: session('总结两周与下一阶段重点', 30, '回查可比练习的变化，保留仍需核实的判断。本轮证据不足时等新的完整测量再更新分数。'),
    special: session('拿到陌生套题后做完整模拟', 152, '如已有一套未见的官方模拟或剑雅真题，可另安排整块时间连续做听读写，并安排 11–14 分钟互动口语。没有新套题时这项保留待做。', 'cambridge-19-listening') },
];

const issueAliases = new Map([
  ['fluency and coherence', 'fluency'], ['fluency coherence', 'fluency'], ['流利度', 'fluency'], ['流利度与连贯性', 'fluency'], ['卡顿', 'fluency'],
  ['lexical resource', 'vocabulary'], ['lexical', 'vocabulary'], ['词汇', 'vocabulary'], ['词汇资源', 'vocabulary'], ['搭配', 'vocabulary'],
  ['grammatical range and accuracy', 'grammar'], ['grammar accuracy', 'grammar'], ['grammatical', 'grammar'], ['语法', 'grammar'], ['语法多样性和准确性', 'grammar'],
  ['发音', 'pronunciation'], ['重音', 'pronunciation'], ['节奏', 'pronunciation'],
  ['task response', 'task-response'], ['not given', 'not-given'],
]);

export function selectPracticeResource({ skill, usedIds = [], issueCategory } = {}) {
  const completedIds = new Set(usedIds);
  const unused = resources.filter((resource) => resource.skill === skill && resource.kind === 'original' && !completedIds.has(resource.id));
  const category = typeof issueCategory === 'string' ? issueCategory.toLowerCase().trim().replace(/_/g, ' ') : '';
  const tag = skill === 'speaking' && category === 'coherence' ? 'fluency' : (issueAliases.get(category) ?? category);
  return unused.find((resource) => resource.tags?.includes(tag)) ?? unused[0] ?? null;
}
