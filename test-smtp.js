import nodemailer from 'nodemailer';

async function testSMTP() {
  console.log('Testing SMTP connection to mail.utia.cas.cz...');

  const transporter = nodemailer.createTransporter({
    host: 'mail.utia.cas.cz',
    port: 25,
    secure: false,
    requireTLS: true,
    auth: {
      user: 'prusek@utia.cas.cz',
      pass: 'M1i2c3h4a5l6',
    },
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 60000,
    greetingTimeout: 60000,
    socketTimeout: 60000,
    logger: true,
    debug: true,
  });

  try {
    console.log('Verifying connection...');
    await transporter.verify();
    console.log('Connection verified successfully!');

    console.log('Sending test email...');
    const info = await transporter.sendMail({
      from: '"Test" <prusek@utia.cas.cz>',
      to: 'prusemic@cvut.cz',
      subject: 'Test Email from Node.js',
      text: 'This is a test email sent via UTIA SMTP server.',
      html: '<b>This is a test email sent via UTIA SMTP server.</b>',
    });

    console.log('Email sent successfully!');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('Error:', error);
  }
}

testSMTP();
