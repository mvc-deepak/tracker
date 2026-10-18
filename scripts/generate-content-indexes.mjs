import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const subjectsRoot = path.join(root, 'subjects');
const imageExtensions = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

const titleFromName = value => value
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, character => character.toLocaleUpperCase());

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, relativePath));
    else if (entry.isFile()) files.push({ file: relativePath, fullPath });
  }
  return files;
}

async function firstHeading(filePath) {
  const markdown = await readFile(filePath, 'utf8');
  return markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() || null;
}

async function generateTopicManifest(topicsDirectory) {
  const manifestPath = path.join(topicsDirectory, 'index.json');
  const previous = await readJson(manifestPath, { topics: [] });
  const previousTopics = new Map((Array.isArray(previous.topics) ? previous.topics : []).map(topic => [topic.id, topic]));
  const topics = [];

  for (const entry of await readdir(topicsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const id = entry.name;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Invalid topic folder name "${id}" in ${topicsDirectory}; use lowercase letters, numbers, and hyphens.`);
    const directory = path.join(topicsDirectory, id);
    const oldTopic = previousTopics.get(id) || {};
    const files = await listFiles(directory);
    const oldPages = new Map((oldTopic.pages || []).map(page => [page.file, page]));
    const oldImages = new Map((oldTopic.images || []).map(image => [image.file, image]));
    const pages = [];
    const images = [];

    for (const file of files) {
      if (/\.md$/i.test(file.file)) {
        const oldPage = oldPages.get(file.file);
        pages.push({ file: file.file, title: oldPage?.title || await firstHeading(file.fullPath) || titleFromName(path.basename(file.file, path.extname(file.file))) });
      } else if (imageExtensions.has(path.extname(file.file).toLocaleLowerCase())) {
        const oldImage = oldImages.get(file.file);
        images.push({
          file: file.file,
          alt: oldImage?.alt || titleFromName(path.basename(file.file, path.extname(file.file)))
        });
      }
    }

    pages.sort((left, right) => left.file.localeCompare(right.file));
    images.sort((left, right) => left.file.localeCompare(right.file));
    topics.push({
      id,
      title: oldTopic.title || titleFromName(id),
      description: oldTopic.description || '',
      pages,
      images
    });
  }

  topics.sort((left, right) => left.title.localeCompare(right.title));
  await writeFile(manifestPath, `${JSON.stringify({ topics }, null, 2)}\n`, 'utf8');
  return topics.length;
}

async function chooseCsv(subjectDirectory, subjectId) {
  const csvFiles = (await readdir(subjectDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.csv'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (csvFiles.includes(`${subjectId}.csv`)) return `${subjectId}.csv`;
  if (csvFiles.length === 1) return csvFiles[0];
  if (!csvFiles.length) return null;
  throw new Error(`Multiple CSV files in subjects/${subjectId}; add the expected ${subjectId}.csv or leave one CSV file.`);
}

async function generateSubjectRegistry() {
  const oldRegistry = await readJson(path.join(subjectsRoot, 'index.json'), { subjects: [] });
  const oldSubjects = new Map((Array.isArray(oldRegistry.subjects) ? oldRegistry.subjects : []).map(subject => [subject.id, subject]));
  const subjects = [];

  for (const entry of await readdir(subjectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const id = entry.name;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Invalid subject folder name "${id}"; use lowercase letters, numbers, and hyphens.`);
    const subjectDirectory = path.join(subjectsRoot, id);
    const topicsDirectory = path.join(subjectDirectory, 'topics');
    try {
      if (!(await stat(topicsDirectory)).isDirectory()) continue;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    const metadata = await readJson(path.join(subjectDirectory, 'subject.json'), {});
    const previous = oldSubjects.get(id) || {};
    const csvFile = await chooseCsv(subjectDirectory, id);
    const topicFile = path.join(subjectDirectory, `${id}.html`);
    try {
      await stat(topicFile);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Missing topic page subjects/${id}/${id}.html for discovered subject folder.`);
      throw error;
    }
    const interviewFile = `${id}_interview.html`;
    let interviewPage = null;
    if (csvFile) {
      try {
        await stat(path.join(subjectDirectory, interviewFile));
        interviewPage = interviewFile;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    const topicCount = await generateTopicManifest(topicsDirectory);
    subjects.push({
      id,
      label: metadata.label || previous.label || titleFromName(id),
      description: metadata.description ?? previous.description ?? '',
      ...(csvFile ? { csvFile } : {}),
      topicsPage: `${id}.html`,
      ...(interviewPage ? { interviewPage } : {})
    });
    console.log(`Indexed ${id}: ${topicCount} topics${csvFile ? `, ${csvFile}` : ', no interview CSV'}.`);
  }

  subjects.sort((left, right) => left.label.localeCompare(right.label));
  await writeFile(path.join(subjectsRoot, 'index.json'), `${JSON.stringify({ subjects }, null, 2)}\n`, 'utf8');
  console.log(`Wrote subjects/index.json with ${subjects.length} discovered subjects.`);
}

await generateSubjectRegistry();