const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_SERVER,
  port: Number(process.env.MAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD,
  },
});

async function sendCredentialsEmail(email, firstName, tempPassword, token) {
  // ✅ Points to your real frontend reset-password page
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto;">
        <h3 style="color: #1a73e8;">Welcome to Biocap, ${firstName}!</h3>
        <p>Your account has been successfully registered.</p>

        <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #1a73e8; margin: 15px 0;">
          <strong>Your Temporary Credentials:</strong><br/>
          &bull; <strong>Email:</strong> ${email}<br/>
          &bull; <strong>Temporary Password:</strong> <code style="font-size: 15px;">${tempPassword}</code>
        </div>

        <!-- ⏰ Expiry warning -->
        <p style="color: #d93025; font-weight: bold;">
          ⚠️ Action Required: This temporary password expires in <u>30 minutes</u>.
          You must reset it before logging in.
        </p>

        <!-- Instructions -->
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

        <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;"/>
        <p style="font-size: 12px; color: #999;">
          If you did not request this account, please ignore this email or contact support.
        </p>
      </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: 'Action Required: Setup Your Biocap Account (Expires in 30 min)',
    html,
  });
}

module.exports = { sendCredentialsEmail };