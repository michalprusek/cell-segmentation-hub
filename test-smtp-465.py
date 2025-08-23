#!/usr/bin/env python3
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def test_smtp_465():
    """Test SMTP connection on port 465 with SSL"""
    
    smtp_server = "mail.utia.cas.cz"
    port = 465
    sender = "spheroseg@utia.cas.cz"
    
    print(f"Testing SMTP server: {smtp_server}:{port}")
    print("=" * 50)
    
    # Create SSL context
    context = ssl.create_default_context()
    # Disable certificate verification for testing
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    
    try:
        print("1. Creating SMTP_SSL connection...")
        server = smtplib.SMTP_SSL(smtp_server, port, context=context, timeout=30)
        server.set_debuglevel(2)  # Enable debug output
        
        print("\n2. Connection established!")
        print(f"   Server: {server.sock.getpeername()}")
        
        print("\n3. Sending EHLO...")
        server.ehlo()
        
        print("\n4. Server features:")
        for feature in server.esmtp_features:
            print(f"   - {feature}")
        
        # Check if authentication is required
        if "AUTH" in server.esmtp_features:
            print("\n⚠️  Server requires authentication!")
            print("   Supported methods:", server.esmtp_features.get("AUTH", ""))
        else:
            print("\n✅ Server does not require authentication")
        
        # Try to send a test email without auth
        print("\n5. Attempting to send test email...")
        
        message = MIMEMultipart()
        message["From"] = sender
        message["To"] = "test@example.com"
        message["Subject"] = "SMTP Test"
        
        body = "This is a test email to verify SMTP configuration."
        message.attach(MIMEText(body, "plain"))
        
        try:
            server.send_message(message)
            print("✅ Email sent successfully!")
        except smtplib.SMTPException as e:
            print(f"❌ Failed to send email: {e}")
            print("\nPossible reasons:")
            print("- Authentication required")
            print("- Sender address not allowed")
            print("- Relay not permitted from this IP")
        
        server.quit()
        print("\n6. Connection closed successfully")
        
    except smtplib.SMTPAuthenticationError as e:
        print(f"❌ Authentication error: {e}")
        print("\nServer requires authentication with username/password")
    except smtplib.SMTPServerDisconnected as e:
        print(f"❌ Server disconnected: {e}")
        print("\nPossible reasons:")
        print("- IP not whitelisted")
        print("- Connection blocked by firewall")
        print("- Server policy rejection")
    except smtplib.SMTPException as e:
        print(f"❌ SMTP error: {e}")
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        print(f"   Error type: {type(e).__name__}")

if __name__ == "__main__":
    test_smtp_465()