import sys
import json
import urllib.request
import urllib.parse
import re

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def search_duckduckgo(query: str, max_results: int = 5):
    encoded = urllib.parse.quote(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return {"error": f"Falha na requisição: {str(e)}", "results": []}

    results = []
    # Expressão regular para links e snippets da página de resultados DuckDuckGo HTML
    snippets = re.findall(r'<a class="result__snippet[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', html, re.DOTALL)
    titles = re.findall(r'<a class="result__url"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', html, re.DOTALL)

    for i in range(min(len(snippets), max_results)):
        link, snippet_raw = snippets[i]
        snippet_clean = re.sub(r'<.*?>', '', snippet_raw).strip()
        results.append({
            "index": i + 1,
            "url": link,
            "snippet": snippet_clean
        })

    if not results:
        # Fallback genérico de extração de texto
        text_matches = re.findall(r'<a class="result__snippet[^"]*"[^>]*>(.*?)</a>', html, re.DOTALL)
        for i, raw in enumerate(text_matches[:max_results]):
            clean = re.sub(r'<.*?>', '', raw).strip()
            if clean:
                results.append({"index": i + 1, "snippet": clean})

    return {"query": query, "total_results": len(results), "results": results}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Nenhuma query informada. Uso: python search.py <termo>"}))
        sys.exit(1)
    
    query = " ".join(sys.argv[1:])
    data = search_duckduckgo(query)
    print(json.dumps(data, ensure_ascii=False, indent=2))
