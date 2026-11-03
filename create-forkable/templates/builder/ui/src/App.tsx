import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "./components/ui/Toast";
import { CommandPalette } from "./components/CommandPalette";
import { Cheatsheet } from "./components/Cheatsheet";
import { Home } from "./screens/Home";
import { Editor } from "./screens/Editor";
import { Settings } from "./screens/Settings";
import { ConnectSetup } from "./screens/ConnectSetup";
import { useKeys } from "./lib/keys";
import { bind } from "./lib/keymap";
import { useSettings } from "./lib/queries";
import { setTheme } from "./lib/theme";
import { setSize } from "./lib/scale";
import { onKeyFromPreview } from "./lib/previewKeys";

/** Server settings win once on load, so theme and size follow the builder across browsers. */
function SettingsSync() {
  const s = useSettings();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !s.data) return;
    done.current = true;
    const local = localStorage.getItem("builder.theme");
    if (!local) setTheme(s.data.settings.theme);
    if (!localStorage.getItem("builder.size")) setSize(s.data.settings.size);
  }, [s.data]);
  return null;
}

export function App() {
  const [palette, setPalette] = useState(false);
  const [cheat, setCheat] = useState(false);
  const loc = useLocation();
  useKeys(bind({ palette: () => setPalette((v) => !v) }), { whileTyping: true, priority: 10 });
  useKeys(bind({ cheatsheet: () => setCheat((v) => !v) }));
  useEffect(() => { setPalette(false); }, [loc.pathname]);
  // Keys pressed inside the preview iframe arrive over the channel.
  useEffect(() => onKeyFromPreview((k) => {
    if (k === "mod+k") setPalette((v) => !v);
    if (k === "?") setCheat((v) => !v);
  }), []);

  return (
    <>
      <SettingsSync />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/p/:projectId/:tab?" element={<Editor />} />
        <Route path="/settings/:section?" element={<Settings />} />
        <Route path="/setup/connect/:setupId?" element={<ConnectSetup />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onCheatsheet={() => setCheat(true)} />
      <Cheatsheet open={cheat} onClose={() => setCheat(false)} />
      <Toaster />
    </>
  );
}
