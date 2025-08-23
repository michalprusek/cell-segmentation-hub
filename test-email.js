const nodemailer = require('nodemailer');

async function sendTestEmail() {
  const transporter = nodemailer.createTransporter({
    host: 'mailhog-blue',
    port: 1025,
    secure: false,
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: 'spheroseg@utia.cas.cz',
      to: 'test@example.com',
      subject: 'Test Email from SpheroSeg',
      text: 'This is a test email from SpheroSeg application.',
      html: '<h1>Test Email</h1><p>This is a test email from SpheroSeg application.</p>',
    });
    console.log('Email sent successfully:', info);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

sendTestEmail();
