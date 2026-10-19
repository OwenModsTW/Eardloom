import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import { useStore } from "../store";

interface Status {
  exe: string;
  claudeDesktopInstalled: boolean;
  claudeDesktopConnected: boolean;
  codexInstalled: boolean;
  codexConnected: boolean;
  claudeCodeInstalled: boolean;
  claudeCodeConnected: boolean;
  claudeCodeCommand: string;
}

const PRIVATE_KEY = "eardloom.aiPrivate";

export const aiCanSeePrivate = () => {
  try {
    return localStorage.getItem(PRIVATE_KEY) === "1";
  } catch {
    return false;
  }
};

export const syncAiPrivacy = () => invoke("assistant_set_private", { include: aiCanSeePrivate() }).catch(() => {});

/** Connect the author's own AI app (Claude, Codex) to Eardloom. */
export function AiSettings() {
  const notify = useStore((s) => s.notify);
  const [status, setStatus] = useState<Status | null>(null);
  const [copied, setCopied] = useState(false);
  const [privateOn, setPrivateOn] = useState(aiCanSeePrivate);

  const reload = () => invoke<Status>("connector_status").then(setStatus);
  useEffect(() => {
    reload();
  }, []);

  const toggle = async (cmd: "connect_claude_desktop" | "connect_codex" | "connect_claude_code", connect: boolean, name: string) => {
    try {
      await invoke(cmd, { connect });
      await reload();
      notify(connect ? `Connected. Restart ${name} to see Eardloom's tools.` : `Disconnected from ${name}.`);
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <section>
      <h2>Connect another AI app</h2>
      <p className="hint">
        Use your own AI app with your world. Connect Claude or Codex here, then talk to them as usual: they can look things
        up in your world, review your chapters and suggest changes. Nothing changes until you approve it in Eardloom, and
        they're set up to help you write, not to write for you.
      </p>
      {status && (
        <div className="ai-apps">
          <div className="ai-app">
            <div>
              <strong>Claude Desktop</strong>
              <small>
                {status.claudeDesktopConnected
                  ? "Connected. Look for Eardloom in Claude's tools."
                  : status.claudeDesktopInstalled
                    ? "Installed."
                    : "Not found on this computer."}
              </small>
            </div>
            <button
              className={status.claudeDesktopConnected ? "ghost" : "primary"}
              onClick={() => toggle("connect_claude_desktop", !status.claudeDesktopConnected, "Claude Desktop")}
            >
              {status.claudeDesktopConnected ? "Disconnect" : "Connect"}
            </button>
          </div>
          <div className="ai-app">
            <div>
              <strong>Codex</strong>
              <small>{status.codexConnected ? "Connected." : status.codexInstalled ? "Installed." : "Not found on this computer."}</small>
            </div>
            <button className={status.codexConnected ? "ghost" : "primary"} onClick={() => toggle("connect_codex", !status.codexConnected, "Codex")}>
              {status.codexConnected ? "Disconnect" : "Connect"}
            </button>
          </div>
          <div className="ai-app">
            <div>
              <strong>Claude Code</strong>
              <small>
                {status.claudeCodeConnected
                  ? "Connected. Eardloom's tools are available in Claude Code."
                  : status.claudeCodeInstalled
                    ? "Installed."
                    : "Not found on this computer."}
              </small>
            </div>
            {status.claudeCodeInstalled && (
              <button
                className={status.claudeCodeConnected ? "ghost" : "primary"}
                onClick={() => toggle("connect_claude_code", !status.claudeCodeConnected, "Claude Code")}
              >
                {status.claudeCodeConnected ? "Disconnect" : "Connect"}
              </button>
            )}
          </div>
          <div className="ai-app column">
            <div>
              <small>Or set up Claude Code yourself in PowerShell:</small>
            </div>
            <div className="row">
              <code className="grow">{status.claudeCodeCommand}</code>
              <button
                className="icon-btn"
                title="Copy"
                onClick={async () => {
                  await navigator.clipboard.writeText(status.claudeCodeCommand);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={privateOn}
          onChange={(e) => {
            setPrivateOn(e.target.checked);
            try {
              localStorage.setItem(PRIVATE_KEY, e.target.checked ? "1" : "0");
            } catch {
              /* preference only */
            }
            syncAiPrivacy();
          }}
        />
        <span>
          Let assistants see private entries
          <small>Off by default: entries marked Private stay hidden from AI apps.</small>
        </span>
      </label>
      <p className="hint">
        Eardloom has to be open for an assistant to use your world. Your AI app runs on your own account; Eardloom never sees
        your login or sends anything anywhere itself.
      </p>
    </section>
  );
}
