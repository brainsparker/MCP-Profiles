import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { Problem } from "@/components/sections/Problem";
import { Idea } from "@/components/sections/Idea";
import { WhyItMatters } from "@/components/sections/WhyItMatters";
import { ExampleProfiles } from "@/components/sections/ExampleProfiles";
import { Vision } from "@/components/sections/Vision";
import { Footer } from "@/components/sections/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <Problem />
        <Idea />
        <WhyItMatters />
        <ExampleProfiles />
        <Vision />
      </main>
      <Footer />
    </>
  );
}
