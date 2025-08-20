# SSL Certificates

This directory should contain SSL certificates for the nginx server.

## Generating Certificates

For development/testing, you can generate self-signed certificates:

```bash
# From the repository root
./backend/scripts/generate-ssl-certs.sh
```

For production, use certificates from a trusted Certificate Authority (CA) or Let's Encrypt.

## Required Files

- `server.crt` - The SSL certificate
- `server.key` - The private key (keep this secure!)

## Security Notes

- Never commit actual certificates to version control
- Set appropriate permissions: `chmod 600 server.key` and `chmod 644 server.crt`
- Rotate certificates regularly in production