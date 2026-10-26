const RESEND_API_URL = 'https://api.resend.com/emails';

// Builds a link to the public website. Emails must never point at localhost, so a local or missing
// FRONTEND_URL is an error: the email is not sent and the caller reports why.
function publicUrl(path) {
  const base = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('FRONTEND_URL is not set. Set it to the public website address so email links work.');
  }
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(base)) {
    throw new Error(`FRONTEND_URL is "${base}", a local address. Set it to the public website address so email links work.`);
  }
  return `${base}${path}`;
}

const EMAIL_ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;
const NAMED_SENDER = /^[^<>]+ <[^\s<>]+>$/;

// Returns a sender Resend accepts: "email@example.com" or "Name <email@example.com>".
// Surrounding quotes from the .env file are removed first. Anything else is rejected before Resend is called,
// with the rejected value in the message so the server setting can be found and corrected.
function resolveSender(value, fromRESEND_FROM) {
  const sender = String(value ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  const isNamed = NAMED_SENDER.test(sender) && EMAIL_ADDRESS.test(sender.slice(sender.lastIndexOf('<') + 1, -1));
  if (EMAIL_ADDRESS.test(sender) || isNamed) return sender;

  const source = fromRESEND_FROM
    ? `in RESEND_FROM ("${sender || '(empty)'}")`
    : `built from MAIL_FROM_NAME and MAIL_FROM because RESEND_FROM is not set ("${String(value)}")`;
  throw new Error(
    `Email sender ${source} is not valid. Set RESEND_FROM to "Biocap <noreply@your-verified-domain>" (a sender on a domain verified in Resend).`
  );
}

// Plain-text copy of an HTML email, sent with it for mail clients that do not show HTML.
const htmlToText = (html) =>
  String(html)
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|h1|h2|h3|li|div|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&copy;/g, '©')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Sends one email through the Resend HTTP API.
// Set RESEND_API_KEY (required) and RESEND_FROM (optional, a sender on a domain verified in Resend).
// Without RESEND_FROM, the sender passed by each caller is used.
async function sendViaResend({ from, to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const sender = resolveSender(process.env.RESEND_FROM || from, Boolean(process.env.RESEND_FROM));

  // A hung connection fails after 10 seconds instead of leaving the request waiting.
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: [to],
      subject,
      html,
      text: htmlToText(html),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend API responded ${response.status}: ${detail}`);
  }

  return response.json();
}

// Escapes user-provided text before it is placed in an HTML email.
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);

// ─── Design system ────────────────────────────────────────────────────────────
// Table-based layout with inline styles, so it renders the same in common mail clients.
const NAVY = '#1B3A5C';
const GOLD = '#A9812F';
const INK = '#1E2620';
const MUTED = '#6B7268';
const LINE = '#E2DDCF';
const PAPER = '#FAF9F5';

const paragraph = (html) =>
  `<p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK};">${html}</p>`;

const muted = (html) =>
  `<p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${MUTED};">${html}</p>`;

// Rows of [label, value]. Values are HTML, so callers escape any user text they include.
const detailTable = (rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 8px 0;border-collapse:collapse;">
    ${rows
      .map(
        ([label, value]) => `
    <tr>
      <td width="150" valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;color:${MUTED};">${escapeHtml(label)}</td>
      <td valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${INK};">${value}</td>
    </tr>`
      )
      .join('')}
  </table>`;

const callout = (html, accent = NAVY) =>
  `<div style="margin:16px 0;padding:14px 18px;background:${PAPER};border-left:4px solid ${accent};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK};">${html}</div>`;

const button = (label, url) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
    <tr>
      <td style="background:${NAVY};">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
  <p style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};word-break:break-all;">
    If the button does not work, paste this link into your browser:<br/>
    <a href="${escapeHtml(url)}" style="color:${NAVY};">${escapeHtml(url)}</a>
  </p>`;

// Shared frame: brand bar, eyebrow, heading, body, and a footer. The heading is escaped here.
const wrapHtml = ({ preheader = '', eyebrow = '', heading, body }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F3F2ED;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F2ED;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${LINE};">
            <tr>
              <td style="background:${NAVY};padding:22px 32px;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-style:italic;color:#FFFFFF;">Biocap</div>
                <div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#D9D4C6;">Rwanda Biotech Capacity Building Project</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 28px 32px;">
                ${eyebrow ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};">${escapeHtml(eyebrow)}</div>` : ''}
                <h1 style="margin:8px 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:normal;color:${INK};">${escapeHtml(heading)}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;border-top:1px solid ${LINE};background:${PAPER};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
                You are receiving this email because you have an account on the Biocap publishing platform.
                This message was sent automatically, so please do not reply to it.<br/>
                &copy; ${new Date().getFullYear()} Biocap, Rwanda Biotech Capacity Building Project
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const sendFrom = (email, subject, html) =>
  sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject,
    html,
  });

const greeting = (firstName) => paragraph(`Hello ${escapeHtml(firstName || 'there')},`);

// ─── 1. Account setup ────────────────────────────────────────────────────────
async function sendCredentialsEmail(email, firstName, tempPassword, token) {
  const resetLink = `${publicUrl('/auth/reset-password')}?token=${token}`;

  const html = wrapHtml({
    preheader: 'Set your password to activate your Biocap account. The link expires in 30 minutes.',
    eyebrow: 'Account setup',
    heading: `Welcome to Biocap, ${firstName || 'there'}`,
    body: `
      ${paragraph('Your Biocap account has been created. Use the temporary password below to set your own password.')}
      ${detailTable([
        ['Email', escapeHtml(email)],
        ['Temporary password', `<code style="font-size:14px;">${escapeHtml(tempPassword)}</code>`],
      ])}
      ${callout('This temporary password expires in <strong>30 minutes</strong>. You must set a new password before you can sign in.', GOLD)}
      ${button('Set my password', resetLink)}
      ${muted('If you did not expect this account, you can ignore this email or contact your administrator.')}`,
  });

  await sendFrom(email, 'Set up your Biocap account (expires in 30 minutes)', html);
}

// ─── 2. Password reset ───────────────────────────────────────────────────────
async function sendPasswordResetEmail(email, firstName, token) {
  const resetLink = `${publicUrl('/auth/reset-password')}?token=${token}`;

  const html = wrapHtml({
    preheader: 'Use the link to choose a new password. It expires in 30 minutes.',
    eyebrow: 'Security',
    heading: 'Reset your password',
    body: `
      ${greeting(firstName)}
      ${paragraph('We received a request to reset the password for your Biocap account. Choose a new password with the button below.')}
      ${callout('This link expires in <strong>30 minutes</strong>.')}
      ${button('Reset my password', resetLink)}
      ${muted('If you did not request this, you can ignore this email. Your password will not change.')}`,
  });

  await sendFrom(email, 'Reset your Biocap password', html);
}

// ─── 3. Story approved (to writer) ───────────────────────────────────────────
async function sendBlogApprovalEmail(email, firstName, blogTitle) {
  const html = wrapHtml({
    preheader: `Your story "${blogTitle}" has been approved and is waiting to be published.`,
    eyebrow: 'Story approved',
    heading: 'Your story has been approved',
    body: `
      ${greeting(firstName)}
      ${paragraph('Our editorial team has reviewed your story and approved it. It is now waiting to be published.')}
      ${detailTable([['Story', escapeHtml(blogTitle)], ['Status', 'Approved, awaiting publication']])}
      ${button('View my stories', publicUrl('/creator/my-stories'))}
      ${muted('Thank you for contributing to Biocap.')}`,
  });

  await sendFrom(email, `Your story "${blogTitle}" has been approved`, html);
}

// ─── 4. Story needs revision (to writer) ─────────────────────────────────────
async function sendBlogRejectionEmail(email, firstName, blogTitle, reviewerNote) {
  const html = wrapHtml({
    preheader: `Your story "${blogTitle}" needs revisions before it can be published.`,
    eyebrow: 'Revision requested',
    heading: 'Your story needs revisions',
    body: `
      ${greeting(firstName)}
      ${paragraph('Thank you for your submission. After review, our editorial team has returned your story so the changes below can be made.')}
      ${detailTable([['Story', escapeHtml(blogTitle)], ['Status', 'Returned to draft']])}
      ${callout(`<strong>Reviewer's note</strong><br/><em>&ldquo;${escapeHtml(reviewerNote)}&rdquo;</em>`, '#B65C4B')}
      ${paragraph('Make the changes and submit the story again when you are ready.')}
      ${button('Revise my story', publicUrl('/creator/my-stories'))}
      ${muted('If you believe this decision was made in error, please contact your communications officer.')}`,
  });

  await sendFrom(email, `Your story "${blogTitle}" needs revisions`, html);
}

// ─── 5. Story published (to writer) ──────────────────────────────────────────
async function sendBlogPublishedEmail(email, firstName, blogTitle, blogSlug) {
  const html = wrapHtml({
    preheader: `Your story "${blogTitle}" is now live on the Biocap website.`,
    eyebrow: 'Now live',
    heading: 'Your story is now live',
    body: `
      ${greeting(firstName)}
      ${paragraph('Your story has been published on the Biocap website.')}
      ${detailTable([['Story', escapeHtml(blogTitle)], ['Status', 'Published']])}
      ${button('View the live story', publicUrl(`/Stewardship-News/${blogSlug}`))}
      ${muted('Share it with your audience. Thank you for contributing to Biocap.')}`,
  });

  await sendFrom(email, `Your story "${blogTitle}" is now live`, html);
}

// ─── 6. Story unpublished (to writer) ────────────────────────────────────────
async function sendStoryUnpublishedEmail(email, firstName, blogTitle, { unpublishedBy, note }) {
  const html = wrapHtml({
    preheader: `Your story "${blogTitle}" has been taken off the Biocap website.`,
    eyebrow: 'Unpublished',
    heading: 'Your story was unpublished',
    body: `
      ${greeting(firstName)}
      ${paragraph(`<strong>${escapeHtml(unpublishedBy)}</strong> removed your story from the Biocap website. It is no longer publicly visible.`)}
      ${detailTable([
        ['Story', escapeHtml(blogTitle)],
        ['Status', 'Unpublished'],
        ['Changed by', escapeHtml(unpublishedBy)],
      ])}
      ${note ? callout(`<strong>Note from the editor</strong><br/><em>&ldquo;${escapeHtml(note)}&rdquo;</em>`, '#B65C4B') : ''}
      ${button('View my stories', publicUrl('/creator/my-stories'))}
      ${muted('If you have questions, please contact your communications officer.')}`,
  });

  await sendFrom(email, `Your story "${blogTitle}" was unpublished`, html);
}

// ─── 7. Editor proposal ready (to writer) ────────────────────────────────────
// Marks used in the email. Inline styles only, since email clients drop <style> blocks.
const INSERT_STYLE = 'background:#d7f5e0;color:#0b5a2a;text-decoration:underline;text-decoration-color:#0f9d58;';
const DELETE_STYLE = 'background:#fde7e5;color:#a50e0e;text-decoration:line-through;';

// Renders one diff segment list with added text highlighted and removed text struck through.
const renderSegments = (segments) =>
  segments
    .map((segment) => {
      const text = escapeHtml(segment.text);
      if (segment.type === 'insert') return `<span style="${INSERT_STYLE}">${text}</span>`;
      if (segment.type === 'delete') return `<span style="${DELETE_STYLE}">${text}</span>`;
      return text;
    })
    .join('');

const changeBlock = (item) => `
  <div style="margin:14px 0;">
    <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${NAVY};">${escapeHtml(item.label)}</p>
    <div style="padding:12px 14px;background:#FFFFFF;border:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:${INK};white-space:pre-wrap;">${renderSegments(item.segments)}${item.truncated ? ' …' : ''}</div>
    ${item.truncated ? muted('Long text was shortened here. Open the review page to see all of it.') : ''}
  </div>`;

// changeItems: from describeChanges(), e.g. [{ label: 'Title', segments: [...], truncated: false }]
// changeLabels: short names from summarizeChanges(), used when no detailed items are given.
async function sendEditorProposalEmail(email, firstName, blogTitle, { editorName, changeLabels = [], changeItems = [], reviewLink }) {
  const changes =
    changeItems.length > 0
      ? changeItems.map(changeBlock).join('')
      : `<ul style="margin:8px 0 0 0;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};">${
          changeLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join('') || '<li>No field-level changes listed</li>'
        }</ul>`;

  const html = wrapHtml({
    preheader: `${editorName} proposed changes to "${blogTitle}". Review them before anything is applied.`,
    eyebrow: 'Changes for your review',
    heading: 'Editor changes are ready for your review',
    body: `
      ${greeting(firstName)}
      ${paragraph(`<strong>${escapeHtml(editorName)}</strong> has proposed changes to your story. Nothing is published yet, and your story stays as you wrote it until you decide.`)}
      ${detailTable([['Story', escapeHtml(blogTitle)]])}
      <p style="margin:16px 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};">
        <span style="${INSERT_STYLE} padding:0 4px;">Added</span>&nbsp;&nbsp;<span style="${DELETE_STYLE} padding:0 4px;">Deleted</span>
      </p>
      ${changes}
      ${button('Review the changes', reviewLink)}
      ${muted('Accepting applies every change. Rejecting any change removes the editor\'s changes from your story and sends the editor your reason.')}`,
  });

  await sendFrom(email, `Review editor changes to "${blogTitle}"`, html);
}

// ─── 8. Writer decision on editor proposal (to editor) ───────────────────────
async function sendEditorProposalDecisionEmail(email, firstName, blogTitle, { approved, writerName, note, changeLabels }) {
  const accent = approved ? '#0f9d58' : '#B65C4B';
  const changeItems = changeLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join('');

  const html = wrapHtml({
    preheader: `${writerName} ${approved ? 'accepted' : 'rejected'} your changes to "${blogTitle}".`,
    eyebrow: approved ? 'Changes accepted' : 'Changes rejected',
    heading: approved ? 'Your changes were accepted' : 'Your changes were rejected',
    body: `
      ${greeting(firstName)}
      ${paragraph(`<strong>${escapeHtml(writerName)}</strong> ${approved ? 'accepted' : 'rejected'} the editor changes you proposed.`)}
      ${detailTable([
        ['Story', escapeHtml(blogTitle)],
        ['Status', approved ? 'Approved, ready for publishing' : 'Returned to draft'],
      ])}
      ${changeItems ? `<p style="margin:16px 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${NAVY};">Proposed changes</p><ul style="margin:0 0 12px 0;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};">${changeItems}</ul>` : ''}
      ${note ? callout(`<strong>Writer's note</strong><br/><em>&ldquo;${escapeHtml(note)}&rdquo;</em>`, accent) : ''}
      ${muted('No further action is needed unless the writer asks for more changes.')}`,
  });

  await sendFrom(email, `${approved ? 'Accepted' : 'Rejected'}: editor changes to "${blogTitle}"`, html);
}

// ─── 9. Editor proposal withdrawn (to writer) ───────────────────────────────
async function sendEditorProposalWithdrawnEmail(email, firstName, blogTitle, { editorName }) {
  const html = wrapHtml({
    preheader: `${editorName} withdrew the proposed changes to "${blogTitle}". No decision is needed.`,
    eyebrow: 'Changes withdrawn',
    heading: 'Editor changes were withdrawn',
    body: `
      ${greeting(firstName)}
      ${paragraph(`<strong>${escapeHtml(editorName)}</strong> withdrew the proposed changes to your story. Nothing was changed, and no decision is needed from you.`)}
      ${detailTable([['Story', escapeHtml(blogTitle)], ['Status', 'Withdrawn']])}
      ${muted('You can keep working on your story as usual.')}`,
  });

  await sendFrom(email, `Editor changes withdrawn for "${blogTitle}"`, html);
}

// ─── 10. Story published (to editors) ────────────────────────────────────────
async function sendStoryPublishedToEditorEmail(email, firstName, blogTitle, { publishedBy, storyLink }) {
  const html = wrapHtml({
    preheader: `"${blogTitle}" is now live on the Biocap website.`,
    eyebrow: 'Published',
    heading: 'A story was published',
    body: `
      ${greeting(firstName)}
      ${paragraph(`<strong>${escapeHtml(publishedBy)}</strong> published a story. It is now live on the Biocap website.`)}
      ${detailTable([['Story', escapeHtml(blogTitle)], ['Status', 'Published']])}
      ${button('View the published story', storyLink)}`,
  });

  await sendFrom(email, `Published: "${blogTitle}"`, html);
}

// ─── 11. New story waiting for review (to editors) ──────────────────────────
async function sendStoryInReviewEmail(email, firstName, blogTitle, { writerName, reviewLink }) {
  const html = wrapHtml({
    preheader: `${writerName} submitted "${blogTitle}" for review.`,
    eyebrow: 'Biocap Project Blogs',
    heading: 'A story is waiting for your review',
    body: `
      ${greeting(firstName)}
      ${paragraph(`<strong>${escapeHtml(writerName)}</strong> has finished the story and submitted it for review.`)}
      ${detailTable([['Story title', escapeHtml(blogTitle)], ['Author', escapeHtml(writerName)], ['Status', 'Waiting for review']])}
      ${button('Open the review queue', reviewLink)}
      ${muted('Review the story and approve it, request changes, or leave it in the queue.')}`,
  });

  await sendFrom(email, `Story ready for review: "${blogTitle}"`, html);
}

// ─── Password changed (security alert) ──────────────────────────────────────
async function sendPasswordChangedEmail(email, firstName) {
  const html = wrapHtml({
    preheader: 'Your Biocap password was just changed. If this was not you, contact your administrator.',
    eyebrow: 'Security alert',
    heading: 'Your password was changed',
    body: `
      ${greeting(firstName)}
      ${paragraph('The password for your Biocap account was changed successfully.')}
      ${detailTable([['Time', escapeHtml(new Date().toUTCString())], ['Action', 'Password updated']])}
      ${callout('If you did not make this change, contact your administrator immediately so your account can be secured.', '#B65C4B')}
      ${muted('This notification was sent to the email address on your account.')}`,
  });

  await sendFrom(email, 'Your Biocap password was changed', html);
}

module.exports = {
  publicUrl,
  sendPasswordChangedEmail,
  sendStoryPublishedToEditorEmail,
  sendStoryInReviewEmail,
  sendStoryUnpublishedEmail,
  sendCredentialsEmail,
  sendPasswordResetEmail,
  sendBlogApprovalEmail,
  sendBlogRejectionEmail,
  sendBlogPublishedEmail,
  sendPasswordChangedEmail,
  sendEditorProposalEmail,
  sendEditorProposalDecisionEmail,
  sendEditorProposalWithdrawnEmail,
  sendViaResend,
  escapeHtml,
};
