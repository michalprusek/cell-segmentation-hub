import nodemailer from 'nodemailer';

async function testEmail() {
  console.log('Testing UTIA SMTP from SpheroSeg backend...');
  console.log('Configuration:');
  console.log('  Host: mail.utia.cas.cz');
  console.log('  Port: 25');
  console.log('  Security: STARTTLS');
  console.log('  Auth: None');
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
    console.log('1. Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ Connection successful!');

    console.log('\n2. Sending test email to prusemic@cvut.cz...');
    const info = await transporter.sendMail({
      from: '"SpheroSeg Platform" <spheroseg@utia.cas.cz>',
      to: 'prusemic@cvut.cz',
      subject: '✅ SpheroSeg Email Working - UTIA SMTP Configured!',
      text: 'Test Email from SpheroSeg - UTIA SMTP is working correctly!',
      html: '<h2>✅ SpheroSeg Email Working!</h2><p>UTIA SMTP is configured correctly.</p>',
    });

    console.log('\n✅ EMAIL SENT SUCCESSFULLY!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('\n📧 Check your inbox at prusemic@cvut.cz');
  } catch (error) {
    console.error('\n❌ EMAIL FAILED!');
    console.error('Error:', error.message);
  }
}

testEmail();
