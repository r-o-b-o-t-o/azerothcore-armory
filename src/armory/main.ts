import 'dotenv/config';
import { Armory } from './Armory';

async function main(): Promise<void> {
  require('source-map-support').install();

  const armory = new Armory();
  await armory.start();
}

main();
