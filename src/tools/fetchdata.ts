import * as fs from "fs";
const fsp = fs.promises;
import * as path from "path";

import * as pako from "pako";
import fetch from "node-fetch";
import * as mkdirp from "mkdirp";
import * as csv from "csv-parser";
import * as glob from "glob-promise";
import { Response } from "node-fetch";
import * as prettyMs from "pretty-ms";
import * as camelCase from "camelcase";
import * as cliProgress from "cli-progress";
import promisepool = require("@supercharge/promise-pool");

require("source-map-support").install();

const baseUrl = "https://wow.zamimg.com/modelviewer/live";

class Stopwatch {
	private startTime: Date;

	public constructor() {
		this.start();
	}

	public start(): void {
		this.startTime = new Date();
	}

	public stop(text?: string): void {
		const dt = Date.now() - this.startTime.getTime();
		const txt = text ?? "Done in {time}";
		console.log(txt.replace("{time}", prettyMs(dt)));
	}
}

class Progress {
	private bar: cliProgress.SingleBar;
	private stopwatch: Stopwatch;

	public constructor(text: string, operations: number) {
		this.bar = this.createProgressBar(text, operations);
		this.stopwatch = new Stopwatch();
	}

	public increment(step?: number): void {
		this.bar.increment(step);
	}

	public stop(): void {
		this.bar.stop();
		this.stopwatch.stop();
	}

	private createProgressBar(text: string, total: number): cliProgress.SingleBar {
		const progress = new cliProgress.SingleBar({
			format: `${text} {bar} {percentage}% ({value} / {total})`,
		}, cliProgress.Presets.shades_classic);
		progress.start(total, 0);
		return progress;
	}
}

class HttpRequestError extends Error {
	public response: Response;

	public constructor(response: Response) {
		super(`Could not download ${response.url} (${response.status})`);
		this.name = "HttpRequestError";
		this.response = response;
		Object.setPrototypeOf(this, HttpRequestError.prototype);
	}
}

interface IItemDbc {
	id: number;
	classId: number;
	subclassId: number;
	soundOverrideSubclassId: number;
	material: number;
	displayInfoId: number;
	inventoryType: number;
	sheatheType: number;
}

interface IItemAppearanceDbc {
	id: number;
	displayType: number;
	itemDisplayInfoId: number;
	defaultIconFileDataId: number;
	uiOrder: number;
	playerConditionId: number;
}

interface IItemModifiedAppearanceDbc {
	id: number;
	itemId: number;
	itemAppearanceModifierId: number;
	itemAppearanceId: number;
	orderIndex: number;
	transmogSourceTypeEnum: number;
}

interface IMountDbc {
	nameLang: string;
	sourceTextLang: string;
	descriptionLang: string;
	id: number;
	mountTypeId: number;
	flags: number;
	sourceTypeEnum: number;
	sourceSpellId: number;
	playerConditionId: number;
	mountFlyRideHeight: number;
	uiModelSceneId: number;
	mountSpecialRiderAnimKitId: number;
	mountSpecialSpellVisualKitId: number;
}

interface IMountXDisplayDbc {
	id: number;
	creatureDisplayInfoId: number;
	playerConditionId: number;
	mountId: number;
}

interface ISpellDbc {
	id: number;
	mechanic: number;
}

let dbcItem: IItemDbc[];
let dbcItemAppearance: IItemAppearanceDbc[];
let dbcItemAppearanceById: { [key: number]: IItemAppearanceDbc };
let dbcItemModifiedAppearance: IItemModifiedAppearanceDbc[];
let dbcItemModifiedAppearanceByItemId: { [key: number]: IItemModifiedAppearanceDbc };
let dbcMount: IMountDbc[];
let dbcMountBySourceSpellId: { [key: number]: IMountDbc };
let dbcMountDisplay: IMountXDisplayDbc[];
let dbcMountDisplayByMountId: { [key: number]: IMountXDisplayDbc };
let dbcSpell: ISpellDbc[];

const classIdArmor = 4;
const classIdWeapon = 2;
const invTypeShield = 14;
const spellMechanicMounted = 21;

const modelsDownloadQueue = new Set<number>();
const texturesDownloadQueue = new Set<number>();
const bonesDownloadQueue = new Set<number>();

async function download(dir: string, file: string): Promise<string | any> {
	const dataDir = path.join(process.cwd(), "data");
	const fullPath = `${dir}/${file}`;

	try {
		const res = await fetch(`${baseUrl}/${fullPath}`);
		if (res.status !== 200) {
			throw new HttpRequestError(res);
		}

		await mkdirp(path.join(dataDir, dir));

		if (res.headers.get("Content-Type") === "application/json") {
			const json = await res.json();
			fsp.writeFile(path.join(dataDir, fullPath), JSON.stringify(json));
			return json;
		} else {
			const fileStream = fs.createWriteStream(path.join(dataDir, fullPath));
			await new Promise((resolve, rej) => {
				res.body.pipe(fileStream);
				res.body.on("error", rej);
				fileStream.on("finish", resolve);
			});

			return fileStream.path.toString();
		}
	} catch (err) {
		throw err;
	}
}

function queueTexturesAndModels(item: any): void {
	if (item.TextureFiles !== null) {
		for (const key in item.TextureFiles) {
			for (const file of item.TextureFiles[key]) {
				if (file.FileDataId !== 0) {
					texturesDownloadQueue.add(file.FileDataId);
				}
			}
		}
	}

	if (item.ModelFiles !== null) {
		for (const key in item.ModelFiles) {
			for (const file of item.ModelFiles[key]) {
				if (file.FileDataId !== 0) {
					modelsDownloadQueue.add(file.FileDataId);
				}
			}
		}
	}

	if (typeof item.Model === "number" && item.Model !== 0) {
		modelsDownloadQueue.add(item.Model);
	}

	if (item.Textures !== null) {
		for (const key in item.Textures) {
			if (item.Textures[key] !== 0) {
				texturesDownloadQueue.add(item.Textures[key]);
			}
		}
	}

	if (item.Textures2 !== null) {
		for (const key in item.Textures2) {
			if (item.Textures2[key] !== 0) {
				texturesDownloadQueue.add(item.Textures2[key]);
			}
		}
	}
}

async function downloadRaces(): Promise<void> {
	const races = [
		"human",
		"nightelf",
		"dwarf",
		"gnome",
		"draenei",
		"orc",
		"troll",
		"tauren",
		"bloodelf",
		"scourge",
	];
	const genders = ["male", "female"];
	const raceGenderCombo = races.map((race) => [race + genders[0], race + genders[1]]).flat();

	const progress = new Progress("Downloading races data...", raceGenderCombo.length);

	await promisepool.PromisePool
		.for(raceGenderCombo)
		.withConcurrency(4)
		.process(async (race) => {
			const characterJson = await download("meta/character", `${race}.json`);
			modelsDownloadQueue.add(characterJson.Model);

			const customizationJson = await download("meta/charactercustomization2", `${characterJson.Race}_${characterJson.Gender}.json`);
			for (const option of customizationJson.Options) {
				for (const choice of option.Choices) {
					for (const element of choice.Elements) {
						if (element.SkinnedModel !== null && typeof element.SkinnedModel.CollectionFileDataID === "number" && element.SkinnedModel.CollectionFileDataID !== 0) {
							modelsDownloadQueue.add(element.SkinnedModel.CollectionFileDataID);
						}
						if (element.BoneSet !== null && typeof element.BoneSet.BoneFileDataID === "number" && element.BoneSet.BoneFileDataID !== 0) {
							bonesDownloadQueue.add(element.BoneSet.BoneFileDataID);
						}
					}
				}
			}

			const textureFiles = Object.keys(customizationJson.TextureFiles)
				.map(key => customizationJson.TextureFiles[key])
				.flat();
			for (const file of textureFiles) {
				texturesDownloadQueue.add(file.FileDataId);
			}

			progress.increment();
		});

	progress.stop();
}

async function downloadArmors(): Promise<void> {
	const rows = dbcItem.filter((row) => row.classId === classIdArmor);

	const progress = new Progress("Downloading armor data...", rows.length);

	await promisepool.PromisePool
		.for(rows)
		.withConcurrency(50)
		.process(async (row) => {
			const modifiedAppearance = dbcItemModifiedAppearanceByItemId[row.id];
			if (modifiedAppearance === undefined) {
				progress.increment();
				return;
			}
			const appearance = dbcItemAppearanceById[modifiedAppearance.itemAppearanceId];
			const metaPath = row.inventoryType === invTypeShield ? "item" : `armor/${row.inventoryType}`; // Inventory Type 14 = Shield
			try {
				const itemJson = await download(`meta/${metaPath}`, `${appearance.itemDisplayInfoId}.json`);
				queueTexturesAndModels(itemJson);
				progress.increment();
			} catch (err) {
				if (err instanceof HttpRequestError && err.response.status === 404) {
					progress.increment();
					return;
				}
				throw err;
			}
		});

	progress.stop();
}

async function downloadWeapons(): Promise<void> {
	const rows = dbcItem.filter((row) => row.classId === classIdWeapon);

	const progress = new Progress("Downloading weapon data...", rows.length);

	await promisepool.PromisePool
		.for(rows)
		.withConcurrency(50)
		.process(async (row) => {
			const modifiedAppearance = dbcItemModifiedAppearanceByItemId[row.id];
			if (modifiedAppearance === undefined) {
				progress.increment();
				return;
			}
			const appearance = dbcItemAppearanceById[modifiedAppearance.itemAppearanceId];
			try {
				const itemJson = await download(`meta/item`, `${appearance.itemDisplayInfoId}.json`);
				queueTexturesAndModels(itemJson);
				progress.increment();
			} catch (err) {
				if (err instanceof HttpRequestError && err.response.status === 404) {
					progress.increment();
					return;
				}
				throw err;
			}
		});

	progress.stop();
}

function readDbcFile<T>(file: string): Promise<T[]> {
	return new Promise((res, rej) => {
		const rows = [];

		fs.createReadStream(file)
			.pipe(csv({
				mapHeaders: ({ header, index }) => camelCase(header).replace(/[\[\]]/g, ""),
				mapValues: ({ header, index, value }) => isNaN(value) ? value : Number(value),
			}))
			.on("error", rej)
			.on("data", (data) => rows.push(data))
			.on("end", () => {
				res(rows);
			});
	});
}

async function readDbcData(): Promise<void> {
	const dir = path.join(process.cwd(), "data");
	console.log("Reading DBC data...");

	dbcItem = await readDbcFile<IItemDbc>(path.join(dir, "Item_3.3.5_12340.csv"));

	dbcItemAppearance = await readDbcFile<IItemAppearanceDbc>(path.join(dir, "ItemAppearance_9.2.0_41462.csv"));
	dbcItemAppearanceById = {};
	for (const row of dbcItemAppearance) {
		dbcItemAppearanceById[row.id] = row;
	}

	dbcItemModifiedAppearance = await readDbcFile<IItemModifiedAppearanceDbc>(path.join(dir, "ItemModifiedAppearance_9.2.0_41462.csv"));
	dbcItemModifiedAppearanceByItemId = {};
	for (const row of dbcItemModifiedAppearance) {
		dbcItemModifiedAppearanceByItemId[row.itemId] = row;
	}

	dbcMount = await readDbcFile<IMountDbc>(path.join(dir, "Mount_9.2.0_41462.csv"));
	dbcMountBySourceSpellId = {};
	for (const row of dbcMount) {
		dbcMountBySourceSpellId[row.sourceSpellId] = row;
	}

	dbcMountDisplay = await readDbcFile<IMountXDisplayDbc>(path.join(dir, "MountXDisplay_9.2.0_41462.csv"));
	dbcMountDisplayByMountId = {};
	for (const row of dbcMountDisplay) {
		dbcMountDisplayByMountId[row.mountId] = row;
	}

	dbcSpell = await readDbcFile<ISpellDbc>(path.join(dir, "Spell_3.3.5_12340.csv"));
}

async function downloadMounts(): Promise<void> {
	const mountSpells = dbcSpell.filter(spell => spell.mechanic === spellMechanicMounted);
	const progress = new Progress("Downloading mount data...", mountSpells.length);

	await promisepool.PromisePool
		.for(mountSpells)
		.withConcurrency(50)
		.process(async (spell) => {
			const mount = dbcMountBySourceSpellId[spell.id];
			if (mount === undefined) {
				progress.increment();
				return;
			}

			const display = dbcMountDisplayByMountId[mount.id];
			const json = await download("meta/npc", `${display.creatureDisplayInfoId}.json`);
			queueTexturesAndModels(json);

			progress.increment();
		});

	progress.stop();
}

async function downloadTextures(): Promise<void> {
	const progress = new Progress("Downloading textures...", texturesDownloadQueue.size);

	await promisepool.PromisePool
		.for(Array.from(texturesDownloadQueue))
		.withConcurrency(25)
		.process(async (fileDataId) => {
			await download("textures", `${fileDataId}.png`);
			progress.increment();
		});

	progress.stop();
}

async function downloadModels(): Promise<void> {
	const progress = new Progress("Downloading models...", modelsDownloadQueue.size);

	await promisepool.PromisePool
		.for(Array.from(modelsDownloadQueue))
		.withConcurrency(25)
		.process(async (fileDataId) => {
			await download("mo3", `${fileDataId}.mo3`);
			progress.increment();
		});

	progress.stop();
}

async function downloadBones(): Promise<void> {
	const progress = new Progress("Downloading bones...", bonesDownloadQueue.size);

	await promisepool.PromisePool
		.for(Array.from(bonesDownloadQueue))
		.withConcurrency(25)
		.process(async (fileDataId) => {
			try {
				await download("bone", `${fileDataId}.bone`);
				progress.increment();
			} catch (err) {
				if (err instanceof HttpRequestError && err.response.status === 404) {
					progress.increment();
					return;
				}
				throw err;
			}
		});

	progress.stop();
}

async function parseModels(): Promise<void> {
	const files = await glob("data/mo3/*.mo3");
	const progress = new Progress("Reading model files for texture references...", files.length);

	await promisepool.PromisePool
		.for(files)
		.withConcurrency(20)
		.process(async (file) => {
			const buffer = await fsp.readFile(file);

			const texturesOffset = buffer.readUInt32LE(60);
			const uncompressedSize = buffer.readUInt32LE(112);
			const compressedData = buffer.slice(116);
			const data = Buffer.from(pako.inflate(compressedData));
			if (data.length !== uncompressedSize) {
				throw `Unexpected data size ${data.length}, expected ${uncompressedSize}`;
			}

			const nbTextures = data.readInt32LE(texturesOffset);
			let offset = texturesOffset + 4;
			for (let i = 0; i < nbTextures; ++i) {
				const textureId = data.readUInt32LE(offset + 4 + 4);
				if (textureId !== 0) {
					texturesDownloadQueue.add(textureId);
				}

				offset += 4 + 4 + 4;
			}

			progress.increment();
		});

	progress.stop();
}

async function main(): Promise<void> {
	const sw = new Stopwatch();

	await readDbcData();
	await downloadRaces(); // Download info for all races
	await downloadArmors(); // Download info for all armors
	await downloadWeapons(); // Download info for all weapons
	await downloadMounts(); // Download info for all mounts
	await downloadModels(); // Download all queued models
	await parseModels(); // Read model files to find texture references
	await downloadTextures(); // Download all queued textures
	await downloadBones(); // Download all queued bones

	sw.stop("Everything done in {time}");
}

main();
