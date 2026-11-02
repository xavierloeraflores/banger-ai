import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Producer } from "@/components/producer/producer";

export default function Home() {
  const source = readFileSync(resolve(process.cwd(), "../../examples/night-drive.banger"), "utf8");
  return <Producer initialFile={{ name: "night-drive.banger", source }} />;
}
