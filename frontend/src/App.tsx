import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, errorMessage, StudydyApiClient, type LearnerIdentity } from "./api/client";
import { AppShell } from "./app/AppShell";
import { readRoute, writeRoute, type AppRoute } from "./app/routes";
import { MaterialFlow } from "./features/material-flow/MaterialFlow";
import { StateView } from "./ui/StateView";

type SessionState =
  | { status: "starting" }
  | { status: "signed-out" }
  | { status: "ready"; identity: LearnerIdentity; api: StudydyApiClient }
  | { status: "failed"; message: string; logoutPending: boolean };

function AccountForm({ authenticate }: {
  authenticate: (mode: "login" | "register", username: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <section className="surface account-form">
      <h1>{mode === "login" ? "登入 Studydy" : "建立帳號"}</h1>
      <p>使用同一帳號登入，可保留相同的學習身分。登出不會刪除教材或學習資料。</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        setBusy(true);
        setMessage("");
        try { await authenticate(mode, String(fields.get("username")), String(fields.get("password"))); }
        catch (error) { setMessage(errorMessage(error)); }
        finally { form.reset(); setBusy(false); }
      }}>
        <label>帳號名稱<input name="username" autoComplete="username" required pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} disabled={busy} /></label>
        <p>3–32 個英文字母、數字或底線，不區分大小寫。</p>
        <label>密碼<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={15} maxLength={128} disabled={busy} /></label>
        <p>15–128 個字元，可使用空格；請妥善保存，目前沒有密碼重設功能。</p>
        {message && <p role="alert" className="form-error">{message}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "處理中…" : mode === "login" ? "登入" : "註冊"}</button>
        <button className="secondary-button" disabled={busy} type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>{mode === "login" ? "建立新帳號" : "已有帳號，前往登入"}</button>
      </form>
    </section>
  );
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => readRoute(window.location.pathname).route);
  const [session, setSession] = useState<SessionState>({ status: "starting" });
  const currentClient = useRef<StudydyApiClient | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const clearPrivateView = useCallback(() => {
    currentClient.current?.invalidate();
    currentClient.current = null;
    setSession({ status: "signed-out" });
    writeRoute({ name: "home" }, true);
  }, []);

  const newClient = useCallback(() => {
    currentClient.current?.invalidate();
    const api = new StudydyApiClient();
    currentClient.current = api;
    api.onSessionExpired = () => {
      if (currentClient.current === api) clearPrivateView();
    };
    return api;
  }, [clearPrivateView]);

  const startSession = useCallback(() => {
    setSession({ status: "starting" });
    const api = newClient();
    void api.ensureSession().then(
      (identity) => { if (currentClient.current === api) setSession({ status: "ready", identity, api }); },
      (error) => {
        if (currentClient.current !== api) return;
        if (error instanceof ApiClientError && error.reasonCode === "SESSION_REQUIRED") clearPrivateView();
        else setSession({ status: "failed", message: errorMessage(error), logoutPending: false });
      },
    );
  }, [newClient, clearPrivateView]);

  const logout = async () => {
    clearPrivateView();
    setSession({ status: "starting" });
    channel.current?.postMessage("identity-changed");
    try {
      await new StudydyApiClient().logout();
      setSession({ status: "signed-out" });
    } catch (error) {
      setSession({ status: "failed", message: `登出尚未完成。${errorMessage(error)}`, logoutPending: true });
    }
  };

  useEffect(() => {
    startSession();
    channel.current = new BroadcastChannel("studydy-account");
    channel.current.onmessage = clearPrivateView;
    const restorePage = (event: PageTransitionEvent) => { if (event.persisted) { clearPrivateView(); window.location.reload(); } };
    window.addEventListener("pageshow", restorePage);
    return () => {
      currentClient.current?.invalidate();
      channel.current?.close();
      window.removeEventListener("pageshow", restorePage);
    };
  }, [startSession, clearPrivateView]);

  useEffect(() => {
    if (session.status !== "ready") return;
    const refresh = () => {
      void session.api.ensureSession().then((identity) => {
        if (identity.learner_id !== session.identity.learner_id) clearPrivateView();
      }).catch(() => { /* 401 由 client 清除畫面；暫時連線失敗不重送產品寫入。 */ });
    };
    const timer = window.setInterval(refresh, 60 * 60 * 1000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [session, clearPrivateView]);

  useEffect(() => {
    const readLocation = () => {
      const next = readRoute(window.location.pathname);
      if (!next.isCanonical) writeRoute({ name: "home" }, true);
      setRoute(next.route);
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);

  return (
    <AppShell route={session.status === "ready" ? route : { name: "home" }} sessionStatus={session.status === "signed-out" ? "failed" : session.status}
      accountAction={session.status === "ready" && <button className="secondary-button" type="button" onClick={() => void logout()}>登出</button>}>
      {session.status === "starting" && <StateView description="正在確認帳號工作階段，請稍候。" live title="連線中" tone="loading" />}
      {session.status === "signed-out" && <AccountForm authenticate={async (mode, username, password) => {
        const api = newClient();
        const identity = await api.authenticate(mode, username, password);
        if (currentClient.current !== api) return;
        writeRoute({ name: "home" }, true);
        channel.current?.postMessage("identity-changed");
        setSession({ status: "ready", identity, api });
      }} />}
      {session.status === "ready" && <MaterialFlow key={session.identity.learner_id} apiClient={session.api} route={route} />}
      {session.status === "failed" && <StateView action={<button className="primary-button" type="button" onClick={() => session.logoutPending ? void logout() : startSession()}>再試一次</button>}
        description={session.message} title="暫時無法完成" tone="failure" />}
    </AppShell>
  );
}
