const nodemailer = require('nodemailer');

// Configure once, reuse across requests
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_SERVER,
  port: Number(process.env.MAIL_PORT) || 587,
  secure: false, // uses STARTTLS, same as MAIL_STARTTLS=True in the Python config
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD,
  },
});

/**
 * Sends the registration email containing the temporary password
 * and a link/token to reset it, mirroring send_credentials_email() in FastAPI.
 */
async function sendCredentialsEmail(email, firstName, tempPassword, token) {
  // Point this at wherever your reset-password UI/endpoint lives
  const resetLink = `http://localhost:5000/api-docs/#/Auth/post_api_auth_reset_password`;

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h3 style="color: #1a73e8;">Welcome to Biocap, ${firstName}!</h3>
        <p>Your account has been successfully registered.</p>

        <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #1a73e8; margin: 15px 0;">
          <strong>Your Temporary Credentials:</strong><br/>
          &bull; <strong>Email:</strong> ${email}<br/>
          &bull; <strong>Temporary Password:</strong> <code>${tempPassword}</code>
        </div>

        <p style="color: #d93025; font-weight: bold;">
          Action Required: You must reset your temporary password before logging in.
        </p>

        <p>
          <a href="${resetLink}" style="background-color: #1a73e8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            Reset Your Password
          </a>
        </p>

        <p style="font-size: 12px; color: #666; margin-top: 25px;">
          If the button above doesn't work, use this token manually with the
          <code>/api/auth/reset-password</code> endpoint:<br/>
          <code style="background: #eee; padding: 2px 5px; display: block; word-break: break-all;">${token}</code>
        </p>
      </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: email,
    subject: 'Action Required: Setup Your Account Credentials',
    html,
  });
}

module.exports = { sendCredentialsEmail };