// storage.migrateNotesToHierarchy.test.js
//
// Covers the one-time upgrade of legacy flat notes (type 'note', no
// parent_id) into a real Subject > ... > Note hierarchy, bucketed by
// their old free-text `subject` field, reusing an existing Subject node
// when one already matches (case-insensitively) instead of duplicating it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, note } from './helpers/fixtures.js';
import { migrateNotesToHierarchy, getNotes, getSubjectNodes, getChildren, getNote } from '../storage.js';

describe('migrateNotesToHierarchy', () => {
  test('does nothing when there are no legacy (unparented, type=note) notes', async () => {
    const subject = note({ id: 's1', type: 'subject', parent_id: null, title: 'Physics' });
    const child = note({ id: 'n1', type: 'note', parent_id: 's1', title: 'Kinematics' });
    await resetStorage({ notes: [subject, child] });

    await migrateNotesToHierarchy();

    assert.equal(getNotes().length, 2);
    assert.equal(getSubjectNodes().length, 1);
  });

  test('buckets legacy notes under a new Subject node matching their old subject field', async () => {
    const a = note({ id: 'n1', type: 'note', parent_id: null, subject: 'Physics', title: 'A' });
    const b = note({ id: 'n2', type: 'note', parent_id: null, subject: 'Physics', title: 'B' });
    await resetStorage({ notes: [a, b] });

    await migrateNotesToHierarchy();

    const subjects = getSubjectNodes();
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0].title, 'Physics');
    assert.deepEqual(getChildren(subjects[0].id).map(n => n.id).sort(), ['n1', 'n2']);
  });

  test('notes with different subject fields land under separate Subject nodes', async () => {
    const a = note({ id: 'n1', type: 'note', parent_id: null, subject: 'Physics', title: 'A' });
    const b = note({ id: 'n2', type: 'note', parent_id: null, subject: 'Mathematics', title: 'B' });
    await resetStorage({ notes: [a, b] });

    await migrateNotesToHierarchy();

    const subjects = getSubjectNodes().map(s => s.title).sort();
    assert.deepEqual(subjects, ['Mathematics', 'Physics']);
  });

  test('reuses an existing Subject node with a case-insensitively matching title', async () => {
    const subject = note({ id: 's1', type: 'subject', parent_id: null, title: 'Physics' });
    const legacy = note({ id: 'n1', type: 'note', parent_id: null, subject: 'physics', title: 'Legacy note' });
    await resetStorage({ notes: [subject, legacy] });

    await migrateNotesToHierarchy();

    assert.equal(getSubjectNodes().length, 1); // no duplicate created
    assert.deepEqual(getChildren('s1').map(n => n.id), ['n1']);
    // subject field is normalized to the canonical Subject node's title
    assert.equal(getNote('n1').subject, 'Physics');
  });

  test('notes missing a subject field default to a "General" bucket', async () => {
    const orphan = note({ id: 'n1', type: 'note', parent_id: null, subject: undefined, title: 'Orphan' });
    await resetStorage({ notes: [orphan] });

    await migrateNotesToHierarchy();

    const subjects = getSubjectNodes();
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0].title, 'General');
  });

  test('leaves topic/subtopic/subject-typed notes alone even without a parent_id', async () => {
    const topic = note({ id: 't1', type: 'topic', parent_id: null, subject: 'Physics', title: 'Mechanics' });
    await resetStorage({ notes: [topic] });

    await migrateNotesToHierarchy();

    assert.equal(getSubjectNodes().length, 0); // nothing created for a bare topic
    assert.equal(getNote('t1').parent_id, null); // and it wasn't touched
  });

  test('leaves already-parented notes untouched', async () => {
    const subject = note({ id: 's1', type: 'subject', parent_id: null, title: 'Physics' });
    const child = note({ id: 'n1', type: 'note', parent_id: 's1', subject: 'Physics', title: 'Already placed' });
    await resetStorage({ notes: [subject, child] });

    await migrateNotesToHierarchy();

    assert.equal(getSubjectNodes().length, 1); // no second Physics subject
    assert.equal(getNote('n1').parent_id, 's1');
  });

  test('is idempotent — running twice does not create duplicate subjects or move notes again', async () => {
    const a = note({ id: 'n1', type: 'note', parent_id: null, subject: 'Math', title: 'A' });
    await resetStorage({ notes: [a] });

    await migrateNotesToHierarchy();
    const afterFirst = getNotes().length;
    await migrateNotesToHierarchy();

    assert.equal(getSubjectNodes().length, 1);
    assert.equal(getNotes().length, afterFirst); // no extra notes created
  });

  test('differently-cased subject strings across notes still collapse onto a single Subject node', async () => {
    const a = note({ id: 'n1', type: 'note', parent_id: null, subject: 'Math', title: 'A' });
    const b = note({ id: 'n2', type: 'note', parent_id: null, subject: 'math', title: 'B' });
    await resetStorage({ notes: [a, b] });

    await migrateNotesToHierarchy();

    assert.equal(getSubjectNodes().length, 1);
    assert.deepEqual(getChildren(getSubjectNodes()[0].id).map(n => n.id).sort(), ['n1', 'n2']);
  });
});
