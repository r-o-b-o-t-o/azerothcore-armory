import * as fs from "fs";
import * as path from "path";

import * as csv from "csv-parser";
import * as camelCase from "camelcase";

export interface IItemDbc {
	id: number;
	classId: number;
	subclassId: number;
	soundOverrideSubclassId: number;
	material: number;
	displayInfoId: number;
	inventoryType: number;
	sheatheType: number;
}

export interface IItemRetailDbc {
	id: number;
	classId: number;
	subclassId: number;
	material: number;
	inventoryType: number;
	sheatheType: number;
	soundOverrideSubclassId: number;
	iconFileDataId: number;
	itemGroupSoundsId: number;
	contentTuningId: number;
	modifiedCraftingReagentItemId: number;
}

export interface IItemAppearanceDbc {
	id: number;
	displayType: number;
	itemDisplayInfoId: number;
	defaultIconFileDataId: number;
	uiOrder: number;
	playerConditionId: number;
}

export interface IItemModifiedAppearanceDbc {
	id: number;
	itemId: number;
	itemAppearanceModifierId: number;
	itemAppearanceId: number;
	orderIndex: number;
	transmogSourceTypeEnum: number;
}

export interface IMountDbc {
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

export interface IMountXDisplayDbc {
	id: number;
	creatureDisplayInfoId: number;
	playerConditionId: number;
	mountId: number;
}

export interface ISpellDbc {
	id: number;
	mechanic: number;
}

export class DbcReader {
	public dbcItem: IItemDbc[];
	public dbcItemRetail: IItemRetailDbc[];
	public dbcItemAppearance: IItemAppearanceDbc[];
	public dbcItemModifiedAppearance: IItemModifiedAppearanceDbc[];
	public dbcMount: IMountDbc[];
	public dbcMountDisplay: IMountXDisplayDbc[];
	public dbcSpell: ISpellDbc[];

	public readDbcFile<T>(file: string): Promise<T[]> {
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

	public async loadAllFiles(): Promise<void> {
		const dir = path.join(process.cwd(), "data");

		this.dbcItem = await this.readDbcFile<IItemDbc>(path.join(dir, "Item_3.3.5_12340.csv"));
		this.dbcItemRetail = await this.readDbcFile<IItemRetailDbc>(path.join(dir, "Item_9.2.0_41462.csv"));
		this.dbcItemAppearance = await this.readDbcFile<IItemAppearanceDbc>(path.join(dir, "ItemAppearance_9.2.0_41462.csv"));
		this.dbcItemModifiedAppearance = await this.readDbcFile<IItemModifiedAppearanceDbc>(path.join(dir, "ItemModifiedAppearance_9.2.0_41462.csv"));
		this.dbcMount = await this.readDbcFile<IMountDbc>(path.join(dir, "Mount_9.2.0_41462.csv"));
		this.dbcMountDisplay = await this.readDbcFile<IMountXDisplayDbc>(path.join(dir, "MountXDisplay_9.2.0_41462.csv"));
		this.dbcSpell = await this.readDbcFile<ISpellDbc>(path.join(dir, "Spell_3.3.5_12340.csv"));
	}
}
