import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { Connected } from "@/screens/Connected";
import { Toaster } from "@/components/ui/Toast";
import { SearchPage } from "@/screens/SearchPage";
import { EntityPage } from "@/screens/EntityPage";
import { SourceDetail } from "@/screens/SourceDetail";
import { Access } from "@/screens/Access";
import { ConnectSetup } from "@/screens/ConnectSetup";
import { Start } from "@/screens/Start";
import { SettingsLayout } from "@/screens/settings/SettingsLayout";
import { GeneralSettings } from "@/screens/settings/GeneralSettings";
import { IntegrationsSettings } from "@/screens/settings/IntegrationsSettings";
import { SearchSettings } from "@/screens/settings/SearchSettings";
import { AssistantSettings } from "@/screens/settings/AssistantSettings";
import { DatabaseSettings } from "@/screens/settings/DatabaseSettings";
import { ApiSettings } from "@/screens/settings/ApiSettings";

// Routes from SPEC 15.1. /start and /setup/connect sit outside the shell;
// everything else needs a signed-in (or sample) user, which Shell checks.
export function App() {
  return (
    <>
      <Routes>
        <Route path="/start" element={<Start />} />
        <Route path="/setup/connect" element={<ConnectSetup />} />
        <Route path="/connected" element={<Connected />} />
        <Route element={<Shell />}>
          <Route index element={<SearchPage />} />
          <Route path="/item/:id" element={<SearchPage />} />
          <Route path="/people/:entityId" element={<EntityPage />} />
          <Route path="/companies/:entityId" element={<EntityPage />} />
          <Route path="/sources/:id" element={<SourceDetail />} />
          <Route path="/access" element={<Access />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="integrations/*" element={<IntegrationsSettings />} />
            <Route path="search" element={<SearchSettings />} />
            <Route path="assistant" element={<AssistantSettings />} />
            <Route path="database" element={<DatabaseSettings />} />
            <Route path="api" element={<ApiSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
