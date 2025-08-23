import nodemailer from 'nodemailer';

async function testEmail() {
  console.log('Testing UTIA SMTP from backend...');

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
    console.log('Verifying connection...');
    await transporter.verify();
    console.log('✅ Connection verified!');

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
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Details:', error);
  }
}

testEmail();
