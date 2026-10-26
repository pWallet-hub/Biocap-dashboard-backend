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

test('sendEditorProposalEmail shows added and deleted text inline, escaped, with the review link', async () => {
  const calls = mockFetch(() => okResponse());

  await sendEditorProposalEmail('writer@example.org', 'Ann', 'Story', {
    editorName: 'Eve',
    changeItems: [
      {
        label: 'Title',
        segments: [
          { type: 'equal', text: 'The ' },
          { type: 'delete', text: 'old<name>' },
          { type: 'insert', text: 'new name' },
        ],
        truncated: false,
      },
    ],
    reviewLink: 'https://biocap.example/creator/proposals/abc123',
  });

  const html = calls[0].body.html;
  assert.match(html, /<span style="[^"]*text-decoration:underline[^"]*">new name<\/span>/);
  assert.match(html, /<span style="[^"]*line-through[^"]*">old&lt;name&gt;<\/span>/);
  assert.doesNotMatch(html, /old<name>/);
  assert.match(html, /href="https:\/\/biocap.example\/creator\/proposals\/abc123"/);
});

test('sendEditorProposalEmail notes when a long change was shortened', async () => {
  const calls = mockFetch(() => okResponse());

  await sendEditorProposalEmail('writer@example.org', 'Ann', 'Story', {
    editorName: 'Eve',
    changeItems: [{ label: 'Body text', segments: [{ type: 'insert', text: 'x' }], truncated: true }],
    reviewLink: 'https://biocap.example/creator/proposals/abc123',
  });

  assert.match(calls[0].body.html, /Long text was shortened here/);
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

test('sending fails with a clear message when the sender is not configured', async () => {
  delete process.env.RESEND_FROM;
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_FROM_NAME;
  const calls = mockFetch(() => okResponse());

  await assert.rejects(
    sendEditorProposalEmail('writer@example.org', 'Ann', 'Story', {
      editorName: 'Eve',
      changeLabels: [],
      reviewLink: 'https://biocap.example',
    }),
    /Email sender built from MAIL_FROM_NAME and MAIL_FROM because RESEND_FROM is not set .* is not valid/
  );
  assert.equal(calls.length, 0, 'Resend must not be called with an invalid sender');
});

test('a malformed RESEND_FROM is rejected before Resend is called, and the value is shown', async () => {
  const calls = mockFetch(() => okResponse());

  for (const bad of ['Biocap noreply@blog.example.org', '"Biocap" <undefined>', 'Biocap <>']) {
    process.env.RESEND_FROM = bad;
    await assert.rejects(
      sendEditorProposalEmail('writer@example.org', 'Ann', 'Story', { editorName: 'Eve', changeLabels: [], reviewLink: 'https://biocap.example' }),
      (err) => err.message.includes('in RESEND_FROM') && err.message.includes('is not valid')
    );
  }
  assert.equal(calls.length, 0);
});

test('quoted and named RESEND_FROM values are accepted and sent as given', async () => {
  const calls = mockFetch(() => okResponse());

  process.env.RESEND_FROM = '"Biocap <noreply@blog.example.org>"';
  await sendEditorProposalEmail('writer@example.org', 'Ann', 'Story', { editorName: 'Eve', changeLabels: [], reviewLink: 'https://biocap.example' });

  assert.equal(calls[0].body.from, 'Biocap <noreply@blog.example.org>');
});

test('sendStoryPublishedToEditorEmail names the publisher and escapes the title', async () => {
  const { sendStoryPublishedToEditorEmail } = require('../utils/sendEmail');
  process.env.RESEND_FROM = 'Biocap <noreply@blog.example.org>';
  const calls = mockFetch(() => okResponse());

  await sendStoryPublishedToEditorEmail('editor@example.org', 'Eve', '<b>Big</b> story', {
    publishedBy: 'Ann <writer>',
    storyLink: 'https://biocap.example/Stewardship-News/big-story',
  });

  assert.deepEqual(calls[0].body.to, ['editor@example.org']);
  assert.equal(calls[0].body.subject, 'Published: "<b>Big</b> story"');
  assert.match(calls[0].body.html, /Ann &lt;writer&gt;/);
  assert.match(calls[0].body.html, /href="https:\/\/biocap.example\/Stewardship-News\/big-story"/);
  assert.doesNotMatch(calls[0].body.html, /<b>Big<\/b>/);
});

test('publicUrl builds links on the public site and refuses localhost', () => {
  const { publicUrl } = require('../utils/sendEmail');
  process.env.FRONTEND_URL = 'https://biocap.example/';
  assert.equal(publicUrl('/creator/my-stories'), 'https://biocap.example/creator/my-stories');

  process.env.FRONTEND_URL = 'http://localhost:3000';
  assert.throws(() => publicUrl('/creator/my-stories'), /local address/);

  delete process.env.FRONTEND_URL;
  assert.throws(() => publicUrl('/creator/my-stories'), /FRONTEND_URL is not set/);
});

test('new templates escape user text and every email carries a plain-text copy', async () => {
  const { sendStoryUnpublishedEmail, sendStoryInReviewEmail } = require('../utils/sendEmail');
  process.env.RESEND_FROM = 'Biocap <noreply@blog.example.org>';
  process.env.FRONTEND_URL = 'https://biocap.example';
  const calls = mockFetch(() => okResponse());

  await sendStoryUnpublishedEmail('ann@example.org', 'Ann', 'Story <b>x</b>', { unpublishedBy: 'Eve <editor>' });
  await sendStoryInReviewEmail('eve@example.org', 'Eve', 'Draft <i>y</i>', {
    writerName: 'Ann <writer>',
    reviewLink: 'https://biocap.example/editor/review',
  });

  assert.equal(calls[0].body.subject, 'Your story "Story <b>x</b>" was unpublished');
  assert.match(calls[0].body.html, /Eve &lt;editor&gt;/);
  assert.doesNotMatch(calls[0].body.html, /<b>x<\/b>/);
  assert.match(calls[1].body.html, /href="https:\/\/biocap.example\/editor\/review"/);
  assert.match(calls[1].body.html, /Ann &lt;writer&gt;/);
  assert.ok(calls[1].body.text.includes('A story is waiting for your review'));
  assert.doesNotMatch(calls[1].body.text, /&(lt|gt|amp|quot|#39);/);
});
