import { addDays, currentPeriod, todayDate } from './store.mjs';

export const skills = ['listening', 'reading', 'writing', 'speaking'];
export function promptKey(attempt) {
  const normalized = attempt.prompt?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^cambridge-\d+-/.test(attempt.resourceId ?? '')) {
    const test = /\btest\s+([1-4])\b/.exec(normalized ?? '');
    return attempt.resourceId + (test ? ':test-' + test[1] : ':' + (normalized ?? ''));
  }
  return attempt.resourceId || normalized;
}

export const skillLabels = { listening: '听力', reading: '阅读', writing: '写作', speaking: '口语' };

const objective = (skill) => skill === 'listening' || skill === 'reading';
const isFull = (attempt) => attempt.status === 'done' && attempt.take === 'first' && attempt.timed && attempt.unseen
  && (objective(attempt.skill) ? attempt.total === 40 && Number.isInteger(attempt.correct) : attempt.full === true);

function metric(attempt) {
  return {
    attemptId: attempt.id, date: attempt.date, band: attempt.band, correct: attempt.correct,
    total: attempt.total, mode: attempt.mode, assessmentSource: attempt.assessmentSource,
  };
}

export function overall(scores) {
  if (scores.length !== 4 || scores.some((score) => !Number.isFinite(score))) return undefined;
  return Math.floor(scores.reduce((sum, score) => sum + score, 0) / 2 + 0.5) / 2;
}

export function calculateProgress(attempts) {
  const ordered = attempts.toSorted((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const baseline = {};
  const latest = {};
  const official = {};
  const mocks = new Map();
  const transfer = { passed: 0, total: 0 };
  const recurrence = new Map();

  for (const attempt of ordered) {
    if (attempt.mode === 'official' && attempt.status === 'done' && Number.isFinite(attempt.band) && attempt.assessmentSource && attempt.assessmentKind === 'official') {
      official[attempt.skill] ??= metric(attempt);
    }
    if ((attempt.mode === 'baseline' || attempt.mode === 'mock') && isFull(attempt)) {
      latest[attempt.skill] ??= metric(attempt);
      if (attempt.mode === 'baseline') baseline[attempt.skill] = metric(attempt);
      const eligibleAssessment = objective(attempt.skill)
        ? ['publisher', 'official'].includes(attempt.assessmentKind) : attempt.assessmentKind === 'teacher';
      if (attempt.mode === 'mock' && attempt.mockId && attempt.assessmentSource && eligibleAssessment && Number.isFinite(attempt.band)) {
        if (!mocks.has(attempt.mockId)) mocks.set(attempt.mockId, {});
        mocks.get(attempt.mockId)[attempt.skill] ??= attempt;
      }
    }
    const review = attempt.review;
    if (attempt.take !== 'transfer' || !attempt.unseen || attempt.status !== 'done'
      || !review || !['passed', 'failed'].includes(review.outcome) || review.opportunities < 1) continue;
    transfer.total += 1;
    transfer.passed += Number(review.outcome === 'passed');
    const record = recurrence.get(review.category) ?? { category: review.category, errors: 0, opportunities: 0 };
    record.errors += review.errors;
    record.opportunities += review.opportunities;
    recurrence.set(review.category, record);
  }

  const spent = new Set();
  const mockScores = [];
  for (const group of mocks.values()) {
    if (!skills.every((skill) => group[skill])) continue;
    if (!['listening', 'reading', 'writing'].every((skill) => group[skill].continuous && group[skill].date === group.listening.date)) continue;
    const questionKeys = skills.map((skill) => {
      const attempt = group[skill];
      const source = promptKey(attempt);
      return source && skill + ':' + source;
    });
    if (questionKeys.some((key) => !key || spent.has(key))) continue;
    for (const key of questionKeys) spent.add(key);
    mockScores.push({ band: overall(skills.map((skill) => group[skill].band)), speaking: group.speaking.band });
  }
  const lastTwo = mockScores.slice(0, 2);
  return {
    baseline, latest, official,
    mock: {
      count: mockScores.length, lastBand: mockScores[0]?.band,
      at75: lastTwo.length === 2 && lastTwo.every((a) => a.band >= 7.5 && a.speaking >= 7.5),
      at80: lastTwo.length === 2 && lastTwo.every((a) => a.band >= 8 && a.speaking >= 7.5),
    },
    transfer, recurrence: [...recurrence.values()].sort((a, b) => b.errors - a.errors),
  };
}

const REVIEW_DAYS = [1, 3, 7, 14, 30];

export function nextReview(attempts, date) {
  const done = new Map();
  for (const attempt of attempts) {
    if (attempt.take !== 'transfer' || attempt.status !== 'done' || !attempt.unseen
      || !attempt.review?.opportunities || attempt.review.outcome === 'untested') continue;
    const key = attempt.rootId + ':' + attempt.review.category;
    done.set(key, (done.get(key) ?? 0) + 1);
  }
  const due = [];
  for (const attempt of attempts) {
    for (const finding of attempt.findings) {
      if (!finding.confirmed || !finding.drill) continue;
      const rounds = done.get(attempt.rootId + ':' + finding.category) ?? 0;
      if (rounds >= REVIEW_DAYS.length) continue;
      due.push({
        attemptId: attempt.id, category: finding.category, drill: finding.drill,
        dueDate: addDays(attempt.date, REVIEW_DAYS[rounds]),
      });
    }
  }
  const dueNow = due.filter((item) => item.dueDate <= date).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return dueNow[0] ?? due.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
}

export function buildToday(start, curriculum, attempts, resume, current = new Date()) {
  const date = todayDate(current);
  const days = start ? Math.max(0, Math.round((Date.parse(date) - Date.parse(start)) / 86_400_000)) : 0;
  const plan = curriculum[days] ?? {
    day: days + 1, focus: '按近两次练习结果调整主攻项',
    morning: { title: '阅读、词汇与口语', minutes: 30, description: '读一个连贯段落，回忆词组，再用自己的话说。' },
    evening: { title: '听力、写作与复盘', minutes: 30, description: '做一个限时练习，优先复测一条已核错误。' },
  };
  const completed = {};
  for (const period of ['morning', 'evening', 'extra']) {
    completed[period] = attempts.some((attempt) => attempt.date === date && attempt.period === period && attempt.status === 'done');
  }
  return { ...plan, date, started: Boolean(start), period: currentPeriod(current), completed, nextReview: nextReview(attempts, date), resume };
}
