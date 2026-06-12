import json
import urllib.request
import urllib.parse

API_KEY = "ydc-sk-80144bc44299ba2f-ruKuJVAvdFWLNyFebkPuayCf7fxpF0dw-155d1f5c"
URL = "https://ydc-index.io/v1/search"

params = urllib.parse.urlencode({"query": "renewable energy trends 2024", "count": 3})
req = urllib.request.Request(f"{URL}?{params}", headers={"X-API-Key": API_KEY})

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

results = []
for r in data["results"]["web"]:
    results.append({
        "title": r["title"],
        "url": r["url"],
        "snippet": r.get("snippets", [r.get("description", "")])[0]
    })

print(json.dumps(results, indent=2))
