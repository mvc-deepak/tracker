'use strict';
const subjectId = getSubjectIdFromPath();
let subject = null;
const siteRoot = document.body.dataset.root || '../../';
const questionPageHref = () => siteRoot + 'subjects/' + subjectId + '/' + (subject?.interviewPage || subjectId + '_interview.html');
const BANK_STORAGE_KEY = 'interviewPrep.bank.v1';
let items = [];
let renderQuestions = () => {};
const requestedQuestionId = new URLSearchParams(window.location.search).get('id');
const subjectReady = subjectsReady.then(() => { subject = SUBJECTS.find(entry => entry.id === subjectId); return subject; });

function shareIdFor(item) {
  return keyFor(subject.id, item.question).split(':').pop();
}

function loadBank() {
  try {
    const allBanks = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY) || '{}');
    return Array.isArray(allBanks[subject.id]) ? allBanks[subject.id] : null;
  } catch {
    return null;
  }
}

function saveBank() {
  try {
    const allBanks = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY) || '{}');
    allBanks[subject.id] = items.map(({ question, answer, concept, language, csvStatus, importance, key, status }) => ({ question, answer, concept, language, csvStatus, importance, key, status }));
    localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(allBanks));
    return true;
  } catch {
    showNotice('Browser storage is unavailable or full. Download the CSV to keep your changes.', 'error');
    return false;
  }
}

function showNotice(message, kind = 'info') {
  const notice = $('loadNotice');
  notice.hidden = false;
  notice.className = `notice ${kind}`;
  notice.textContent = message;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) throw new Error('Clipboard access was denied.');
  }
}

function questionLink(item) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('id', shareIdFor(item));
  return url.href;
}

function answerAsPlainText(answer) {
  return answer
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

function shareActionsHTML(item, index) {
  const title = escapeHTML(item.question);
  const key = escapeHTML(item.key);
  const id = `share-menu-${index}`;
  return `<div class="question-sharebar"><div class="question-share-actions"><button type="button" class="button copy-question-button" data-copy-question="${key}">▢ Copy question</button><button type="button" class="button share-options-button" aria-expanded="false" aria-controls="${id}" data-share-toggle="${id}">♧ Share options</button><div class="share-menu" id="${id}" hidden role="group" aria-label="Share ${title}"><button type="button" class="share-menu-item" data-share-facebook="${key}">Share on Facebook</button><button type="button" class="share-menu-item" data-copy-link="${key}">Copy question link</button><button type="button" class="share-menu-item" data-copy-text="${key}">Copy question and answer</button></div></div></div>`;
}

function makeEditor() {
  const dialog = document.createElement('dialog');
  dialog.className = 'question-editor';
  dialog.id = 'questionEditor';
  dialog.setAttribute('aria-labelledby', 'editorTitle');
  dialog.innerHTML = `
    <form id="questionForm" method="dialog">
      <div class="editor-heading"><div><p class="eyebrow">QUESTION BANK</p><h2 id="editorTitle">Add question</h2></div><button class="icon-button" type="button" data-close aria-label="Close editor">×</button></div>
      <input type="hidden" name="key">
      <label>Question <textarea name="question" required rows="2" maxlength="2000"></textarea></label>
      <label>Answer <textarea name="answer" required rows="10" maxlength="30000" aria-describedby="answerHelp"></textarea></label>
      <p id="answerHelp" class="editor-help">Supports paragraphs, bullet lists, fenced code blocks, Markdown images <code>![alt](images/file.png)</code>, and YouTube URLs or links. Image files should be committed in your site folder.</p>
      <div class="editor-fields">
        <label>CoreConcept <input name="concept" required maxlength="120"></label>
        <label>LanguageTag <input name="language" required maxlength="80"></label>
        <label>Status <select name="status"><option>Not Started</option><option>Learning</option><option>Revised</option></select></label>
        <label>Importance <select name="importance"><option value="5">5 · Must prepare</option><option value="4">4 · Very important</option><option value="3">3 · Important</option><option value="2">2 · Below average</option><option value="1">1 · Low</option></select></label>
      </div>
      <div class="editor-actions"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">Save question</button></div>
    </form>`;
  document.body.append(dialog);
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const key = String(form.get('key') || '');
    const previous = items.find(item => item.key === key);
    const question = String(form.get('question')).trim();
    const duplicate = items.find(item => item.question.toLocaleLowerCase() === question.toLocaleLowerCase() && item.key !== key);
    if (duplicate) {
      showNotice('A question with the same text already exists in this subject.', 'error');
      return;
    }
    const record = {
      question,
      answer: String(form.get('answer')).trim(),
      concept: String(form.get('concept')).trim(),
      language: String(form.get('language')).trim(),
      status: String(form.get('status')),
      csvStatus: String(form.get('status')),
      importance: Number(form.get('importance')),
      key: previous ? previous.key : `${subject.id}:local-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
    };
    if (previous) items = items.map(item => item.key === key ? record : item);
    else items.push(record);
    saveBank();
    saveQuestionStatus(record);
    dialog.close();
    showNotice(previous ? 'Question updated in this browser. Download the CSV to commit the change.' : 'Question added in this browser. Download the CSV to commit the change.', 'success');
    renderQuestions();
  });
  return dialog;
}

function saveQuestionStatus(item) {
  const saved = getSaved();
  saved[item.key] = item.status;
  saveSaved(saved);
}

function openEditor(item = null) {
  const dialog = $('questionEditor');
  const form = $('questionForm');
  form.reset();
  form.elements.key.value = item ? item.key : '';
  form.elements.question.value = item ? item.question : '';
  form.elements.answer.value = item ? item.answer : '';
  form.elements.concept.value = item ? item.concept : '';
  form.elements.language.value = item ? item.language : subject.label;
  form.elements.status.value = item ? item.status : 'Not Started';
  form.elements.importance.value = item ? String(item.importance) : '3';
  $('editorTitle').textContent = item ? 'Edit question' : 'Add question';
  dialog.showModal();
  form.elements.question.focus();
}

function exportCSV() {
  const columns = ['Question', 'Answer', 'CoreConcept', 'LanguageTag', 'Status', 'Importance'];
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [columns.join(','), ...items.map(item => [item.question, item.answer, item.concept, item.language, item.status || item.csvStatus, item.importance].map(quote).join(','))];
  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = subject.file;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNotice(`Downloaded ${subject.file}. Replace subjects/${subject.id}/${subject.file} in your checkout and commit it to publish your question bank.`, 'success');
}

function resetToCSV() {
  if (!window.confirm('Discard browser-local question edits for this subject and reload its CSV? Download the CSV first if you need to keep those edits.')) return;
  try {
    const allBanks = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY) || '{}');
    delete allBanks[subject.id];
    if (Object.keys(allBanks).length) localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(allBanks));
    else localStorage.removeItem(BANK_STORAGE_KEY);
    window.location.reload();
  } catch {
    showNotice('Could not reset local question edits. Check browser storage settings.', 'error');
  }
}

function installManagementControls() {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = siteRoot + 'css/question-admin.css';
  document.head.append(stylesheet);
  const toolbar = document.querySelector('.subject-toolbar');
  const actions = document.createElement('div');
  actions.className = 'bank-actions';
  actions.innerHTML = '<button type="button" id="addQuestion" class="button primary">＋ Add question</button><button type="button" id="exportQuestions" class="button">Download CSV</button><button type="button" id="resetQuestionBank" class="button" title="Discard local question edits and reload the source CSV">Reset to CSV</button>';
  toolbar.append(actions);
  $('addQuestion').addEventListener('click', () => openEditor());
  $('exportQuestions').addEventListener('click', exportCSV);
  $('resetQuestionBank').addEventListener('click', resetToCSV);
  makeEditor();
}

subjectReady.then(() => {
  if (!subject) return;
  document.title = 'Interview Prep · ' + subject.label + ' Interview Questions';
  $('subjectTitle').textContent = subject.label + ' Interview Questions';
  $('subjectDescription').textContent = subject.description;
  $('backToTopics').href = siteRoot + 'subjects/' + subject.id + '/' + subject.topicsPage;
  installManagementControls();
  (async () => {
    try {
      const response = await fetch(siteRoot + 'subjects/' + subject.id + '/' + subject.file, { cache: 'no-cache' });
      if (!response.ok) throw Error('Could not load subjects/' + subject.id + '/' + subject.file);
      const csvItems = parseCSV(await response.text()).map(item => ({ ...item, key: keyFor(subject.id, item.question) }));
      items = loadBank() || csvItems;
      const saved = getSaved();
      items = items.map(item => ({ ...item, key: item.key || keyFor(subject.id, item.question), status: STATUSES.includes(saved[item.key || keyFor(subject.id, item.question)]) ? saved[item.key || keyFor(subject.id, item.question)] : (STATUSES.includes(item.status) ? item.status : item.csvStatus) }));
      const render = () => {
        const query = $('search').value.trim().toLocaleLowerCase();
        const status = $('statusFilter').value;
        const importance = $('importanceFilter').value;
        const conceptFilter = new URLSearchParams(window.location.search).get('concept') || '';
        const matchingItems = items.filter(item => (!conceptFilter || item.concept === conceptFilter) && (!status || item.status === status) && (!importance || item.importance === Number(importance)) && (!query || [item.question, item.answer, item.concept, item.language].some(value => value.toLocaleLowerCase().includes(query))));
        const selectedSharedItem = requestedQuestionId ? matchingItems.find(item => shareIdFor(item) === requestedQuestionId) : null;
        const filtered = requestedQuestionId ? (selectedSharedItem ? [selectedSharedItem] : []) : matchingItems;
        $('resultCount').textContent = requestedQuestionId ? (filtered.length ? 'Shared question' : 'Shared question not found') : filtered.length + ' of ' + items.length + ' questions';
        $('subjectStats').innerHTML = '<span class="mini-stat"><strong>' + items.length + '</strong> total</span><span class="mini-stat"><strong>' + items.filter(item => item.status === 'Revised').length + '</strong> revised</span><span class="mini-stat"><strong>' + items.filter(item => item.status === 'Learning').length + '</strong> learning</span>';
        if (!filtered.length) {
          $('questionList').innerHTML = requestedQuestionId ? '<div class="empty"><strong>This shared question could not be found.</strong><p>The question may have been removed or its content changed. Open the subject page to browse all questions.</p><a class="button" href="' + escapeHTML(questionPageHref()) + '">View all ' + escapeHTML(subject.label) + ' questions</a></div>' : '<div class="empty">No questions match. Try clearing the filters or add a question to this subject.</div>';
          return;
        }
        const sharedBanner = requestedQuestionId ? `<div class="shared-question-banner"><span>You are viewing one shared ${escapeHTML(subject.label)} question.</span><a class="button" href="${escapeHTML(questionPageHref())}">View all questions</a></div>` : '';
        $('questionList').innerHTML = sharedBanner + filtered.map(item => {
          const questionNumber = items.indexOf(item) + 1;
          const sharedAnswer = answerHTML(item.answer);
          const shareBar = shareActionsHTML(item, questionNumber - 1);
          return `<details class="question" id="question-${escapeHTML(shareIdFor(item))}"${requestedQuestionId ? ' open' : ''}><summary><span class="question-number">QUESTION ${questionNumber}</span><span class="question-title">${escapeHTML(item.question)}</span><span class="question-meta"><span class="chip">${escapeHTML(item.concept)}</span><span class="chip">${escapeHTML(item.language)}</span><span class="chip">Importance ${item.importance}/5</span><span class="chip status-${escapeHTML(item.status)}">${escapeHTML(item.status)}</span></span></summary><div class="answer">${sharedAnswer}${shareBar}<div class="question-controls"><label>Study status <select data-status-key="${escapeHTML(item.key)}" aria-label="Study status for ${escapeHTML(item.question)}">${STATUSES.map(value => `<option${item.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label><div class="question-actions"><button type="button" class="button" data-edit="${escapeHTML(item.key)}">Edit</button><button type="button" class="button danger-button" data-delete="${escapeHTML(item.key)}">Delete</button></div></div></div></details>`;
        }).join('');
        if (requestedQuestionId) document.title = 'Shared question · ' + filtered[0].question + ' | ' + subject.label;
      };
      renderQuestions = render;
      render();
      $('search').addEventListener('input', render);
      $('statusFilter').addEventListener('change', render);
      $('importanceFilter').addEventListener('change', render);
      $('questionList').addEventListener('change', event => {
        const select = event.target.closest('select[data-status-key]');
        if (!select) return;
        const item = items.find(entry => entry.key === select.dataset.statusKey);
        if (!item) return;
        item.status = select.value;
        const saved = getSaved();
        saved[item.key] = item.status;
        saveSaved(saved);
        saveBank();
        render();
      });
      $('questionList').addEventListener('click', event => {
        const copyQuestionButton = event.target.closest('[data-copy-question]');
        const copyLinkButton = event.target.closest('[data-copy-link]');
        const copyTextButton = event.target.closest('[data-copy-text]');
        const facebookButton = event.target.closest('[data-share-facebook]');
        const shareToggle = event.target.closest('[data-share-toggle]');
        if (shareToggle) {
          const menu = document.getElementById(shareToggle.dataset.shareToggle);
          const opening = menu.hidden;
          document.querySelectorAll('.share-menu').forEach(otherMenu => { otherMenu.hidden = true; });
          document.querySelectorAll('[data-share-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
          menu.hidden = !opening;
          shareToggle.setAttribute('aria-expanded', String(opening));
          return;
        }
        const shareKey = copyQuestionButton?.dataset.copyQuestion || copyLinkButton?.dataset.copyLink || copyTextButton?.dataset.copyText || facebookButton?.dataset.shareFacebook;
        if (shareKey) {
          const item = items.find(entry => entry.key === shareKey);
          if (!item) return;
          if (facebookButton) {
            const facebookUrl = new URL('https://www.facebook.com/sharer/sharer.php');
            facebookUrl.searchParams.set('u', questionLink(item));
            window.open(facebookUrl.href, 'facebook-share', 'width=720,height=620,noopener,noreferrer');
            return;
          }
          const text = copyQuestionButton ? item.question : copyLinkButton ? questionLink(item) : `${item.question}\n\n${answerAsPlainText(item.answer)}`;
          copyText(text).then(() => showNotice(copyQuestionButton ? 'Question copied.' : copyLinkButton ? 'Direct question link copied.' : 'Question and answer copied.', 'success')).catch(error => showNotice(error.message, 'error'));
          return;
        }
        const editButton = event.target.closest('[data-edit]');
        if (editButton) openEditor(items.find(item => item.key === editButton.dataset.edit));
        const deleteButton = event.target.closest('[data-delete]');
        if (deleteButton) {
          const item = items.find(entry => entry.key === deleteButton.dataset.delete);
          if (!item || !window.confirm(`Delete “${item.question}”? Download the updated CSV to keep this deletion in the repository.`)) return;
          items = items.filter(entry => entry.key !== item.key);
          const saved = getSaved();
          delete saved[item.key];
          saveSaved(saved);
          saveBank();
          showNotice('Question deleted in this browser. Download the CSV to commit the change.', 'success');
          render();
        }
      });
      document.addEventListener('click', event => {
        if (event.target.closest('.question-share-actions')) return;
        document.querySelectorAll('.share-menu').forEach(menu => { menu.hidden = true; });
        document.querySelectorAll('[data-share-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll('.share-menu').forEach(menu => { menu.hidden = true; });
        document.querySelectorAll('[data-share-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      });
      $('clearFilters').addEventListener('click', () => { $('search').value = ''; $('statusFilter').value = ''; $('importanceFilter').value = ''; render(); });
    } catch (error) {
      showNotice(error.message + ' Check that this page is opened through GitHub Pages or a local web server, not file://.', 'error');
      $('resultCount').textContent = 'Question bank unavailable';
    }
  })();
}).catch(error => {
  showNotice('Could not load subject metadata: ' + error.message, 'error');
  $('resultCount').textContent = 'Question bank unavailable';
});
