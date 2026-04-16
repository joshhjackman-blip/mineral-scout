from dotenv import load_dotenv
load_dotenv('/workspace/.env.local')

import anthropic
import json
import os
import time

BETAS = ["managed-agents-2026-04-01"]
AGENT_ID = "agent_011Ca6Kr7ZQ7vTmWiAoEhz9E"

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

LEASES = [
    {"id": "12563", "name": "RED CREST 4H"},
    {"id": "20905", "name": "STOBAUGH-ROSSOW A"},
    {"id": "20974", "name": "RED CREST 3H"},
    {"id": "296751", "name": "ZIRCON A"},
    {"id": "21064", "name": "LASSEN A"},
    {"id": "21449", "name": "DEMPSEY UNIT A"},
    {"id": "19085", "name": "ACADIA A 1H"},
]

def get_or_create_environment():
    envs = client.beta.environments.list(betas=BETAS).data or []
    for env in envs:
        if getattr(env, "name", None) == "rrc-lease-lookup":
            return env.id
    env = client.beta.environments.create(
        name="rrc-lease-lookup",
        description="RRC lease to abstract lookup",
        betas=BETAS,
    )
    return env.id

def lookup_lease(environment_id, lease_id, lease_name, timeout=300):
    session = client.beta.sessions.create(
        agent=AGENT_ID,
        environment_id=environment_id,
        betas=BETAS,
    )

    prompt = f"""
Look up RRC oil lease ID {lease_id} (lease name: {lease_name}) in Gonzales County Texas.

Go to this URL and find the abstract/survey information:
https://webapps2.rrc.texas.gov/EWA/specificLeaseQueryAction.do

Search for:
- Lease type: Oil
- District: 2 (South Texas)
- Lease number: {lease_id}

Find the survey name and abstract number associated with this lease.
Also try searching by lease name "{lease_name}" in Gonzales County.

Return ONLY this JSON:
{{
  "lease_id": "{lease_id}",
  "lease_name": "{lease_name}",
  "abstract_number": "A-XXX",
  "survey_name": "SURNAME, FIRSTNAME",
  "confidence": 0.0,
  "source_url": "url where you found it",
  "notes": "any relevant notes"
}}
""".strip()

    client.beta.sessions.events.send(
        session.id,
        events=[{"type": "user.message", "content": [{"type": "text", "text": prompt}]}],
        betas=BETAS,
    )

    deadline = time.time() + timeout
    latest_text = None

    while time.time() < deadline:
        events = client.beta.sessions.events.list(session.id, betas=BETAS).data or []
        session_done = False
        for ev in events:
            ev_type = getattr(ev, "type", "")
            if ev_type == "agent.message":
                blocks = getattr(ev, "content", []) or []
                text = "".join(getattr(b, "text", "") for b in blocks).strip()
                if text:
                    latest_text = text
            if ev_type in ("session.status.idle", "session.status.terminated"):
                session_done = True
        if session_done and latest_text:
            return latest_text
        time.sleep(3)

    return latest_text

def main():
    environment_id = get_or_create_environment()
    results = []

    for lease in LEASES:
        print(f"\nLooking up lease {lease['id']} — {lease['name']}...")
        result = lookup_lease(environment_id, lease['id'], lease['name'])
        print(f"Result: {result[:300] if result else 'No response'}")
        results.append({"lease": lease, "response": result})
        time.sleep(2)

    # Save results
    with open('/workspace/data/rrc_lookup_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    print("\nSaved to data/rrc_lookup_results.json")

if __name__ == "__main__":
    main()
