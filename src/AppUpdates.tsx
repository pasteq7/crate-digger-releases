import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { UpdateState } from "./types";

function useUpdates() {
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!window.crate) return;
    let mounted = true;
    let received = false;
    const off = window.crate.onUpdate((next) => {
      received = true;
      setState(next);
    });
    window.crate
      .updateState()
      .then((next) => {
        if (mounted && !received) setState(next);
      })
      .catch(() => {
        if (mounted) setError("Couldn’t read update status.");
      });
    return () => {
      mounted = false;
      off();
    };
  }, []);
  async function act(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^.*Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/,
          "",
        ),
      );
    }
  }
  return { state, error, act };
}

export function UpdateBanner() {
  const { state, error, act } = useUpdates();
  if (!state || !["ready", "installing"].includes(state.phase)) return null;
  return (
    <aside className="update-banner" aria-label="App update">
      <span role="status">
        {error || `Crate Digger ${state.nextVersion} is ready to install.`}
      </span>
      <button
        className="secondary-button"
        disabled={state.phase === "installing"}
        onClick={() => void act(() => window.crate!.installUpdate())}
      >
        <RefreshCw size={14} />
        {state.phase === "installing" ? "Restarting…" : "Restart to update"}
      </button>
    </aside>
  );
}

export function UpdateSettings() {
  const { state, error, act } = useUpdates();
  const disabled = !state || state.phase === "disabled";
  const working =
    state && ["checking", "downloading", "installing"].includes(state.phase);
  return (
    <section className="settings-section app-updates" aria-label="App updates">
      <div className="settings-section-heading">
        <div>
          <h2>App updates</h2>
          <p>{state ? `Crate Digger ${state.version}` : "Crate Digger"}</p>
        </div>
        <button
          className="secondary-button"
          disabled={disabled || !!working}
          onClick={() =>
            void act(() =>
              state?.phase === "ready"
                ? window.crate!.installUpdate()
                : window.crate!.checkUpdates(),
            )
          }
        >
          <RefreshCw size={15} className={working ? "spin" : ""} />
          {state?.phase === "ready"
            ? "Restart to update"
            : state?.phase === "checking"
              ? "Checking…"
              : state?.phase === "downloading"
                ? "Downloading…"
                : state?.phase === "installing"
                  ? "Restarting…"
                  : "Check for updates"}
        </button>
      </div>
      <p role="status">
        {error ||
          state?.message ||
          "Updates are available in the installed Windows app."}
      </p>
      {state?.phase === "downloading" && (
        <progress
          aria-label="Update download"
          value={state.percent ?? 0}
          max={100}
        />
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={state?.automatic ?? true}
          disabled={disabled || state?.phase === "installing"}
          onChange={(event) =>
            void act(() => window.crate!.automaticUpdates(event.target.checked))
          }
        />
        Automatically check for and download updates
      </label>
      <p className="settings-footnote">
        Updates install when you choose Restart to update. Finish imports and
        external commands first.
      </p>
    </section>
  );
}
