// storage.rebuildLinksFor.test.js
//
// Covers wikilink parsing/rebuilding: [[Title]] tokens in a note's body
// get turned into kind:'wikilink' note_links, resolved case-insensitively
// against other notes' titles, deduplicated, self-links excluded, and
// manual (user-drawn) links always left alone.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, note } from './helpers/fixtures.js';
import { rebuildLinksFor, getNoteLinks } from '../storage.js';

describe('rebuildLinksFor — wikilink parsing', () => {
  test('creates a wikilink to a note matched by title, case-insensitively', async () => {
    const target = note({ id: 'n-target', title: 'Limits' });
    const source = note({ id: 'n-source', title: 'F = ma', body: 'See also [[limits]] for more.' });
    await resetStorage({ notes: [target, source] });

    await rebuildLinksFor(source);

    const links = getNoteLinks();
    assert.equal(links.length, 1);
    assert.equal(links[0].source, 'n-source');
    assert.equal(links[0].target, 'n-target');
    assert.equal(links[0].kind, 'wikilink');
  });

  test('ignores a wikilink that does not match any existing note title', async () => {
    const source = note({ id: 'n-source', title: 'Note A', body: 'Links to [[Nothing Here]].' });
    await resetStorage({ notes: [source] });

    await rebuildLinksFor(source);

    assert.equal(getNoteLinks().length, 0);
  });

  test('does not create a self-link when a note references its own title', async () => {
    const source = note({ id: 'n-source', title: 'Self', body: 'Refers to [[Self]] again.' });
    await resetStorage({ notes: [source] });

    await rebuildLinksFor(source);

    assert.equal(getNoteLinks().length, 0);
  });

  test('collapses repeated wikilinks to the same target into a single link', async () => {
    const target = note({ id: 'n-target', title: 'Limits' });
    const source = note({ id: 'n-source', title: 'F = ma', body: '[[Limits]] and again [[Limits]].' });
    await resetStorage({ notes: [target, source] });

    await rebuildLinksFor(source);

    assert.equal(getNoteLinks().length, 1);
  });

  test('creates one link per distinct target when multiple wikilinks are present', async () => {
    const a = note({ id: 'n-a', title: 'Alpha' });
    const b = note({ id: 'n-b', title: 'Beta' });
    const source = note({ id: 'n-source', title: 'Source', body: '[[Alpha]] connects to [[Beta]].' });
    await resetStorage({ notes: [a, b, source] });

    await rebuildLinksFor(source);

    const targets = getNoteLinks().map(l => l.target).sort();
    assert.deepEqual(targets, ['n-a', 'n-b']);
  });

  test('re-running rebuild drops wikilinks no longer present in the body', async () => {
    const target = note({ id: 'n-target', title: 'Limits' });
    const source = note({ id: 'n-source', title: 'Source', body: '[[Limits]]' });
    await resetStorage({ notes: [target, source] });

    await rebuildLinksFor(source);
    assert.equal(getNoteLinks().length, 1);

    await rebuildLinksFor({ ...source, body: 'No links anymore.' });
    assert.equal(getNoteLinks().length, 0);
  });

  test('leaves manual (user-drawn) links on this note untouched', async () => {
    const target = note({ id: 'n-target', title: 'Limits' });
    const source = note({ id: 'n-source', title: 'Source', body: 'No wikilinks in this body.' });
    await resetStorage({
      notes: [target, source],
      note_links: [{ id: 'manual-1', user_id: 'local', source: 'n-source', target: 'n-target', kind: 'manual' }],
    });

    await rebuildLinksFor(source);

    const links = getNoteLinks();
    assert.equal(links.length, 1);
    assert.equal(links[0].kind, 'manual');
  });

  test('a manual link and a fresh wikilink from the same source coexist', async () => {
    const manualTarget = note({ id: 'n-manual-target', title: 'Manual Target' });
    const wikiTarget = note({ id: 'n-wiki-target', title: 'Wiki Target' });
    const source = note({ id: 'n-source', title: 'Source', body: 'See [[Wiki Target]].' });
    await resetStorage({
      notes: [manualTarget, wikiTarget, source],
      note_links: [{ id: 'manual-1', user_id: 'local', source: 'n-source', target: 'n-manual-target', kind: 'manual' }],
    });

    await rebuildLinksFor(source);

    const kinds = getNoteLinks().map(l => l.kind).sort();
    assert.deepEqual(kinds, ['manual', 'wikilink']);
  });

  test('an empty body produces no links', async () => {
    const source = note({ id: 'n-source', title: 'Empty', body: '' });
    await resetStorage({ notes: [source] });

    await rebuildLinksFor(source);

    assert.equal(getNoteLinks().length, 0);
  });
});
