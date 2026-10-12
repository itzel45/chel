"""Vercel Python API. Configure Supabase env vars for durable shared storage."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import json, os, uuid

_memory = []

def _supabase(method, path, payload=None, prefer=None):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer: headers["Prefer"] = prefer
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(base + "/rest/v1/" + path, data=data, headers=headers, method=method)
    with urlopen(req, timeout=8) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def _persistent():
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

def _all():
    if _persistent(): return _supabase("GET", "tickets?select=*&order=created_at.asc") or []
    return _memory

def _update(ticket_id, values):
    if _persistent():
        rows = _supabase("PATCH", f"tickets?id=eq.{ticket_id}", values, "return=representation")
        return rows[0] if rows else None
    for ticket in _memory:
        if ticket["id"] == ticket_id:
            ticket.update(values)
            return ticket

def _create(values):
    if _persistent():
        rows = _supabase("POST", "tickets", values, "return=representation")
        return rows[0]
    _memory.append(values)
    return values

def _date(value):
    return str(value or "")[:10]

class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self): self._send(200, {})

    def do_GET(self):
        try:
            path = urlparse(self.path).path.rstrip("/")
            if path not in ("/api", "/api/state"): return self._send(404, {"error": "Ruta no encontrada"})
            today = datetime.now(ZoneInfo("America/Mexico_City")).date().isoformat()
            tickets = [t for t in _all() if _date(t.get("created_at")) == today]
            desks = []
            for number in range(1, 5):
                current = next((t for t in reversed(tickets) if t.get("status") == "called" and t.get("desk") == number), None)
                desks.append({"number": number, "current": current})
            self._send(200, {"tickets": tickets, "desks": desks,
                "waiting": sum(t.get("status") == "waiting" for t in tickets),
                "served": sum(t.get("status") == "served" for t in tickets)})
        except (HTTPError, URLError, KeyError, TimeoutError) as exc:
            self._send(503, {"error": "No se pudo consultar el almacenamiento. Verifica la configuración de Supabase."})

    def do_POST(self):
        try:
            path = urlparse(self.path).path.rstrip("/")
            length = min(int(self.headers.get("Content-Length", "0")), 10000)
            body = json.loads(self.rfile.read(length) or b"{}")
            tickets = _all()
            today = datetime.now(ZoneInfo("America/Mexico_City")).date().isoformat()
            todays = [t for t in tickets if _date(t.get("created_at")) == today]
            now = datetime.now(timezone.utc).isoformat()
            if path == "/api/tickets":
                kind = str(body.get("kind", "Atención general"))[:60]
                sequence = len(todays) + 1
                ticket = {"id": str(uuid.uuid4()), "number": f"A{sequence:03d}", "kind": kind,
                          "status": "waiting", "desk": None, "created_at": now}
                self._create(ticket)
                return self._send(201, ticket)
            if path in ("/api/call", "/api/finish"):
                desk = body.get("desk")
                if not isinstance(desk, int) or desk not in range(1, 5): return self._send(400, {"error": "Ventanilla inválida"})
                if path.endswith("/call"):
                    active = any(t.get("status") == "called" and t.get("desk") == desk for t in todays)
                    if active: return self._send(409, {"error": "Finaliza el turno actual antes de llamar al siguiente."})
                    ticket = next((t for t in todays if t.get("status") == "waiting"), None)
                    if not ticket: return self._send(404, {"error": "No hay turnos en espera."})
                    updated = _update(ticket["id"], {"status": "called", "desk": desk, "called_at": now})
                    return self._send(200, updated)
                ticket = next((t for t in reversed(todays) if t.get("status") == "called" and t.get("desk") == desk), None)
                if not ticket: return self._send(404, {"error": "Esta ventanilla no tiene un turno activo."})
                updated = _update(ticket["id"], {"status": "served", "finished_at": now})
                return self._send(200, updated)
            self._send(404, {"error": "Ruta no encontrada"})
        except (HTTPError, URLError, KeyError, TimeoutError, ValueError, json.JSONDecodeError):
            self._send(503, {"error": "No se pudo completar la operación. Revisa la API y Supabase."})

    def log_message(self, *_args): pass
