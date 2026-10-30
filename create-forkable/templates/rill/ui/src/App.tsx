import { Navigate, Route, Routes } from "react-router-dom";
import { MailboxProvider, useMailbox } from "./lib/mailbox";
import { Toaster } from "./components/ui/Toast";
import { Shell } from "./components/Shell";
import { Start } from "./screens/Start";
import { Inbox } from "./screens/Inbox";
import { Brief } from "./screens/Brief";
import { Calendar } from "./screens/Calendar";
import { Access } from "./screens/Access";
import { SettingsLayout } from "./screens/settings/SettingsLayout";
import { GoalsSettings } from "./screens/settings/GoalsSettings";
import { VipsSettings } from "./screens/settings/VipsSettings";
import { CalendarSettings } from "./screens/settings/CalendarSettings";
import { EngineSettings } from "./screens/settings/EngineSettings";
import { DatabaseSettings } from "./screens/settings/DatabaseSettings";
import { GeneralSettings } from "./screens/settings/GeneralSettings";
import { Splash } from "./components/Splash";
import { ConnectSetup } from "./screens/ConnectSetup";

function Root() {
  const { loading, mailbox } = useMailbox();
  if (loading) return <Splash />;
  if (!mailbox || !mailbox.onboarded) return <Navigate to="/start" replace />;
  return <Navigate to="/inbox/vip" replace />;
}

export function App() {
  return (
    <MailboxProvider>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/start" element={<Start />} />
        <Route path="/setup/connect" element={<ConnectSetup />} />
        <Route element={<Shell />}>
          <Route path="/inbox/:lane?" element={<Inbox />} />
          <Route path="/thread/:threadId" element={<Inbox />} />
          <Route path="/all/thread/:threadId" element={<Inbox all />} />
          <Route path="/all/:lane?" element={<Inbox all />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/access" element={<Access />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="goals" element={<GoalsSettings />} />
            <Route path="vips" element={<VipsSettings />} />
            <Route path="calendars" element={<CalendarSettings />} />
            <Route path="engine" element={<EngineSettings />} />
            <Route path="database" element={<DatabaseSettings />} />
            <Route path="general" element={<GeneralSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </MailboxProvider>
  );
}
