#!/usr/bin/env python3
"""
OWASP ZAP Baseline Security Scan
Automated security testing script for SphereSeg application.
"""

import os
import sys
import json
import time
import shutil
import requests
import subprocess
from typing import Dict, List, Optional
from pathlib import Path

class ZAPSecurityScanner:
    """OWASP ZAP security scanner wrapper."""
    
    def __init__(self, 
                 target_url: str = "http://localhost:3000",
                 api_url: str = "http://localhost:3001",
                 zap_port: int = 8090):
        self.target_url = target_url
        self.api_url = api_url
        self.zap_port = zap_port
        self.zap_url = f"http://localhost:{zap_port}"
        self.api_key = self._generate_api_key()
        
        # Test URLs to scan
        self.urls_to_scan = [
            f"{target_url}/",
            f"{target_url}/login",
            f"{target_url}/register",
            f"{target_url}/dashboard",
            f"{api_url}/health",
            f"{api_url}/api/endpoints",
        ]
        
        # Authentication details
        self.test_user = {
            "email": f"security-test-{int(time.time())}@example.com",
            "password": "SecurityTest123!",
            "firstName": "Security",
            "lastName": "Test"
        }
        
    def _generate_api_key(self) -> str:
        """Generate ZAP API key."""
        return "security-test-key-" + str(int(time.time()))
    
    def check_zap_installation(self) -> bool:
        """Check if OWASP ZAP is installed and available."""
        zap_executable = shutil.which("zap.sh") or shutil.which("zap.bat") or shutil.which("zap")
        if not zap_executable:
            print("❌ OWASP ZAP not found in PATH")
            print("Please install OWASP ZAP and ensure it's in your PATH")
            print("Download from: https://www.zaproxy.org/download/")
            return False
        
        print(f"✅ OWASP ZAP found at: {zap_executable}")
        return True
    
    def start_zap_daemon(self) -> bool:
        """Start ZAP in daemon mode."""
        # Check ZAP installation first
        if not self.check_zap_installation():
            return False
            
        try:
            # Determine ZAP executable based on platform
            zap_cmd = "zap.bat" if sys.platform == "win32" else "zap.sh"
            if not shutil.which(zap_cmd):
                zap_cmd = "zap"  # Fallback to generic zap command
            
            cmd = [
                zap_cmd,
                "-daemon",
                "-port", str(self.zap_port),
                "-config", f"api.key={self.api_key}",
                "-config", "api.addrs.addr.name=.*",
                "-config", "api.addrs.addr.regex=true"
            ]
            
            print(f"Starting OWASP ZAP daemon on port {self.zap_port}...")
            self.zap_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Wait for ZAP to start
            for _ in range(30):  # Wait up to 30 seconds
                try:
                    response = requests.get(f"{self.zap_url}/JSON/core/view/version/")
                    if response.status_code == 200:
                        print("✅ ZAP daemon started successfully")
                        return True
                except requests.exceptions.ConnectionError:
                    time.sleep(1)
                    
            print("❌ Failed to start ZAP daemon")
            return False
            
        except Exception as e:
            print(f"❌ Error starting ZAP: {e}")
            return False
    
    def stop_zap_daemon(self):
        """Stop ZAP daemon."""
        if hasattr(self, 'zap_process'):
            try:
                # Send shutdown command to ZAP
                requests.get(
                    f"{self.zap_url}/JSON/core/action/shutdown/",
                    params={"apikey": self.api_key}
                )
                self.zap_process.wait(timeout=10)
                print("✅ ZAP daemon stopped")
            except Exception as e:
                print(f"⚠️ Error stopping ZAP gracefully: {e}")
                self.zap_process.terminate()
    
    def setup_test_user(self) -> Optional[str]:
        """Create test user for authenticated scanning."""
        try:
            # Check if API is accessible
            health_response = requests.get(f"{self.api_url}/health", timeout=5)
            if health_response.status_code != 200:
                print(f"⚠️ API health check failed: {health_response.status_code}")
                print("Continuing without authentication...")
                return None
                
        except requests.exceptions.RequestException as e:
            print(f"⚠️ Cannot reach API at {self.api_url}: {e}")
            print("Continuing without authentication...")
            return None
            
        try:
            # Register test user
            register_data = {
                "email": self.test_user["email"],
                "password": self.test_user["password"],
                "firstName": self.test_user["firstName"],
                "lastName": self.test_user["lastName"]
            }
            
            response = requests.post(
                f"{self.api_url}/api/auth/register",
                json=register_data,
                timeout=10
            )
            
            if response.status_code in [201, 409]:  # Created or already exists
                # Login to get token
                login_data = {
                    "email": self.test_user["email"],
                    "password": self.test_user["password"]
                }
                
                try:
                    login_response = requests.post(
                        f"{self.api_url}/api/auth/login",
                        json=login_data,
                        timeout=10
                    )
                    
                    if login_response.status_code == 200:
                        token_data = login_response.json()
                        if "data" in token_data and "accessToken" in token_data["data"]:
                            token = token_data["data"]["accessToken"]
                            print("✅ Test user authenticated successfully")
                            return token
                        else:
                            print("⚠️ Unexpected login response format")
                            return None
                    else:
                        print(f"⚠️ Login failed with status: {login_response.status_code}")
                        if login_response.headers.get('content-type', '').startswith('application/json'):
                            print(f"Response: {login_response.json()}")
                        return None
                        
                except requests.exceptions.RequestException as e:
                    print(f"⚠️ Login request failed: {e}")
                    return None
                    
            else:
                print(f"⚠️ Registration failed with status: {response.status_code}")
                if response.headers.get('content-type', '').startswith('application/json'):
                    print(f"Response: {response.json()}")
                return None
                
        except requests.exceptions.RequestException as e:
            print(f"⚠️ Registration request failed: {e}")
            return None
        except Exception as e:
            print(f"❌ Error setting up test user: {e}")
            return None
    
    def configure_authentication(self, auth_token: str):
        """Configure ZAP for authenticated scanning."""
        try:
            # Set up authentication header
            headers_data = {
                "apikey": self.api_key,
                "site": self.target_url,
                "name": "Authorization",
                "value": f"Bearer {auth_token}",
                "enabled": "true"
            }
            
            response = requests.get(
                f"{self.zap_url}/JSON/replacer/action/addRule/",
                params=headers_data
            )
            
            if response.status_code == 200:
                print("✅ Authentication configured")
                return True
            else:
                print("⚠️ Failed to configure authentication")
                return False
                
        except Exception as e:
            print(f"❌ Error configuring authentication: {e}")
            return False
    
    def spider_scan(self) -> bool:
        """Run spider scan to discover URLs."""
        try:
            print("🕷️ Starting spider scan...")
            
            # Start spider scan
            response = requests.get(
                f"{self.zap_url}/JSON/spider/action/scan/",
                params={
                    "apikey": self.api_key,
                    "url": self.target_url
                }
            )
            
            if response.status_code != 200:
                print("❌ Failed to start spider scan")
                return False
            
            scan_id = response.json()["scan"]
            
            # Wait for spider scan to complete
            while True:
                status_response = requests.get(
                    f"{self.zap_url}/JSON/spider/view/status/",
                    params={
                        "apikey": self.api_key,
                        "scanId": scan_id
                    }
                )
                
                if status_response.status_code == 200:
                    status = int(status_response.json()["status"])
                    print(f"Spider scan progress: {status}%")
                    
                    if status >= 100:
                        break
                        
                time.sleep(2)
            
            # Get discovered URLs
            urls_response = requests.get(
                f"{self.zap_url}/JSON/spider/view/results/",
                params={
                    "apikey": self.api_key,
                    "scanId": scan_id
                }
            )
            
            if urls_response.status_code == 200:
                urls = urls_response.json()["results"]
                print(f"✅ Spider scan completed. Found {len(urls)} URLs")
                return True
            
            return False
            
        except Exception as e:
            print(f"❌ Error during spider scan: {e}")
            return False
    
    def active_scan(self) -> Dict:
        """Run active security scan."""
        try:
            print("🔍 Starting active security scan...")
            
            # Start active scan on target
            response = requests.get(
                f"{self.zap_url}/JSON/ascan/action/scan/",
                params={
                    "apikey": self.api_key,
                    "url": self.target_url
                }
            )
            
            if response.status_code != 200:
                print("❌ Failed to start active scan")
                return {}
            
            scan_id = response.json()["scan"]
            
            # Wait for active scan to complete
            while True:
                status_response = requests.get(
                    f"{self.zap_url}/JSON/ascan/view/status/",
                    params={
                        "apikey": self.api_key,
                        "scanId": scan_id
                    }
                )
                
                if status_response.status_code == 200:
                    status = int(status_response.json()["status"])
                    print(f"Active scan progress: {status}%")
                    
                    if status >= 100:
                        break
                        
                time.sleep(5)
            
            print("✅ Active scan completed")
            return {"scan_id": scan_id}
            
        except Exception as e:
            print(f"❌ Error during active scan: {e}")
            return {}
    
    def get_alerts(self) -> List[Dict]:
        """Get security alerts from ZAP."""
        try:
            response = requests.get(
                f"{self.zap_url}/JSON/core/view/alerts/",
                params={
                    "apikey": self.api_key,
                    "baseurl": self.target_url
                }
            )
            
            if response.status_code == 200:
                alerts = response.json()["alerts"]
                print(f"📊 Found {len(alerts)} security alerts")
                return alerts
            
            return []
            
        except Exception as e:
            print(f"❌ Error getting alerts: {e}")
            return []
    
    def generate_report(self, alerts: List[Dict], output_file: str):
        """Generate security report."""
        try:
            # Categorize alerts by risk level
            risk_counts = {"High": 0, "Medium": 0, "Low": 0, "Informational": 0}
            categorized_alerts = {"High": [], "Medium": [], "Low": [], "Informational": []}
            
            for alert in alerts:
                risk = alert.get("risk", "Low")
                risk_counts[risk] += 1
                categorized_alerts[risk].append(alert)
            
            # Generate HTML report
            html_response = requests.get(
                f"{self.zap_url}/OTHER/core/other/htmlreport/",
                params={"apikey": self.api_key}
            )
            
            if html_response.status_code == 200:
                with open(f"{output_file}.html", "w") as f:
                    f.write(html_response.text)
                print(f"✅ HTML report saved to {output_file}.html")
            
            # Generate JSON report
            report = {
                "scan_info": {
                    "target_url": self.target_url,
                    "api_url": self.api_url,
                    "scan_date": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "total_alerts": len(alerts)
                },
                "risk_summary": risk_counts,
                "alerts": categorized_alerts
            }
            
            with open(f"{output_file}.json", "w") as f:
                json.dump(report, f, indent=2)
            
            print(f"✅ JSON report saved to {output_file}.json")
            
            # Print summary
            print("\n📊 Security Scan Summary:")
            print(f"Total Alerts: {len(alerts)}")
            for risk, count in risk_counts.items():
                if count > 0:
                    print(f"  {risk}: {count}")
            
            # Return exit code based on high/medium risk findings
            if risk_counts["High"] > 0:
                return 2  # Critical issues found
            elif risk_counts["Medium"] > 0:
                return 1  # Medium issues found
            else:
                return 0  # No significant issues
                
        except Exception as e:
            print(f"❌ Error generating report: {e}")
            return 1
    
    def run_baseline_scan(self, output_dir: str = "security-reports") -> int:
        """Run complete baseline security scan."""
        # Create output directory
        Path(output_dir).mkdir(exist_ok=True)
        
        # Start ZAP daemon
        if not self.start_zap_daemon():
            return 1
        
        try:
            # Set up test user for authenticated scanning
            auth_token = self.setup_test_user()
            if auth_token:
                self.configure_authentication(auth_token)
            
            # Run spider scan to discover URLs
            if not self.spider_scan():
                print("⚠️ Spider scan failed, continuing with active scan...")
            
            # Run active security scan
            scan_result = self.active_scan()
            if not scan_result:
                print("❌ Active scan failed")
                return 1
            
            # Get security alerts
            alerts = self.get_alerts()
            
            # Generate reports
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            output_file = f"{output_dir}/zap_baseline_scan_{timestamp}"
            exit_code = self.generate_report(alerts, output_file)
            
            return exit_code
            
        finally:
            # Always stop ZAP daemon
            self.stop_zap_daemon()


def main():
    """Main function to run security scan."""
    import argparse
    
    parser = argparse.ArgumentParser(description="OWASP ZAP Baseline Security Scan")
    parser.add_argument("--target", default="http://localhost:3000", 
                       help="Target application URL")
    parser.add_argument("--api", default="http://localhost:3001", 
                       help="API base URL")
    parser.add_argument("--output", default="security-reports", 
                       help="Output directory for reports")
    parser.add_argument("--zap-port", type=int, default=8090, 
                       help="ZAP daemon port")
    
    args = parser.parse_args()
    
    print("🛡️ OWASP ZAP Baseline Security Scan")
    print(f"Target: {args.target}")
    print(f"API: {args.api}")
    print("-" * 50)
    
    scanner = ZAPSecurityScanner(
        target_url=args.target,
        api_url=args.api,
        zap_port=args.zap_port
    )
    
    exit_code = scanner.run_baseline_scan(args.output)
    
    if exit_code == 0:
        print("\n✅ Security scan completed successfully - No significant issues found")
    elif exit_code == 1:
        print("\n⚠️ Security scan completed with medium-risk issues")
    else:
        print("\n❌ Security scan found high-risk security issues")
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()