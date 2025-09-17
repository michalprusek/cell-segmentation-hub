# Řešení problému s SMTP portem 465 na mail.utia.cas.cz

## Problém

Server mail.utia.cas.cz na portu 465 má několik nestandardních vlastností:

1. **Nestandartní SMTP banner**: Server vrací `220 SMTPD UTIA` místo standardního formátu s hostname
2. **Pomalá SSL/TLS odezva**: SSL handshake trvá 10-60 sekund
3. **Problémy s connection pooling**: Opakovaná připojení selhávají

## Implementované řešení

### 1. Extended Timeouts

Port 465 vyžaduje **120 sekund** timeout (místo standardních 5-10 sekund):

```javascript
connectionTimeout: 120000; // 2 minuty
greetingTimeout: 120000; // 2 minuty
socketTimeout: 120000; // 2 minuty
```

### 2. Specifická TLS konfigurace

```javascript
tls: {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',  // Force TLSv1.2
  ciphers: 'ECDHE-RSA-AES256-GCM-SHA384',  // Specifický cipher
  rejectUnauthorized: false  // Self-signed certifikát
}
```

### 3. Vypnutí connection pooling

Connection pooling způsobuje problémy s nestandartním bannerem:

```javascript
pool: false,
maxConnections: 1,
maxMessages: 1
```

## Implementace v emailService.ts

Kód automaticky detekuje UTIA server na portu 465 a aplikuje speciální konfiguraci:

```javascript
const isUTIAPort465 =
  config.smtp.host === 'mail.utia.cas.cz' && config.smtp.port === 465;

if (isUTIAPort465) {
  // Aplikovat speciální konfiguraci
}
```

## Alternativní řešení

Pokud port 465 přestane fungovat, lze použít **port 25 s STARTTLS**:

```bash
SMTP_PORT=25
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_AUTH=false  # Není potřeba na interní síti
```

## Testování

### Test portu 465

```bash
docker exec spheroseg-backend node -e "
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'mail.utia.cas.cz',
    port: 465,
    secure: true,
    auth: { user: 'prusek@utia.cas.cz', pass: 'M1i2c3h4a5l6' },
    tls: { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', rejectUnauthorized: false },
    connectionTimeout: 120000,
    greetingTimeout: 120000,
    socketTimeout: 120000
  });
  transporter.verify().then(() => console.log('✅ SUCCESS')).catch(e => console.error('❌', e.message));
"
```

### Test portu 25 (záložní)

```bash
docker exec spheroseg-backend node -e "
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'mail.utia.cas.cz',
    port: 25,
    secure: false,
    requireTLS: true,
    auth: false,
    tls: { rejectUnauthorized: false }
  });
  transporter.verify().then(() => console.log('✅ SUCCESS')).catch(e => console.error('❌', e.message));
"
```

## Známé problémy a jejich řešení

| Problém               | Příčina                  | Řešení                   |
| --------------------- | ------------------------ | ------------------------ |
| SSL handshake timeout | Krátký timeout           | Zvýšit na 120 sekund     |
| "Connection closed"   | Connection pooling       | Vypnout pooling          |
| "Invalid greeting"    | Nestandartní banner      | Použít port 25           |
| Autentizace selhává   | Port 25 nepotřebuje auth | Nastavit SMTP_AUTH=false |

## Monitoring

Při problémech zkontrolovat logy:

```bash
docker logs spheroseg-backend | grep -i smtp
```

Zapnout debug mode:

```bash
SMTP_DEBUG=true
EMAIL_DEBUG=true
```

## Závěr

Port 465 na mail.utia.cas.cz **funguje**, ale vyžaduje:

1. ✅ **2minutové timeouty**
2. ✅ **Specifickou TLS konfiguraci** (TLSv1.2 only)
3. ✅ **Vypnutý connection pooling**
4. ✅ **Specifický cipher** (ECDHE-RSA-AES256-GCM-SHA384)

Toto řešení bylo úspěšně otestováno a implementováno do `backend/src/services/emailService.ts`.
