'use strict';
(async function loadSubjectTopics() {
  await subjectsReady;
  const subject = SUBJECTS.find(entry => entry.id === document.body.dataset.subject);
  const root = document.body.dataset.root || '../../';
  const heading = document.getElementById('topicsHeading');
  const description = document.getElementById('topicsDescription');
  const list = document.getElementById('topicsList');
  const interview = document.getElementById('interviewLink');
  if (!subject) return;
  document.title = 'Interview Prep · ' + subject.label + ' Topics';
  heading.textContent = subject.label + ' Topics';
  description.textContent = subject.description;
  if (subject.interviewPage) {
    interview.href = root + 'subjects/' + subject.id + '/' + subject.interviewPage;
    try { if (!(await (await fetch(interview.href, { method: 'HEAD', cache: 'no-cache' })).ok)) interview.hidden = true; }
    catch { interview.hidden = true; }
  } else interview.hidden = true;
  try {
    const response = await fetch(root + 'subjects/' + subject.id + '/' + subject.file, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Could not load the ' + subject.label + ' question file.');
    const questions = parseCSV(await response.text());
    const concepts = [...new Set(questions.map(question => question.concept))].sort((a, b) => a.localeCompare(b));
    list.innerHTML = concepts.length ? concepts.map(concept => {
      const count = questions.filter(question => question.concept === concept).length;
      const url = new URL(root + 'subjects/' + subject.id + '/' + subject.id + '_interview.html', document.baseURI);
      url.searchParams.set('concept', concept);
      return `<a class="subject-topic-link" href="${escapeHTML(url.href)}"><span><strong>${escapeHTML(concept)}</strong><small>${count} ${count === 1 ? 'question' : 'questions'}</small></span><span aria-hidden="true">→</span></a>`;
    }).join('') : '<div class="empty"><h3>No topics found yet</h3><p>Add questions with a CoreConcept value to the subject CSV to populate this list.</p></div>';
  } catch (error) {
    list.innerHTML = '<div class="notice error">' + escapeHTML(error.message) + '</div>';
  }
})().catch(error => console.error('Unable to load subject topics:', error));
