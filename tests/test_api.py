import pytest
from fastapi.testclient import TestClient
import marketlab.api as market_api
from marketlab.bridge import Market
from app import create_app

@pytest.fixture
def client():
    engine=Market()
    market_api.market=engine
    with TestClient(create_app(public=False)) as client:
        yield client
    engine.close()

def test_market_api_validation_and_replay(client):
    assert client.post("/api/market/orders", json={"id":"x\nRESET", "side":"buy", "type":"market", "quantity":1}).status_code == 422
    response = client.post("/api/market/orders", json={"id":"x", "side":"buy", "type":"market", "quantity":50})
    assert response.status_code == 200
    assert response.json()["result"]["filled"] == 50
    assert client.post("/api/market/replay").json()["result"]["identical"]
