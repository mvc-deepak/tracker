'use strict';
const BANK_STORAGE_KEY = 'interviewPrep.bank.v1';
let revisionImages = [];

async function loadRevisionImages() {
  const results = await Promise.all(SUBJECTS.map(async subject => {
    try {
      const response = await fetch('subjects/' + encodeURIComponent(subject.id) + '/topics/index.json', { cache: 'no-cache' });
      if (!response.ok) return [];
      const manifest = await response.json();
      if (!Array.isArray(manifest.topics)) return [];
      return manifest.topics.flatMap(topic => (Array.isArray(topic.images) ? topic.images : []).map(image => ({
        subjectId: subject.id,
        subjectLabel: subject.label,
        topicId: topic.id,
        topicTitle: topic.title || topic.id,
        file: image.file,
        alt: image.alt || image.file,
        src: ['subjects', subject.id, 'topics', topic.id, ...String(image.file).split('/')].map(encodeURIComponent).join('/')
      })));
    } catch {
      return [];
    }
  }));
  revisionImages = results.flat();
  renderRevisionImages();
}

function renderRevisionImages() {
  const subjectFilter = $('revisionSubjectFilter');
  const topicFilter = $('revisionTopicFilter');
  const grid = $('revisionImageGrid');
  if (!subjectFilter || !topicFilter || !grid) return;

  const selectedSubject = subjectFilter.value;
  const availableImages = revisionImages.filter(image => !selectedSubject || image.subjectId === selectedSubject);
  const availableTopics = new Map();
  availableImages.forEach(image => availableTopics.set(image.subjectId + ':' + image.topicId, image.subjectLabel + ' · ' + image.topicTitle));
  const selectedTopic = topicFilter.value;
  topicFilter.innerHTML = '<option value="">All topics</option>' + [...availableTopics].map(([id, label]) => '<option value="' + escapeHTML(id) + '">' + escapeHTML(label) + '</option>').join('');
  if (availableTopics.has(selectedTopic)) topicFilter.value = selectedTopic;

  const filtered = availableImages.filter(image => !topicFilter.value || image.subjectId + ':' + image.topicId === topicFilter.value);
  $('revisionImageCount').textContent = filtered.length + (filtered.length === 1 ? ' image' : ' images');
  grid.innerHTML = filtered.length ? filtered.map(image => '<button class="revision-image-card" type="button" data-revision-image><img src="' + escapeHTML(image.src) + '" alt="' + escapeHTML(image.alt) + '" loading="lazy" data-zoom tabindex="-1"><span class="revision-image-caption"><strong>' + escapeHTML(image.alt) + '</strong><small>' + escapeHTML(image.subjectLabel) + ' · ' + escapeHTML(image.topicTitle) + '</small></span></button>').join('') : '<p class="muted">No topic images match these filters yet.</p>';
}

function setupQuickRevision() {
  const toggle = $('quickRevisionToggle');
  const panel = $('quickRevisionPanel');
  if (!toggle || !panel) return;
  $('revisionSubjectFilter').innerHTML = '<option value="">All subjects</option>' + SUBJECTS.map(subject => '<option value="' + escapeHTML(subject.id) + '">' + escapeHTML(subject.label) + '</option>').join('');
  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.textContent = opening ? '× Close quick revision' : '▧ Quick image revision';
    if (opening) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('revisionSubjectFilter').addEventListener('change', () => {
    $('revisionTopicFilter').value = '';
    renderRevisionImages();
  });
  $('revisionTopicFilter').addEventListener('change', renderRevisionImages);
  $('revisionImageGrid').addEventListener('click', event => {
    const card = event.target.closest('[data-revision-image]');
    if (!card) return;
    const image = card.querySelector('img[data-zoom]');
    if (image && event.target !== image) image.click();
  });
}

async function loadAll() {
  await subjectsReady;
  setupQuickRevision();
  loadRevisionImages();
  const groups = await Promise.all(SUBJECTS.map(async subject => {
    if (!subject.file) return { subject, items: [], error: null };
    try {
      const response = await fetch('subjects/' + subject.id + '/' + subject.file, { cache: 'no-cache' });
      if (!response.ok) throw Error('Could not load subjects/' + subject.id + '/' + subject.file);
      return { subject, items: parseCSV(await response.text()), error: null };
    } catch (error) {
      return { subject, items: [], error: error.message };
    }
  }));
  const errors = groups.filter(group => group.error);
  if (errors.length) {
    $('loadNotice').hidden = false;
    $('loadNotice').className = 'notice error';
    $('loadNotice').textContent = 'Some CSV files could not be loaded: ' + errors.map(error => error.subject.file + ' (' + error.error + ')').join(' · ');
  }
  let localBanks = {};
  try { localBanks = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY) || '{}'); } catch { /* Use CSV data if browser storage is unavailable. */ }
  groups.forEach(group => {
    const localItems = localBanks[group.subject.id];
    if (Array.isArray(localItems)) group.items = localItems;
  });
  const all = groups.flatMap(group => group.items.map(item => ({ ...item, subject: group.subject.id, key: item.key || keyFor(group.subject.id, item.question) })));
  const saved = getSaved();
  all.forEach(item => { item.status = STATUSES.includes(saved[item.key]) ? saved[item.key] : (STATUSES.includes(item.status) ? item.status : item.csvStatus); });
  const total = all.length;
  const revised = all.filter(item => item.status === 'Revised').length;
  const learning = all.filter(item => item.status === 'Learning').length;
  const notStarted = all.filter(item => item.status === 'Not Started').length;
  const importance = all.reduce((sum, item) => sum + item.importance, 0);
  const weighted = importance ? 100 * all.filter(item => item.status === 'Revised').reduce((sum, item) => sum + item.importance, 0) / importance : 0;
  const metrics = [['📚', 'Question bank', total, 'Across all subjects'], ['✅', 'Revised', revised, 'Ready to revisit'], ['🧠', 'Learning', learning, 'In progress'], ['🎯', 'Weighted progress', Math.round(weighted) + '%', 'By question importance']];
  $('metrics').innerHTML = metrics.map(([icon, label, value, detail]) => '<article class="metric"><span class="metric-icon" aria-hidden="true">' + icon + '</span><span class="metric-label">' + escapeHTML(label) + '</span><strong class="metric-value">' + escapeHTML(value) + '</strong><span class="metric-sub">' + escapeHTML(detail) + '</span></article>').join('');
  $('subjectChart').innerHTML = groups.map(group => {
    const subjectItems = all.filter(item => item.subject === group.subject.id);
    const count = subjectItems.length;
    const done = subjectItems.filter(item => item.status === 'Revised').length;
    const percent = count ? Math.round(100 * done / count) : 0;
    return '<div class="bar-row"><span class="bar-label">' + escapeHTML(group.subject.label) + '</span><div class="bar-track" role="img" aria-label="' + percent + '% revised"><div class="bar-fill" style="width:' + percent + '%"></div></div><span class="bar-value">' + percent + '%</span></div>';
  }).join('') || '<p class="muted">Add questions to your CSV files to see progress.</p>';
  const revisedPercent = total ? 100 * revised / total : 0;
  const learningPercent = total ? 100 * learning / total : 0;
  const statusLabel = revised + ' revised, ' + learning + ' learning, ' + notStarted + ' not started';
  const counts = [['✅', 'Revised', revised], ['🧠', 'Learning', learning], ['⏳', 'Not started', notStarted]];
  $('statusChart').innerHTML = '<div class="status-donut" role="img" aria-label="' + statusLabel + '" style="--revised:' + revisedPercent + '%;--learning:' + learningPercent + '%"><div><strong>' + total + '</strong><span>questions</span></div></div><div class="status-legend">' + counts.map(([icon, status, count]) => '<div class="status-legend-row"><span class="status-legend-label"><span aria-hidden="true">' + icon + '</span>' + status + '</span><strong>' + count + '</strong><span class="status-legend-percent">' + (total ? Math.round(100 * count / total) : 0) + '%</span></div>').join('') + '</div>';
  $('subjectCount').textContent = SUBJECTS.length + (SUBJECTS.length === 1 ? ' subject' : ' subjects');
  const subjectIcons = {'azure':'☁️','csharp':'💻','claude':'🤖','design-patterns':'🧩','dotnet-core':'🟣','github':'🐙','kubernetes':'⚙️','microservices':'🔗','react':'⚛️','sql':'🗃️','system-design':'🏗️','terraform':'🌍'};
  $('subjectCards').innerHTML = SUBJECTS.map(subject => {
    const subjectItems = all.filter(item => item.subject === subject.id);
    const count = subjectItems.length;
    const done = subjectItems.filter(item => item.status === 'Revised').length;
    const percent = count ? Math.round(100 * done / count) : 0;
    const destination = subject.interviewPage ? 'subjects/' + subject.id + '/' + subject.interviewPage : subject.href;
    return '<a class="subject-card" href="' + escapeHTML(destination) + '"><span class="subject-card-icon" aria-hidden="true">' + (subjectIcons[subject.id] || '📘') + '</span><span class="subject-card-content"><strong>' + escapeHTML(subject.label) + '</strong><span>' + count + ' questions · ' + percent + '% revised</span><span class="subject-card-track"><i style="width:' + percent + '%"></i></span></span><span class="subject-card-arrow" aria-hidden="true">↗</span></a>';
  }).join('');
}
loadAll().catch(error => { $('loadNotice').hidden = false; $('loadNotice').className = 'notice error'; $('loadNotice').textContent = error.message; });
