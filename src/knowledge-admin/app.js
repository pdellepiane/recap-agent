'use strict';
const $ = id => document.getElementById(id);
let documents = [], previewUrl = null, previewId = null, busy = false, loaded = false;
const root = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
async function request(route, options = {}) {
  const response = await fetch(root + 'api/' + route, { ...options, headers: { 'content-type': 'application/json', 'x-knowledge-action': '1', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : 'success'; }
function button(text, action, className = '') {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.className = className;
  node.addEventListener('click', async () => { if (busy) return; busy = true; node.disabled = true; try { await action(); } catch (error) { notice(error.message, true); } finally { busy = false; node.disabled = false; } }); return node;
}
function render() {
  if (!loaded) { $('count').textContent = 'Loading documents…'; return; }
  const filter = $('filter').value.toLowerCase(); const visible = documents.filter(doc => doc.title.toLowerCase().includes(filter));
  $('documents').replaceChildren(); $('count').textContent = visible.length + ' of ' + documents.length + ' documents';
  if (!visible.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = documents.length ? 'No matching documents.' : 'No documents yet. Add your first document above.'; row.append(cell); $('documents').append(row); }
  visible.forEach(doc => {
    const row = document.createElement('tr');
    [doc.title, doc.origin === 'tawk' ? 'Tawk · read-only' : doc.origin === 'helper' ? 'Added here' : 'Other · read-only', doc.status].forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    const actions = document.createElement('td'); actions.append(button('Preview', () => preview(doc.id)));
    if (doc.canPublish) actions.append(button('Publish', () => publish(doc.id), 'primary'));
    if (doc.canDelete) actions.append(button('Delete', () => remove(doc), 'danger'));
    row.append(actions); $('documents').append(row);
  });
}
async function refresh() { documents = await request('documents'); loaded = true; render(); }
async function publish(id) { await request('documents/' + encodeURIComponent(id) + '/publish', { method: 'POST' }); notice('Submitted for indexing. The status will become published when indexing completes.'); $('preview').close(); await refresh(); }
async function remove(doc) {
  if (!confirm('Delete “' + doc.title + '”? This removes it from the agent’s knowledge.')) return;
  await request('documents/' + encodeURIComponent(doc.id), { method: 'DELETE' });
  if (previewId === doc.id) $('preview').close(); notice('Document deleted. Search removal can take a short time to propagate.'); await refresh();
}
async function preview(id) {
  const doc = documents.find(entry => entry.id === id); const data = await request('documents/' + encodeURIComponent(id) + '/preview'); previewId = id;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  $('preview-title').textContent = data.title; $('preview-error').textContent = data.error || ''; $('preview-content').replaceChildren(); $('preview-actions').replaceChildren();
  if (data.pdf) {
    const response = await fetch(root + 'api/documents/' + encodeURIComponent(id) + '/original'); if (!response.ok) throw new Error('Could not load PDF preview.');
    previewUrl = URL.createObjectURL(await response.blob()); const frame = document.createElement('iframe'); frame.src = previewUrl; frame.title = 'PDF document preview'; $('preview-content').append(frame);
  } else { const text = document.createElement('pre'); text.textContent = data.text || 'No preview text is available yet.'; $('preview-content').append(text); }
  if (doc?.canPublish) $('preview-actions').append(button('Publish this document', () => publish(id), 'primary'));
  if (doc?.canDelete) $('preview-actions').append(button('Delete draft/document', () => remove(doc), 'danger'));
  $('preview').showModal();
}
$('add-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; const submit = event.submitter; submit.disabled = true;
  try {
    const file = $('file').files[0]; const text = $('text').value;
    if (file && text.trim()) throw new Error('Choose a file or paste text, rather than both.');
    if (!file && !text.trim()) throw new Error('Choose a file or paste some document text.');
    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text);
    if (bytes.length > 3 * 1024 * 1024) throw new Error('Maximum upload size is 3 MiB.');
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const doc = await request('documents', { method: 'POST', body: JSON.stringify({ title: $('title').value, filename: file?.name || 'document.txt', data: btoa(binary) }) });
    $('add-form').reset(); notice('Draft saved. Preview it, then publish when ready.'); await refresh(); await preview(doc.id);
  } catch (error) { notice(error.message, true); } finally { busy = false; submit.disabled = false; }
});
$('file').addEventListener('change', () => { const file = $('file').files[0]; if (file && !$('title').value) $('title').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '); });
$('refresh').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
$('filter').addEventListener('input', render); $('close-preview').addEventListener('click', () => $('preview').close());
$('preview').addEventListener('close', () => { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } });
refresh().catch(error => notice(error.message, true));
setInterval(() => { if (!busy && documents.some(doc => doc.status === 'indexing' || doc.status === 'publishing')) refresh().catch(error => notice(error.message, true)); }, 5000);
