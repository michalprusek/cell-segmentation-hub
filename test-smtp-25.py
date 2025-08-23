#!/usr/bin/env python3
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def test_smtp_25():
    """Test SMTP connection on port 25 with optional STARTTLS"""
    
    smtp_server = "mail.utia.cas.cz"
    port = 25
    sender = "spheroseg@utia.cas.cz"
    
    print(f"Testing SMTP server: {smtp_server}:{port}")
    print("=" * 50)
    
    try:
        print("1. Creating SMTP connection (plain)...")
        server = smtplib.SMTP(smtp_server, port, timeout=10)
        server.set_debuglevel(2)  # Enable debug output
        
        print("\n2. Connection established!")
        
        print("\n3. Sending EHLO...")
        code, response = server.ehlo()
        print(f"   Response code: {code}")
        print(f"   Response: {response.decode() if isinstance(response, bytes) else response}")
        
        print("\n4. Server features:")
        for feature in server.esmtp_features:
            print(f"   - {feature}: {server.esmtp_features[feature]}")
        
        # Check for STARTTLS support
        if "STARTTLS" in server.esmtp_features or "starttls" in server.esmtp_features:
            print("\n5. STARTTLS supported, upgrading connection...")
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            server.starttls(context=context)
            server.ehlo()  # Re-identify after STARTTLS
            print("✅ Connection upgraded to TLS")
        else:
            print("\n5. STARTTLS not supported, continuing with plain connection")
        
        # Check authentication requirements
        if "AUTH" in server.esmtp_features:
            print(f"\n⚠️  Server supports authentication: {server.esmtp_features['AUTH']}")
        else:
            print("\n✅ No authentication required/supported")
        
        # Try to send a test email
        print("\n6. Attempting to send test email...")
        
        message = MIMEMultipart()
        message["From"] = sender
        message["To"] = "test@example.com"
        message["Subject"] = "SMTP Test"
        
        body = "This is a test email to verify SMTP configuration."
        message.attach(MIMEText(body, "plain"))
        
        try:
            # Try to send without authentication
            refused = server.send_message(message)
            if refused:
                print(f"⚠️  Some recipients refused: {refused}")
            else:
                print("✅ Email accepted for delivery!")
        except smtplib.SMTPRecipientsRefused as e:
            print(f"❌ Recipients refused: {e}")
            print("\nServer rejected all recipients")
        except smtplib.SMTPSenderRefused as e:
            print(f"❌ Sender refused: {e}")
            print(f"\nServer rejected sender address: {sender}")
        except smtplib.SMTPDataError as e:
            print(f"❌ Data error: {e}")
            print("\nServer rejected message data")
        except smtplib.SMTPException as e:
            print(f"❌ SMTP error: {e}")
            print("\nPossible reasons:")
            print("- Authentication required")
            print("- Relay not permitted from this IP")
            print("- IP not whitelisted")
        
        server.quit()
        print("\n7. Connection closed successfully")
        
    except smtplib.SMTPServerDisconnected as e:
        print(f"❌ Server disconnected: {e}")
        print("\nServer closed connection immediately")
        print("Possible reasons:")
        print("- IP address blocked/not whitelisted")
        print("- Firewall rules")
        print("- Server policy (only accepts mail from specific hosts)")
    except ConnectionRefusedError:
        print(f"❌ Connection refused on port {port}")
        print("\nPort might be blocked or service not running")
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        print(f"   Error type: {type(e).__name__}")

if __name__ == "__main__":
    test_smtp_25()