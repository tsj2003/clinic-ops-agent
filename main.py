import json
import time
from rich.console import Console
from rich.panel import Panel
from dotenv import load_dotenv
from core.reasoning import AntigravityEngine
from agent.tinyfish_client import TinyFishAgent

# Initialize the Rich console for a sleek, beautiful dashboard
console = Console()
load_dotenv()

def load_patients():
    with open('data/synthetic_patients.json', 'r') as file:
        return json.load(file)

def run_demo():
    console.print(
        Panel.fit(
            "[bold cyan]AuthPilot AI: Clinic Denial-Recovery Agent[/bold cyan]\n"
            "Powered by TinyFish Web Agent API and Antigravity reasoning",
            border_style="cyan",
        )
    )
    
    patients = load_patients()
    reasoner = AntigravityEngine()
    agent = TinyFishAgent(console, reasoner)
    
    agent.login()
    
    for idx, patient in enumerate(patients):
        console.print(
            Panel.fit(
                f"[bold magenta]Processing Case {idx+1}: {patient['name']}[/bold magenta]",
                border_style="magenta",
            )
        )
        time.sleep(1)
        
        # 1. Evaluate the chart using Antigravity
        console.print(
            "[bold cyan]🧠 Antigravity (Reasoning Phase):[/bold cyan] "
            "[dim]Reviewing a synthetic chart and denial context with zero PII.[/dim]"
        )
        probability, reason = reasoner.calculate_approval_probability(patient)
        
        console.print(f"  └── 📊 Calculated Approval Probability: [bold green]{probability}%[/bold green]")
        console.print(f"  └── 📝 Reasoning: [dim]{reason}[/dim]")
        time.sleep(2)

        econ = reasoner.economic_decision(probability)
        console.print(
            f"  └── 💵 EV Model: expected ${econ['expected_recovery_usd']} vs labor ${econ['labor_cost_usd']}"
        )
        console.print(
            f"  └── 💵 Economic Intelligence Decision: [bold]{econ['action'].upper()}[/bold] "
            f"- [dim]{econ['reason']}[/dim]"
        )
        if econ["action"] in ["delay", "escalate"]:
            console.print(
                "[bold red]⚠️  SMART ESCALATION: preserving human attention for low-confidence or ambiguous cases.[/bold red]"
            )
            console.print("[dim]Freezing TinyFish session and assigning nurse task...[/dim]\n")
            explanation = reasoner.explanation_mode(patient, probability, "Escalated to human queue")
            console.print(f"[bold cyan]🧾 Agent Explanation Mode:[/bold cyan] {explanation}\n")
            continue

        time.sleep(1)
        
        # 2. Run the TinyFish web agent on the portal
        result = agent.fill_and_submit_form(patient, attempt=1)
        
        final_outcome = "Submitted on first attempt"
        if not result['success']:
            # 3. The crucial Error -> Retry Loop
            error_reason = result['error_banner']
            
            # Antigravity reads the portal error and devises a plan based on the original chart
            plan = reasoner.analyze_portal_error(error_reason, patient)
            
            recovery_state = agent.handle_recovery(patient, plan)
            if recovery_state == "recovered":
                final_outcome = "Recovered after rejection and approved"
            elif recovery_state == "escalated":
                final_outcome = "Escalated after rejection"
            else:
                final_outcome = "Failed after retries"
        else:
            final_outcome = "Approved"

        explanation = reasoner.explanation_mode(patient, probability, final_outcome)
        console.print(f"[bold cyan]🧾 Agent Explanation Mode:[/bold cyan] {explanation}")
            
        console.print("[dim]--------------------------------------------------[/dim]\n")
        time.sleep(3)
        
    console.print(
        Panel.fit(
            "[bold cyan]Demo concluded. Denials reviewed, evidence recovered, and approvals moved forward.[/bold cyan]",
            border_style="cyan",
        )
    )

if __name__ == "__main__":
    try:
        run_demo()
    except KeyboardInterrupt:
        console.print("\n[bold red]Process Terminated.[/bold red]")
