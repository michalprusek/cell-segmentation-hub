const nodemailer = require('./node_modules/nodemailer');

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
      text: `
Test Email from SpheroSeg Platform
===================================

This email confirms that UTIA SMTP is working correctly!

Configuration:
- SMTP Server: mail.utia.cas.cz
- Port: 25
- Security: STARTTLS
- Authentication: None

Sent at: ${new Date().toISOString()}

--
SpheroSeg Platform
https://spherosegapp.utia.cas.cz
      `,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #2563eb;">✅ SpheroSeg Email System Working!</h2>
  
  <p>This email confirms that UTIA SMTP is configured correctly.</p>
  
  <div style="background: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
    <h3 style="margin-top: 0;">Configuration Details:</h3>
    <ul>
      <li>SMTP Server: mail.utia.cas.cz</li>
      <li>Port: 25</li>
      <li>Security: STARTTLS</li>
      <li>Authentication: None</li>
    </ul>
  </div>
  
  <p style="color: #6b7280; font-size: 14px;">
    Sent at: ${new Date().toISOString()}<br>
    From: SpheroSeg Platform<br>
    <a href="https://spherosegapp.utia.cas.cz">https://spherosegapp.utia.cas.cz</a>
  </p>
</div>
      `,
    });

    console.log('\n✅ EMAIL SENT SUCCESSFULLY!');
    console.log('=====================================');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('=====================================');
    console.log('\n📧 Check your inbox at prusemic@cvut.cz');
  } catch (error) {
    console.error('\n❌ EMAIL FAILED!');
    console.error('=====================================');
    console.error('Error:', error.message);
    if (error.code) console.error('Code:', error.code);
    if (error.response) console.error('Response:', error.response);
    console.error('=====================================');
    console.error('\nPossible issues:');
    console.error('- IP not whitelisted by UTIA');
    console.error('- Firewall blocking connection');
    console.error('- SMTP server policy restrictions');
  }
}

testEmail();
