const nodemailer = require('nodemailer');

async function testEmail() {
  console.log('Testing nodemailer with simple config...\n');

  const transporter = nodemailer.createTransporter({
    host: 'mail.utia.cas.cz',
    port: 25,
    secure: false,
    ignoreTLS: true, // Try ignoring TLS completely
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });

  try {
    console.log('Testing connection...');
    await transporter.verify();
    console.log('✅ Connection verified!');

    console.log('\nSending test email...');
    const info = await transporter.sendMail({
      from: '"SpheroSeg" <spheroseg@utia.cas.cz>',
      to: 'prusemic@cvut.cz',
      subject: 'Test from Docker Container',
      text: 'Simple test email from nodemailer',
    });

    console.log('✅ Email sent!');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testEmail();
