const nodemailer = require('nodemailer');

async function testUtiaSMTP() {
  console.log('Testing UTIA SMTP configuration...');
  console.log('Host: mail.utia.cas.cz');
  console.log('Port: 465');
  console.log('Secure: true');
  console.log('');

  const transporter = nodemailer.createTransporter({
    host: 'mail.utia.cas.cz',
    port: 465,
    secure: true,
    tls: {
      rejectUnauthorized: false, // Accept self-signed certificates
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  try {
    console.log('Verifying connection...');
    await transporter.verify();
    console.log('✅ SMTP connection successful!');

    console.log('\nSending test email...');
    const info = await transporter.sendMail({
      from: '"SpheroSeg Platform" <spheroseg@utia.cas.cz>',
      to: 'prusemic@cvut.cz',
      subject: 'Test Email from SpheroSeg',
      text: 'This is a test email from SpheroSeg platform using UTIA SMTP server.',
      html:
        '<h2>Test Email</h2><p>This is a test email from SpheroSeg platform using UTIA SMTP server.</p><p>Sent at: ' +
        new Date().toISOString() +
        '</p>',
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.response) {
      console.error('SMTP Response:', error.response);
    }
    console.error('\nFull error:', error);
  }
}

testUtiaSMTP();
