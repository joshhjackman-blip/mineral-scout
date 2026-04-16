from dotenv import load_dotenv
load_dotenv('/workspace/.env.local')

import anthropic, json, os, time

BETAS = ["managed-agents-2026-04-01"]
AGENT_ID = "agent_011Ca6Kr7ZQ7vTmWiAoEhz9E"
client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

RETRY_LEASES = [
    {"id": "20974",  "name": "RED CREST 3H"},
    {"id": "296751", "name": "ZIRCON A"},
    {"id": "21064",  "name": "LASSEN A"},
    {"id": "21449",  "name": "DEMPSEY UNIT A"},
    {"id": "19085",  "name": "ACADIA A 1H"},
]

def get_environment():
    envs = client.beta.environments.list(betas=BETAS).data or []
    for env in envs:
        if getattr(env, "name", None) == "rrc-lease-lookup":
            return env.id
    return client.beta.environments.create(
        name="rrc-lease-lookup",
        description="RRC lease lookup",
        betas=BETAS,
    ).id

def lookup(env_id, lease_id, lease_name, timeout=360):
    session = client.beta.sessions.create(
        agent=AGENT_ID, environment_id=env_id, betas=BETAS)

    prompt = f"""
Find the survey abstract number for RRC lease ID {lease_id} 
(lease name: {lease_name}) in Gonzales County Texas (county code 177).

Try ALL of these approaches:
1. Search RRC EWA system for District 1 Oil lease {lease_id}:
   https://webapps2.rrc.texas.gov/EWA/specificLeaseQueryAction.do
2. Search RRC EWA system for District 2 Oil lease {lease_id}
3. Search by lease name "{lease_name}" in Gonzales County:
   https://webapps2.rrc.texas.gov/EWA/leaseQueryAction.do
4. Search Google for: "{lease_name} Gonzales County Texas abstract survey RRC"
5. Try shalexp.com or drillingedge.com for this lease name

The abstract number format is A-XXX where XXX is a number.
Gonzales County abstracts range from A-1 to A-553.

Return ONLY JSON:
{{
  "lease_id": "{lease_id}",
  "lease_name": "{lease_name}",
  "abstract_number": "A-XXX or unknown",
  "survey_name": "name or unknown",
  "confidence": 0.0,
  "method": "how you found it",
  "notes": "any details"
}}
""".strip()

    client.beta.sessions.events.send(
        session.id,
        events=[{"type": "user.message", "content": [{"type": "text", "text": prompt}]}],
        betas=BETAS,
    )

    deadline = time.time() + timeout
    latest_text = None
    checks = 0
    while time.time() < deadline:
        events = client.beta.sessions.events.list(session.id, betas=BETAS).data or []
        done = False
        for ev in events:
            t = getattr(ev, "type", "")
            if t == "agent.message":
                blocks = getattr(ev, "content", []) or []
                text = "".join(getattr(b, "text", "") for b in blocks).strip()
                if text: latest_text = text
            if t in ("session.status.idle", "session.status.terminated"):
                done = True
        checks += 1
        if checks % 10 == 0:
            print(f"  Check {checks}...")
        if done and latest_text:
            return latest_text
        time.sleep(3)
    return latest_text

def main():
    env_id = get_environment()
    results = []
    for lease in RETRY_LEASES:
        print(f"\nLooking up {lease['id']} — {lease['name']}...")
        result = lookup(env_id, lease['id'], lease['name'])
        print(f"Result: {result[:400] if result else 'No response'}")
        results.append({"lease_id": lease['id'], "response": result})
        time.sleep(3)

    with open('/workspace/data/rrc_retry_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    print("\nSaved to data/rrc_retry_results.json")

if __name__ == "__main__":
    main()
