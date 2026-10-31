import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { IntegrationsSection } from "./components/IntegrationsSection";
import { HybridSearchSection } from "./components/HybridSearchSection";
import { AskSection } from "./components/AskSection";
import { SurfacesSection } from "./components/SurfacesSection";
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
        <HybridSearchSection />
        <AskSection />
        <SurfacesSection />
        <FAQSection />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
