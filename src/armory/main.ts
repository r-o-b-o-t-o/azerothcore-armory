import "dotenv/config";
import "source-map-support/register";

import { Armory } from "./Armory";

async function main(): Promise<void> {
	const armory = new Armory();
	await armory.start();
}

main();
