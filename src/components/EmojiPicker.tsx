import { useEffect, useRef, useState } from "react";

/** A curated set that suits worldbuilding. Anything else can be pasted or picked with Win + . */
const GROUPS: [string, string][] = [
  ["People", "🧙 🧝 🧛 🧟 🧞 🧜 🧚 🥷 🤴 👸 🫅 🧑‍🚀 🧑‍🔬 🧑‍⚕️ 🧑‍🌾 🧑‍🍳 🧑‍🎨 🧑‍✈️ 👮 💂 🕵️ 👤 👥 👶 🧓 🤖 👽 👻 💀 😈 👹"],
  ["Creatures", "🐉 🐲 🦄 🐺 🦅 🦉 🐦‍⬛ 🐍 🦂 🕷️ 🦇 🐗 🐻 🦁 🐎 🐋 🦈 🐙 🦑 🦀 🐢 🦎 🐾 🦴 🧬 🦠 🌿 🍄 🌵 🪸"],
  ["Places", "🏰 🏯 🏛️ ⛪ 🕌 🛕 🗼 🏘️ 🏚️ 🏭 🏗️ ⛺ 🗻 🏔️ 🌋 🏝️ 🏜️ 🌲 🌊 🌌 🌍 🪐 🌙 ☀️ ⭐ 🌑 🛰️ 🚀 🛸 🗺️"],
  ["Objects", "⚔️ 🗡️ 🛡️ 🏹 🪓 🔫 💣 🪄 🔮 📿 💎 👑 💍 🗝️ 🔑 📜 📖 📕 🧪 ⚗️ 💊 🩸 ⚙️ 🔧 🔋 💾 📡 🧭 ⏳ 🪙"],
  ["Groups & ideas", "🚩 🏳️ 🏴 ⚜️ ☠️ ⚖️ 🔥 ❄️ ⚡ 🌪️ ☢️ ☣️ ✨ 🌀 💫 🕯️ ♟️ 🎭 🎲 🧩 ❤️ 💔 🖤 🤝 🗣️ 📯 🔔 🧿 ☯️ 🔱"],
];

const isEmojiInput = (s: string) => /\p{Extended_Pictographic}/u.test(s);

export function EmojiPicker({
  value,
  onPick,
  onClose,
}: {
  value: string | null;
  onPick: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => (window.removeEventListener("mousedown", down), window.removeEventListener("keydown", key));
  }, [onClose]);

  const pick = (e: string | null) => (onPick(e), onClose());

  return (
    <div className="menu emoji-picker" ref={ref}>
      <div className="emoji-custom">
        <input
          autoFocus
          value={custom}
          placeholder="Paste any emoji, or press Win + ."
          onChange={(e) => {
            const v = e.target.value.trim();
            setCustom(v);
            if (isEmojiInput(v)) pick(v);
          }}
        />
        {value && (
          <button className="ghost" onClick={() => pick(null)}>
            Remove
          </button>
        )}
      </div>
      {GROUPS.map(([label, list]) => (
        <section key={label}>
          <h5>{label}</h5>
          <div className="emoji-grid">
            {list.split(" ").map((e) => (
              <button key={e} className={e === value ? "on" : ""} onClick={() => pick(e)}>
                {e}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
