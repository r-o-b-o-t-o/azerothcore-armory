import { Armory } from "./Armory";

async function main(): Promise<void> {
	require("source-map-support").install();

	const armory = new Armory();
	armory.start();
}

main();
