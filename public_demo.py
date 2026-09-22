"""Isolated stateless hosting adapter for the MarketLab Java engine.

Each browser tab owns a bounded command transcript. Every public request rebuilds
that tab's sandbox on the server. No money or shared customer data is stored, and
serverless cold starts cannot mix or silently reset another visitor's session.
This is explicitly a replayable demo, not a durable hosted financial service.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import threading
from typing import Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from marketlab.api import Order, Step, Reset

ROOT = Path(__file__).resolve().parent
router = APIRouter(tags=["Public sandboxes"])
compile_lock = threading.Lock()
MAX_COMMANDS = 200


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(max_length=220)
    body: dict = Field(default_factory=dict)
    at: datetime
    nonce: str = Field(pattern=r"^[a-f0-9]{8}$")


class Session(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    started_at: datetime
    history: list[Command] = Field(default_factory=list, max_length=MAX_COMMANDS)


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(max_length=220)
    body: dict | None = None
    session: Session


def java_command(path, data):
    if path == "/api/market/state":
        return "STATE"
    if path == "/api/market/replay":
        return "REPLAY"
    if path == "/api/market/reset":
        p = Reset.model_validate(data)
        return "RESET\t" + p.liquidity
    if path == "/api/market/step":
        p = Step.model_validate(data)
        return f"STEP\t{p.ticks}"
    if path == "/api/market/orders":
        p = Order.model_validate(data)
        return f"ORDER\t{p.id}\t{p.side}\t{p.type}\t{p.quantity}\t{p.limit}"
    if match := re.fullmatch(r"/api/market/orders/([A-Za-z0-9_-]{1,64})/cancel", path):
        return "CANCEL\t" + match[1]
    if path in ("/api/market/feed/disconnect", "/api/market/feed/reconnect"):
        return path.rsplit("/", 1)[1].upper()
    raise ValueError("Unsupported market operation")


def run_java(commands):
    bundled = ROOT / ".runtime" / "java" / "bin" / "java"
    executable = str(bundled) if bundled.exists() else "java"
    build = ROOT / "marketlab" / "build"
    source = ROOT / "marketlab" / "java" / "MarketEngine.java"
    target = build / "MarketEngine.class"
    if not bundled.exists():
        with compile_lock:
            if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
                build.mkdir(exist_ok=True)
                subprocess.run(["javac", "-encoding", "UTF-8", "--release", "17", "-d", str(build), str(source)], check=True, capture_output=True, timeout=30)
    result = subprocess.run([executable, "-Dfile.encoding=UTF-8", "-Xms16m", "-Xmx128m", "-XX:ActiveProcessorCount=1", "-cp", str(build), "MarketEngine", "--batch"],
        input="\n".join(commands)+"\n", text=True, encoding="utf-8", capture_output=True, timeout=12)
    if result.returncode != 0:
        raise RuntimeError("Java sandbox could not start")
    value = json.loads(result.stdout)
    if "error" in value:
        raise ValueError(value["error"])
    return value


def execute(envelope):
    session = envelope.session.model_copy(deep=True)
    path = envelope.path
    state_read = path in ("/api/market/state", "/api/market/replay")
    if path == "/api/market/reset":
        session.history = []
    if not state_read and len(session.history) >= MAX_COMMANDS:
        raise ValueError("This sandbox reached 200 actions. Use New session to start again.")
    current = Command(path=path, body=envelope.body or {}, at=datetime.now(timezone.utc), nonce=uuid4().hex[:8])
    if path.startswith("/api/market/"):
        commands = [java_command(c.path, c.body) for c in session.history]
        if any(command in ("STATE", "REPLAY") for command in commands):
            raise ValueError("Read commands cannot be recorded as mutations")
        commands.append(java_command(path, current.body))
        ticks = sum(int(c.split("\t")[1]) for c in commands if c.startswith("STEP\t"))
        if ticks > 1000:
            raise ValueError("This public session reached 1,000 ticks. Use New session to start again.")
        value = run_java(commands)
    else:
        raise ValueError("Unsupported sandbox route")
    if not state_read:
        session.history.append(current)
    return {"value": value, "session": session.model_dump(mode="json")}


@router.post("/api/demo")
async def demo(request: Request):
    # Bound both request-body allocation and re-execution work for an anonymous demo.
    if int(request.headers.get("content-length", "0")) > 100_000:
        raise HTTPException(413, "Sandbox request is too large")
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 100_000:
            raise HTTPException(413, "Sandbox request is too large")
    try:
        envelope = Envelope.model_validate_json(payload)
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(execute, envelope)
    except (ValidationError, ValueError) as exc:
        detail = "Invalid sandbox input" if isinstance(exc, ValidationError) else str(exc)
        raise HTTPException(409, detail) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(503, "Sandbox execution timed out. Start a new session.") from exc
