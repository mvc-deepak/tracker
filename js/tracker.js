'use strict';

const PLAN_START_DATE = '2026-10-18';
const PLAN_TARGET_END_DATE = '2027-01-31';
const COURSE_HEADERS = ['Section Name', 'Lectures', 'Duration', 'Status', 'Completion Date', 'Notes'];
const COURSE_STATUSES = ['Not Started', 'In Progress', 'Completed'];
let trackerCourses = [];
let checkoutHandle = null;
let selectedCourseFile = '';
const now = new Date();
let trackerToday = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');

function setTrackerNotice(message, kind = 'info') {
  const notice = $('trackerNotice');
  notice.hidden = false;
  notice.className = 'notice ' + kind;
  notice.textContent = message;
}

function formatTrackerDate(value) {
  if (!value) return '—';
  const date = new Date(value + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function isValidCompletionDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseDurationMinutes(value) {
  const text = String(value || '').trim().toLowerCase();
  const hourValues = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/g)];
  const minuteValues = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)/g)];
  const hours = hourValues.reduce((sum, match) => sum + Number(match[1]), 0);
  const minutes = minuteValues.reduce((sum, match) => sum + Number(match[1]), 0);
  return hourValues.length || minuteValues.length ? Math.round(hours * 60 + minutes) : null;
}

function parseCourseCsv(text, fileName, fileHandle = null) {
  const hasBom = text.charCodeAt(0) === 0xFEFF;
  const source = hasBom ? text.slice(1) : text;
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(value => value.trim())) records.push(row);
      row = [];
      field = '';
    } else if (character === '"') {
      throw new Error(fileName + ' contains a quote in an unquoted CSV field.');
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error(fileName + ' contains an unfinished quoted CSV field.');
  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value.trim())) records.push(row);
  }
  if (!records.length) throw new Error(fileName + ' is empty.');

  const headers = records.shift().map(value => value.trim().replace(/^\uFEFF/, ''));
  const missingHeaders = COURSE_HEADERS.filter(header => !headers.includes(header));
  if (missingHeaders.length) throw new Error(fileName + ' is missing required columns: ' + missingHeaders.join(', ') + '.');
  const headerIndexes = Object.fromEntries(COURSE_HEADERS.map(header => [header, headers.indexOf(header)]));
  const sections = records.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(fileName + ' row ' + (index + 2) + ' has ' + cells.length + ' columns; expected ' + headers.length + '.');
    return { cells };
  }).filter(section => section.cells[headerIndexes['Section Name']].trim());
  const title = fileName.replace(/\.csv$/i, '');
  return { fileName, title, headers, headerIndexes, sections, hasBom, lineEnding, sourceText: text, fileHandle };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function serializeCourseCsv(course) {
  const rows = [course.headers, ...course.sections.map(section => section.cells)];
  const content = rows.map(row => row.map(csvEscape).join(',')).join(course.lineEnding) + course.lineEnding;
  return (course.hasBom ? '\uFEFF' : '') + content;
}

function cell(section, course, header) {
  return section.cells[course.headerIndexes[header]] || '';
}

function setCell(section, course, header, value) {
  section.cells[course.headerIndexes[header]] = value;
}

function normalizedStatus(value) {
  const status = String(value || '').trim();
  const lower = status.toLocaleLowerCase();
  if (!status || lower === 'pending' || lower === 'not started' || lower === 'no started') return 'Not Started';
  if (lower === 'in progress' || lower === 'in-progress' || lower === 'learning') return 'In Progress';
  if (lower === 'completed' || lower === 'complete' || lower === 'done') return 'Completed';
  return status;
}

function sectionIsCompleted(section, course) {
  return isValidCompletionDate(cell(section, course, 'Completion Date').trim());
}

function courseStats(course) {
  const durations = course.sections.map(section => parseDurationMinutes(cell(section, course, 'Duration')));
  const totalMinutes = durations.reduce((sum, value) => sum + (value ?? 0), 0);
  const completedMinutes = course.sections.reduce((sum, section, index) => sum + (sectionIsCompleted(section, course) ? durations[index] ?? 0 : 0), 0);
  const completedSections = course.sections.filter(section => sectionIsCompleted(section, course)).length;
  const allDurationsKnown = durations.length > 0 && durations.every(value => value !== null);
  const percent = allDurationsKnown
    ? (totalMinutes ? Math.round(completedMinutes * 100 / totalMinutes) : 0)
    : (course.sections.length ? Math.round(completedSections * 100 / course.sections.length) : 0);
  const totalLectures = course.sections.reduce((sum, section) => {
    const value = Number(cell(section, course, 'Lectures').replace(/,/g, '').trim());
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  return {
    totalSections: course.sections.length,
    completedSections,
    inProgressSections: course.sections.filter(section => normalizedStatus(cell(section, course, 'Status')) === 'In Progress' && !sectionIsCompleted(section, course)).length,
    totalMinutes,
    completedMinutes,
    totalLectures,
    percent,
    allDurationsKnown
  };
}

function formatHours(minutes) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? hours + 'h' : hours.toFixed(1) + 'h';
}

function overallStats() {
  const stats = trackerCourses.map(courseStats);
  const totalMinutes = stats.reduce((sum, course) => sum + course.totalMinutes, 0);
  const completedMinutes = stats.reduce((sum, course) => sum + course.completedMinutes, 0);
  const totalSections = stats.reduce((sum, course) => sum + course.totalSections, 0);
  const completedSections = stats.reduce((sum, course) => sum + course.completedSections, 0);
  const everyDurationKnown = stats.every(course => course.allDurationsKnown);
  const percent = everyDurationKnown
    ? (totalMinutes ? Math.round(completedMinutes * 100 / totalMinutes) : 0)
    : (totalSections ? Math.round(completedSections * 100 / totalSections) : 0);
  const start = new Date(PLAN_START_DATE + 'T00:00:00');
  const end = new Date(PLAN_TARGET_END_DATE + 'T00:00:00');
  const today = new Date(trackerToday + 'T00:00:00');
  const planDays = Math.max(1, Math.ceil((end - start) / 86400000));
  const daysLeft = Math.max(0, Math.ceil((end - today) / 86400000));
  const elapsedPercent = Math.min(100, Math.max(0, Math.round((planDays - daysLeft) * 100 / planDays)));
  return {
    totalMinutes, completedMinutes, totalSections, completedSections,
    percent, daysLeft, elapsedPercent,
    hoursPerDay: daysLeft ? Math.max(0, totalMinutes - completedMinutes) / 60 / daysLeft : 0,
    everyDurationKnown
  };
}

function renderSummary() {
  const stats = overallStats();
  $('trackerSummary').innerHTML = `
    <article class="tracker-progress-card panel"><div class="tracker-progress-ring" style="--progress:${stats.percent * 3.6}deg"><div><strong>${stats.percent}%</strong><span>complete</span></div></div><div><p class="eyebrow">ALL-COURSE PROGRESS</p><h2>${stats.completedSections} of ${stats.totalSections} chapters completed</h2><p class="muted">${formatHours(stats.completedMinutes)} of ${formatHours(stats.totalMinutes)} watched · ${stats.daysLeft} days to target</p></div></article>
    <article class="tracker-stat-card panel"><span class="tracker-stat-icon progress-icon">⏱️</span><strong>${stats.totalMinutes ? formatHours(stats.totalMinutes - stats.completedMinutes) : '—'}</strong><span>Course hours remaining</span></article>
    <article class="tracker-stat-card panel"><span class="tracker-stat-icon overdue-icon">🎬</span><strong>${trackerCourses.reduce((sum, course) => sum + courseStats(course).totalLectures, 0).toLocaleString()}</strong><span>Total lectures</span></article>
    <article class="tracker-stat-card panel"><span class="tracker-stat-icon schedule-icon">🚀</span><strong>${stats.daysLeft ? stats.hoursPerDay.toFixed(1) + 'h/day' : '—'}</strong><span>Needed to finish by 31 Jan</span></article>
    <div class="tracker-pace-card"><div><strong>📈 Progress pace</strong><span>Time elapsed: ${stats.elapsedPercent}% · Course complete: ${stats.percent}%</span></div><div class="tracker-pace-track" role="img" aria-label="Progress pace: ${stats.percent} percent complete; ${stats.elapsedPercent} percent of plan elapsed"><span class="tracker-pace-elapsed" style="width:${stats.elapsedPercent}%"></span><i class="tracker-pace-marker" style="left:${stats.percent}%"></i></div><small>${stats.percent >= stats.elapsedPercent ? 'You are on pace or ahead—keep it going!' : 'A little more study time will help you catch up.'}</small></div>`;
}

function renderCourseOverview() {
  const selected = selectedCourseFile;
  $('courseOverview').innerHTML = trackerCourses.map(course => {
    const stats = courseStats(course);
    const weightedLabel = stats.allDurationsKnown ? 'hours' : 'sections · duration missing';
    return `<button type="button" class="course-card${course.fileName === selected ? ' is-selected' : ''}" data-course-file="${escapeHTML(course.fileName)}" aria-pressed="${course.fileName === selected}">
      <span class="course-card-top"><span class="course-card-emoji">${courseEmoji(course.title)}</span><span class="course-card-percent">${stats.percent}%</span></span>
      <strong class="course-card-title">${escapeHTML(course.title)}</strong>
      <span class="course-progress-track" role="img" aria-label="${stats.percent}% complete"><i style="width:${stats.percent}%"></i></span>
      <span class="course-card-meta">${stats.completedSections}/${stats.totalSections} chapters · ${formatHours(stats.completedMinutes)} / ${formatHours(stats.totalMinutes)} · ${stats.totalLectures} lectures</span>
      <span class="course-card-weight">Progress by ${weightedLabel}</span>
    </button>`;
  }).join('') || '<p class="muted">No course CSV files were found.</p>';
  const caption = document.querySelector('.course-overview-caption');
  caption.textContent = '📚 ' + trackerCourses.length + ' courses';
}

function courseEmoji(name) {
  const title = name.toLocaleLowerCase();
  if (title.includes('react')) return '⚛️';
  if (title.includes('design')) return '🏗️';
  if (title.includes('terraform') || title.includes('azure')) return '☁️';
  if (title.includes('claude')) return '🤖';
  if (title.includes('github')) return '🐙';
  if (title.includes('microservice')) return '🧩';
  if (title.includes('system')) return '🧠';
  return '📘';
}

function renderCompletionTimeline(course) {
  const stats = courseStats(course);
  if (!stats.totalMinutes) return '<div class="course-chart-empty">Course durations are unavailable, so there is no effort timeline to chart.</div>';
  const planStart = new Date(PLAN_START_DATE + 'T00:00:00').getTime();
  const planEnd = new Date(PLAN_TARGET_END_DATE + 'T00:00:00').getTime();
  const range = planEnd - planStart;
  const points = new Map();
  for (const section of course.sections) {
    const date = cell(section, course, 'Completion Date').trim();
    const duration = parseDurationMinutes(cell(section, course, 'Duration'));
    if (isValidCompletionDate(date) && duration !== null) points.set(date, (points.get(date) || 0) + duration);
  }
  if (!points.size) return '<div class="course-chart-empty"><span>🗓️</span><strong>No completion dates yet</strong><p>As you complete chapters, your progress line will build here.</p></div>';
  let cumulative = 0;
  const chartPoints = [[30, 184]];
  const sorted = [...points.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [date, minutes] of sorted) {
    cumulative += minutes;
    const x = Math.min(610, Math.max(30, 30 + ((new Date(date + 'T00:00:00').getTime() - planStart) / range) * 580));
    const y = 184 - Math.min(1, cumulative / stats.totalMinutes) * 150;
    chartPoints.push([x, y]);
  }
  const coordinates = chartPoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `30,184 ${coordinates} 610,184`;
  return `<svg class="course-timeline" viewBox="0 0 640 230" role="img" aria-label="Cumulative course completion by date">
    <title>Course progress over time</title>
    <line x1="30" y1="34" x2="610" y2="34" class="timeline-grid"></line><line x1="30" y1="109" x2="610" y2="109" class="timeline-grid"></line><line x1="30" y1="184" x2="610" y2="184" class="timeline-axis"></line>
    <text x="2" y="38">100%</text><text x="8" y="113">50%</text><text x="18" y="188">0%</text>
    <polygon points="${area}" class="timeline-area"></polygon><polyline points="${coordinates}" class="timeline-line"></polyline>
    ${chartPoints.slice(1).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" class="timeline-point"></circle>`).join('')}
    <text x="30" y="213">${formatTrackerDate(PLAN_START_DATE)}</text><text x="610" y="213" text-anchor="end">${formatTrackerDate(PLAN_TARGET_END_DATE)}</text>
  </svg>`;
}

function renderStatusDonut(course, stats) {
  const started = course.sections.filter(section => !sectionIsCompleted(section, course) && normalizedStatus(cell(section, course, 'Status')) === 'In Progress').length;
  const completed = stats.completedSections;
  const remaining = Math.max(0, stats.totalSections - completed - started);
  const total = stats.totalSections || 1;
  const completeAngle = completed * 360 / total;
  const startedAngle = (completed + started) * 360 / total;
  return `<div class="course-detail-donut" style="--complete-angle:${completeAngle}deg;--started-angle:${startedAngle}deg"><div><strong>${stats.percent}%</strong><span>by hours</span></div></div>
    <div class="course-detail-legend"><span><i class="legend-completed"></i> Completed <strong>${completed}</strong></span><span><i class="legend-in-progress"></i> In progress <strong>${started}</strong></span><span><i class="legend-remaining"></i> Not started <strong>${remaining}</strong></span></div>`;
}

function renderCourseDetail() {
  const course = trackerCourses.find(item => item.fileName === selectedCourseFile);
  if (!course) {
    $('courseDetail').innerHTML = '<div class="course-detail-empty"><span>🧭</span><h2 id="courseDetailHeading">Choose a course above</h2><p class="muted">The overview and each course’s progress are available as soon as the tracker loads.</p></div>';
    return;
  }
  const stats = courseStats(course);
  const editable = Boolean(checkoutHandle && course.fileHandle);
  const saveLabel = course.dirty ? 'Save course CSV' : 'CSV saved';
  const sections = course.sections.map((section, index) => {
    const title = cell(section, course, 'Section Name').trim();
    const status = normalizedStatus(cell(section, course, 'Status'));
    const rawCompletionDate = cell(section, course, 'Completion Date').trim();
    const completionDate = isValidCompletionDate(rawCompletionDate) ? rawCompletionDate : '';
    const duration = parseDurationMinutes(cell(section, course, 'Duration'));
    const durationLabel = duration === null ? cell(section, course, 'Duration').trim() || '—' : formatHours(duration);
    const options = [...COURSE_STATUSES];
    if (status && !options.includes(status)) options.push(status);
    const invalidDate = rawCompletionDate && !completionDate;
    return `<article class="course-section-row${completionDate ? ' is-completed' : ''}" data-section-index="${index}">
      <span class="section-number">${String(index + 1).padStart(2, '0')}</span>
      <div class="section-name"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(cell(section, course, 'Lectures').trim() || '—')} lectures · ${escapeHTML(durationLabel)}</span></div>
      <label class="section-status-control"><span>Status</span><select data-status ${editable ? '' : 'disabled'}>${options.map(option => `<option value="${escapeHTML(option)}" ${option === status ? 'selected' : ''}>${escapeHTML(option)}</option>`).join('')}</select></label>
      <label class="section-date-control"><span>Completed on</span><input data-completion type="date" value="${escapeHTML(completionDate || rawCompletionDate)}" ${editable ? '' : 'disabled'} aria-label="Completion date for ${escapeHTML(title)}"></label>
      ${invalidDate ? '<span class="invalid-date-note">Date format not recognized</span>' : ''}
      <span class="section-done-mark" aria-label="${completionDate ? 'Completed' : 'Not completed'}">${completionDate ? '✅' : '◯'}</span>
    </article>`;
  }).join('');

  $('courseDetail').innerHTML = `
    <div class="course-detail-heading"><div><p class="eyebrow">COURSE DEEP DIVE</p><h2 id="courseDetailHeading">${courseEmoji(course.title)} ${escapeHTML(course.title)}</h2><p class="muted">${stats.totalSections} chapters · ${stats.totalLectures} lectures · ${formatHours(stats.totalMinutes)} total video</p></div><div class="course-detail-actions"><span class="course-edit-state">${editable ? (course.dirty ? 'Unsaved edits' : 'Local CSV connected') : 'Read only · connect checkout to edit'}</span><button class="button primary" type="button" data-save-course="${escapeHTML(course.fileName)}" ${editable && course.dirty ? '' : 'disabled'}>${saveLabel}</button></div></div>
    <div class="course-detail-metrics">
      <article class="course-detail-progress panel"><div class="course-detail-donut-wrap">${renderStatusDonut(course, stats)}</div><div><p class="eyebrow">EFFORT COMPLETED</p><strong class="course-detail-big-number">${stats.percent}%</strong><p>${formatHours(stats.completedMinutes)} complete · ${formatHours(stats.totalMinutes - stats.completedMinutes)} to go</p><span class="course-detail-note">${stats.allDurationsKnown ? 'Long chapters count more toward progress.' : 'Duration is missing; progress is chapter-weighted.'}</span></div></article>
      <article class="course-timeline-panel panel"><div class="panel-heading"><div><h3>📈 Completion over time</h3><p class="muted">Completed video hours accumulated by completion date.</p></div></div>${renderCompletionTimeline(course)}</article>
    </div>
    <section class="course-sections"><div class="course-sections-heading"><div><h3>🎯 Chapters</h3><p class="muted">Update status and completion date, then save this course CSV.</p></div><span>${stats.completedSections}/${stats.totalSections} complete</span></div>
    <div class="course-section-list">${sections}</div></section>`;
}

function renderTracker() {
  renderSummary();
  renderCourseOverview();
  renderCourseDetail();
}

function hasUnsavedCourseChanges() {
  return trackerCourses.some(course => course.dirty);
}

async function loadPublishedCourses() {
  const response = await fetch('courses/index.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Could not load courses/index.json. Open the tracker through a local web server or HTTPS.');
  const manifest = await response.json();
  if (!Array.isArray(manifest.courses) || !manifest.courses.length) throw new Error('courses/index.json must contain a non-empty courses array.');
  const names = [...new Set(manifest.courses.filter(name => typeof name === 'string' && /^[^\\/]+\.csv$/i.test(name)))];
  if (!names.length) throw new Error('courses/index.json does not list any valid CSV filenames.');
  const loaded = await Promise.all(names.map(async fileName => {
    const csvResponse = await fetch('courses/' + encodeURIComponent(fileName), { cache: 'no-cache' });
    if (!csvResponse.ok) throw new Error('Could not load courses/' + fileName + ' (HTTP ' + csvResponse.status + '). Verify the CSV is committed and published and its filename matches courses/index.json.');
    return parseCourseCsv(await csvResponse.text(), fileName);
  }));
  trackerCourses = loaded.sort((a, b) => a.title.localeCompare(b.title));
  $('trackerSaveState').textContent = 'Published course data · read only';
  renderTracker();
}

async function connectTrackerCheckout(root) {
  if (!root) return;
  if (hasUnsavedCourseChanges() && !window.confirm('Discard unsaved course changes before connecting a checkout?')) return;
  try {
    const permission = await root.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Read/write access to the selected checkout was not granted.');
    const courseDirectory = await root.getDirectoryHandle('courses');
    if (typeof courseDirectory.values !== 'function') throw new Error('This browser cannot enumerate the courses folder. Update Chrome or Edge and try again.');
    const files = [];
    for await (const entry of courseDirectory.values()) {
      if (entry.kind === 'file' && /\.csv$/i.test(entry.name)) files.push(entry);
    }
    if (!files.length) throw new Error('No CSV course files were found in the selected checkout’s courses folder.');
    const loaded = await Promise.all(files.map(async fileHandle => {
      const file = await fileHandle.getFile();
      return parseCourseCsv(await file.text(), fileHandle.name, fileHandle);
    }));
    checkoutHandle = root;
    trackerCourses = loaded.sort((a, b) => a.title.localeCompare(b.title));
    if (selectedCourseFile && !trackerCourses.some(course => course.fileName === selectedCourseFile)) selectedCourseFile = trackerCourses[0].fileName;
    $('trackerSaveState').textContent = 'Local checkout connected';
    $('trackerSaveState').classList.remove('is-dirty');
    setTrackerNotice('Connected to your checkout. Changes are written directly to the selected course CSV; review and commit the changed files.', 'success');
    renderTracker();
  } catch (error) {
    if (error.name !== 'AbortError') setTrackerNotice('Could not connect to the local checkout: ' + error.message, 'error');
  }
}

document.addEventListener('local-checkout-selected', event => {
  connectTrackerCheckout(event.detail.handle);
});

function handleSectionChange(event) {
  const control = event.target.closest('[data-status], [data-completion]');
  if (!control) return;
  const row = control.closest('[data-section-index]');
  const course = trackerCourses.find(item => item.fileName === selectedCourseFile);
  if (!row || !course || !checkoutHandle) return;
  const section = course.sections[Number(row.dataset.sectionIndex)];
  if (!section) return;
  if (control.matches('[data-status]')) {
    const status = control.value;
    setCell(section, course, 'Status', status);
    if (status === 'Completed' && !cell(section, course, 'Completion Date').trim()) setCell(section, course, 'Completion Date', trackerToday);
    if (status !== 'Completed') setCell(section, course, 'Completion Date', '');
  } else {
    const date = control.value;
    setCell(section, course, 'Completion Date', date);
    if (date) setCell(section, course, 'Status', 'Completed');
  }
  course.dirty = true;
  renderTracker();
}

async function saveCourseCsv(fileName) {
  const course = trackerCourses.find(item => item.fileName === fileName);
  if (!course || !checkoutHandle || !course.fileHandle) return;
  try {
    let permission = await checkoutHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await checkoutHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Write access to the selected checkout is no longer available.');
    const latestText = await (await course.fileHandle.getFile()).text();
    if (latestText !== course.sourceText) throw new Error('This CSV changed outside the tracker after it was loaded. Reconnect the checkout before saving, to avoid overwriting newer edits.');
    const updatedText = serializeCourseCsv(course);
    const writable = await course.fileHandle.createWritable();
    await writable.write(updatedText);
    await writable.close();
    course.sourceText = updatedText;
    course.dirty = false;
    $('trackerSaveState').textContent = 'Saved ' + course.fileName + ' · ready to commit';
    $('trackerSaveState').classList.remove('is-dirty');
    setTrackerNotice('Saved changes to courses/' + course.fileName + '. Review and commit this CSV to publish your progress.', 'success');
    renderTracker();
  } catch (error) {
    setTrackerNotice('Could not save ' + course.fileName + ': ' + error.message, 'error');
  }
}

function attachTrackerEvents() {
  $('courseOverview').addEventListener('click', event => {
    const button = event.target.closest('[data-course-file]');
    if (!button) return;
    if (button.dataset.courseFile !== selectedCourseFile) {
      const selectedCourse = trackerCourses.find(course => course.fileName === selectedCourseFile);
      if (selectedCourse?.dirty && !window.confirm('Discard unsaved changes to ' + selectedCourse.fileName + '?')) return;
    }
    selectedCourseFile = button.dataset.courseFile;
    renderTracker();
  });
  $('courseDetail').addEventListener('change', handleSectionChange);
  $('courseDetail').addEventListener('click', event => {
    const button = event.target.closest('[data-save-course]');
    if (button) saveCourseCsv(button.dataset.saveCourse);
  });
  window.addEventListener('beforeunload', event => {
    if (hasUnsavedCourseChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

async function initTracker() {
  attachTrackerEvents();
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.dataset.trackerPage = 'true';
  try {
    await loadPublishedCourses();
  } catch (error) {
    $('trackerSaveState').textContent = 'Course data unavailable';
    $('courseOverview').innerHTML = '<div class="tracker-load-error"><strong>Could not load course data.</strong><p>' + escapeHTML(error.message) + '</p><p>If you opened this page directly as a file, use localhost or HTTPS instead.</p></div>';
    setTrackerNotice(error.message, 'error');
  }
}

initTracker();
