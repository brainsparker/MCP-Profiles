import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { Problem } from "@/components/sections/Problem";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Trace } from "@/components/sections/Trace";
import { Memory } from "@/components/sections/Memory";
import { Privacy } from "@/components/sections/Privacy";
import { Install } from "@/components/sections/Install";
import { Footer } from "@/components/sections/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <Problem />
        <HowItWorks />
        <Trace />
        <Memory />
        <Privacy />
        <Install />
      </main>
      <Footer />
    </>
  );
}
