const nodemailer = require('nodemailer');

async function testEmail() {
  console.log('Testing UTIA SMTP...');
  console.log('Host: mail.utia.cas.cz');
  console.log('Port: 25');
  console.log('STARTTLS: yes');
  console.log('');

  const transporter = nodemailer.createTransporter({
    host: 'mail.utia.cas.cz',
    port: 25,
    secure: false,
    requireTLS: true,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
  });

  try {
    console.log('1. Verifying connection...');
    await transporter.verify();
    console.log('✅ Connection verified!');

    console.log('\n2. Sending email...');
    const info = await transporter.sendMail({
      from: '"SpheroSeg Platform" <spheroseg@utia.cas.cz>',
      to: 'prusemic@cvut.cz',
      subject: 'Test Email from SpheroSeg - UTIA SMTP Working!',
      text: 'This is a test email from SpheroSeg platform.\n\nUTIA SMTP is now configured correctly!',
      html:
        '<h2>Test Email from SpheroSeg</h2><p>UTIA SMTP is now configured correctly!</p><p>Sent at: ' +
        new Date().toISOString() +
        '</p>',
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('\n📧 Email should arrive in your inbox shortly!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) console.error('Code:', error.code);
    if (error.response) console.error('Response:', error.response);
    console.error('\nFull error:', error);
  }
}

testEmail();
