import { randomUUID } from 'node:crypto';
import { promptKey, skills, skillLabels } from './progress.mjs';
import { todayDate } from './store.mjs';
import { containsQuote } from './evidence.mjs';

export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (message) => { throw new Problem(400, message); };
const owns = (object, key) => Object.hasOwn(object, key);

export function text(value, label, max = 16000) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) fail(label + '格式有误或字数过多。');
  return value.trim() || undefined;
}

function integer(value, label, min, max) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Number.isInteger(value) || value < min || value > max) fail(label + '超出范围。');
  return value;
}

function choice(value, label, options) {
  if (!options.includes(value)) fail(label + '无效。');
  return value;
}

export function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function dateValue(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('请选择有效的日期。');
  return date;
}

export function attemptPayload(input, resources, previous) {
  const get = (field, fallback) => owns(input, field) ? input[field] : (previous?.[field] ?? fallback);
  const id = previous?.id ?? input.id ?? randomUUID();
  if (!validId(id)) fail('练习编号无效。');
  const skill = choice(get('skill'), '科目', skills);
  const mode = choice(get('mode', 'drill'), '练习类型', ['drill', 'baseline', 'mock', 'official']);
  const take = choice(get('take', 'first'), '作答轮次', ['first', 'retake', 'transfer']);
  const status = choice(get('status', 'started'), '练习状态', ['started', 'done', 'partial', 'skipped']);
  const resourceId = text(get('resourceId'), '题目来源', 100);
  if (resourceId && !resources.some((resource) => resource.id === resourceId && resource.skill === skill)) fail('请选择对应科目的题目。');
  const band = get('band');
  const bandValue = band === null || band === '' || band === undefined ? undefined : band;
  if (bandValue !== undefined && (!Number.isFinite(bandValue) || bandValue % 0.5 !== 0 || bandValue < 0 || bandValue > 9)) fail('分档应为 0–9 之间的半分。');
  if (bandValue !== undefined && mode === 'drill') fail('专项练习请保存正确数或文字反馈。');
  const prompt = text(get('prompt'), '题目或来源', 5000);
  if (/^cambridge-\d+-/.test(resourceId ?? '') && ['baseline', 'mock'].includes(mode)
    && !/\bTest\s+[1-4]\b/i.test(prompt ?? '')) fail('请选择所使用的剑雅 Test 1–4。');
  const scoreTitle = skillLabels[skill] + '分档';
  const assessmentSource = text(get('assessmentSource'), '评分来源', 300);
  const assessmentKind = get('assessmentKind') ? choice(get('assessmentKind'), '评分类型', ['teacher', 'publisher', 'official']) : undefined;
  if (bandValue !== undefined && (!assessmentSource || !assessmentKind || status !== 'done')) fail(scoreTitle + '需要已完成的作答和评分来源。');
  if (bandValue !== undefined && mode === 'official' && assessmentKind !== 'official') fail('正式成绩需要正式成绩单来源。');
  if (bandValue !== undefined && mode !== 'official' && ['writing', 'speaking'].includes(skill)
    && assessmentKind !== 'teacher') fail('口语或写作分档需要教师或人工评阅来源。');
  const total = integer(get('total'), '题量', 1, 100);
  const correct = integer(get('correct'), '正确数', 0, total ?? 0);
  if (correct !== undefined && total === undefined) fail('请输入题量。');
  if (bandValue !== undefined && mode !== 'official' && ['listening', 'reading'].includes(skill) && (total !== 40 || correct === undefined)) {
    fail('听力或阅读分档需要完整 40 题的正确数。');
  }
  const full = get('full') === true;
  if (bandValue !== undefined && mode !== 'official' && ['writing', 'speaking'].includes(skill) && !full) {
    fail('写作或口语分档需要完整模块及人工评分来源。');
  }
  const parentId = text(get('parentId'), '原练习编号', 64);
  if (take !== 'first' && !validId(parentId)) fail('请从原练习进入重录或复测。');
  if (take === 'first' && parentId) fail('首次作答不能关联重练。');
  const mockId = text(get('mockId'), '模考编号', 80);
  if (mode === 'mock' && !mockId) fail('请填写本套模考编号，四科使用同一编号。');

  const answer = text(get('answer'), '原始作答', 32000);
  return {
    id, date: dateValue(get('date', todayDate())), skill, mode, take, parentId, resourceId,
    prompt,
    period: choice(get('period', 'extra'), '学习时段', ['morning', 'evening', 'extra']),
    status, minutes: integer(get('minutes'), '实际分钟数', 0, 600),
    notes: text(get('notes'), '学习记录'), answer,
    originalAnswer: previous?.originalAnswer ?? (status === 'done' ? answer : undefined),
    correct, total, band: bandValue, assessmentSource, assessmentKind,
    assessmentNotes: text(get('assessmentNotes'), '评阅意见', 4000),
    full, mockId, timed: get('timed') === true, unseen: get('unseen') === true, continuous: get('continuous') === true,
    privateSource: text(get('privateSource'), '本地资料引用', 1800),
  };
}

export function linkAttempt(attempt, store) {
  if (!attempt.parentId) return attempt.id;
  const parent = store.get(attempt.parentId);
  if (!parent) throw new Problem(404, '找不到原练习。');
  if (parent.id === attempt.id || parent.skill !== attempt.skill || attempt.date < parent.date) fail('复测与原练习的科目或日期不一致。');
  if (attempt.take === 'retake') {
    if (promptKey(attempt) && promptKey(parent) && promptKey(attempt) !== promptKey(parent)) fail('同题重录使用原题。');
    attempt.resourceId = parent.resourceId ?? attempt.resourceId;
    attempt.prompt = parent.prompt ?? attempt.prompt;
    attempt.unseen = false;
  } else {
    const key = promptKey(attempt);
    const alreadySeen = store.list().some((entry) => entry.id !== attempt.id
      && entry.skill === attempt.skill && promptKey(entry) === key
      && (entry.rootId === parent.rootId || ['done', 'partial'].includes(entry.status)));
    if (!key || alreadySeen) fail('复测请使用未做过的不同题目。');
  }
  return parent.rootId;
}

function reviewFinding(raw, existing, attempt, durationMs, corrected) {
  if (!raw || typeof raw !== 'object') fail('纠错记录无效。');
  const id = raw.id ?? randomUUID();
  if (!validId(id)) fail('纠错编号无效。');
  const source = choice(raw.source, '证据来源', ['audio', 'text']);
  const category = text(raw.category, '问题类别', 40);
  const quote = text(raw.quote, '原句', 700);
  const correction = text(raw.correction, '改法', 1200);
  const drill = text(raw.drill, '复练', 1200);
  if (!category || !quote || !correction || !drill) fail('请补齐问题类别、原句、改法和复练任务。');
  const segmentId = text(raw.segmentId, '录音片段', 100);
  const segment = segmentId ? attempt.segments.find(({ id: key }) => key === segmentId) : undefined;
  if (segmentId && !segment) fail('找不到对应录音片段。');
  const startMs = integer(raw.startMs ?? segment?.startMs, '开始时间', 0, durationMs);
  const endMs = integer(raw.endMs ?? segment?.endMs, '结束时间', 0, durationMs);
  if (endMs !== undefined && startMs !== undefined && endMs < startMs) fail('回听时间区间无效。');
  const confirmed = raw.confirmed === true;
  if (confirmed && category === 'pronunciation' && source !== 'audio') fail('确认发音问题需要原声和时间点。');
  if (source === 'audio' && (!attempt.recording || startMs === undefined)) fail('回听证据需要原录音和时间点。');
  if (confirmed && source === 'text') {
    const evidence = segment ? corrected[segment.id] ?? segment.text : attempt.answer;
    if (!containsQuote(evidence, quote)) fail('确认前请核对原句与作答或校订稿是否一致。');
  }
  return { id, source, category, quote, correction, drill, segmentId, startMs, endMs, confirmed, origin: existing?.origin ?? 'manual' };
}

export function reviewPayload(input, attempt, raw) {
  const corrected = { ...raw.corrected };
  const durationMs = attempt.recording?.durationMs ?? 0;
  if (input.segments !== undefined) {
    if (!Array.isArray(input.segments) || input.segments.length > 2000) fail('转写校订无效。');
    for (const segment of input.segments) {
      if (!attempt.segments.some(({ id }) => id === segment?.id) || typeof segment.text !== 'string' || segment.text.length > 6000) fail('转写片段或校订文字无效。');
      corrected[segment.id] = segment.text.trim();
    }
  }
  let findings = raw.manualFindings.map((finding) => {
    if (!finding.confirmed || finding.source !== 'text') return finding;
    const segment = attempt.segments.find(({ id }) => id === finding.segmentId);
    const evidence = segment ? corrected[segment.id] ?? segment.text : attempt.answer;
    if (containsQuote(evidence, finding.quote)) return finding;
    return { ...finding, confirmed: false };
  });
  if (input.findings !== undefined) {
    if (!Array.isArray(input.findings) || input.findings.length > 24) fail('纠错记录无效。');
    const current = input.replaceFindings ? new Map() : new Map(findings.map((finding) => [finding.id, finding]));
    for (const item of input.findings) {
      const finding = reviewFinding(item, attempt.findings.find(({ id }) => id === item?.id), attempt, durationMs, corrected);
      current.set(finding.id, finding);
    }
    findings = [...current.values()];
  }
  let review = raw.review;
  if (input.outcome !== undefined) {
    if (attempt.take !== 'transfer' || attempt.status !== 'done') fail('完成陌生题作答后再登记复测结果。');
    const outcome = choice(input.outcome, '复测结论', ['passed', 'failed', 'untested']);
    const opportunities = integer(input.opportunities, '出现机会', 0, 200) ?? 0;
    const errors = integer(input.errors, '复现次数', 0, opportunities) ?? 0;
    const category = text(input.category, '问题类别', 40);
    if (!category || (outcome !== 'untested' && (!attempt.unseen || !opportunities))) fail('有效复测需要陌生题、目标类别和实际使用机会。');
    review = { outcome, opportunities, errors, category };
  }
  return { corrected, findings, review };
}
