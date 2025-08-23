const net = require('net');

console.log('Testing direct SMTP connection to mail.utia.cas.cz:25...\n');

const client = net.createConnection(25, 'mail.utia.cas.cz', () => {
  console.log('✅ Connected to SMTP server!');
  console.log('Sending HELO command...');
  client.write('HELO spherosegapp.utia.cas.cz\r\n');
});

client.on('data', data => {
  console.log('Server response:', data.toString().trim());

  if (data.toString().includes('250')) {
    if (!client.destroyed) {
      console.log('Sending QUIT command...');
      client.write('QUIT\r\n');
      setTimeout(() => {
        client.end();
        console.log('\n✅ SMTP test successful!');
        process.exit(0);
      }, 1000);
    }
  }
});

client.on('error', err => {
  console.error('❌ Connection error:', err.message);
  process.exit(1);
});

client.on('end', () => {
  console.log('Connection closed');
});

setTimeout(() => {
  console.error('\n❌ Timeout - no response from server');
  client.destroy();
  process.exit(1);
}, 10000);
