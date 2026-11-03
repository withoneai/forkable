import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { IntegrationsSection } from "./components/IntegrationsSection";
import { BuildSection } from "./components/BuildSection";
import { PublishSection } from "./components/PublishSection";
import { FAQSection } from "./components/FAQSection";
import { Closing } from "./components/Closing";
import { Footer } from "./components/Footer";

export function App() {
  return (
    <div className="grain min-h-full overflow-x-clip bg-background">
      <Header />
      <main>
        <Hero />
        <IntegrationsSection />
        <BuildSection />
        <PublishSection />
        <FAQSection />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
