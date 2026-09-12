import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, errorMessage, StudydyApiClient, type LearnerIdentity } from "./api/client";
import { AppShell } from "./app/AppShell";
import { readRoute, writeRoute, type AppRoute } from "./app/routes";
import { MaterialFlow } from "./features/material-flow/MaterialFlow";
import { StateView } from "./ui/StateView";
import { AccountFrame, AccountPage } from "./features/account/AccountPage";

type SessionState =
  | { status: "starting" }
  | { status: "signed-out" }
  | { status: "ready"; identity: LearnerIdentity; api: StudydyApiClient }
  | { status: "failed"; message: string; logoutPending: boolean };

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => readRoute(window.location.pathname).route);
  const [session, setSession] = useState<SessionState>({ status: "starting" });
  const currentClient = useRef<StudydyApiClient | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  const clearPrivateView = useCallback(() => {
    currentClient.current?.invalidate();
    currentClient.current = null;
    setSession({ status: "signed-out" });
    if (!["/login", "/register"].includes(window.location.pathname)) {
      window.history.replaceState(null, "", "/login");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
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
      (identity) => { if (currentClient.current === api) {
        if (["/login", "/register"].includes(window.location.pathname)) writeRoute({ name: "home" }, true);
        setSession({ status: "ready", identity, api });
      } },
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
    const api = newClient();
    try {
      await api.logout();
      if (currentClient.current !== api) return;
      setSession({ status: "signed-out" });
    } catch (error) {
      if (currentClient.current !== api) return;
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
        if (currentClient.current === session.api && identity.learner_id !== session.identity.learner_id) clearPrivateView();
      }).catch(() => { /* 401 由 client 清除畫面；暫時連線失敗不重送產品寫入。 */ });
    };
    const timer = window.setInterval(refresh, 60 * 60 * 1000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [session, clearPrivateView]);

  useEffect(() => {
    const readLocation = () => {
      if (["/login", "/register"].includes(window.location.pathname)) { setRoute({ name: "home" }); return; }
      const next = readRoute(window.location.pathname);
      if (!next.isCanonical) writeRoute({ name: "home" }, true);
      setRoute(next.route);
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);

  if (session.status !== "ready") {
    const mode = window.location.pathname === "/register" ? "register" : "login";
    if (["/login", "/register"].includes(window.location.pathname) || session.status === "signed-out") return <AccountPage key={mode} mode={mode}
      sessionNotice={session.status === "failed" && session.logoutPending ? <div role="alert"><p>{session.message}</p><button type="button" onClick={() => void logout()}>再試一次</button></div> : undefined}
      authenticate={async (action, email, password) => {
      const api = newClient();
      let identity: LearnerIdentity;
      try { identity = await api.authenticate(action, email, password); }
      catch (error) { if (currentClient.current !== api) return; throw error; }
      if (currentClient.current !== api) return;
      writeRoute({ name: "home" }, true);
      channel.current?.postMessage("identity-changed");
      setSession({ status: "ready", identity, api });
    }} />;
    return <AccountFrame mode={mode}>{session.status === "starting"
      ? <StateView description="正在確認帳戶狀態，請稍候。" live title="連線中" tone="loading" />
      : <StateView action={<button className="primary-button" type="button" onClick={() => session.logoutPending ? void logout() : startSession()}>再試一次</button>}
          description={session.message} title="暫時無法完成" tone="failure" />}</AccountFrame>;
  }
  return <AppShell route={route}
    accountAction={<button className="secondary-button" type="button" onClick={() => void logout()}>登出</button>}>
    <MaterialFlow key={session.identity.learner_id} apiClient={session.api} route={route} />
  </AppShell>;
}
