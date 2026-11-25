const SKILLS = ['listening', 'reading', 'writing', 'speaking'];
const SKILL_NAMES = { listening: '听力', reading: '阅读', writing: '写作', speaking: '口语' };
const SKILL_MARKS = { listening: '听', reading: '读', writing: '写', speaking: '说' };
const PERIODS = { morning: '早课', evening: '晚课', extra: '额外练习' };
const MODES = { drill: '日常练习', baseline: '分科基线', mock: '限时模考', official: '正式成绩' };
const TAKES = { first: '首次作答', retake: '同题重录', transfer: '陌生题复测' };
const STATUSES = { started: '进行中', done: '已完成', partial: '部分完成', skipped: '未完成' };
const CATEGORIES = { grammar: '语法', vocabulary: '词汇', coherence: '表达结构', fluency: '流利度', pronunciation: '发音', rhythm: '节奏与重音', comprehension: '理解', other: '其他' };
const RESOURCE_KINDS = {
  official: '官方样题', sample: '官方样题', official_sample: '官方样题',
  authentic: '剑雅真题索引', cambridge: '剑雅真题索引', genuine: '剑雅真题索引',
  benchmark: '官方评分样本', examiner: '官方评分样本',
  original: '原创练习', practice: '原创练习', generated: 'AI 练习题', ai: 'AI 练习题',
  personal: '个人材料',
};
const ASSESSMENT_KINDS = { teacher: '教师 / 人工评阅', publisher: '官方或套题换算', official: '正式成绩' };
const OUTCOMES = { untested: '证据不足', passed: '通过', failed: '仍需复练' };
const TIME_ZONE = 'Asia/Shanghai';
const ACTIVE_RECORDING = new Set(['queued', 'running', 'pending', 'processing']);
const AUDIO_ACCEPT = '.m4a,.mp3,.wav,.aac,.ogg,.opus,.webm,.mp4,audio/*';

const pageContent = document.querySelector('#page-content');
const dialog = document.querySelector('#dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogSubtitle = document.querySelector('#dialog-subtitle');
const dialogBody = document.querySelector('#dialog-body');
const toast = document.querySelector('#toast');

let view = 'today';
let state;
let loadError;
let activePeriod;
let resourceFilter = 'all';
let openedAttemptId;
let openedAttempt;
let editingDetail = false;
let detailNotice = '';
let modalBusy = false;
let stateRequest;
let toastTimer;
let refreshTimer;
let focusReturn;

const formatDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TIME_ZONE, month: 'long', day: 'numeric', weekday: 'long',
});
document.querySelector('#current-date').textContent = formatDate.format(new Date());

function dateKey() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function currentPeriod() {
  const hour = new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format();
  return Number(hour) < 15 ? 'morning' : 'evening';
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function externalLink(url, label, css = 'button slim') {
  const verified = externalUrl(url);
  return verified ? `<a class="${css}" href="${html(verified)}" target="_blank" rel="noopener noreferrer">${html(label)} <span aria-hidden="true">↗</span></a>` : '';
}

function button(label, action, data = {}, css = 'button') {
  const attributes = Object.entries(data)
    .map(([name, value]) => ` data-${name}="${html(value)}"`).join('');
  return `<button type="button" class="${css}" data-act="${action}"${attributes}>${html(label)}</button>`;
}

function option(value, label, selected) {
  return `<option value="${html(value)}"${value === selected ? ' selected' : ''}>${html(label)}</option>`;
}

function options(labels, selected) {
  return Object.entries(labels).map(([value, label]) => option(value, label, selected)).join('');
}

function badge(label, color = '') {
  return label ? `<span class="badge ${color}">${html(label)}</span>` : '';
}

function empty(message, css = '') {
  return `<div class="empty-panel ${css}">${html(message)}</div>`;
}

function heading(title, subtitle, actions = '') {
  return `<header class="page-heading"><div><h1>${html(title)}</h1>${subtitle ? `<p>${html(subtitle)}</p>` : ''}</div>
    ${actions ? `<div class="heading-actions">${actions}</div>` : ''}</header>`;
}

async function api(path, { method = 'GET', body, headers, raw = false } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw || body === undefined ? body : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('连接暂时中断，请确认 Mac 已开机并联网。');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || (response.status === 403 ? '当前设备没有访问权限。' : '操作未完成，请重试。'));
  }
  return data;
}

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function resourceFor(id) {
  return state?.resources?.find((item) => item.id === id);
}

function attemptFor(id) {
  return state?.attempts?.find((item) => item.id === id);
}

function activeJob(attempt) {
  return ACTIVE_RECORDING.has(attempt?.recording?.status) || ACTIVE_RECORDING.has(attempt?.recording?.feedbackStatus);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (document.hidden || !(activeJob(openedAttempt) || state?.attempts?.some(activeJob))) return;
  refreshTimer = setTimeout(async () => {
    if (openedAttemptId && !editingDetail && !modalBusy && activeJob(openedAttempt)) {
      try {
        const { attempt } = await api(`/api/attempts/${encodeURIComponent(openedAttemptId)}`);
        if (openedAttemptId === attempt.id && !editingDetail && !modalBusy && dialog.open) {
          const changed = openedAttempt.recording?.status !== attempt.recording?.status
            || openedAttempt.recording?.feedbackStatus !== attempt.recording?.feedbackStatus;
          openedAttempt = attempt;
          if (changed) renderAttemptDetail(attempt, detailNotice);
        }
      } catch {
        // The existing result remains visible when a background request is interrupted.
      }
    }
    await reload({ quiet: true });
  }, 2800);
}

async function reload({ quiet = false } = {}) {
  if (stateRequest) return stateRequest;
  stateRequest = api('/api/state').then((data) => {
    state = data;
    loadError = undefined;
    if (!activePeriod) activePeriod = state.today?.period || currentPeriod();
    renderPage();
  }).catch((error) => {
    if (!quiet || !state) {
      loadError = error.message;
      renderPage();
    }
  }).finally(() => {
    stateRequest = undefined;
    scheduleRefresh();
  });
  return stateRequest;
}

function blockList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Array.isArray(value.blocks) ? value.blocks : [value];
  return typeof value === 'string' && value ? [{ description: value }] : [];
}

function recordingLabel(attempt) {
  const recording = attempt.recording;
  if (!recording) return '';
  if (recording.status === 'failed') return '转写待重试';
  if (recording.status === 'queued') return '排队中';
  if (recording.status === 'running') return '转写中';
  if (ACTIVE_RECORDING.has(recording.feedbackStatus)) return '正在生成反馈';
  if (recording.feedbackStatus === 'failed') return '反馈待重试';
  return '可回听';
}

function attemptTitle(attempt) {
  const resource = resourceFor(attempt.resourceId);
  const prompt = resource?.kind === 'authentic' && attempt.prompt ? `${resource.title} · ${attempt.prompt}`
    : resource?.title || attempt.prompt || '';
  return prompt ? String(prompt).replace(/\s+/g, ' ').slice(0, 75) : `${SKILL_NAMES[attempt.skill] || '学习'} · ${MODES[attempt.mode] || '记录'}`;
}

function recordList(attempts, fallback) {
  if (!attempts.length) return empty(fallback);
  return `<ul class="record-list">${attempts.map((attempt) => {
    const status = recordingLabel(attempt) || STATUSES[attempt.status];
    const metadata = [
      attempt.date,
      PERIODS[attempt.period],
      attempt.take && attempt.take !== 'first' ? TAKES[attempt.take] : MODES[attempt.mode],
      attempt.minutes == null ? '' : `${attempt.minutes} 分钟`,
    ].filter(Boolean).join(' · ');
    return `<li class="record-row">
      <span class="lesson-mark" aria-hidden="true">${html(SKILL_MARKS[attempt.skill] || '练')}</span>
      <div><h3>${html(attemptTitle(attempt))}</h3><p>${html(metadata)}</p></div>
      <div class="record-meta">${badge(status, attempt.recording?.status === 'failed' ? 'warm' : '')}
      ${button('查看', 'detail', { id: attempt.id }, 'button slim')}</div>
    </li>`;
  }).join('')}</ul>`;
}

function renderBlock(block) {
  const resource = resourceFor(block.resourceId);
  const skill = block.skill || resource?.skill;
  const title = block.title || resource?.title || '训练安排';
  const url = resource ? button('题目', 'resource', { id: resource.id }, 'text-button') : '';
  const shortcut = !url && skill ? button('记一笔', 'open-log', { skill }, 'text-button') : '';
  return `<li class="plan-row"><span class="lesson-mark" aria-hidden="true">${html(SKILL_MARKS[skill] || '练')}</span>
    <div><h3>${html(title)}</h3>${block.description ? `<p>${html(block.description)}</p>` : ''}</div>
    <div class="plan-duration">${block.minutes > 0 ? `${html(block.minutes)} 分钟` : ''}${url || shortcut ? `<div>${url || shortcut}</div>` : ''}</div>
  </li>`;
}

function renderToday() {
  const today = state.today || {};
  const selected = activePeriod || today.period || currentPeriod();
  const special = today.started ? blockList(today.special) : [];
  const blocks = blockList(today[selected]);
  const dayLabel = today.started && today.day ? `第 ${today.day} 天` : '';
  const focus = today.focus && typeof today.focus === 'object' ? today.focus.title || today.focus.description : today.focus;
  const nextReview = today.nextReview;
  const recent = Array.from(state.attempts || []).slice(0, 5);
  const plannedMinutes = blocks.reduce((sum, block) => sum + (Number(block.minutes) || 0), 0);
  const progress = today.completed?.[selected];
  const progressLabel = typeof progress === 'number' && progress ? `已记录 ${progress} 项` : progress === true ? '本时段已记录' : '';
  const overview = [
    dayLabel,
    focus || 'Academic 总分 7.5 · 冲刺 8.0 · 口语 7.5',
  ].filter(Boolean).join('  /  ');

  return `${heading('今天的训练', overview, button('＋ 记学习', 'open-log'))}
    <div class="today-layout">
      <section class="panel plan-panel" aria-labelledby="plan-title">
        <div class="panel-header plan-top">
          <div><h2 id="plan-title">学习安排</h2>
          <p>${plannedMinutes ? `本节约 ${html(plannedMinutes)} 分钟` : '记录今天实际完成的练习'}</p></div>
          <div class="switcher" aria-label="学习时段">
            <button type="button" data-act="period" data-period="morning" aria-pressed="${selected === 'morning'}">早课</button>
            <button type="button" data-act="period" data-period="evening" aria-pressed="${selected === 'evening'}">晚课</button>
          </div>
        </div>
        ${blocks.length ? `<ul class="plan-list">${blocks.map(renderBlock).join('')}</ul>`
          : `<p class="plan-description">开始后，工作台会按天显示四科基线、短板练习和复测安排。</p>`}
        ${special.length ? `<div class="optional-session">
          <h3>可选完整模考</h3><ul class="plan-list">${special.map(renderBlock).join('')}</ul>
        </div>` : ''}
        ${today.resume?.title && selected === 'morning' ? `<details class="details"><summary>续学 · ${html(today.resume.title)}</summary>
          ${today.resume.description ? `<p class="plan-description">${html(today.resume.description)}</p>` : ''}
          ${today.resume.sourceLabel ? `<p class="small muted">${html(today.resume.sourceLabel)}</p>` : ''}</details>` : ''}
        <div class="plan-footer">
          ${today.started ? `<p class="muted">${html(progressLabel || '做完哪一项，就记哪一项。')}</p>${button('记本节练习', 'open-log', { period: selected }, 'button slim')}`
            : `${button('开始 14 天计划', 'start', {}, 'button primary')}<p class="muted">从第一次训练当天开始计天。</p>`}
        </div>
      </section>
      <div class="today-aside">
        <section class="audio-panel" aria-labelledby="audio-title">
          <div class="audio-wave" aria-hidden="true">${'<i></i>'.repeat(13)}</div>
          <h2 id="audio-title">上传口语录音</h2>
          <p>${state.health?.asr === false ? '录音可保存，自动转写等待本机工具。' : '上传后自动转写，点时间戳回听。'}</p>
          ${button('选择录音', 'open-upload', {}, 'button light')}
        </section>
        <section class="panel review-panel" aria-labelledby="review-title">
          <div class="panel-header"><h2 id="review-title">优先复测</h2>
          ${nextReview ? badge(CATEGORIES[nextReview.category] || nextReview.category, 'sage') : ''}</div>
          ${nextReview
            ? `<p class="small">${html(nextReview.drill || '用一道不同的题检验这次纠错。')}</p>
            ${nextReview.dueDate && nextReview.dueDate > today.date ? `<p class="form-note">${html(nextReview.dueDate)} 开始复测</p>` : ''}
            ${button('开始陌生题', 'transfer', { id: nextReview.attemptId }, 'text-button')}`
            : `<p class="small muted">确认第一条纠错后，这里会安排陌生题复测。</p>`}
        </section>
      </div>
    </div>
    <div class="section-heading"><h2>最近记录</h2>${recent.length ? '<a class="text-button" href="#progress">查看全部 →</a>' : ''}</div>
    ${recordList(recent, '练过的录音和作答会显示在这里。')}`;
}

function renderResources() {
  const resources = (state.resources || []).filter((resource) => resourceFilter === 'all' || resource.skill === resourceFilter);
  return `${heading('题库', '选一道题，做完后保存作答或成绩。')}
    <div class="filter-bar" aria-label="按科目筛选">
      ${Object.entries({ all: '全部', ...SKILL_NAMES }).map(([value, label]) =>
        `<button type="button" data-act="filter" data-value="${value}" aria-pressed="${value === resourceFilter}">${label}</button>`).join('')}
    </div>
    ${resources.length ? `<div class="resource-grid">${resources.map((resource) => `<article class="panel resource-card">
      <div class="resource-meta">${badge(SKILL_NAMES[resource.skill], 'sage')}${badge(RESOURCE_KINDS[resource.kind] || resource.kind)}</div>
      <h3>${html(resource.title)}</h3>
      <p>${html(resource.description || resource.sourceLabel || '')}</p>
      ${resource.minutes ? `<p>建议 ${html(resource.minutes)} 分钟</p>` : ''}
      <div class="action-row">${button('查看题目', 'resource', { id: resource.id }, 'button slim')}</div>
    </article>`).join('')}</div>` : empty('该科还没有题目。')}`;
}

function scoreText(score) {
  if (score?.band != null) return Number(score.band).toFixed(1);
  if (score?.correct != null && score?.total != null) return `${score.correct}/${score.total}`;
  return '';
}

function scorePanels(scores, kind) {
  return `<div class="score-grid">${SKILLS.map((skill) => {
    const score = scores?.[skill];
    const value = scoreText(score);
    const description = score?.assessmentSource || (score?.band == null && value ? '原始正确数' : kind);
    return `<section class="panel score-panel"><h2>${SKILL_NAMES[skill]}</h2>
      <div class="score-number${value ? '' : ' is-empty'}">${html(value || '待测')}</div>
      ${value ? `<p>${html(description)}</p>` : ''}
      ${score?.attemptId ? button('看作答', 'detail', { id: score.attemptId }, 'text-button') : ''}</section>`;
  }).join('')}</div>`;
}

function metricRow(name, part, total) {
  return `<li><span>${html(name)}</span><strong>${html(total > 0 ? `${part}/${total}` : '待测')}</strong>
    ${total > 0 ? `<progress class="metric-track" aria-label="${html(name)}" value="${html(part)}" max="${html(total)}"></progress>` : ''}</li>`;
}

function renderProgress() {
  const progress = state.progress || {};
  const transfer = progress.transfer || {};
  const recurrence = progress.recurrence || [];
  const mock = progress.mock || {};
  const latest = progress.latest || {};
  const official = progress.official || {};
  const headline = mock.at80 ? '最近两套模考达到总分 8.0，口语达到 7.5。'
    : mock.at75 ? '最近两套模考达到总分 7.5，口语达到 7.5。'
      : mock.lastBand != null ? `最近一套完整模考 ${Number(mock.lastBand).toFixed(1)} · 符合条件 ${mock.count || 0} 套`
        : '完整模考齐备后显示目标进度。';
  return `${heading('学习进步', headline,
    `<a class="button" href="/api/export" download>导出记录</a>${button('＋ 记成绩', 'open-log', { mode: 'baseline' })}`)}
    <div class="section-heading"><h2>四科基线</h2></div>${scorePanels(progress.baseline, '分科基线')}
    ${Object.keys(latest).length ? `<details class="details"><summary>最新可比成绩</summary>${scorePanels(latest, '限时首答')}</details>` : ''}
    ${Object.keys(official).length ? `<details class="details"><summary>正式考试成绩</summary>${scorePanels(official, '正式考试')}</details>` : ''}
    <div class="progress-columns">
      <section class="panel"><div class="panel-header"><h2>陌生题复测</h2></div>
      ${transfer.total > 0 ? `<ul class="metric-list">${metricRow('通过 / 已核作答', transfer.passed || 0, transfer.total)}</ul>`
        : empty('完成一次有明确判定的陌生题复测后显示。')}</section>
      <section class="panel"><div class="panel-header"><h2>问题复现</h2></div>
      ${recurrence.length ? `<ul class="metric-list">${recurrence.map((item) =>
        metricRow(CATEGORIES[item.category] || item.category, item.errors || 0, item.opportunities || 0)).join('')}</ul>`
        : empty('复测时记下错误数和实际使用机会数。')}</section>
    </div>
    <div class="section-heading"><h2>学习记录</h2></div>
    ${recordList(state.attempts || [], '还没有学习记录。')}`;
}

function renderPage() {
  pageContent.removeAttribute('aria-busy');
  if (!state) {
    pageContent.innerHTML = `${heading('雅思工作台', '')}${empty(loadError || '正在读取学习记录…', 'loading-panel')}
      ${loadError ? `<div class="section-heading">${button('重新连接', 'reload')}</div>` : ''}`;
    return;
  }
  pageContent.innerHTML = view === 'resources' ? renderResources() : view === 'progress' ? renderProgress() : renderToday();
}

function route() {
  const hash = location.hash.slice(1);
  if (hash === 'main') return;
  view = ['resources', 'progress'].includes(hash) ? hash : 'today';
  document.querySelectorAll('[data-page]').forEach((link) => {
    if (link.dataset.page === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  renderPage();
  window.scrollTo(0, 0);
}

function openDialog(title, subtitle, content) {
  openedAttemptId = undefined;
  openedAttempt = undefined;
  editingDetail = false;
  dialogTitle.textContent = title;
  dialogSubtitle.textContent = subtitle || '';
  dialogSubtitle.hidden = !subtitle;
  dialogBody.innerHTML = content;
  if (!dialog.open) {
    focusReturn = document.activeElement;
    dialog.showModal();
  }
  dialog.scrollTop = 0;
}

function closeDialog() {
  if (modalBusy) return;
  if (dialog.open) dialog.close();
}

function formMessage(form, message = '') {
  const status = form.querySelector('.form-message');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message;
}

function bindForm(id, onSubmit) {
  const form = dialogBody.querySelector(`#${id}`);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (modalBusy) return;
    modalBusy = true;
    formMessage(form);
    const submit = event.submitter || form.querySelector('button[type="submit"]');
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      await onSubmit(new FormData(form), form);
    } catch (error) {
      formMessage(form, error.message);
    } finally {
      modalBusy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  return form;
}

function formActions(submit, secondary = '取消') {
  return `<div class="form-message" role="alert" hidden></div><div class="form-actions">
    ${secondary ? button(secondary, 'close') : ''}
    <button type="submit" class="button primary">${html(submit)}</button>
  </div>`;
}

let fieldCounter = 0;
function labeled(label, input, note = '') {
  const id = `field-${++fieldCounter}`;
  const attributes = ` id="${id}"${note ? ` aria-describedby="${id}-note"` : ''}`;
  const control = input.replace(/^<(input|select|textarea)/, '<$1' + attributes);
  return `<div class="field"><label for="${id}">${html(label)}</label>${control}
    ${note ? `<small id="${id}-note">${html(note)}</small>` : ''}</div>`;
}

function input(name, value, attributes = '') {
  return `<input name="${name}" value="${html(value)}" ${attributes}>`;
}

function textArea(name, value, attributes = '') {
  return `<textarea name="${name}" ${attributes}>${html(value)}</textarea>`;
}

function select(name, labels, selected, attributes = '') {
  return `<select name="${name}" ${attributes}>${options(labels, selected)}</select>`;
}

function check(name, label, checked = false) {
  return `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}><span>${html(label)}</span></label>`;
}

function numberOrNull(value) {
  return value == null || value === '' ? null : Number(value);
}

function modeForResource(resource) {
  return resource?.id?.startsWith('baseline-') ? 'baseline' : 'drill';
}

function setFieldGroup(form, className, enabled) {
  const group = form.querySelector(`.${className}`);
  group.hidden = !enabled;
  group.querySelectorAll('input, textarea, select').forEach((control) => { control.disabled = !enabled; });
}

function defaultAssessmentKind(mode, skill) {
  return mode === 'official' ? 'official' : ['writing', 'speaking'].includes(skill) ? 'teacher' : 'publisher';
}

function updateScoreFields(form, initial = false) {
  const mode = form.elements.namedItem('mode').value;
  const skill = form.elements.namedItem('skill').value;
  const scored = mode !== 'drill';
  setFieldGroup(form, 'score-inputs', scored);
  setFieldGroup(form, 'raw-inputs', ['listening', 'reading'].includes(skill));
  setFieldGroup(form, 'full-inputs', ['baseline', 'mock'].includes(mode) && ['writing', 'speaking'].includes(skill));
  setFieldGroup(form, 'timing-inputs', ['baseline', 'mock'].includes(mode));
  setFieldGroup(form, 'mock-inputs', mode === 'mock');
  const hasBand = form.elements.namedItem('band').value !== '';
  form.elements.namedItem('assessmentSource').required = scored && (mode === 'official' || hasBand);
  const assessment = form.elements.namedItem('assessmentKind');
  if (!initial) assessment.value = defaultAssessmentKind(mode, skill);
  form.elements.namedItem('mockId').required = mode === 'mock';
  if (mode !== 'drill') form.querySelector('.assessment-details').open = true;
  const full = form.querySelector('.full-inputs span');
  full.textContent = skill === 'writing' ? '完成 Task 1 和 Task 2' : '完成 Part 1、2、3 互动';
}

function openLog({ resourceId, skill, mode, period, existing, prompt, parent, take } = {}) {
  const resource = resourceFor(resourceId || existing?.resourceId);
  const authentic = resource?.kind === 'authentic';
  const chosenTake = existing?.take || take || 'first';
  const selectedSkill = existing?.skill || resource?.skill || parent?.skill || skill || 'speaking';
  const selectedPeriod = existing?.period || period || activePeriod || currentPeriod();
  const selectedMode = existing?.mode || mode || modeForResource(resource);
  const id = existing?.id || newId();

  openDialog(existing ? '编辑学习记录' : '记学习', resource?.title || '', `
    <form class="form" id="log-form">
      <div class="fields">
        ${labeled('学习日期', input('date', existing?.date || state.today?.date || dateKey(), 'type="date" required'))}
        ${labeled('科目', select('skill', SKILL_NAMES, selectedSkill, resource || existing || parent ? 'disabled' : ''))}
        ${labeled('时段', select('period', PERIODS, selectedPeriod))}
        ${labeled('实际用时（分钟）', input('minutes', existing?.minutes, 'type="number" min="0" max="600" step="1" placeholder="选填"'))}
        ${labeled('类型', select('mode', MODES, selectedMode))}
        ${labeled('状态', select('status', STATUSES, existing?.status || 'done'))}
      </div>
      ${authentic ? testNumberField(existing?.prompt)
        : resource ? '' : labeled('题目或练习', input('prompt', existing?.prompt || prompt, 'maxlength="350" placeholder="选填，可填写所用资料与题号"'))}
      ${chosenTake === 'transfer' ? check('transferUnseen', '这是第一次见到这道题', existing?.unseen) : ''}
      ${labeled('原作答', textArea('answer', existing?.answer, 'maxlength="30000" placeholder="选填，例如写作原稿"'))}
      ${labeled('学习记录', textArea('notes', existing?.notes, 'maxlength="8000" placeholder="选填，记下一个问题或下一步"'))}
      <details class="details"><summary>补充资料来源</summary>
        <div class="assessment-inner">
          ${labeled('书册页码或本机资料备注', input('privateSource', existing?.privateSource, 'maxlength="350" placeholder="选填，仅作私人资料引用"'))}
        </div>
      </details>
      <details class="details assessment-details">
        <summary>成绩和评阅</summary>
        <div class="form assessment-inner">
          <div class="raw-inputs fields">
            ${labeled('正确数', input('correct', existing?.correct, 'type="number" min="0" max="40" step="1"'))}
            ${labeled('总题数', input('total', existing?.total, 'type="number" min="1" max="40" step="1"'))}
          </div>
          <div class="score-inputs form">
            <div class="fields">
              ${labeled('分数（可选）', input('band', existing?.band, 'type="number" min="0" max="9" step=".5"'))}
              ${labeled('评阅类型', select('assessmentKind', ASSESSMENT_KINDS, existing?.assessmentKind || defaultAssessmentKind(selectedMode, selectedSkill)))}
            </div>
            ${labeled('评阅或换算来源', input('assessmentSource', existing?.assessmentSource, 'maxlength="200" placeholder="例如教师姓名或官方套题换算表"'))}
            ${labeled('评阅说明', textArea('assessmentNotes', existing?.assessmentNotes, 'maxlength="3000" placeholder="选填，可记录四项评分依据"'))}
            <div class="full-inputs">${check('full', '', existing?.full)}</div>
            <div class="timing-inputs action-row">${check('timed', '完整限时', existing?.timed)}${check('unseen', '第一次见这套题', existing?.unseen)}</div>
            <div class="mock-inputs form">
              ${labeled('模考标识', input('mockId', existing?.mockId, 'maxlength="80" placeholder="例如 Cambridge19-Test1"'), '同套听、读、写、说填写同一个标识。')}
              ${check('continuous', '本套听、读、写在一个连续时段完成', existing?.continuous)}
            </div>
          </div>
          <p class="form-note">完整限时练习可进入四科基线或模考。口语与写作的分数需注明评阅来源。</p>
        </div>
      </details>
      ${formActions('保存记录')}
    </form>`);

  const form = bindForm('log-form', async (data) => {
    const clean = (name) => String(data.get(name) || '').trim();
    const payload = {
      id,
      date: clean('date'),
      skill: clean('skill') || selectedSkill,
      period: clean('period'),
      mode: clean('mode'),
      status: clean('status'),
      take: chosenTake,
      resourceId: resource?.id,
      parentId: existing?.parentId || parent?.id,
      prompt: clean('prompt') || existing?.prompt || resource?.prompt,
      minutes: numberOrNull(data.get('minutes')),
      notes: clean('notes'),
      answer: clean('answer'),
      correct: numberOrNull(data.get('correct')),
      total: numberOrNull(data.get('total')),
      band: numberOrNull(data.get('band')),
      assessmentSource: clean('assessmentSource'),
      assessmentKind: clean('assessmentKind') || undefined,
      privateSource: clean('privateSource'),
      assessmentNotes: clean('assessmentNotes'),
      mockId: clean('mockId'),
      full: data.has('full'),
      timed: data.has('timed'),
      unseen: data.has('unseen') || data.has('transferUnseen'),
      continuous: data.has('continuous'),
    };
    if (chosenTake === 'transfer' && !payload.unseen) throw new Error('请确认这是第一次见到这道题。');
    if ((payload.correct == null) !== (payload.total == null) || payload.correct > payload.total) {
      throw new Error('听力或阅读成绩请同时填写正确数和总题数，正确数须在总题数以内。');
    }
    const url = existing ? `/api/attempts/${encodeURIComponent(id)}` : '/api/attempts';
    await api(url, { method: existing ? 'PATCH' : 'POST', body: payload });
    dialog.close();
    notify('已保存学习记录。');
    await reload();
  });
  form.addEventListener('change', (event) => {
    if (['skill', 'mode'].includes(event.target.name)) updateScoreFields(form);
    if (event.target.name === 'band') updateScoreFields(form, true);
  });
  updateScoreFields(form, true);
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const part = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [part.slice(0, 4), part.slice(4, 6), part.slice(6, 8), part.slice(8, 10), part.slice(10)]
    .map((group) => group.join('')).join('-');
}

const TEST_NUMBERS = { 'Test 1': 'Test 1', 'Test 2': 'Test 2', 'Test 3': 'Test 3', 'Test 4': 'Test 4' };
function testNumberField(value) {
  return labeled('书内套号', select('prompt', { '': '请选择', ...TEST_NUMBERS }, value || '', 'required'));
}

function openUpload({ parent, resource, take = 'first', existing } = {}) {
  const id = existing?.id || newId();
  const first = take === 'first';
  const title = first ? '上传口语录音' : TAKES[take];
  const defaultPrompt = existing?.prompt || (take === 'retake' ? parent?.prompt : '') || resource?.prompt || resource?.title || '';
  const context = parent ? `上一次：${attemptTitle(parent)}` : resource?.title || '';
  const picker = labeled('录音文件', `<input type="file" name="audio" accept="${AUDIO_ACCEPT}" required>`, '可选手机语音备忘录导出的 M4A、MP3 或 WAV。');
  const info = existing ? '' : resource?.kind === 'authentic' && take !== 'retake' ? testNumberField('')
    : resource?.prompt && take !== 'retake' ? `<div class="detail-section"><h3>题目</h3><pre>${html(resource.prompt)}</pre></div>`
      : labeled(take === 'transfer' ? '陌生题' : '题目或练习',
        input('prompt', defaultPrompt, `maxlength="350" placeholder="如 Part 2 练习题" ${take === 'retake' && defaultPrompt ? 'readonly' : ''}`));

  openDialog(title, context, `
    <form class="form" id="upload-form">
      ${info}
      ${picker}
      ${take === 'transfer' ? check('transferUnseen', '这是第一次见到这道题') : ''}
      ${existing ? '' : `<div class="fields">
        ${labeled('学习日期', input('date', state.today?.date || dateKey(), 'type="date" required'))}
        ${labeled('时段', select('period', PERIODS, activePeriod || 'extra'))}
      </div>`}
      ${formActions('上传并转写')}
    </form>`);

  let created = !!existing;
  bindForm('upload-form', async (data) => {
    const file = data.get('audio');
    if (!(file instanceof File) || !file.size) throw new Error('请选择一份非空的录音。');
    if (!created) {
      const prompt = String(data.get('prompt') || resource?.prompt || '').trim();
      if (take === 'transfer' && !data.has('transferUnseen')) throw new Error('请确认这是第一次见到这道题。');
      if (take === 'transfer' && !resource && !prompt) throw new Error('请填写这次未做过的题目。');
      await api('/api/attempts', { method: 'POST', body: {
        id,
        date: data.get('date'),
        skill: 'speaking',
        period: data.get('period'),
        mode: resource ? modeForResource(resource) : 'drill',
        status: 'started',
        unseen: take === 'transfer' && data.has('transferUnseen'),
        take,
        parentId: parent?.id,
        resourceId: resource?.id || (take === 'retake' ? parent?.resourceId : undefined),
        prompt,
      } });
      created = true;
    }
    const { attempt } = await api(`/api/attempts/${encodeURIComponent(id)}/audio`, {
      method: 'PUT', body: file, raw: true,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    });
    renderAttemptDetail(attempt, '录音已保存。关闭此页后，Mac 会继续处理。');
    await reload();
  });
}

function openResource(resource) {
  if (!resource) return;
  const source = [resource.sourceLabel, resource.part].filter(Boolean).join(' · ');
  const officialLink = externalLink(resource.url, '打开题面');
  const answerLink = externalLink(resource.answerUrl, '查看答案');
  openDialog(resource.title, source, `
    <div class="detail-meta">${badge(SKILL_NAMES[resource.skill], 'sage')}${badge(RESOURCE_KINDS[resource.kind] || resource.kind)}
      ${resource.minutes ? badge(`建议 ${resource.minutes} 分钟`) : ''}</div>
    ${resource.description ? `<div class="detail-section"><p>${html(resource.description)}</p></div>` : ''}
    ${resource.prompt ? `<div class="detail-section"><h3>题目</h3><pre>${html(resource.prompt)}</pre></div>` : ''}
    <div class="detail-section action-row">${officialLink}${answerLink}
      ${button('保存作答', 'open-log', { resource: resource.id }, 'button primary')}
      ${resource.skill === 'speaking' ? button('上传作答录音', 'open-upload', { resource: resource.id }) : ''}
    </div>`);
}

function timestamp(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function audioPath(attempt, endpoint = 'audio') {
  return `/api/attempts/${encodeURIComponent(attempt.id)}/${endpoint}`;
}

function seekButton(attempt, from) {
  return attempt.recording?.hasPlayback && Number.isFinite(Number(from))
    ? button(timestamp(from), 'seek', { ms: from }, 'button slim') : '';
}

function recordingContent(attempt) {
  const recording = attempt.recording;
  if (!recording) return attempt.skill === 'speaking'
    ? `<section class="detail-section">${button('补上传录音', 'attach', { id: attempt.id })}</section>` : '';

  const message = recording.status === 'queued' ? '录音已保存，正在等待转写。'
    : recording.status === 'running' ? 'Mac 正在生成带时间戳的转写。'
      : recording.status === 'failed' ? recording.error || '转写失败，可使用同一份原录音重试。' : '';
  const feedbackMessage = ACTIVE_RECORDING.has(recording.feedbackStatus) ? '正在检查转写中的语法、用词与表达结构。'
    : recording.feedbackStatus === 'failed' ? recording.feedbackError || '自动文字反馈暂时失败，可重试或补录人工反馈。'
      : recording.feedbackStatus === 'unavailable' || state.health?.feedback === false ? '自动文字反馈暂不可用，可回听后手工记录。' : '';
  const retry = recording.status === 'failed' || ['failed', 'unavailable'].includes(recording.feedbackStatus);
  const playback = recording.hasPlayback
    ? `<audio class="audio-player" controls preload="metadata" aria-label="练习录音" src="${audioPath(attempt)}"></audio>`
    : recording.hasOriginal ? `<a class="button slim" href="${audioPath(attempt, 'original')}" download>导出原录音</a>` : '';

  return `<section class="detail-section">
    <div class="panel-header"><h3>录音与处理状态</h3>${badge(recordingLabel(attempt), retry ? 'warm' : 'sage')}</div>
    ${playback}
    ${message ? `<p class="small muted" role="status">${html(message)}</p>` : ''}
    ${feedbackMessage ? `<p class="small muted" role="status">${html(feedbackMessage)}</p>` : ''}
    ${retry ? `<div class="action-row detail-actions">${button('重试处理', 'retry', { id: attempt.id })}</div>` : ''}
  </section>`;
}

function transcriptContent(attempt) {
  const segments = attempt.segments || [];
  if (!segments.length) return '';
  return `<section class="detail-section"><h3>转写与校订</h3>
    <form class="form" id="transcript-form">
      <ol class="segment-list">
        ${segments.map((segment, index) => `<li>
          ${seekButton(attempt, segment.startMs) || `<span class="badge">${timestamp(segment.startMs)}</span>`}
          <div>
            ${segment.correctedText != null ? `<div class="small muted">机器稿：${html(segment.text)}</div>` : ''}
            <textarea class="segment-review" name="segment-${index}" aria-label="校订 ${timestamp(segment.startMs)}" rows="2">${html(segment.correctedText ?? segment.text)}</textarea>
          </div>
        </li>`).join('')}
      </ol>
      ${formActions('保存校订', '')}
    </form></section>`;
}

function findingsContent(attempt) {
  const findings = attempt.findings || [];
  return `<section class="detail-section">
    <div class="panel-header"><h3>纠错与复练</h3>${button('＋ 添加纠错', 'manual-finding', { id: attempt.id }, 'button slim')}</div>
    ${findings.length ? findings.map((finding, index) => `<article class="issue-card"><div class="panel-header">
      ${badge(CATEGORIES[finding.category] || finding.category, 'sage')}
      ${badge(finding.confirmed ? '已核实' : '待核实', finding.confirmed ? 'sage' : 'warm')}
      ${badge(finding.source === 'audio' ? '原声' : '文字')}
      ${finding.startMs != null ? seekButton(attempt, finding.startMs) : ''}
    </div>
    <p><span class="issue-label">原句</span>${html(finding.quote)}</p>
    <p><span class="issue-label">改法</span>${html(finding.correction)}</p>
    <p><span class="issue-label">复练</span>${html(finding.drill)}</p>
    <div class="action-row detail-actions">${button('编辑', 'manual-finding', { id: attempt.id, index }, 'text-button')}</div>
    </article>`).join('') : `<p class="small muted">确认一处问题后，记录原句、改法和复练任务。</p>`}
  </section>`;
}

function reviewResultContent(attempt) {
  const review = attempt.review || {};
  if (attempt.take !== 'transfer') return '';
  const category = review.category || attemptFor(attempt.parentId)?.findings?.find((finding) => finding.confirmed)?.category || 'grammar';
  return `<section class="detail-section"><h3>陌生题复测结果</h3>
    <form class="form" id="result-form">
      <div class="fields">
        ${labeled('语言目标', select('category', CATEGORIES, category))}
        ${labeled('结果', select('outcome', OUTCOMES, review.outcome || 'untested'))}
        ${labeled('目标表达出现的机会数', input('opportunities', review.opportunities, 'type="number" min="0" step="1" max="200"'))}
        ${labeled('核实的错误数', input('errors', review.errors, 'type="number" min="0" step="1" max="200"'))}
      </div>
      <p class="form-note">如果这道题没有用到目标表达，保留「证据不足」。</p>
      ${formActions('保存复测', '')}
    </form></section>`;
}

function renderAttemptDetail(attempt, notice = '') {
  const sourceText = resourceFor(attempt.resourceId)?.sourceLabel;
  const subtitle = [attempt.date, PERIODS[attempt.period], MODES[attempt.mode], TAKES[attempt.take], sourceText].filter(Boolean).join(' · ');
  const parent = attemptFor(attempt.parentId);
  const doneAction = attempt.status === 'started' && attempt.recording
    ? button('标记已完成', 'complete', { id: attempt.id }, 'button primary') : '';
  const rawScore = scoreText(attempt);
  const answer = attempt.answer || attempt.originalAnswer || attempt.notes || rawScore || attempt.assessmentNotes || attempt.privateSource
    ? `<section class="detail-section">
      <h3>本次作答</h3>
      ${rawScore ? `<p>${html(rawScore)}${attempt.assessmentSource ? `<span class="muted"> · ${html(attempt.assessmentSource)}</span>` : ''}</p>` : ''}
      ${attempt.originalAnswer && attempt.originalAnswer !== attempt.answer ? `<p class="muted">首次提交</p><pre>${html(attempt.originalAnswer)}</pre><p class="muted">当前作答</p>` : ''}
      ${attempt.answer ? `<pre>${html(attempt.answer)}</pre>` : ''}
      ${attempt.notes ? `<p class="small">${html(attempt.notes)}</p>` : ''}
      ${attempt.assessmentNotes ? `<pre>${html(attempt.assessmentNotes)}</pre>` : ''}
      ${attempt.privateSource ? `<p class="small muted">资料备注 · ${html(attempt.privateSource)}</p>` : ''}
    </section>` : '';
  const buttons = attempt.skill === 'speaking' && (attempt.recording || attempt.answer)
    ? button('同题重录', 'retake', { id: attempt.id }) : '';
  const transfer = attempt.findings?.some((item) => item.confirmed)
    ? button('陌生题复测', 'transfer', { id: attempt.id }) : '';

  const answerUrl = resourceFor(attempt.resourceId)?.answerUrl;
  openDialog(attemptTitle(attempt), subtitle, `
    <div class="detail-meta">${badge(SKILL_NAMES[attempt.skill], 'sage')}${badge(STATUSES[attempt.status])}
      ${attempt.minutes != null ? badge(`实练 ${attempt.minutes} 分钟`) : ''}
      ${parent ? button('查看上一次', 'detail', { id: parent.id }, 'text-button') : ''}
      ${doneAction}${button('编辑记录', 'edit', { id: attempt.id }, 'button slim')}
      ${externalLink(answerUrl, '查看答案')}
    </div>
    ${notice ? `<p class="save-notice" role="status">${html(notice)}</p>` : ''}
    ${recordingContent(attempt)}
    ${transcriptContent(attempt)}
    ${answer}
    ${findingsContent(attempt)}
    ${reviewResultContent(attempt)}
    ${buttons || transfer ? `<div class="detail-section action-row">${buttons}${transfer}</div>` : ''}`);
  openedAttempt = attempt;
  openedAttemptId = attempt.id;
  detailNotice = notice;
  if (attempt.segments?.length) {
    const form = bindForm('transcript-form', async (data) => {
      const segments = attempt.segments.map((segment, index) => ({ id: segment.id, text: String(data.get(`segment-${index}`)).trim() }))
        .filter((segment, index) => segment.text !== (attempt.segments[index].correctedText ?? attempt.segments[index].text));
      if (!segments.length) {
        await showAttempt(attempt.id, '目前没有需要保存的校订。');
        return;
      }
      await api(audioPath(attempt, 'review'), { method: 'PATCH', body: { segments } });
      await showAttempt(attempt.id, '校订已保存。');
    });
    form.addEventListener('input', () => { editingDetail = true; });
  }
  if (attempt.take === 'transfer') {
    const form = bindForm('result-form', async (data) => {
      const opportunities = numberOrNull(data.get('opportunities')) || 0;
      const errors = numberOrNull(data.get('errors')) || 0;
      const outcome = data.get('outcome');
      if (errors > opportunities || (outcome !== 'untested' && !opportunities)) {
        throw new Error('请填写实际出现的机会数，错误数不能大于机会数。');
      }
      if (attempt.status === 'started' && attempt.recording) {
        await api(`/api/attempts/${encodeURIComponent(attempt.id)}`, { method: 'PATCH', body: { status: 'done' } });
      }
      await api(audioPath(attempt, 'review'), { method: 'PATCH', body: {
        outcome, opportunities, errors, category: data.get('category'),
      } });
      await showAttempt(attempt.id, '复测结果已保存。');
      await reload();
    });
    form.addEventListener('input', () => { editingDetail = true; });
  }
  scheduleRefresh();
}

async function showAttempt(id, notice) {
  const { attempt } = await api(`/api/attempts/${encodeURIComponent(id)}`);
  renderAttemptDetail(attempt, notice);
}

function openFinding(attempt, index) {
  const existing = Number.isInteger(index) ? attempt.findings[index] : null;
  const hasAudio = !!attempt.recording?.hasPlayback;
  const sourceValues = { text: '文字作答或已核转写', ...(hasAudio ? { audio: '原声回听' } : {}) };
  const seconds = (value) => value == null ? null : value / 1000;
  openDialog(existing ? '编辑纠错' : '添加纠错', attemptTitle(attempt), `
    <form class="form" id="finding-form">
      <div class="fields">
        ${labeled('问题类型', select('category', CATEGORIES, existing?.category || 'grammar'))}
        ${labeled('证据来源', select('source', sourceValues, existing?.source || 'text'))}
      </div>
      ${hasAudio ? `<audio class="audio-player" controls preload="metadata" aria-label="回听原录音" src="${audioPath(attempt)}"></audio>
        <div class="fields">
          ${labeled('开始时间（秒）', input('start', seconds(existing?.startMs), 'type="number" min="0" step="0.001" placeholder="选填"'))}
          ${labeled('结束时间（秒）', input('end', seconds(existing?.endMs), 'type="number" min="0" step="0.001" placeholder="选填"'))}
        </div>` : ''}
      ${labeled('原句或听到的片段', textArea('quote', existing?.quote, 'required maxlength="700"'))}
      ${labeled('改法', textArea('correction', existing?.correction, 'required maxlength="1200"'))}
      ${labeled('复练任务', textArea('drill', existing?.drill, 'required maxlength="1200"'))}
      ${check('confirmed', '已核对证据，加入错题与复测记录', existing?.confirmed)}
      <p class="form-note">发音、重音和节奏需要原声证据。识别疑点可以先留待核实。</p>
      ${formActions('保存纠错')}
    </form>`);
  bindForm('finding-form', async (data) => {
    const start = numberOrNull(data.get('start'));
    const end = numberOrNull(data.get('end'));
    const cat = data.get('category');
    const source = data.get('source');
    const confirmed = data.has('confirmed');
    const quote = String(data.get('quote')).trim();
    const correction = String(data.get('correction')).trim();
    const drill = String(data.get('drill')).trim();
    if (!quote || !correction || !drill) throw new Error('请填写原句、改法和复练任务。');
    if ((source === 'audio' && start == null) || (confirmed && ['pronunciation', 'rhythm', 'fluency'].includes(cat) && source !== 'audio')) {
      throw new Error('请回听原声、选择「原声回听」并填入开始时间，再确认此纠错。');
    }
    if (end != null && (start == null || end < start)) throw new Error('结束时间应晚于开始时间。');
    const startMs = start == null ? existing?.startMs : Math.round(start * 1000);
    const endMs = end == null ? existing?.endMs : Math.round(end * 1000);
    const matchingText = source === 'text' && !attempt.answer?.includes(quote)
      ? attempt.segments?.find((segment) => (segment.correctedText ?? segment.text).includes(quote)) : undefined;
    const finding = {
      id: existing?.id, segmentId: matchingText?.id || (source === 'audio' ? existing?.segmentId : undefined), startMs, endMs,
      category: cat, quote, correction, drill, confirmed, source,
    };
    await api(audioPath(attempt, 'review'), { method: 'PATCH', body: { findings: [finding] } });
    await showAttempt(attempt.id, '纠错已保存。');
    await reload();
  });
}

async function transferFor(attempt) {
  const { resource } = await api(audioPath(attempt, 'next'));
  if (attempt.skill === 'speaking') openUpload({ parent: attempt, resource, take: 'transfer' });
  else openLog({ parent: attempt, take: 'transfer', skill: attempt.skill, resourceId: resource?.id });
}

function seekAudio(ms) {
  const player = dialogBody.querySelector('audio');
  if (!player) return;
  const seek = () => {
    const seconds = Number(ms) / 1000;
    player.currentTime = Number.isFinite(player.duration) ? Math.min(seconds, player.duration) : seconds;
    player.play().catch(() => {});
  };
  if (player.readyState) seek();
  else {
    player.addEventListener('loadedmetadata', seek, { once: true });
    player.load();
  }
}

async function withAttempt(id, action) {
  const attempt = openedAttempt?.id === id ? openedAttempt : attemptFor(id) || (await api(`/api/attempts/${encodeURIComponent(id)}`)).attempt;
  return action(attempt);
}

const actions = {
  reload: () => reload(),
  async start() {
    await api('/api/start', { method: 'POST', body: {} });
    notify('已开始 14 天计划。');
    await reload();
  },
  period({ period }) {
    activePeriod = period;
    renderPage();
    pageContent.querySelector(`[data-period="${period}"]`)?.focus({ preventScroll: true });
  },
  filter({ value }) {
    resourceFilter = value;
    renderPage();
    pageContent.querySelector(`[data-value="${value}"]`)?.focus({ preventScroll: true });
  },
  resource: ({ id }) => openResource(resourceFor(id)),
  'open-log': ({ resource, skill, mode, period }) => openLog({ resourceId: resource, skill, mode, period }),
  'open-upload': ({ resource }) => openUpload({ resource: resourceFor(resource) }),
  detail: ({ id }) => showAttempt(id),
  edit: ({ id }) => withAttempt(id, (attempt) => openLog({ existing: attempt })),
  retake: ({ id }) => withAttempt(id, (attempt) => openUpload({ parent: attempt, resource: resourceFor(attempt.resourceId), take: 'retake' })),
  transfer: ({ id }) => withAttempt(id, transferFor),
  attach: ({ id }) => withAttempt(id, (attempt) => openUpload({ existing: attempt })),
  async retry({ id }) {
    await api(`/api/attempts/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} });
    await showAttempt(id, '已重新安排处理。');
    await reload();
  },
  async complete({ id }) {
    await api(`/api/attempts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'done' } });
    await reload();
    await showAttempt(id, '已标记为完成。');
  },
  'manual-finding': ({ id, index }) => withAttempt(id, (attempt) => openFinding(attempt, index == null ? null : Number(index))),
  seek: ({ ms }) => seekAudio(ms),
  close: () => closeDialog(),
};

document.addEventListener('click', async (event) => {
  const control = event.target.closest('button[data-act]');
  if (!control || modalBusy || !actions[control.dataset.act]) return;
  const loading = ['detail', 'start', 'retry', 'complete', 'transfer'].includes(control.dataset.act);
  if (loading) control.disabled = true;
  try {
    await actions[control.dataset.act](control.dataset);
  } catch (error) {
    if (dialog.open) {
      const notice = document.createElement('p');
      notice.className = 'form-message';
      notice.setAttribute('role', 'alert');
      notice.textContent = error.message;
      dialogBody.prepend(notice);
    } else notify(error.message);
  } finally {
    if (loading) control.disabled = false;
  }
});

document.querySelector('#close-dialog').addEventListener('click', closeDialog);
dialog.addEventListener('cancel', (event) => { if (modalBusy) event.preventDefault(); });
dialog.addEventListener('close', () => {
  openedAttemptId = undefined;
  openedAttempt = undefined;
  editingDetail = false;
  detailNotice = '';
  if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
  scheduleRefresh();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void reload({ quiet: true });
  else clearTimeout(refreshTimer);
});
window.addEventListener('hashchange', route);
route();
void reload();
