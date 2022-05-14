import * as fs from "fs";
const fsp = fs.promises;

import * as winston from "winston";

export interface IDatabaseConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
}

export interface IRealmConfig {
	name: string;
	realmId: number;
	authDatabase: string;
	charactersDatabase: IDatabaseConfig;
}

export interface IIframeModeConfig {
	enabled: boolean;
	url: string;
}

export class Config {
	public aowowUrl: string;
	public websiteUrl: string;
	public websiteName: string;
	public websiteRoot: string;
	public iframeMode: IIframeModeConfig;
	public loadDbcs: boolean;
	public hideGameMasters: boolean;
	public transmogModule: boolean;
	public useZamCdn: boolean;
	public realms: IRealmConfig[];
	public worldDatabase: IDatabaseConfig;
	public dbQueryTimeout: number;

	private static envPrefix = "ACORE_ARMORY";
	private static checkedMissingField = false;

	public static async load(logger: winston.Logger): Promise<Config> {
		try {
			await fsp.access("config.json");
			return await Config.loadFromFile(logger);
		} catch (err) {
			return await Config.loadFromEnv(logger);
		}
	}

	private static async loadFromFile(logger: winston.Logger): Promise<Config> {
		const json: Buffer = await fsp.readFile("config.json");
		const config = JSON.parse(json.toString()) as Config;

		if (!Config.checkedMissingField) {
			const defaultConfigJson = await fsp.readFile("config.default.json");
			const defaultConfig = JSON.parse(defaultConfigJson.toString());
			Config.checkAllMissingFields(logger, config, defaultConfig);
			Config.checkedMissingField = true;
		}

		return config;
	}

	private static async loadFromEnv(logger: winston.Logger): Promise<Config> {
		const config = {};
		const json = await fsp.readFile("config.default.json");
		const defaultConfig = JSON.parse(json.toString());
		Config.loadObjFromEnv(logger, config, defaultConfig);
		Config.checkedMissingField = true;
		return config as Config;
	}

	private static loadObjFromEnv(logger: winston.Logger, obj: object, model: object, parentName = "") {
		if (parentName !== "") {
			parentName += ".";
		}

		for (const field in model) {
			if (!Object.hasOwnProperty.call(model, field)) {
				continue;
			}

			if (Array.isArray(model[field])) {
				obj[field] = Config.loadArrayFromEnv(logger, model[field][0], parentName + field);
			} else if (typeof model[field] === "object") {
				obj[field] = {};
				Config.loadObjFromEnv(logger, obj[field], model[field], parentName + field);
			} else if (!Object.hasOwnProperty.call(obj, field)) {
				const key = Config.getEnvKey(parentName + field);
				if (Object.hasOwnProperty.call(process.env, key)) {
					obj[field] = Config.parseEnvValue(process.env[key], model[field]);
				} else if (!Config.checkedMissingField) {
					logger.warn(`Config field ${key} is missing from .env!`);
				}
			}
		}
	}

	private static loadArrayFromEnv(logger: winston.Logger, model, parentName = ""): unknown[] {
		if (parentName !== "") {
			parentName += ".";
		}

		const arr = [];
		let i = 0;
		for (;;) {
			const key = Config.getEnvKey(parentName + i);
			const found = Object.keys(process.env).some((k) => k.startsWith(key));
			if (!found) {
				break;
			}

			if (Array.isArray(model)) {
				arr.push(Config.loadArrayFromEnv(logger, model[0], parentName + i));
			} else if (typeof model === "object") {
				const obj = {};
				Config.loadObjFromEnv(logger, obj, model, parentName + i);
				if (Object.keys(obj).length) {
					arr.push(obj);
				}
			} else if (Object.hasOwnProperty.call(process.env, key)) {
				arr.push(Config.parseEnvValue(process.env[key], model));
			} else {
				break;
			}

			++i;
		}

		return arr;
	}

	private static getEnvKey(key: string): string {
		return (
			Config.envPrefix +
			"_" +
			key
				.replace(/\./g, "__")
				.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
				.toUpperCase()
		);
	}

	private static parseEnvValue(value: string, model: boolean | number | string): boolean | number | string {
		const type = typeof model;
		const lower = value.toLowerCase();
		if (type === "boolean") {
			return lower === "true" || value === "1";
		}
		if (type === "number") {
			return parseFloat(value);
		}
		return value;
	}

	private static checkAllMissingFields(logger: winston.Logger, obj: object, model: object, parentName = "") {
		const missing = Config.hasMissingFields(obj, model);
		if (parentName !== "") {
			parentName += ".";
		}
		for (const field of missing) {
			logger.warn(`Field ${parentName}${field} is missing from config.json!`);
		}
		for (const key of Object.keys(model)) {
			if (typeof model[key] === "object" && Object.hasOwnProperty.call(obj, key)) {
				Config.checkAllMissingFields(logger, obj[key], model[key], parentName + key);
			}
		}
	}

	private static hasMissingFields(obj: object, model: object): string[] {
		const objProp = Object.keys(obj);
		const missingProps = Object.keys(model).filter((key) => !objProp.includes(key));
		return missingProps;
	}
}
