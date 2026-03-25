import time
import random
from typing import Dict, Any
import os
import requests
from core.reasoning import AntigravityEngine

class TinyFishAgent:
    """Wrapper around the TinyFish Web Agent API for a denial-recovery demo."""
    def __init__(self, console, reasoner: AntigravityEngine):
        self.console = console
        self.reasoner = reasoner
        self.logged_in = False
        self.api_key = os.getenv("TINYFISH_API_KEY", "")
        self.api_base_url = os.getenv("TINYFISH_API_BASE_URL", "https://agent.tinyfish.ai")
        self.mode = os.getenv("TINYFISH_MODE", "mock").replace(" ", "")

    def _real_api_available(self) -> bool:
        return self.mode == "live" and bool(self.api_key)

    def _tinyfish_request(self, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Thin TinyFish HTTP adapter. Falls back to mock when config is absent."""
        if not self._real_api_available():
            return {"ok": True, "mode": "mock", "endpoint": endpoint, "payload": payload}

        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
        }
        try:
            response = requests.post(f"{self.api_base_url}{endpoint}", json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if "text/event-stream" in content_type:
                return {
                    "ok": True,
                    "mode": "live",
                    "stream": True,
                    "data": response.text[:2000],
                }
            return {"ok": True, "mode": "live", "stream": False, "data": response.json()}
        except Exception as exc:
            return {"ok": False, "mode": "live", "error": str(exc)}
        
    def login(self) -> None:
        self.console.print(
            "\n[bold deep_sky_blue1]▶ TinyFish Agent:[/bold deep_sky_blue1] "
            "[dim]Navigating to the payer portal and restoring the clinic session...[/dim]"
        )
        time.sleep(1.5)
        session_call = self._tinyfish_request(
            "/v1/automation/run-sse",
            {
                "url": "https://news.ycombinator.com/jobs",
                "goal": (
                    "Simulate a payer portal session health check for a denial-recovery workflow "
                    "and return compact JSON status."
                ),
            },
        )
        if session_call.get("ok"):
            self.console.print(f"[dim]TinyFish session initialized ({session_call.get('mode')}).[/dim]")
        else:
            self.console.print(f"[yellow]TinyFish live session failed, continuing in mock mode: {session_call.get('error')}[/yellow]")
        self.console.print(
            "[bold deep_sky_blue1]▶ TinyFish Agent:[/bold deep_sky_blue1] "
            "[dim]Clearing intermediary portal prompts and restoring session cookies...[/dim]"
        )
        time.sleep(1.0)
        self.console.print("[bold green]✔ Authenticated via vaulted credentials & valid session cookies.[/bold green]\n")
        self.logged_in = True
        
    def fill_and_submit_form(self, chart: Dict[Any, Any], attempt: int = 1) -> Dict[str, Any]:
        """Navigates the decision tree, inputs data, and handles the submit, returning the result or error state."""
        extraction = self.reasoner.extract_cpt_and_diagnosis(chart)
        diag_code = extraction['diagnosis_code']
        cpt_code = extraction['cpt_code']
        
        self.console.print(
            "[bold deep_sky_blue1]▶ TinyFish Agent:[/bold deep_sky_blue1] "
            "[dim]Locating denial case inputs on a reactive payer DOM...[/dim]"
        )
        time.sleep(1.0)
        self.console.print(f"  └── ⌨️  Typing Diagnosis Code: [bold yellow]{diag_code}[/bold yellow]")
        time.sleep(0.5)
        self.console.print(f"  └── ⌨️  Typing Procedure Code: [bold yellow]{cpt_code}[/bold yellow]")
        time.sleep(0.8)

        strategy = random.choice(["portal-intake-first", "search-assisted"]) if attempt == 1 else "evidence-bundle-recovery"
        self.console.print(f"  └── 🧭 Strategy Selected: [bold white]{strategy}[/bold white]")
        
        self.console.print(
            "[bold deep_sky_blue1]▶ TinyFish Agent:[/bold deep_sky_blue1] "
            "[dim]Portal updated dynamically from CPT selection. Reading newly exposed fields...[/dim]"
        )
        time.sleep(1.2)
        dynamic_field = random.choice(
            ["Conservative Therapy History", "Referring Provider NPI", "Clinical Documentation Upload"]
        )
        self.console.print(f"  └── 🧠 Dynamic UI detected field: [bold white]{dynamic_field}[/bold white]")
        time.sleep(0.8)

        action_call = self._tinyfish_request(
            "/v1/automation/run-sse",
            {
                "url": "https://news.ycombinator.com/jobs",
                "goal": (
                    "Simulate adaptive web workflow execution for a denial-recovery demo. "
                    f"Use diagnosis {diag_code}, cpt {cpt_code}, attempt {attempt}, strategy {strategy}, "
                    f"dynamic field {dynamic_field}. Return compact JSON status."
                ),
            },
        )
        if not action_call.get("ok"):
            self.console.print(f"[yellow]TinyFish action error: {action_call.get('error')}[/yellow]")
        
        # Simulated success/fail logic based on the attempt number
        if "MRI Lumbar" in chart.get("requested_procedure", "") and attempt == 1:
            # We purposely simulate a failure for the demo on the first try for 'Jane Doe'
            # to show the retry loop.
            self.console.print("\n[bold deep_sky_blue3]▶ Submitting form...[/bold deep_sky_blue3]")
            time.sleep(1.5)
            self.console.print("\n[blink bold red]❌ PORTAL DENIAL DETECTED![/blink bold red]")
            self.console.print(
                "[red]UI Banner reads: 'Missing Proof of Conservative Therapy (Physical Therapy). Submission Denied.'[/red]\n"
            )
            
            return {
                "success": False,
                "error_banner": "Missing Proof of Conservative Therapy (Physical Therapy). Submission Denied."
            }
        else:
            self.console.print(
                f"  └── 📎  Uploading selected evidence bundle: [bold yellow]{', '.join(chart.get('evidence_files', []))}[/bold yellow]"
            )
            time.sleep(2)
            self.console.print("\n[bold deep_sky_blue3]▶ Submitting form...[/bold deep_sky_blue3]")
            time.sleep(2)
            self.console.print("\n[blink bold green]✅ DENIAL RECOVERED AND AUTHORIZATION APPROVED![/blink bold green]")
            auth_number = f"AUTH-{random.randint(100000, 999999)}"
            self.console.print(
                f"[bold green]Captured authorization reference for billing follow-up: [white]{auth_number}[/white][/bold green]\n"
            )
            
            return {
                "success": True,
                "auth_number": auth_number
            }
            
    def handle_recovery(self, chart: Dict[Any, Any], recovery_plan: Dict[str, Any]) -> str:
        """Executes the recovery actions determined by the Reasoning Engine."""
        self.console.print(f"[bold red]▶ Error Intercepted.[/bold red] [yellow]Engaging Antigravity engine reasoning loop...[/yellow]")
        time.sleep(2)
        
        if recovery_plan['action'] == 'recover':
            self.console.print(f"[bold cyan]🧠 Reasoning Engine Decision: [/bold cyan][white]{recovery_plan['reason']}[/white]")
            time.sleep(1.5)
            self.console.print(
                "[bold deep_sky_blue1]▶ TinyFish Agent:[/bold deep_sky_blue1] "
                "[dim]Navigating to the portal attachments tab and restoring saved browser state...[/dim]"
            )
            time.sleep(1.2)
            upload_label = recovery_plan.get("upload_label", "supporting documentation")
            file_target = recovery_plan.get("file_target", "available_chart_evidence.pdf")
            self.console.print(
                f"  └── 📎  Extracting {upload_label} from the clinic vault and uploading [bold yellow]{file_target}[/bold yellow]..."
            )
            time.sleep(2.0)
            self.console.print("[bold deep_sky_blue1]▶ TinyFish Agent:[/bold deep_sky_blue1] [dim]Re-submitting...[/dim]")
            
            # The agent calls the form submit again, this time as attempt 2
            result = self.fill_and_submit_form(chart, attempt=2)
            return "recovered"
        
        elif recovery_plan['action'] == 'escalate':
            self.console.print(f"[bold cyan]🧠 Reasoning Engine Decision: [/bold cyan][white]{recovery_plan['reason']}[/white]")
            self.console.print("\n[blink bold red]🚨 SMART ESCALATION: Pausing browser state and assigning to Human Queue.[/blink bold red]\n")
            return "escalated"
            
        return "failed"
