// Sends one example of every transactional email through the app's real Resend sender.
//
// Usage:
//   node scripts/sendTestEmails.js carterk279@gmail.com
//   DRY_RUN=1 node scripts/sendTestEmails.js carterk279@gmail.com   (renders templates, sends nothing)

require('dotenv').config();

const {
  sendCredentialsEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendBlogApprovalEmail,
  sendBlogRejectionEmail,
  sendBlogPublishedEmail,
  sendEditorProposalEmail,
  sendEditorProposalDecisionEmail,
} = require('../utils/sendEmail');

const recipient = process.argv[2];
if (!recipient) {
  console.error('Usage: node scripts/sendTestEmails.js <recipient-email>');
  process.exit(1);
}

const firstName = 'Carter';
const blogTitle = 'Test story: <i>escaping</i> check';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

const cases = [
  ['account creation', () => sendCredentialsEmail(recipient, firstName, 'TempPass-123', 'test-token')],
  ['password reset', () => sendPasswordResetEmail(recipient, firstName, 'test-token')],
  ['password changed', () => sendPasswordChangedEmail(recipient, firstName)],
  ['blog approved', () => sendBlogApprovalEmail(recipient, firstName, blogTitle)],
  ['blog rejected', () => sendBlogRejectionEmail(recipient, firstName, blogTitle, 'Please add sources.')],
  ['blog published', () => sendBlogPublishedEmail(recipient, firstName, blogTitle, 'test-story')],
  [
    'editor proposal ready (to writer)',
    () =>
      sendEditorProposalEmail(recipient, firstName, blogTitle, {
        editorName: 'Eve Editor',
        changeLabels: ['Title', 'Tag', 'Content blocks (2 changed)'],
        reviewLink: `${frontendUrl}/dashboard/my-submissions`,
      }),
  ],
  [
    'editor proposal accepted (to editor)',
    () =>
      sendEditorProposalDecisionEmail(recipient, firstName, blogTitle, {
        approved: true,
        writerName: 'Ann Writer',
        note: 'Looks good.',
        changeLabels: ['Title', 'Tag'],
      }),
  ],
  [
    'editor proposal rejected (to editor)',
    () =>
      sendEditorProposalDecisionEmail(recipient, firstName, blogTitle, {
        approved: false,
        writerName: 'Ann Writer',
        note: 'Keep the original excerpt.',
        changeLabels: ['Excerpt'],
      }),
  ],
];

const run = async () => {
  if (process.env.DRY_RUN === '1') {
    const sent = [];
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      sent.push(body);
      return { ok: true, status: 200, json: async () => ({ id: 'dry-run' }) };
    };
    for (const [label, send] of cases) {
      await send();
      const mail = sent[sent.length - 1];
      console.log(`rendered  ${label.padEnd(38)} subject: ${mail.subject}`);
    }
    console.log(`\nDRY RUN: ${sent.length} emails rendered, none sent.`);
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set. Add it to .env first.');
    process.exit(1);
  }

  let failures = 0;
  for (const [label, send] of cases) {
    try {
      await send();
      console.log(`sent      ${label}`);
    } catch (err) {
      failures += 1;
      console.log(`FAILED    ${label}: ${err.message}`);
    }
  }
  console.log(failures === 0 ? `\nAll ${cases.length} emails sent to ${recipient}.` : `\n${failures} of ${cases.length} emails failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
};

run();
