import { useState } from "react";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { IntegrationsSection } from "./components/IntegrationsSection";
import { TemplateGallery } from "./components/TemplateGallery";
import { BlocksSection } from "./components/BlocksSection";
import { ChatSection } from "./components/ChatSection";
import { ForkSection } from "./components/ForkSection";
import { PublishSection } from "./components/PublishSection";
import { Closing } from "./components/Closing";
import { Footer } from "./components/Footer";
import { TEMPLATES } from "./lib/templates";

export function App() {
  const [selected, setSelected] = useState(TEMPLATES[0]);
  // A coming-soon card still previews in the gallery, but the hero and the
  // fork steps stay on a template you can fork today.
  const forkable = selected.comingSoon ? TEMPLATES[0] : selected;
  return (
    <div className="grain min-h-full overflow-x-clip bg-background">
      <Header />
      <main>
        <Hero template={forkable} />
        <IntegrationsSection />
        <TemplateGallery selected={selected} onSelect={setSelected} />
        <BlocksSection />
        <ChatSection />
        <ForkSection template={forkable} />
        <PublishSection />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
