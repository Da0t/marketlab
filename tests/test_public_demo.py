from datetime import datetime, timezone
from fastapi.testclient import TestClient
import pytest
from app import create_app


@pytest.fixture
def client():
    with TestClient(create_app(public=True)) as client:
        yield client


def fresh():
    return {"version":1,"started_at":datetime.now(timezone.utc).isoformat(),"history":[]}


def call(client, session, path, body=None):
    response=client.post("/api/demo",json={"path":path,"body":body,"session":session})
    assert response.status_code==200, response.text
    result=response.json()
    session.update(result["session"])
    return result["value"]


def test_java_engine_is_real_isolated_and_replayable(client):
    a,b=fresh(),fresh()
    result=call(client,a,"/api/market/orders",{"id":"order1","side":"buy","type":"market","quantity":50})
    assert result["state"]["position"]==150
    assert call(client,b,"/api/market/state")["state"]["position"]==100
    call(client,a,"/api/market/step",{"ticks":10})
    before=call(client,a,"/api/market/state")["state"]
    replay=call(client,a,"/api/market/replay",{})
    assert replay["result"]["identical"]
    assert replay["state"]==before
    assert all(before["checks"].values())


def test_public_invalid_command_cannot_escape_sandbox(client):
    for path in ["/api/market/orders/x\nRESET/cancel", "/etc/passwd", "/api/ledger/state/../../secret"]:
        response=client.post("/api/demo",json={"path":path,"body":{},"session":fresh()})
        assert response.status_code==409


def test_public_workload_and_payload_caps(client):
    session=fresh()
    for _ in range(11):
        session["history"].append({"path":"/api/market/step","body":{"ticks":100},"at":session["started_at"],"nonce":"01234567"})
    assert client.post("/api/demo",json={"path":"/api/market/state","session":session}).status_code==409
    assert client.post("/api/demo",content=b"x"*100001).status_code==413


def test_liquidity_reset_starts_a_new_transcript(client):
    session=fresh()
    call(client,session,"/api/market/orders",{"id":"o1","side":"buy","type":"market","quantity":50})
    value=call(client,session,"/api/market/reset",{"liquidity":"thin"})
    assert len(session["history"])==1
    assert value["state"]["position"]==100
    value=call(client,session,"/api/market/orders",{"id":"o2","side":"buy","type":"market","quantity":50})
    assert value["result"]["filled"]==45


def test_independent_application(client):
    assert client.get('/').status_code == 200
    assert client.get('/clearledger').status_code == 404
    assert client.get('/api/ledger/state').status_code == 404
    assert client.get('/api/market/state').status_code == 404
    assert client.post('/api/demo', json={'path':'/api/ledger/state','session':fresh()}).status_code == 409
    assert client.post('/api/demo', content=b'x'*100001).status_code == 413
    assert client.get('/openapi.json').json()['info']['title'] == 'MarketLab'
