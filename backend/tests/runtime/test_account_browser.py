"""以本地 API、真 PostgreSQL 與 production frontend 驗證帳號隔離；不啟動模型。"""

import socket
import threading
import time

import pytest
import uvicorn

import runtime.api.app as api_app
from browser_e2e_runner import main as run_browser
from test_closed_loop_v1 import closed_loop


def test_account_browser_with_real_api_and_database(closed_loop, monkeypatch):
    learner, source, settings, structure, dsn, _ = closed_loop
    monkeypatch.setattr(api_app, "runtime_preflight", lambda _: {})
    app = api_app.create_app(api_app.ApiSettings(
        profile="local", public_origin="http://127.0.0.1:4173",
        secure_cookie=False, local_config=settings, dsn=dsn,
    ))
    monkeypatch.setenv("STUDYDY_E2E_ACCOUNT_LEARNER", str(learner.learner_id))
    monkeypatch.setenv("STUDYDY_E2E_ACCOUNT_MATERIAL", str(source.material_id))
    monkeypatch.setenv("STUDYDY_E2E_ACCOUNT_RUN", structure["run_id"])
    monkeypatch.setenv("STUDYDY_E2E_ACCOUNT_REVISION", structure["revision"])
    monkeypatch.setenv("STUDYDY_E2E_ACCOUNT_ARTIFACT", str(source.artifact_id))
    # 綁定專屬測試 socket；埠占用時停止，絕不連到既有產品服務。
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", 8001))
        except OSError:
            pytest.fail("ACCOUNT_TEST_API_PORT_OCCUPIED", pytrace=False)
        server = uvicorn.Server(uvicorn.Config(app, lifespan="off", log_level="error", access_log=False))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(.05)
            assert server.started
            assert run_browser("e2e/accounts.spec.ts", production=True) == 0
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            assert not thread.is_alive()
