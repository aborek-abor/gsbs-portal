const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The address you send FROM. Resend's shared sandbox address
// (onboarding@resend.dev) works out of the box but can only deliver to the
// email you signed up to Resend with, fine for testing, not for real
// applicants. Once you verify your own domain in Resend, set
// RESEND_FROM_EMAIL to something like "GSBS <no-reply@yourdomain.org>" and
// it'll send to anyone.
const FROM = process.env.RESEND_FROM_EMAIL || 'GSBS <onboarding@resend.dev>';

async function sendPasscodeResetEmail(toEmail, resetUrl) {
  if (!resend) {
    console.warn('RESEND_API_KEY is not set, skipping actual email send. Reset URL was:', resetUrl);
    return { skipped: true };
  }
  return resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Reset your GSBS member passcode',
    html: `
      <p>Someone (hopefully you) requested a passcode reset for your GSBS membership account.</p>
      <p><a href="${resetUrl}">Click here to set a new passcode</a>. This link works once and expires in 30 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email, your passcode will not change.</p>
    `,
  });
}

module.exports = { sendPasscodeResetEmail, sendCertificateEmail };

async function sendCertificateEmail(toEmail, memberName, pdfBuffer) {
  if (!resend) {
    console.warn('RESEND_API_KEY is not set, skipping actual email send. Certificate was generated but not emailed.');
    return { skipped: true };
  }
  return resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Your GSBS Certificate of Competence',
    html: `
      <p>Dear ${memberName},</p>
      <p>Congratulations, your GSBS Certificate of Competence is attached to this email.</p>
      <p>Please keep a copy for your records.</p>
      <p>Ghanaian Society for Biomedical Scientists</p>
    `,
    attachments: [
      {
        filename: 'GSBS_Certificate_of_Competence.pdf',
        content: pdfBuffer.toString('base64'),
      },
    ],
  });
}
