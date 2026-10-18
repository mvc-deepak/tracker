'use strict';
const subjectId = getSubjectIdFromPath();
let subject = null;
const siteRoot = document.body.dataset.root || '../../';
const questionPageHref = () => siteRoot + 'subjects/' + subjectId + '/' + (subject?.interviewPage || subjectId + '_interview.html');
const BANK_STORAGE_KEY = 'interviewPrep.bank.v1';
let items = [];
let renderQuestions = () => {};
let checkoutHandle = null;
let questionCsvHandle = null;
let questionCsvBaseline = '';
let questionCsvDirty = false;
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

function markQuestionCsvDirty() {
  if (!checkoutHandle) return;
  questionCsvDirty = true;
  updateQuestionCsvControls();
}

function updateQuestionCsvControls() {
  const saveButton = $('saveQuestionCsv');
  const state = $('questionCsvState');
  if (!saveButton) return;
  saveButton.disabled = !checkoutHandle || !questionCsvDirty;
  if (state) state.textContent = checkoutHandle
    ? (questionCsvDirty ? 'Unsaved changes' : 'Local CSV connected')
    : '';
  const addButton = $('addQuestion');
  if (addButton) {
    addButton.disabled = !checkoutHandle;
    addButton.title = checkoutHandle ? '' : 'Choose your local checkout before editing questions';
  }
}

function csvEscape(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function serializeQuestionCsv() {
  const columns = ['Question', 'Answer', 'CoreConcept', 'LanguageTag', 'Status', 'Importance'];
  const rows = [columns.join(','), ...items.map(item => [
    item.question, item.answer, item.concept, item.language, item.status || item.csvStatus, item.importance
  ].map(csvEscape).join(','))];
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

async function connectQuestionCheckout(root, restored = false) {
  if (!root) return;
  if (questionCsvDirty && !window.confirm('Discard unsaved question edits before connecting a checkout?')) return;
  try {
    const permission = await root.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Read/write access to the selected checkout was not granted.');
    const subjectsDirectory = await root.getDirectoryHandle('subjects');
    const subjectDirectory = await subjectsDirectory.getDirectoryHandle(subject.id);
    const csvFile = subject.file || subject.csvFile;
    if (!csvFile || !/^[^\\/]+\.csv$/i.test(csvFile)) throw new Error('The subject registry does not contain a valid CSV filename.');
    const fileHandle = await subjectDirectory.getFileHandle(csvFile);
    const file = await fileHandle.getFile();
    const csvText = await file.text();
    const csvItems = parseCSV(csvText).map(item => ({ ...item, key: keyFor(subject.id, item.question) }));
    const browserItems = loadBank();
    const importBrowserItems = Array.isArray(browserItems) && window.confirm('This browser has a saved question bank for this subject. Choose OK to use those browser changes and save them to the selected checkout, or Cancel to load the checkout CSV instead.');
    if (!importBrowserItems) clearSubjectBrowserOverrides(csvItems);

    checkoutHandle = root;
    questionCsvHandle = fileHandle;
    questionCsvBaseline = csvText;
    items = (importBrowserItems ? browserItems : csvItems).map(item => {
      const key = item.key || keyFor(subject.id, item.question);
      return { ...item, key, csvStatus: item.csvStatus || item.status, status: item.status || item.csvStatus };
    });
    questionCsvDirty = importBrowserItems && serializeQuestionCsv() !== csvText;
    renderQuestions();
    updateQuestionCsvControls();
    showNotice(importBrowserItems
      ? 'Connected to your checkout and loaded this browser’s saved questions. Save CSV to write them to disk.'
      : 'Connected to your checkout and loaded its CSV. Changes can be saved directly to subjects/' + subject.id + '/' + csvFile + '; review and commit the CSV.', 'success');
  } catch (error) {
    showNotice('Could not connect to the local checkout' + (restored ? ' restored from the header' : '') + ': ' + error.message, 'error');
  }
}

async function saveQuestionCsv() {
  if (!checkoutHandle || !questionCsvHandle) {
    showNotice('Choose your local checkout before saving directly to CSV.', 'error');
    return;
  }
  try {
    let permission = await checkoutHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await checkoutHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Write access to the selected checkout is no longer available.');
    const latestText = await (await questionCsvHandle.getFile()).text();
    if (latestText !== questionCsvBaseline) throw new Error('The CSV changed outside the page after it was loaded. Reconnect the checkout before saving to avoid overwriting newer changes.');
    const updatedText = serializeQuestionCsv();
    const writable = await questionCsvHandle.createWritable();
    await writable.write(updatedText);
    await writable.close();
    questionCsvBaseline = updatedText;
    questionCsvDirty = false;
    let cacheWarning = '';
    try {
      const allBanks = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY) || '{}');
      delete allBanks[subject.id];
      if (Object.keys(allBanks).length) localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(allBanks));
      else localStorage.removeItem(BANK_STORAGE_KEY);
    } catch (error) {
      cacheWarning = ' The CSV was saved, but older browser-saved questions could not be cleared: ' + error.message;
    }
    const savedStatuses = getSaved();
    for (const item of items) delete savedStatuses[item.key];
    saveSaved(savedStatuses);
    updateQuestionCsvControls();
    showNotice('Saved subjects/' + subject.id + '/' + (subject.file || subject.csvFile) + '. Review and commit this CSV to publish your changes.' + cacheWarning, cacheWarning ? 'error' : 'success');
  } catch (error) {
    showNotice('Could not save the question CSV: ' + error.message, 'error');
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
    if (checkoutHandle) markQuestionCsvDirty();
    else saveBank();
    saveQuestionStatus(record);
    dialog.close();
    showNotice(checkoutHandle
      ? (previous ? 'Question updated. Save CSV to write the change to your checkout.' : 'Question added. Save CSV to write the change to your checkout.')
      : 'Choose your local checkout before editing questions.', 'success');
    renderQuestions();
  });
  return dialog;
}

function saveQuestionStatus(item) {
  const saved = getSaved();
  saved[item.key] = item.status;
  saveSaved(saved);
}

function clearSubjectBrowserOverrides(entries) {
  let allBanks;
  try {
    allBanks = JSON.parse(localStorage.getItem(BANK_STORAGE_KEY) || '{}');
  } catch {
    throw new Error('Browser-saved question data could not be read. Check site storage before connecting the checkout.');
  }
  delete allBanks[subject.id];
  if (Object.keys(allBanks).length) localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(allBanks));
  else localStorage.removeItem(BANK_STORAGE_KEY);
  const savedStatuses = getSaved();
  for (const item of entries) delete savedStatuses[item.key];
  saveSaved(savedStatuses);
}

function openEditor(item = null) {
  if (!checkoutHandle) {
    showNotice('Choose your local checkout before editing questions.', 'info');
    return;
  }
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

function installManagementControls() {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = siteRoot + 'css/question-admin.css?v=question-admin-6';
  document.head.append(stylesheet);
  const toolbar = document.querySelector('.subject-toolbar');
  const actions = document.createElement('div');
  actions.className = 'bank-actions';
  actions.innerHTML = '<button type="button" id="saveQuestionCsv" class="button primary" disabled>Save CSV</button><button type="button" id="addQuestion" class="button" disabled>＋ Add question</button>';
  actions.classList.add('subject-heading-actions');
  const backToTopics = $('backToTopics');
  const csvState = document.createElement('span');
  csvState.id = 'questionCsvState';
  csvState.className = 'question-csv-state';
  csvState.setAttribute('role', 'status');
  document.querySelector('.local-checkout-control')?.append(csvState);
  actions.prepend(backToTopics);
  const summaryRow = document.createElement('div');
  summaryRow.className = 'interview-summary-row';
  const subjectStats = $('subjectStats');
  summaryRow.append(subjectStats, actions);
  document.querySelector('.page-heading').after(summaryRow);
  $('saveQuestionCsv').addEventListener('click', saveQuestionCsv);
  $('addQuestion').addEventListener('click', () => openEditor());
  makeEditor();
  updateQuestionCsvControls();
  const footer = document.querySelector('main footer');
  if (footer) footer.textContent = 'Use the refresh-indexes button in the shared header in Chrome or Edge on localhost/HTTPS to select your checkout, edit questions, and save the CSV directly to disk. Review and commit the CSV to publish updates.';
}

document.addEventListener('local-checkout-selected', event => {
  const { handle, restored } = event.detail;
  subjectReady.then(() => connectQuestionCheckout(handle, restored)).catch(error => {
    showNotice('Could not load subject metadata: ' + error.message, 'error');
  });
});

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
          return `<details class="question" id="question-${escapeHTML(shareIdFor(item))}"${requestedQuestionId ? ' open' : ''}><summary><span class="question-number">QUESTION ${questionNumber}</span><span class="question-title">${escapeHTML(item.question)}</span><span class="question-meta"><span class="chip">${escapeHTML(item.concept)}</span><span class="chip">${escapeHTML(item.language)}</span><span class="chip">Importance ${item.importance}/5</span><span class="chip status-${escapeHTML(item.status)}">${escapeHTML(item.status)}</span></span></summary><div class="answer">${sharedAnswer}${shareBar}<div class="question-controls"><label>Study status <select data-status-key="${escapeHTML(item.key)}" aria-label="Study status for ${escapeHTML(item.question)}" ${checkoutHandle ? '' : 'disabled'}>${STATUSES.map(value => `<option${item.status === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label><div class="question-actions"><button type="button" class="button" data-edit="${escapeHTML(item.key)}" ${checkoutHandle ? '' : 'disabled'}>Edit</button><button type="button" class="button danger-button" data-delete="${escapeHTML(item.key)}" ${checkoutHandle ? '' : 'disabled'}>Delete</button></div></div></div></details>`;
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
        if (!checkoutHandle) {
          showNotice('Choose your local checkout before editing question statuses.', 'info');
          render();
          return;
        }
        item.status = select.value;
        item.csvStatus = select.value;
        const saved = getSaved();
        saved[item.key] = item.status;
        saveSaved(saved);
        markQuestionCsvDirty();
        render();
        showNotice('Status changed. Save CSV to write it to your checkout.', 'success');
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
          if (!checkoutHandle) {
            showNotice('Choose your local checkout before editing questions.', 'info');
            return;
          }
          if (!item || !window.confirm(`Delete “${item.question}”? Save CSV to keep this deletion in your checkout.`)) return;
          items = items.filter(entry => entry.key !== item.key);
          markQuestionCsvDirty();
          const saved = getSaved();
          delete saved[item.key];
          saveSaved(saved);
          showNotice('Question deleted. Save CSV to write the change to your checkout.', 'success');
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
      window.addEventListener('beforeunload', event => {
        if (questionCsvDirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    } catch (error) {
      showNotice(error.message + ' Check that this page is opened through GitHub Pages or a local web server, not file://.', 'error');
      $('resultCount').textContent = 'Question bank unavailable';
    }
  })();
}).catch(error => {
  showNotice('Could not load subject metadata: ' + error.message, 'error');
  $('resultCount').textContent = 'Question bank unavailable';
});
