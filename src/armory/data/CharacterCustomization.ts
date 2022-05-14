import * as fs from "fs";
const fsp = fs.promises;
import * as path from "path";

export class CharacterCustomization {
	private data: { [key: number]: { [key: number]: unknown } };

	public async loadData(): Promise<void> {
		this.data = {};
		const races = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11];
		const genders = [0, 1];

		for (const race of races) {
			this.data[race] = {};

			for (const gender of genders) {
				const buffer = await fsp.readFile(path.join(process.cwd(), `data/meta/charactercustomization2/${race}_${gender}.json`));
				const customizationData = JSON.parse(buffer.toString());
				this.data[race][gender] = customizationData;
			}
		}
	}

	public getCharacterCustomizationData(race: number, gender: number): unknown {
		return this.data[race][gender];
	}
}
