const test = require('node:test');
const assert = require('node:assert/strict');
const AuditLog = require('../models/AuditLog');
const { writeAuditLog } = require('../utils/auditLogger');

test('audit records support durable actor snapshots and gallery targets', async () => {
  const entry = new AuditLog({
    actorRole: 'anonymous',
    actorLabel: 'Guest',
    action: 'gallery.publish',
    targetModel: 'Gallery',
    targetId: '507f1f77bcf86cd799439011',
  });

  await assert.doesNotReject(entry.validate());
});

test('audit logger captures actor and request context and propagates persistence errors', async () => {
  const originalCreate = AuditLog.create;
  const originalConsoleError = console.error;
  let recorded;

  try {
    AuditLog.create = async (data) => {
      recorded = data;
      return data;
    };

    await writeAuditLog({
      req: {
        user: { id: '507f1f77bcf86cd799439012', role: 'admin', username: 'admin-user' },
        ip: '192.0.2.10',
        headers: { 'user-agent': 'test-agent' },
        method: 'PATCH',
        path: '/api/gallery/507f1f77bcf86cd799439011/publish',
        body: { password: 'must-not-be-recorded', token: 'must-not-be-recorded' },
      },
      action: 'gallery.publish',
      targetModel: 'Gallery',
      targetId: '507f1f77bcf86cd799439011',
      targetLabel: 'Field visit',
      detail: { mediaType: 'folder' },
    });

    assert.equal(String(recorded.actor), '507f1f77bcf86cd799439012');
    assert.equal(recorded.actorRole, 'admin');
    assert.equal(recorded.actorLabel, 'admin-user');
    assert.equal(recorded.requestMethod, 'PATCH');
    assert.equal(recorded.requestPath, '/api/gallery/507f1f77bcf86cd799439011/publish');
    assert.deepEqual(recorded.detail, { mediaType: 'folder' });
    assert.equal('body' in recorded, false);

    AuditLog.create = async () => {
      throw new Error('database unavailable');
    };
    console.error = () => {};

    await assert.rejects(
      writeAuditLog({
        req: { user: { id: '507f1f77bcf86cd799439012', role: 'admin' } },
        action: 'user.update',
        targetModel: 'User',
        targetId: '507f1f77bcf86cd799439013',
      }),
      /database unavailable/
    );
  } finally {
    AuditLog.create = originalCreate;
    console.error = originalConsoleError;
  }
});
