const RESEND_API_URL = 'https://api.resend.com/emails';

// Sends one email through the Resend HTTP API.
// Set RESEND_API_KEY (required) and RESEND_FROM (optional, a sender on a domain verified in Resend).
// Without RESEND_FROM, the sender passed by each caller is used.
async function sendViaResend({ from, to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || from,
      to: [to],
      subject,
      html,
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

// ─── Shared layout wrapper ────────────────────────────────────────────────────
const wrapHtml = (content) => `
  <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto;">
      ${content}
      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
      <p style="font-size: 12px; color: #999;">
        This is an automated message from Biocap. Please do not reply directly to this email.
      </p>
    </body>
  </html>
`;

// ─── 1. Account Creation / Credentials Email ─────────────────────────────────
async function sendCredentialsEmail(email, firstName, tempPassword, token) {
  const resetLink = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

  const html = wrapHtml(`
    <h3 style="color: #1a73e8;">Welcome to Biocap, ${escapeHtml(firstName)}!</h3>
    <p>Your account has been successfully registered.</p>

    <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #1a73e8; margin: 15px 0;">
      <strong>Your Temporary Credentials:</strong><br/>
      &bull; <strong>Email:</strong> ${escapeHtml(email)}<br/>
      &bull; <strong>Temporary Password:</strong> <code style="font-size: 15px;">${tempPassword}</code>
    </div>

    <p style="color: #d93025; font-weight: bold;">
      ⚠️ Action Required: This temporary password expires in <u>30 minutes</u>.
      You must reset it before logging in.
    </p>

    <p>When you click the button below, you will be taken to a password reset page where you will:</p>
    <ol>
      <li>Enter your <strong>temporary password</strong> shown above</li>
      <li>Choose a <strong>new password</strong></li>
      <li>Confirm your new password</li>
    </ol>

    <p>
      <a href="${resetLink}"
         style="background-color: #1a73e8; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 5px; display: inline-block;
                font-weight: bold; font-size: 15px;">
        Reset Your Password →
      </a>
    </p>

    <p style="font-size: 13px; color: #666; margin-top: 25px;">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <a href="${resetLink}" style="color: #1a73e8; word-break: break-all;">${resetLink}</a>
    </p>

    <p style="font-size: 12px; color: #999; margin-top: 15px;">
      If you did not request this account, please ignore this email or contact support.
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: 'Action Required: Setup Your Biocap Account (Expires in 30 min)',
    html,
  });
}

// ─── 2. Password Reset Email ────────────────────────────────────────────────
async function sendPasswordResetEmail(email, firstName, token) {
  const resetLink = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

  const html = wrapHtml(`
    <h3 style="color: #1a73e8;">Password Reset Request</h3>
    <p>Hello ${escapeHtml(firstName || 'there')},</p>
    <p>We received a request to reset your Biocap password.</p>
    <p>Click the button below to choose a new password. This link will expire in <strong>30 minutes</strong>.</p>

    <p>
      <a href="${resetLink}"
         style="background-color: #1a73e8; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 5px; display: inline-block;
                font-weight: bold; font-size: 15px;">
        Reset My Password →
      </a>
    </p>

    <p style="font-size: 13px; color: #666; margin-top: 25px;">
      If you did not request this, you can safely ignore this email.
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: '🔐 Biocap password reset request',
    html,
  });
}

// ─── 3. Blog Approved Email ───────────────────────────────────────────────────
async function sendBlogApprovalEmail(email, firstName, blogTitle) {
  const dashboardLink = `${process.env.FRONTEND_URL}/dashboard/my-submissions`;

  const html = wrapHtml(`
    <h3 style="color: #0f9d58;">🎉 Great News, ${escapeHtml(firstName)}!</h3>
    <p>Your blog post has been <strong>reviewed and approved</strong> by our editorial team.</p>

    <div style="background: #f0fff4; padding: 15px; border-left: 4px solid #0f9d58; margin: 15px 0;">
      <strong>Blog Title:</strong> ${escapeHtml(blogTitle)}
    </div>

    <p>
      Your post is now in the <strong>approved</strong> queue and will be published to the
      live Biocap website shortly by our team.
    </p>

    <p>
      <a href="${dashboardLink}"
         style="background-color: #0f9d58; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 5px; display: inline-block;
                font-weight: bold; font-size: 15px;">
        View My Submissions →
      </a>
    </p>

    <p style="font-size: 13px; color: #666;">
      Thank you for contributing to the Biocap community!
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: `✅ Your blog "${blogTitle}" has been approved`,
    html,
  });
}

// ─── 4. Blog Rejected Email ───────────────────────────────────────────────────
async function sendBlogRejectionEmail(email, firstName, blogTitle, reviewerNote) {
  const dashboardLink = `${process.env.FRONTEND_URL}/dashboard/my-submissions`;

  const html = wrapHtml(`
    <h3 style="color: #d93025;">Blog Post Needs Revision — ${escapeHtml(firstName)}</h3>
    <p>
      Thank you for your submission. After careful review, our editorial team has
      returned your blog post for revisions.
    </p>

    <div style="background: #fff8f7; padding: 15px; border-left: 4px solid #d93025; margin: 15px 0;">
      <strong>Blog Title:</strong> ${escapeHtml(blogTitle)}<br/>
      <strong>Reviewer's Note:</strong><br/>
      <em style="color: #555;">"${escapeHtml(reviewerNote)}"</em>
    </div>

    <p>
      Your blog has been moved back to <strong>draft</strong> status. Please make the
      suggested revisions and resubmit when ready.
    </p>

    <p>
      <a href="${dashboardLink}"
         style="background-color: #1a73e8; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 5px; display: inline-block;
                font-weight: bold; font-size: 15px;">
        Edit My Blog →
      </a>
    </p>

    <p style="font-size: 13px; color: #666;">
      If you believe this decision was made in error, please contact your communications officer.
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: `📝 Your blog "${blogTitle}" needs revisions`,
    html,
  });
}

// ─── 5. Blog Published Email ──────────────────────────────────────────────────
async function sendBlogPublishedEmail(email, firstName, blogTitle, blogSlug) {
  const blogLink = `${process.env.FRONTEND_URL}/blog/${blogSlug}`;

  const html = wrapHtml(`
    <h3 style="color: #1a73e8;">🚀 Your Blog is Live, ${escapeHtml(firstName)}!</h3>
    <p>Congratulations! Your blog post has been published to the Biocap website.</p>

    <div style="background: #f0f4ff; padding: 15px; border-left: 4px solid #1a73e8; margin: 15px 0;">
      <strong>Blog Title:</strong> ${escapeHtml(blogTitle)}
    </div>

    <p>
      <a href="${blogLink}"
         style="background-color: #1a73e8; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 5px; display: inline-block;
                font-weight: bold; font-size: 15px;">
        View Live Blog Post →
      </a>
    </p>

    <p style="font-size: 13px; color: #666;">
      Share it with your audience! Thank you for contributing to Biocap.
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: `🚀 Your blog "${blogTitle}" is now live!`,
    html,
  });
}

// ─── 6. Password Changed Security Alert ──────────────────────────────────────
async function sendPasswordChangedEmail(email, firstName) {
  const html = wrapHtml(`
    <h3 style="color: #f4b400;">🔒 Security Alert — ${escapeHtml(firstName)}</h3>
    <p>Your Biocap account password was successfully changed.</p>

    <div style="background: #fffde7; padding: 15px; border-left: 4px solid #f4b400; margin: 15px 0;">
      <strong>Time:</strong> ${new Date().toUTCString()}<br/>
      <strong>Action:</strong> Password successfully updated
    </div>

    <p>
      If you did <strong>not</strong> make this change, please contact your administrator
      immediately to secure your account.
    </p>

    <p style="font-size: 13px; color: #666;">
      For security, this notification was sent to your registered email address.
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: '🔒 Your Biocap password was changed',
    html,
  });
}

// ─── 7. Editor Proposal Ready (to writer) ────────────────────────────────────
// changeLabels: short field names from summarizeChanges(), e.g. ["Title", "Content blocks (2 changed)"]
async function sendEditorProposalEmail(email, firstName, blogTitle, { editorName, changeLabels, reviewLink }) {
  const changeItems = changeLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join('');

  const html = wrapHtml(`
    <h3 style="color: #1a73e8;">Editor Changes Ready for Your Review, ${escapeHtml(firstName || 'there')}</h3>
    <p>
      <strong>${escapeHtml(editorName)}</strong> has proposed changes to your article.
      Nothing is published yet. Please accept or reject the changes.
    </p>

    <div style="background: #f0f4ff; padding: 15px; border-left: 4px solid #1a73e8; margin: 15px 0;">
      <strong>Blog Title:</strong> ${escapeHtml(blogTitle)}<br/>
      <strong>Changed:</strong>
      <ul style="margin: 8px 0 0 0;">${changeItems || '<li>No field-level changes listed</li>'}</ul>
    </div>

    <p>
      <a href="${escapeHtml(reviewLink)}"
         style="background-color: #1a73e8; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 5px; display: inline-block;
                font-weight: bold; font-size: 15px;">
        Review Editor Changes →
      </a>
    </p>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: `Review editor changes to "${blogTitle}"`,
    html,
  });
}

// ─── 8. Writer Decision on Editor Proposal (to editor) ───────────────────────
async function sendEditorProposalDecisionEmail(email, firstName, blogTitle, { approved, writerName, note, changeLabels }) {
  const accentColor = approved ? '#0f9d58' : '#d93025';
  const changeItems = changeLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join('');

  const html = wrapHtml(`
    <h3 style="color: ${accentColor};">
      ${approved ? 'Your Changes Were Accepted' : 'Your Changes Were Rejected'}, ${escapeHtml(firstName || 'there')}
    </h3>
    <p>
      <strong>${escapeHtml(writerName)}</strong>
      ${approved ? 'accepted' : 'rejected'} the editor changes you proposed.
    </p>

    <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid ${accentColor}; margin: 15px 0;">
      <strong>Blog Title:</strong> ${escapeHtml(blogTitle)}<br/>
      <strong>Status:</strong> ${approved ? 'Approved, ready for publishing' : 'Returned to draft'}<br/>
      ${changeItems ? `<strong>Proposed changes:</strong><ul style="margin: 8px 0 0 0;">${changeItems}</ul>` : ''}
      ${note ? `<strong>Writer's Note:</strong><br/><em style="color: #555;">"${escapeHtml(note)}"</em>` : ''}
    </div>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: `${approved ? 'Accepted' : 'Rejected'}: editor changes to "${blogTitle}"`,
    html,
  });
}

// ─── 9. Editor Proposal Withdrawn (to writer) ───────────────────────────────
async function sendEditorProposalWithdrawnEmail(email, firstName, blogTitle, { editorName }) {
  const html = wrapHtml(`
    <h3 style="color: #5f6368;">Editor Changes Withdrawn, ${escapeHtml(firstName || 'there')}</h3>
    <p>
      <strong>${escapeHtml(editorName)}</strong> withdrew the proposed changes to your article.
      Nothing was changed, and no decision is needed from you.
    </p>

    <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #5f6368; margin: 15px 0;">
      <strong>Blog Title:</strong> ${escapeHtml(blogTitle)}
    </div>
  `);

  await sendViaResend({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: `Editor changes withdrawn for "${blogTitle}"`,
    html,
  });
}

module.exports = {
  sendCredentialsEmail,
  sendPasswordResetEmail, // ✅ Added missing export!
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