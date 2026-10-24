const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sendEditorProposalEmail,
  sendEditorProposalDecisionEmail,
  sendBlogRejectionEmail,
  escapeHtml,
} = require('../utils/sendEmail');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const mockFetch = (responder) => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return responder(calls.length);
  };
  return calls;
};

const okResponse = () => ({ ok: true, json: async () => ({ id: 'email_1' }) });

test.beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM = 'Biocap <updates@example.org>';
  process.env.MAIL_FROM = 'fallback@example.org';
  process.env.MAIL_FROM_NAME = 'Biocap';
  process.env.FRONTEND_URL = 'https://biocap.example';
});

test.afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('escapeHtml neutralizes HTML-significant characters', () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script> & 'y'`),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;'
  );
  assert.equal(escapeHtml(undefined), '');
});

test('sendEditorProposalEmail posts to Resend with the API key and escaped user text', async () => {
  const calls = mockFetch(() => okResponse());

  await sendEditorProposalEmail('writer@example.org', 'Ann', '<b>Bold</b> story', {
    editorName: 'Eve <editor>',
    changeLabels: ['Title'],
    reviewLink: 'https://biocap.example/dashboard/my-submissions',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].body.from, 'Biocap <updates@example.org>');
  assert.deepEqual(calls[0].body.to, ['writer@example.org']);
  assert.match(calls[0].body.subject, /<b>Bold<\/b> story/);
  assert.match(calls[0].body.html, /&lt;b&gt;Bold&lt;\/b&gt; story/);
  assert.match(calls[0].body.html, /Eve &lt;editor&gt;/);
  assert.doesNotMatch(calls[0].body.html, /<b>Bold<\/b>/);
});

test('sendEditorProposalDecisionEmail escapes the writer note and reports status', async () => {
  const calls = mockFetch(() => okResponse());

  await sendEditorProposalDecisionEmail('editor@example.org', 'Eve', 'Story', {
    approved: false,
    writerName: 'Ann',
    note: '<img src=x onerror=alert(1)>',
    changeLabels: ['Excerpt'],
  });

  const html = calls[0].body.html;
  assert.match(html, /Returned to draft/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(calls[0].body.subject, /^Rejected:/);
});

test('sending fails with a clear error when RESEND_API_KEY is missing', async () => {
  delete process.env.RESEND_API_KEY;
  mockFetch(() => okResponse());

  await assert.rejects(
    sendEditorProposalEmail('writer@example.org', 'Ann', 'Story', {
      editorName: 'Eve',
      changeLabels: [],
      reviewLink: 'https://biocap.example',
    }),
    /RESEND_API_KEY is not configured/
  );
});

test('a non-2xx response from Resend is surfaced as an error', async () => {
  mockFetch(() => ({ ok: false, status: 422, text: async () => 'invalid from address' }));

  await assert.rejects(
    sendEditorProposalDecisionEmail('editor@example.org', 'Eve', 'Story', {
      approved: true,
      writerName: 'Ann',
      note: '',
      changeLabels: [],
    }),
    /Resend API responded 422: invalid from address/
  );
});

test('older templates escape the title, name and reviewer note in the HTML body', async () => {
  const calls = mockFetch(() => okResponse());

  await sendBlogRejectionEmail('ann@example.org', '<b>Ann</b>', 'Story <i>x</i>', '<script>bad()</script>');

  const html = calls[0].body.html;
  assert.match(html, /&lt;b&gt;Ann&lt;\/b&gt;/);
  assert.match(html, /Story &lt;i&gt;x&lt;\/i&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
