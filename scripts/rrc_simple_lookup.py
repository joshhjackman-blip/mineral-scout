from dotenv import load_dotenv
load_dotenv('/workspace/.env.local')

import anthropic, json, os, csv

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

LEASES = [
    {"id": "20974",  "name": "RED CREST 3H"},
    {"id": "296751", "name": "ZIRCON A"},
    {"id": "21064",  "name": "LASSEN A"},
    {"id": "21449",  "name": "DEMPSEY UNIT A"},
    {"id": "19085",  "name": "ACADIA A 1H"},
]

def lookup_lease(lease_id, lease_name):
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[{
            "role": "user",
            "content": f"""Search for the RRC lease "{lease_name}" lease ID {lease_id} in Gonzales County Texas (county FIPS 177).

I need to find which survey abstract this lease belongs to.
Gonzales County abstracts are formatted as A-XXX (like A-30, A-266 etc).

Try these searches:
1. "{lease_name} Gonzales County Texas abstract survey"
2. "RRC lease {lease_id} Gonzales County abstract"
3. site:shalexp.com "{lease_name} gonzales county"

Return ONLY valid JSON, nothing else:
{{
  "lease_id": "{lease_id}",
  "lease_name": "{lease_name}",
  "abstract_number": "A-XXX or unknown",
  "survey_name": "name or unknown",
  "confidence": 0.0,
  "source": "where found"
}}"""
        }]
    )

    for block in response.content:
        if hasattr(block, 'text') and block.text:
            text = block.text.strip()
            try:
                start = text.find('{')
                end = text.rfind('}') + 1
                if start >= 0 and end > start:
                    return json.loads(text[start:end])
            except:
                return {"lease_id": lease_id, "abstract_number": "unknown", "raw": text[:200]}
    return {"lease_id": lease_id, "abstract_number": "unknown"}

def main():
    # Already found these two from first run
    new_mappings = [
        {"rrc_lease_id": "12563", "abstract_label": "A-266"},
        {"rrc_lease_id": "20905", "abstract_label": "A-230"},
    ]

    for lease in LEASES:
        print(f"Looking up {lease['id']} — {lease['name']}...")
        result = lookup_lease(lease['id'], lease['name'])
        ab = result.get('abstract_number', 'unknown')
        print(f"  -> {ab} (confidence: {result.get('confidence', 0)}) source: {result.get('source', '')}")
        if ab != 'unknown':
            new_mappings.append({
                "rrc_lease_id": lease['id'],
                "abstract_label": ab
            })

    # Append new mappings to CSV
    with open('/workspace/data/lease_abstract_mapping.csv', 'a', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['rrc_lease_id', 'abstract_label'])
        for m in new_mappings:
            writer.writerow(m)
    print(f"\nAdded {len(new_mappings)} mappings to lease_abstract_mapping.csv")

if __name__ == "__main__":
    main()
