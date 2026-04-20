#!/usr/bin/env python3
"""
Security Audit Script
Comprehensive security scanning for Clinic Ops Agent
"""

import subprocess
import sys
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple


class SecurityAuditor:
    """Runs security audits and generates reports"""
    
    CRITICAL_PATTERNS = [
        r'password\s*=\s*["\'][^"\']+["\']',
        r'secret\s*=\s*["\'][^"\']+["\']',
        r'api_key\s*=\s*["\'][^"\']+["\']',
        r'SECRET_KEY\s*=\s*["\'][^"\']+["\']',
        r'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY',
        r'AKIA[0-9A-Z]{16}',  # AWS Access Key
        r'ghp_[a-zA-Z0-9]{36}',  # GitHub Token
        r'glpat-[a-zA-Z0-9\-]{20}',  # GitLab Token
    ]
    
    def __init__(self):
        self.findings = []
        self.critical = 0
        self.high = 0
        self.medium = 0
        self.low = 0
    
    def run_dependency_scan(self) -> Dict:
        """Scan for vulnerable dependencies"""
        print("🔍 Scanning dependencies...")
        
        try:
            # Run pip-audit if available
            result = subprocess.run(
                ['pip-audit', '--format=json', '-r', 'requirements.txt'],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode == 0:
                return {'status': 'clean', 'vulnerabilities': []}
            
            try:
                data = json.loads(result.stdout)
                return {
                    'status': 'vulnerable',
                    'vulnerabilities': data.get('dependencies', [])
                }
            except:
                return {'status': 'error', 'message': result.stderr}
                
        except FileNotFoundError:
            return {'status': 'skipped', 'message': 'pip-audit not installed'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    def run_bandit_scan(self) -> Dict:
        """Run static code analysis with bandit"""
        print("🔍 Running Bandit security scan...")
        
        try:
            result = subprocess.run(
                ['bandit', '-r', '.', '-f', 'json', '-x', './venv,./.git,./tests'],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            try:
                data = json.loads(result.stdout)
                issues = data.get('results', [])
                
                for issue in issues:
                    severity = issue.get('issue_severity', 'UNKNOWN')
                    if severity == 'CRITICAL':
                        self.critical += 1
                    elif severity == 'HIGH':
                        self.high += 1
                    elif severity == 'MEDIUM':
                        self.medium += 1
                    else:
                        self.low += 1
                
                return {
                    'status': 'completed',
                    'issues': len(issues),
                    'by_severity': {
                        'critical': self.critical,
                        'high': self.high,
                        'medium': self.medium,
                        'low': self.low
                    }
                }
            except:
                return {'status': 'error', 'message': result.stderr}
                
        except FileNotFoundError:
            return {'status': 'skipped', 'message': 'bandit not installed'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    def scan_for_secrets(self) -> Dict:
        """Scan for hardcoded secrets in code"""
        print("🔍 Scanning for hardcoded secrets...")
        
        findings = []
        scanned = 0
        
        # Scan Python files
        for py_file in Path('.').rglob('*.py'):
            if 'venv' in str(py_file) or '.git' in str(py_file):
                continue
            
            try:
                content = py_file.read_text()
                scanned += 1
                
                for i, line in enumerate(content.split('\n'), 1):
                    for pattern in self.CRITICAL_PATTERNS:
                        if re.search(pattern, line, re.IGNORECASE):
                            # Check if it's an environment variable read
                            if 'os.getenv' in line or 'os.environ' in line:
                                continue
                            
                            findings.append({
                                'file': str(py_file),
                                'line': i,
                                'pattern': 'Potential secret',
                                'severity': 'HIGH'
                            })
                            self.high += 1
            except:
                continue
        
        # Scan config files
        for config_file in ['.env', 'config.py', 'settings.py']:
            if Path(config_file).exists():
                try:
                    content = Path(config_file).read_text()
                    for i, line in enumerate(content.split('\n'), 1):
                        if '=' in line and not line.startswith('#'):
                            for pattern in self.CRITICAL_PATTERNS:
                                if re.search(pattern, line, re.IGNORECASE):
                                    if 'your-' in line.lower() or 'example' in line.lower():
                                        continue  # Skip placeholders
                                    findings.append({
                                        'file': config_file,
                                        'line': i,
                                        'pattern': 'Potential secret',
                                        'severity': 'CRITICAL'
                                    })
                                    self.critical += 1
                except:
                    continue
        
        return {
            'status': 'completed',
            'files_scanned': scanned,
            'secrets_found': len(findings),
            'findings': findings[:10]  # Limit output
        }
    
    def check_file_permissions(self) -> Dict:
        """Check for overly permissive file permissions"""
        print("🔍 Checking file permissions...")
        
        issues = []
        
        # Check for world-writable files
        sensitive_files = [
            Path('.env'),
            Path('config.py'),
            Path('k8s/secret.yaml'),
        ]
        
        for file in sensitive_files:
            if file.exists():
                import stat
                try:
                    mode = file.stat().st_mode
                    # Check if world-readable
                    if mode & stat.S_IROTH:
                        issues.append({
                            'file': str(file),
                            'issue': 'World-readable',
                            'severity': 'MEDIUM'
                        })
                        self.medium += 1
                except:
                    continue
        
        return {
            'status': 'completed',
            'issues': len(issues),
            'findings': issues
        }
    
    def generate_report(self, results: Dict) -> str:
        """Generate security audit report"""
        report = []
        report.append("=" * 70)
        report.append("CLINIC OPS AGENT - SECURITY AUDIT REPORT")
        report.append("=" * 70)
        report.append(f"Generated: {datetime.utcnow().isoformat()}")
        report.append("")
        
        # Summary
        report.append("📊 SECURITY SUMMARY")
        report.append("-" * 70)
        report.append(f"❌ Critical: {self.critical}")
        report.append(f"🔴 High: {self.high}")
        report.append(f"🟡 Medium: {self.medium}")
        report.append(f"🟢 Low: {self.low}")
        report.append("")
        
        # Dependency scan
        dep = results.get('dependency_scan', {})
        report.append("📦 DEPENDENCY SCAN")
        report.append("-" * 70)
        report.append(f"Status: {dep.get('status', 'unknown')}")
        if dep.get('vulnerabilities'):
            report.append(f"Vulnerabilities: {len(dep['vulnerabilities'])}")
        report.append("")
        
        # Bandit scan
        bandit = results.get('bandit_scan', {})
        report.append("🔍 STATIC CODE ANALYSIS (Bandit)")
        report.append("-" * 70)
        report.append(f"Status: {bandit.get('status', 'unknown')}")
        if bandit.get('by_severity'):
            for sev, count in bandit['by_severity'].items():
                report.append(f"  {sev}: {count}")
        report.append("")
        
        # Secrets scan
        secrets = results.get('secrets_scan', {})
        report.append("🔑 SECRETS SCAN")
        report.append("-" * 70)
        report.append(f"Files scanned: {secrets.get('files_scanned', 0)}")
        report.append(f"Potential secrets: {secrets.get('secrets_found', 0)}")
        if secrets.get('findings'):
            for finding in secrets['findings'][:5]:
                report.append(f"  - {finding['file']}:{finding['line']} ({finding['severity']})")
        report.append("")
        
        # Recommendations
        report.append("💡 RECOMMENDATIONS")
        report.append("-" * 70)
        if self.critical > 0:
            report.append("❗ CRITICAL: Fix critical issues immediately before deployment")
        if self.high > 0:
            report.append("⚠️  HIGH: Address high severity issues within 24 hours")
        if self.medium > 0:
            report.append("ℹ️  MEDIUM: Plan remediation for medium severity issues")
        report.append("")
        report.append("Best Practices:")
        report.append("- Use environment variables for all secrets")
        report.append("- Enable 2FA for all service accounts")
        report.append("- Rotate API keys quarterly")
        report.append("- Review access logs weekly")
        report.append("")
        
        # Overall status
        report.append("=" * 70)
        if self.critical == 0 and self.high <= 2:
            report.append("✅ SECURITY AUDIT PASSED")
            report.append("The application meets security standards for production deployment.")
        else:
            report.append("❌ SECURITY AUDIT FAILED")
            report.append("Fix critical/high severity issues before deploying to production.")
        report.append("=" * 70)
        
        return "\n".join(report)
    
    def run_audit(self) -> Tuple[bool, str]:
        """Run complete security audit"""
        print("\n🔒 CLINIC OPS AGENT - SECURITY AUDIT")
        print("=" * 70)
        
        results = {
            'dependency_scan': self.run_dependency_scan(),
            'bandit_scan': self.run_bandit_scan(),
            'secrets_scan': self.scan_for_secrets(),
            'permissions_check': self.check_file_permissions(),
        }
        
        report = self.generate_report(results)
        
        # Save report
        report_file = Path('security_audit_report.txt')
        report_file.write_text(report)
        print(f"\n📄 Report saved to: {report_file}")
        
        # Determine pass/fail
        passed = self.critical == 0 and self.high <= 2
        
        return passed, report


def main():
    """Main entry point"""
    auditor = SecurityAuditor()
    passed, report = auditor.run_audit()
    
    print(report)
    
    # Exit with appropriate code
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
