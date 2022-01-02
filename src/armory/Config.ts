import * as fs from "fs";
const fsp = fs.promises;

export interface IDatabaseConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
}

export interface IRealmConfig {
	name: string;
	database: IDatabaseConfig;
}

export class Config {
	public realms: IRealmConfig[];

	private static checkedMissingField: boolean = false;

	public static async load(): Promise<Config> {
		const json: Buffer = await fsp.readFile("config.json");
		const config = JSON.parse(json.toString()) as Config;

		if (!Config.checkedMissingField) {
			const defaultConfigJson = await fsp.readFile("config.default.json");
			const defaultConfig = JSON.parse(defaultConfigJson.toString());
			Config.checkAllMissingFields(config, defaultConfig);
			Config.checkedMissingField = true;
		}

		return config;
	}

	private static checkAllMissingFields(obj: object, model: object, parentName: string = "") {
		const missing = Config.hasMissingFields(obj, model);
		if (parentName !== "") {
			parentName += ".";
		}
		for (const field of missing) {
			console.warn(`Field ${parentName}${field} is missing in config.json!`);
		}
		for (const key in model) {
			if (typeof model[key] === "object" && obj.hasOwnProperty(key)) {
				Config.checkAllMissingFields(obj[key], model[key], parentName + key);
			}
		}
	}

	private static hasMissingFields(obj: object, model: object): string[] {
		const missing = [];
		for (const key in model) {
			if (!obj.hasOwnProperty(key)) {
				missing.push(key);
			}
		}
		return missing;
	}
};
