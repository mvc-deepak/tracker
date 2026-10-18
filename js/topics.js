'use strict';
const topicSubjectId = getSubjectIdFromPath();
const TOPIC_ROOT_URL = (document.body.dataset.root || '../../') + 'subjects/' + topicSubjectId + '/topics/';
const MANIFEST_URL = TOPIC_ROOT_URL + 'index.json';
const topicQuery = new URLSearchParams(window.location.search);
let manifest = { topics: [] };
let activeTopicId = topicQuery.get('topic') || '';
let activeDocFile = topicQuery.get('doc') || '';
let activeImage = null;
let rootHandle = null;
let subjectTopicsHandle = null;
let localAccess = false;
let scanInProgress = false;
let localScanTimer = null;

const topicById = id => manifest.topics.find(topic => topic.id === id);
const currentTopic = () => topicById(activeTopicId);
const setNotice = (message, kind = 'info') => {
  const notice = $('topicNotice');
  notice.hidden = false;
  notice.className = 'notice ' + kind;
  notice.textContent = message;
};
const safeSlug = value => value.trim().toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const resolveAsset = (topic, relativePath) => new URL(TOPIC_ROOT_URL + encodeURIComponent(topic.id) + '/' + relativePath.split('/').map(encodeURIComponent).join('/'), document.baseURI).href;

function escapeTopicHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function renderInlineMarkdown(text, topic, docFile) {
  let output = escapeTopicHTML(text);
  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawPath) => {
    const imagePath = rawPath.trim();
    if (/^(?:https?:|javascript:|data:)/i.test(imagePath)) {
      if (!/^https?:\/\//i.test(imagePath)) return '<span class="media-fallback">Unsupported image path</span>';
      return `<img src="${escapeTopicHTML(imagePath)}" alt="${escapeTopicHTML(alt)}" loading="lazy" data-topic-image tabindex="0" role="button">`;
    }
    const directory = docFile.includes('/') ? docFile.slice(0, docFile.lastIndexOf('/') + 1) : '';
    const resolved = new URL(directory + imagePath, new URL(encodeURIComponent(topic.id) + '/' + docFile.split('/').map(encodeURIComponent).join('/'), new URL(TOPIC_ROOT_URL, document.baseURI))).href;
    return `<img src="${escapeTopicHTML(resolved)}" alt="${escapeTopicHTML(alt)}" loading="lazy" data-topic-image tabindex="0" role="button">`;
  });
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawUrl) => {
    const url = rawUrl.trim();
    if (/^(https?:\/\/|mailto:|#)/i.test(url)) return `<a href="${escapeTopicHTML(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    const docDirectory = docFile.includes('/') ? docFile.slice(0, docFile.lastIndexOf('/') + 1) : '';
    const target = new URL(docDirectory + url, new URL(encodeURIComponent(topic.id) + '/' + docFile.split('/').map(encodeURIComponent).join('/'), new URL(TOPIC_ROOT_URL, document.baseURI))).href;
    return `<a href="${escapeTopicHTML(target)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return output;
}

function markdownToHTML(markdown, topic, docFile) {
  const lines = String(markdown).replace(/\r/g, '').split('\n');
  let html = '';
  let paragraph = [];
  let list = [];
  let code = [];
  let inCode = false;
  const inline = line => renderInlineMarkdown(line, topic, docFile);
  const flushParagraph = () => {
    if (paragraph.length) html += '<p>' + paragraph.map(inline).join('<br>') + '</p>';
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) html += '<ul>' + list.map(item => '<li>' + inline(item.replace(/^\s*[-*+]\s+/, '')) + '</li>').join('') + '</ul>';
    list = [];
  };
  for (const line of lines) {
    if (inCode) {
      if (/^\s*```/.test(line)) {
        html += '<pre><code>' + escapeTopicHTML(code.join('\n')) + '</code></pre>';
        code = [];
        inCode = false;
      } else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushParagraph(); flushList(); inCode = true; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) { flushParagraph(); list.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    flushList();
    paragraph.push(line);
  }
  if (inCode) html += '<pre><code>' + escapeTopicHTML(code.join('\n')) + '</code></pre>';
  flushParagraph();
  flushList();
  return html;
}

async function ensureWritePermission() {
  if (!subjectTopicsHandle) throw new Error('Choose your local checkout folder first.');
  let permission = await subjectTopicsHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') permission = await subjectTopicsHandle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('Write access was not granted.');
}

async function resolveDirectory(relativePath, create = false) {
  const segments = relativePath.split('/').filter(Boolean);
  let directory = subjectTopicsHandle;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create });
  return directory;
}

async function readLocalText(relativePath) {
  const parts = relativePath.split('/');
  const fileName = parts.pop();
  const directory = parts.length ? await resolveDirectory(parts.join('/')) : subjectTopicsHandle;
  const handle = await directory.getFileHandle(fileName);
  return (await handle.getFile()).text();
}

async function localFileExists(relativePath) {
  const parts = relativePath.split('/');
  const fileName = parts.pop();
  const directory = parts.length ? await resolveDirectory(parts.join('/')) : subjectTopicsHandle;
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error.name === 'NotFoundError') return false;
    throw error;
  }
}

async function writeLocalText(relativePath, content) {
  await ensureWritePermission();
  const parts = relativePath.split('/');
  const fileName = parts.pop();
  const directory = parts.length ? await resolveDirectory(parts.join('/'), true) : subjectTopicsHandle;
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function removeLocalEntry(relativePath, recursive = false) {
  await ensureWritePermission();
  const parts = relativePath.split('/');
  const name = parts.pop();
  const directory = parts.length ? await resolveDirectory(parts.join('/')) : subjectTopicsHandle;
  await directory.removeEntry(name, { recursive });
}

async function saveManifest() {
  manifest.topics.sort((a, b) => a.title.localeCompare(b.title));
  const portableManifest = {
    topics: manifest.topics.map(topic => ({
      id: topic.id,
      title: topic.title,
      description: topic.description,
      pages: topic.pages.map(({ file, title }) => ({ file, title })),
      images: topic.images.map(({ file, alt }) => ({ file, alt }))
    }))
  };
  await writeLocalText('index.json', JSON.stringify(portableManifest, null, 2) + '\n');
}

function updateTopicUrl() {
  const url = new URL(window.location.href);
  if (activeTopicId) url.searchParams.set('topic', activeTopicId);
  else url.searchParams.delete('topic');
  if (activeDocFile) url.searchParams.set('doc', activeDocFile);
  else url.searchParams.delete('doc');
  url.searchParams.delete('image');
  history.replaceState(null, '', url);
}

function renderTopicNav() {
  $('topicCount').textContent = manifest.topics.length + (manifest.topics.length === 1 ? ' topic' : ' topics');
  $('topicNav').innerHTML = manifest.topics.map(topic => `<a href="?topic=${encodeURIComponent(topic.id)}" data-topic-id="${escapeTopicHTML(topic.id)}" class="${topic.id === activeTopicId ? 'active' : ''}"${topic.id === activeTopicId ? ' aria-current="page"' : ''}><span>${escapeTopicHTML(topic.title)}</span><small>${topic.pages.length}</small></a>`).join('') || '<p class="muted">No topics have been added yet.</p>';
}

function renderTopic() {
  renderTopicNav();
  const topic = currentTopic();
  if (!topic) {
    $('topicMain').innerHTML = '<div class="panel topic-empty"><h2>No topic selected</h2><p>Choose a topic from the sidebar.</p></div>';
    return;
  }
  const selectedDoc = topic.pages.find(page => page.file === activeDocFile) || topic.pages[0] || null;
  activeDocFile = selectedDoc?.file || '';
  const pages = topic.pages.map(page => `<button type="button" class="topic-page-link${selectedDoc && page.file === selectedDoc.file ? ' active' : ''}" data-doc-file="${escapeTopicHTML(page.file)}"><span class="topic-page-icon">MD</span><span>${escapeTopicHTML(page.title)}</span></button>`).join('');
  const images = topic.images.map((image, index) => `<button type="button" class="gallery-tile" data-image-index="${index}" aria-label="Open image ${escapeTopicHTML(image.alt || image.file)}"><img src="${escapeTopicHTML(resolveAsset(topic, image.file))}" alt="${escapeTopicHTML(image.alt || image.file)}" loading="lazy"><span>${escapeTopicHTML(image.alt || image.file)}</span></button>`).join('');
  const mdHTML = selectedDoc ? `<article class="topic-card"><div class="markdown-heading-actions"><h3>${escapeTopicHTML(selectedDoc.title)}</h3></div><div class="markdown-content">${selectedDoc.content === undefined ? '<p class="muted">Loading notes…</p>' : markdownToHTML(selectedDoc.content, topic, selectedDoc.file)}</div></article>` : '<div class="topic-card topic-empty"><h3>No Markdown pages in this topic</h3></div>';
  $('topicMain').innerHTML = `<div class="topic-content"><header class="topic-card topic-header"><div><p class="eyebrow">TOPIC</p><h2>${escapeTopicHTML(topic.title)}</h2><p>${escapeTopicHTML(topic.description || '')}</p></div></header><section class="topic-card"><div class="topic-section-heading"><div><h3>Notes and Markdown pages</h3><p class="muted">Open a page to read its notes.</p></div></div><div class="topic-pages">${pages || '<p class="topic-empty">No Markdown pages have been added yet.</p>'}</div></section>${mdHTML}<section class="topic-card"><div class="topic-section-heading"><div><h3>Topic images</h3><p class="muted">Swipe or drag through images. Select one to view it full size.</p></div><div class="topic-section-actions"><button class="button" type="button" data-gallery-toggle aria-expanded="false">View all (${topic.images.length})</button></div></div>${topic.images.length ? `<div class="gallery-controls"><button type="button" class="button" data-gallery-prev aria-label="Previous images">←</button><button type="button" class="button" data-gallery-next aria-label="Next images">→</button><span class="muted">Swipe to browse</span></div><div class="gallery-track" id="imageCarousel">${images}</div><div class="gallery-grid" id="imageGrid" hidden>${images}</div>` : '<p class="topic-empty">No supporting images for this topic yet.</p>'}</section></div>`;
  if (selectedDoc && selectedDoc.content === undefined) loadMarkdown(topic, selectedDoc);
}

async function loadMarkdown(topic, page) {
  try {
    const content = localAccess ? await readLocalText(topic.id + '/' + page.file) : await (async () => {
      const response = await fetch(resolveAsset(topic, page.file));
      if (!response.ok) throw new Error('Unable to load ' + page.file);
      return response.text();
    })();
    if (!currentTopic() || currentTopic().id !== topic.id || activeDocFile !== page.file) return;
    page.content = content;
    renderTopic();
  } catch (error) {
    page.content = `Unable to load **${page.file}**. ${error.message}`;
    renderTopic();
  }
}

function openTopicDialog(topic = null) {
  const form = $('topicForm');
  form.reset();
  form.elements.originalId.value = topic?.id || '';
  form.elements.title.value = topic?.title || '';
  form.elements.id.value = topic?.id || '';
  form.elements.id.disabled = Boolean(topic);
  form.elements.description.value = topic?.description || '';
  $('topicDialogTitle').textContent = topic ? 'Edit topic' : 'Add topic';
  $('topicDialog').showModal();
  form.elements.title.focus();
}

function openMarkdownDialog(page = null) {
  const form = $('markdownForm');
  form.reset();
  form.elements.originalFile.value = page?.file || '';
  form.elements.title.value = page?.title || '';
  form.elements.file.value = page?.file || '';
  form.elements.file.disabled = Boolean(page);
  form.elements.content.value = page?.content || '';
  $('markdownDialogTitle').textContent = page ? 'Edit Markdown page' : 'Add Markdown page';
  $('markdownDialog').showModal();
  form.elements.title.focus();
}

async function saveTopicFromForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const originalId = String(form.get('originalId') || '');
  const id = originalId || safeSlug(String(form.get('id')));
  const title = String(form.get('title')).trim();
  if (!id || !title) return;
  if (!originalId && manifest.topics.some(topic => topic.id === id)) {
    setNotice('A topic with that folder name already exists.', 'error');
    return;
  }
  try {
    await ensureWritePermission();
    if (originalId) {
      const topic = topicById(originalId);
      topic.title = title;
      topic.description = String(form.get('description') || '').trim();
    } else {
      const topic = { id, title, description: String(form.get('description') || '').trim(), pages: [{ file: 'overview.md', title: 'Overview' }], images: [] };
      try {
        await subjectTopicsHandle.getDirectoryHandle(id);
        setNotice('That topic folder already exists in the checkout but is not listed in the manifest. Rename it or add it to index.json first.', 'error');
        return;
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
      manifest.topics.push(topic);
      await resolveDirectory(id, true);
      await writeLocalText(id + '/overview.md', `# ${title}\n\nAdd your notes for this topic here.\n`);
      activeTopicId = id;
      activeDocFile = 'overview.md';
    }
    await saveManifest();
    $('topicDialog').close();
    updateTopicUrl();
    setNotice(originalId ? 'Topic updated in your local checkout.' : 'Topic folder and starter Markdown page created in your local checkout.', 'success');
    renderTopic();
  } catch (error) { setNotice(error.message, 'error'); }
}

async function saveMarkdownFromForm(event) {
  event.preventDefault();
  const topic = currentTopic();
  if (!topic) return;
  const form = new FormData(event.currentTarget);
  const originalFile = String(form.get('originalFile') || '');
  const file = originalFile || String(form.get('file')).trim().toLocaleLowerCase();
  const title = String(form.get('title')).trim();
  const content = String(form.get('content'));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file)) {
    setNotice('Markdown file names must be lowercase, with hyphens, and end in .md.', 'error');
    return;
  }
  if (!originalFile && topic.pages.some(page => page.file.toLocaleLowerCase() === file)) {
    setNotice('A Markdown page with that filename already exists in this topic.', 'error');
    return;
  }
  try {
    if (!originalFile && await localFileExists(topic.id + '/' + file)) {
      setNotice('A file with that name already exists in the local topic folder.', 'error');
      return;
    }
    await writeLocalText(topic.id + '/' + file, content);
    const page = { file, title: title || file.replace(/\.md$/, ''), content };
    if (originalFile) topic.pages = topic.pages.map(item => item.file === originalFile ? page : item);
    else topic.pages.push(page);
    await saveManifest();
    activeDocFile = file;
    $('markdownDialog').close();
    updateTopicUrl();
    setNotice('Markdown page saved in your local checkout.', 'success');
    renderTopic();
  } catch (error) { setNotice(error.message, 'error'); }
}

async function deleteTopic() {
  const topic = currentTopic();
  if (!topic || !window.confirm(`Delete the entire “${topic.title}” topic folder and its Markdown and images from your local checkout?`)) return;
  try {
    await removeLocalEntry(topic.id, true);
    manifest.topics = manifest.topics.filter(item => item.id !== topic.id);
    activeTopicId = manifest.topics[0]?.id || '';
    activeDocFile = '';
    await saveManifest();
    updateTopicUrl();
    setNotice('Topic folder deleted from your local checkout.', 'success');
    renderTopic();
  } catch (error) { setNotice(error.message, 'error'); }
}

async function deleteMarkdown(file) {
  const topic = currentTopic();
  const page = topic?.pages.find(item => item.file === file);
  if (!page || !window.confirm(`Delete the Markdown page “${page.title}” from this topic?`)) return;
  try {
    await removeLocalEntry(topic.id + '/' + file);
    topic.pages = topic.pages.filter(item => item.file !== file);
    activeDocFile = topic.pages[0]?.file || '';
    await saveManifest();
    updateTopicUrl();
    setNotice('Markdown page deleted from your local checkout.', 'success');
    renderTopic();
  } catch (error) { setNotice(error.message, 'error'); }
}

async function addImages(fileList) {
  const topic = currentTopic();
  if (!topic) return;
  const files = [...fileList].filter(file => file.type.startsWith('image/'));
  if (!files.length) { setNotice('Choose one or more supported image files.', 'error'); return; }
  try {
    await ensureWritePermission();
    await resolveDirectory(topic.id + '/images', true);
    for (const file of files) {
      let name = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      if (!name || name.startsWith('.')) name = 'image-' + Date.now() + '.png';
      let base = name;
      let suffix = 1;
      while (topic.images.some(image => image.file.toLocaleLowerCase() === 'images/' + name.toLocaleLowerCase()) || await localFileExists(topic.id + '/images/' + name)) {
        const dot = base.lastIndexOf('.');
        name = (dot > 0 ? base.slice(0, dot) : base) + '-' + suffix++ + (dot > 0 ? base.slice(dot) : '');
      }
      const fileHandle = await (await resolveDirectory(topic.id + '/images')).getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      topic.images.push({ file: 'images/' + name, alt: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') });
    }
    await saveManifest();
    setNotice(files.length + ' image' + (files.length === 1 ? '' : 's') + ' copied into your local checkout.', 'success');
    renderTopic();
  } catch (error) { setNotice(error.message, 'error'); }
  $('imageUpload').value = '';
}

function openImage(image) {
  activeImage = image;
  const topic = currentTopic();
  $('fullImage').src = /^(https?:|blob:|data:)/i.test(image.file) ? image.file : resolveAsset(topic, image.file);
  $('fullImage').alt = image.alt || image.file;
  $('imageDialog').showModal();
  $('closeImage').focus();
}

async function deleteCurrentImage() {
  if (!activeImage || !localAccess) return;
  const topic = currentTopic();
  if (!window.confirm(`Delete image “${activeImage.alt || activeImage.file}” from your local checkout?`)) return;
  try {
    await removeLocalEntry(topic.id + '/' + activeImage.file);
    topic.images = topic.images.filter(image => image.file !== activeImage.file);
    activeImage = null;
    await saveManifest();
    $('imageDialog').close();
    setNotice('Image deleted from your local checkout.', 'success');
    renderTopic();
  } catch (error) { setNotice(error.message, 'error'); }
}

function shareCurrentImage() {
  if (!activeImage) return;
  const topic = currentTopic();
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  shareUrl.searchParams.set('topic', topic.id);
  shareUrl.searchParams.set('image', activeImage.file);
  const facebookUrl = new URL('https://www.facebook.com/sharer/sharer.php');
  facebookUrl.searchParams.set('u', shareUrl.href);
  window.open(facebookUrl.href, 'facebook-image-share', 'width=720,height=620,noopener,noreferrer');
}

async function connectCheckout() {
  if (!window.showDirectoryPicker) {
    setNotice('This browser does not provide local folder access. Try the current version of Chrome or Edge, then access the site through localhost or HTTPS.', 'error');
    return;
  }
  try {
    rootHandle = await window.showDirectoryPicker({ id: 'interview-prep-checkout', mode: 'readwrite', startIn: 'documents' });
    const subjectsHandle = await rootHandle.getDirectoryHandle('subjects');
    const subjectHandle = await subjectsHandle.getDirectoryHandle(topicSubjectId);
    subjectTopicsHandle = await subjectHandle.getDirectoryHandle('topics');
    let permission = await subjectTopicsHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await subjectTopicsHandle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Read/write permission is required to manage local topic files.');
    localAccess = true;
    try {
      manifest = JSON.parse(await readLocalText('index.json'));
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      manifest = { topics: [] };
    }
    normalizeManifest();
    await scanLocalTopics(true, false);
    if (!topicById(activeTopicId)) activeTopicId = manifest.topics[0]?.id || '';
    activeDocFile = topicQuery.get('doc') || '';
    updateTopicUrl();
    setNotice('Connected. Topic folders and their Markdown/images are discovered from disk. New or removed files are rescanned automatically while this page is open.', 'success');
    if (localScanTimer) window.clearInterval(localScanTimer);
    localScanTimer = window.setInterval(() => scanLocalTopics(false, true), 10000);
    renderTopic();
  } catch (error) {
    if (error.name === 'AbortError') return;
    setNotice('Could not connect to the selected checkout: ' + error.message + `. Choose the project root that contains subjects/${topicSubjectId}/topics/.`, 'error');
  }
}

function titleFromFolder(folderName) {
  return folderName.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toLocaleUpperCase());
}

function titleFromMarkdown(fileName, content) {
  const heading = content.match(/^#\s+(.+)\s*$/m);
  return heading ? heading[1].trim() : fileName.split('/').pop().replace(/\.md$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toLocaleUpperCase());
}

function isImageFile(name) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp|bmp)$/i.test(name);
}

async function collectFiles(directory, prefix = '') {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    if (name.startsWith('.')) continue;
    const relativePath = prefix ? prefix + '/' + name : name;
    if (handle.kind === 'directory') files.push(...await collectFiles(handle, relativePath));
    else files.push({ name, path: relativePath, handle });
  }
  return files;
}

async function scanLocalTopics(persistManifest = true, quiet = false) {
  if (!localAccess || !subjectTopicsHandle || scanInProgress) return;
  scanInProgress = true;
  try {
    const priorTopics = manifest.topics;
    const discovered = [];
    for await (const [folderName, handle] of subjectTopicsHandle.entries()) {
      if (handle.kind !== 'directory' || folderName.startsWith('.')) continue;
      const oldTopic = priorTopics.find(topic => topic.id === folderName);
      const files = await collectFiles(handle);
      const oldPages = new Map((oldTopic?.pages || []).map(page => [page.file, page]));
      const oldImages = new Map((oldTopic?.images || []).map(image => [image.file, image]));
      const pages = [];
      const images = [];
      for (const file of files) {
        if (/\.md$/i.test(file.path)) {
          const content = await (await file.handle.getFile()).text();
          const previous = oldPages.get(file.path);
          pages.push({ file: file.path, title: previous?.title || titleFromMarkdown(file.path, content), content });
        } else if (isImageFile(file.path)) {
          const previous = oldImages.get(file.path);
          images.push({ file: file.path, alt: previous?.alt || file.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') });
        }
      }
      pages.sort((a, b) => a.file.localeCompare(b.file));
      images.sort((a, b) => a.file.localeCompare(b.file));
      discovered.push({ id: folderName, title: oldTopic?.title || titleFromFolder(folderName), description: oldTopic?.description || '', pages, images });
    }
    discovered.sort((a, b) => a.title.localeCompare(b.title));
    const previousSnapshot = JSON.stringify(priorTopics.map(({ id, title, description, pages, images }) => ({ id, title, description, pages, images })));
    const nextSnapshot = JSON.stringify(discovered.map(({ id, title, description, pages, images }) => ({ id, title, description, pages, images })));
    if (previousSnapshot === nextSnapshot) return;
    manifest.topics = discovered;
    if (!topicById(activeTopicId)) {
      activeTopicId = discovered[0]?.id || '';
      activeDocFile = '';
    } else if (!currentTopic().pages.some(page => page.file === activeDocFile)) {
      activeDocFile = currentTopic().pages[0]?.file || '';
    }
    if (persistManifest) {
      try {
        await saveManifest();
      } catch (error) {
        if (!quiet) setNotice(`Folder scan updated the page, but could not save subjects/${topicSubjectId}/topics/index.json: ` + error.message, 'error');
      }
    }
    updateTopicUrl();
    renderTopic();
    if (!quiet) setNotice(`Folder scan complete: found ${discovered.length} topics, ${discovered.reduce((sum, topic) => sum + topic.pages.length, 0)} Markdown pages, and ${discovered.reduce((sum, topic) => sum + topic.images.length, 0)} images.`, 'success');
  } catch (error) {
    if (!quiet) setNotice('Could not scan topic folders: ' + error.message, 'error');
  } finally {
    scanInProgress = false;
  }
}

function normalizeManifest() {
  if (!manifest || !Array.isArray(manifest.topics)) manifest = { topics: [] };
  manifest.topics = manifest.topics.map(topic => ({ id: topic.id, title: topic.title || topic.id, description: topic.description || '', pages: Array.isArray(topic.pages) ? topic.pages.map(page => ({ file: page.file, title: page.title || page.file })) : [], images: Array.isArray(topic.images) ? topic.images.map(image => ({ file: image.file, alt: image.alt || image.file })) : [] }));
}

async function loadStaticManifest() {
  await subjectsReady;
  const subjectEntry = SUBJECTS.find(entry => entry.id === topicSubjectId);
  if (subjectEntry) {
    document.title = 'Interview Prep · ' + subjectEntry.label + ' Topics';
    $('subjectLibraryHeading').textContent = subjectEntry.label + ' Topics';
    $('subjectLibraryEyebrow').textContent = subjectEntry.label.toLocaleUpperCase() + ' STUDY LIBRARY';
    $('topicNav').setAttribute('aria-label', subjectEntry.label + ' topic navigation');
  }
  const interviewLink = document.getElementById('topicInterviewLink');
  const subject = subjectEntry;
  if (interviewLink && subject?.interviewPage) {
    interviewLink.href = (document.body.dataset.root || '../../') + 'subjects/' + topicSubjectId + '/' + subject.interviewPage;
    interviewLink.textContent = subject.label + ' interview questions →';
    try { if (!(await (await fetch(interviewLink.href, { method: 'HEAD', cache: 'no-cache' })).ok)) interviewLink.hidden = true; }
    catch { interviewLink.hidden = true; }
  } else if (interviewLink) interviewLink.hidden = true;
  const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Topic manifest could not be loaded (' + response.status + ').');
  manifest = await response.json();
  normalizeManifest();
  if (!topicById(activeTopicId)) activeTopicId = manifest.topics[0]?.id || '';
  if (!currentTopic()?.pages.some(page => page.file === activeDocFile)) activeDocFile = currentTopic()?.pages[0]?.file || '';
  updateTopicUrl();
  renderTopic();
  const imageFile = topicQuery.get('image');
  if (imageFile) {
    const image = currentTopic()?.images.find(entry => entry.file === imageFile);
    if (image) openImage(image);
  }
}

$('topicNav').addEventListener('click', event => {
  const link = event.target.closest('[data-topic-id]');
  if (!link) return;
  event.preventDefault();
  activeTopicId = link.dataset.topicId;
  activeDocFile = '';
  updateTopicUrl();
  renderTopic();
});
$('topicMain').addEventListener('click', event => {
  const docButton = event.target.closest('[data-doc-file]');
  if (docButton) {
    activeDocFile = docButton.dataset.docFile;
    updateTopicUrl();
    renderTopic();
    return;
  }
  const imageButton = event.target.closest('[data-image-index]');
  if (imageButton) { openImage(currentTopic().images[Number(imageButton.dataset.imageIndex)]); return; }
  const markdownImage = event.target.closest('[data-topic-image]');
  if (markdownImage) {
    const match = currentTopic().images.find(image => resolveAsset(currentTopic(), image.file) === markdownImage.src);
    openImage(match || { file: markdownImage.src, alt: markdownImage.alt, deletable: false });
    return;
  }
  const toggle = event.target.closest('[data-gallery-toggle]');
  if (toggle) {
    const grid = $('imageGrid');
    grid.hidden = !grid.hidden;
    toggle.setAttribute('aria-expanded', String(!grid.hidden));
    toggle.textContent = grid.hidden ? `View all (${currentTopic().images.length})` : 'Hide image grid';
    return;
  }
  const prev = event.target.closest('[data-gallery-prev]');
  const next = event.target.closest('[data-gallery-next]');
  if (prev || next) $('imageCarousel').scrollBy({ left: (next ? 1 : -1) * $('imageCarousel').clientWidth * 0.8, behavior: 'smooth' });
});
$('topicMain').addEventListener('keydown', event => {
  const image = event.target.closest('[data-topic-image]');
  if (image && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    const match = currentTopic().images.find(entry => resolveAsset(currentTopic(), entry.file) === image.src);
    openImage(match || { file: image.src, alt: image.alt, deletable: false });
  }
});
$('topicMain').addEventListener('error', event => {
  const image = event.target;
  if (!image.matches('.gallery-tile img, [data-topic-image]')) return;
  const fallback = document.createElement('span');
  fallback.className = 'media-fallback';
  fallback.textContent = 'Image unavailable: ' + image.getAttribute('src');
  image.replaceWith(fallback);
}, true);
$('topicMain').addEventListener('dragstart', event => { if (event.target.matches('.gallery-tile img')) event.preventDefault(); });
$('closeImage').addEventListener('click', () => $('imageDialog').close());
$('shareImage').addEventListener('click', shareCurrentImage);
$('imageDialog').addEventListener('click', event => { if (event.target === $('imageDialog')) $('imageDialog').close(); });
window.addEventListener('focus', () => { if (localAccess) scanLocalTopics(true, true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && localAccess) scanLocalTopics(true, true); });
loadStaticManifest().catch(error => {
  $('topicCount').textContent = 'Unavailable';
  $('topicMain').innerHTML = '<div class="panel topic-empty"><h2>Topic library unavailable</h2><p>' + escapeTopicHTML(error.message) + '</p><p>Run this page through a local web server or GitHub Pages, not file://.</p></div>';
  setNotice(error.message, 'error');
});
