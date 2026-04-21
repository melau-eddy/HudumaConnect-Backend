const nodemailer = require('nodemailer');

/**
 * Email service for sending notifications
 */
class EmailService {
  constructor() {
    this.transporter = this.createTransporter();
  }

  /**
 * Create nodemailer transporter
 * @returns {Object} Nodemailer transporter
 */
  createTransporter() {
    if (process.env.NODE_ENV === 'development') {
      // For development, log emails to console
      return {
        sendMail: (options) => {
          console.log('📧 Email would be sent in production:');
          console.log('To:', options.to);
          console.log('Subject:', options.subject);
          console.log('Text:', options.text);
          console.log('HTML:', options.html);
          return Promise.resolve({ messageId: 'dev-mode' });
        }
      };
    }

    // Production transporter
    return nodemailer.createTransporter({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  /**
   * Send email
   * @param {Object} options - Email options
   * @returns {Promise} Send result
   */
  async sendEmail(options) {
    const mailOptions = {
      from: `${process.env.FROM_NAME || 'HudumaConnect'} <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('📧 Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email send error:', error);
      throw error;
    }
  }

  /**
   * Send welcome email
   * @param {Object} user - User object
   * @param {string} verificationUrl - Email verification URL
   */
  async sendWelcomeEmail(user, verificationUrl) {
    const subject = 'Welcome to HudumaConnect!';
    const message = `
      Hi ${user.name},

      Welcome to HudumaConnect - your local service provider platform!

      Please verify your email address by clicking the link below:
      ${verificationUrl}

      This link will expire in 24 hours.

      Best regards,
      HudumaConnect Team
    `;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Welcome to HudumaConnect!</h2>
        <p>Hi ${user.name},</p>
        <p>Welcome to HudumaConnect - your local service provider platform!</p>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}"
           style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
          Verify Email Address
        </a>
        <p><small>This link will expire in 24 hours.</small></p>
        <hr>
        <p>Best regards,<br>HudumaConnect Team</p>
      </div>
    `;

    return this.sendEmail({
      email: user.email,
      subject,
      message,
      html
    });
  }

  /**
   * Send password reset email
   * @param {Object} user - User object
   * @param {string} resetUrl - Password reset URL
   */
  async sendPasswordResetEmail(user, resetUrl) {
    const subject = 'Password Reset Request - HudumaConnect';
    const message = `
      Hi ${user.name},

      You are receiving this email because you (or someone else) has requested a password reset for your HudumaConnect account.

      Please click the link below to reset your password:
      ${resetUrl}

      This link will expire in 10 minutes.

      If you did not request this, please ignore this email and your password will remain unchanged.

      Best regards,
      HudumaConnect Team
    `;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Password Reset Request</h2>
        <p>Hi ${user.name},</p>
        <p>You are receiving this email because you (or someone else) has requested a password reset for your HudumaConnect account.</p>
        <p>Please click the button below to reset your password:</p>
        <a href="${resetUrl}"
           style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
          Reset Password
        </a>
        <p><small>This link will expire in 10 minutes.</small></p>
        <p><strong>If you did not request this, please ignore this email and your password will remain unchanged.</strong></p>
        <hr>
        <p>Best regards,<br>HudumaConnect Team</p>
      </div>
    `;

    return this.sendEmail({
      email: user.email,
      subject,
      message,
      html
    });
  }

  /**
   * Send email verification email
   * @param {Object} user - User object
   * @param {string} verificationUrl - Email verification URL
   */
  async sendEmailVerification(user, verificationUrl) {
    const subject = 'Verify Your Email - HudumaConnect';
    const message = `
      Hi ${user.name},

      Please verify your email address by clicking the link below:
      ${verificationUrl}

      This link will expire in 24 hours.

      Best regards,
      HudumaConnect Team
    `;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Verify Your Email</h2>
        <p>Hi ${user.name},</p>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}"
           style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
          Verify Email Address
        </a>
        <p><small>This link will expire in 24 hours.</small></p>
        <hr>
        <p>Best regards,<br>HudumaConnect Team</p>
      </div>
    `;

    return this.sendEmail({
      email: user.email,
      subject,
      message,
      html
    });
  }

  /**
   * Send security alert email (account locked, suspicious activity, etc.)
   * @param {Object} user - User object
   * @param {Object} details - Security alert details
   */
  async sendSecurityAlert(user, details) {
    const subject = '🔐 Security Alert - HudumaConnect Account';
    const reason = details.reason || 'Unusual activity detected on your account';
    const timestamp = details.timestamp || new Date().toISOString();
    const unlockTime = details.unlockTime || 'Within 30 minutes';

    const message = `
      Hi ${user.name},

      We detected a security event on your HudumaConnect account:

      Reason: ${reason}
      Time: ${new Date(timestamp).toLocaleString()}

      If this was not you, please contact our support team immediately.

      Account Status: Your account will be unlocked automatically at ${unlockTime}

      For security, do not share your password with anyone.

      Best regards,
      HudumaConnect Security Team
    `;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #fee2e2; border-left: 4px solid #dc2626; padding: 16px; margin-bottom: 16px; border-radius: 4px;">
          <h2 style="color: #dc2626; margin-top: 0;">🔐 Security Alert</h2>
          <p>We detected a security event on your HudumaConnect account.</p>
        </div>

        <div style="background-color: #f3f4f6; padding: 16px; margin-bottom: 16px; border-radius: 4px;">
          <p><strong>Alert Details:</strong></p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</p>
          <p><strong>Account Status:</strong> Account will be unlocked automatically at <strong>${unlockTime}</strong></p>
        </div>

        <p style="color: #dc2626;"><strong>If this was not you:</strong> Please contact our support team immediately.</p>
        <p><small>For security, do not share your password with anyone, even with HudumaConnect staff.</small></p>

        <hr>
        <p>Best regards,<br>HudumaConnect Security Team</p>
      </div>
    `;

    return this.sendEmail({
      email: user.email,
      subject,
      message,
      html
    });
  }
}

module.exports = new EmailService();