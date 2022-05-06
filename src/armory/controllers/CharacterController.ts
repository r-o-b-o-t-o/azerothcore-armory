import * as express from "express";
import { RowDataPacket } from "mysql2/promise";

import { Utils } from "../Utils";
import { Armory } from "../Armory";
import { IRealmConfig } from "../Config";
import { IAchievement } from "../data/DbcReader";

interface ICharacterData {
	guid: number;
	name: string;
	race: number;
	class: number;
	gender: number;
	level: number;
	skin: number;
	face: number;
	hairStyle: number;
	hairColor: number;
	facialStyle: number;
	playerFlags: number;
	online: number;
	guild: string;
}

interface IEquipmentData {
	slot: number;
	itemEntry: number;
	flags: number;
	enchantments: string;
	randomPropertyId: number;
	classId: number;
	subclassId: number;
}

interface ICustomizationOption {
	optionId: number;
	choiceId: number;
}

interface IMount {
	creatureDisplayId: number;
	spell: number;
	icon: string;
}

const ItemClassGem = 3;
const SpellMechanicMounted = 21;
const RaceDisplayName = {
	1: "Human",
	2: "Orc",
	3: "Dwarf",
	4: "Night Elf",
	5: "Undead",
	6: "Tauren",
	7: "Gnome",
	8: "Troll",
	10: "Blood Elf",
	11: "Draenei",
};
const ClassDisplayName = {
	1: "Warrior",
	2: "Paladin",
	3: "Hunter",
	4: "Rogue",
	5: "Priest",
	6: "Death Knight",
	7: "Shaman",
	8: "Mage",
	9: "Warlock",
	11: "Druid",
};

export class CharacterController {
	private armory: Armory;
	private itemInventoryTypes: { [key: number]: number };
	private itemIcons: { [key: number]: number };
	private gemItems: { [key: number]: boolean };
	private enchantSrcItems: { [key: number]: number };
	private itemSocketBonuses: { [key: number]: number };
	private mountSpells: number[];
	private mountBySpellId: { [key: number]: IMount };
	private achievementById: { [key: number]: IAchievement };

	public constructor(armory: Armory) {
		this.armory = armory;
	}

	public async load(): Promise<void> {
		this.itemInventoryTypes = {};
		const itemsRetail = await this.armory.dbc.itemRetail().toArray();
		for await (const item of this.armory.dbc.item()) {
			const retailItem = itemsRetail.find((row) => row.id === item.id);
			if (retailItem !== undefined) {
				this.itemInventoryTypes[item.id] = retailItem.inventoryType;
			}
		}

		this.itemIcons = {};
		const itemIconsByDisplayInfoId: { [key: number]: number } = {};
		for await (const row of this.armory.dbc.itemDisplayInfo()) {
			itemIconsByDisplayInfoId[row.id] = row.inventoryIcon0;
		}
		for await (const item of this.armory.dbc.item()) {
			const icon = itemIconsByDisplayInfoId[item.displayInfoId];
			if (icon !== undefined) {
				this.itemIcons[item.id] = icon;
			}
		}

		this.gemItems = {};
		for await (const row of this.armory.dbc.item().filter((item) => item.classId === ItemClassGem)) {
			this.gemItems[row.id] = true;
		}

		this.enchantSrcItems = {};
		for await (const row of this.armory.dbc.spellItemEnchantment()) {
			this.enchantSrcItems[row.id] = row.srcItemId;
		}

		this.itemSocketBonuses = {};
		let [rows, fields] = await this.armory.worldDb.query({
			sql: "SELECT entry, socketBonus FROM item_template WHERE socketBonus <> 0",
			timeout: this.armory.config.dbQueryTimeout,
		});
		for (const row of rows as RowDataPacket[]) {
			this.itemSocketBonuses[row.entry] = row.socketBonus;
		}

		const mountSpells = await this.armory.dbc
			.spell()
			.filter((m) => m.mechanic === SpellMechanicMounted)
			.toArray();
		this.mountSpells = mountSpells.map((spell) => spell.id);
		this.mountBySpellId = {};
		for (const spell of mountSpells) {
			const mount = await this.armory.dbc.mount().find((m) => m.sourceSpellId === spell.id);
			const icon = await this.armory.dbc.spellIcon().find((icon) => icon.id === spell.spellIconId);
			if (mount !== undefined) {
				const display = await this.armory.dbc.mountDisplay().find((d) => d.mountId === mount.id);
				if (display !== undefined) {
					this.mountBySpellId[spell.id] = {
						creatureDisplayId: display.creatureDisplayInfoId,
						spell: spell.id,
						icon: this.processSpellIconTexture(icon?.textureFilename ?? ""),
					};
				}
			}
		}

		this.achievementById = {};
		for await (const achievement of this.armory.dbc.achievement()) {
			this.achievementById[achievement.id] = achievement;
		}
	}

	public async character(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
		const realmName = req.params.realm;
		const charName = req.params.name;

		const realm = this.armory.getRealm(realmName);
		if (realm === undefined) {
			// Could not find realm
			return next(404);
		}

		const charData = await this.getCharacterData(realm, charName);
		if (charData === null) {
			// Could not find character
			return next(404);
		}

		const equipmentData = await this.getEquipmentData(realmName, charData.guid);
		const customization = this.getCustomizationOptions(charData);
		const equipment = equipmentData.map((row) => {
			(row as any).icon = this.itemIcons[row.itemEntry];
			(row as any).gems = this.getGemsFromEnchantments(row.enchantments);
			(row as any).enchantments = this.filterEnchantments(row.itemEntry, row.enchantments);
			return row;
		});
		const mounts = await this.getMounts(realmName, charData.guid);

		res.render("character.hbs", {
			title: `Armory - ${charData.name}`,
			...this.makeSharedDataObject(realm, charData),
			data: {
				race: charData.race,
				gender: charData.gender,
				class: charData.class,
				flags: charData.playerFlags,
				characterModelItems: await this.getModelViewerItems(equipmentData, charData.class),
				customizationOptions: customization,
				equipment,
				mounts,
			},
		});

		this.armory.gc();
	}

	public async talents(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
		const realmName = req.params.realm;
		const charName = req.params.name;

		const realm = this.armory.getRealm(realmName);
		if (realm === undefined) {
			// Could not find realm
			return next(404);
		}

		const charData = await this.getCharacterData(realm, charName);
		if (charData === null) {
			// Could not find character
			return next(404);
		}

		res.render("character-talents.hbs", {
			title: `Armory - ${charData.name} - Talents`,
			...this.makeSharedDataObject(realm, charData),
			data: {
				talents: await this.getTalents(realm.name, charData.guid),
				trees: await this.getTalentTrees(charData.class),
				glyphs: await this.getGlyphs(realm.name, charData.guid),
			},
		});
	}

	public async achievements(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
		const realmName = req.params.realm;
		const charName = req.params.name;

		const realm = this.armory.getRealm(realmName);
		if (realm === undefined) {
			// Could not find realm
			return next(404);
		}

		const charData = await this.getCharacterData(realm, charName);
		if (charData === null) {
			// Could not find character
			return next(404);
		}

		res.render("character-achievements.hbs", {
			title: `Armory - ${charData.name} - Achievements`,
			...this.makeSharedDataObject(realm, charData),
		});
	}

	public async achievementsData(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
		const realmName = req.params.realm;
		const character = parseInt(req.params.character) || -1;

		const realm = this.armory.getRealm(realmName);
		if (realm === undefined) {
			// Could not find realm
			return next(404);
		}

		const charData = await this.getCharacterData(realm, character);
		if (charData === null) {
			// Could not find character
			return next(404);
		}

		res.json({
			categories: await this.armory.dbc.achievementCategory().toArray(),
			...(await this.getAchievements(realm.name, charData)),
		});
	}

	public async pvp(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
		const realmName = req.params.realm;
		const charName = req.params.name;

		const realm = this.armory.getRealm(realmName);
		if (realm === undefined) {
			// Could not find realm
			return next(404);
		}

		const charData = await this.getCharacterData(realm, charName);
		if (charData === null) {
			// Could not find character
			return next(404);
		}

		res.render("character-pvp.hbs", {
			title: `Armory - ${charData.name} - PvP`,
			...this.makeSharedDataObject(realm, charData),
			faction: Utils.getFactionFromRaceId(charData.race),
			kills: await this.getPvpKills(realm.name, charData.guid),
			arenaTeams: await this.getArenaTeams(realm.name, charData.guid),
		});
	}

	private makeSharedDataObject(realm: IRealmConfig, charData: ICharacterData) {
		return {
			realm: realm.name,
			name: charData.name,
			guid: charData.guid,
			race: RaceDisplayName[charData.race],
			class: ClassDisplayName[charData.class],
			level: charData.level,
			online: charData.online === 1,
			guild: charData.guild,
		};
	}

	private async getCharacterData(realm: IRealmConfig, character: string | number): Promise<ICharacterData> {
		const where = typeof character === "string" ? "LOWER(`characters`.`name`) = LOWER(?)" : "`characters`.`guid` = ?";
		const [rows, fields] = await this.armory.getCharactersDb(realm.name).query({
			sql: `
				SELECT \`characters\`.\`guid\`, \`characters\`.\`name\`, \`race\`, \`class\`, \`gender\`, \`level\`, \`skin\`, \`face\`, \`hairStyle\`, \`hairColor\`, \`facialStyle\`, \`playerFlags\`, \`online\`, \`guild\`.\`name\` AS \`guild\`
				FROM \`characters\`
				LEFT JOIN \`guild_member\` ON \`guild_member\`.\`guid\` = \`characters\`.\`guid\`
				LEFT JOIN \`guild\` ON \`guild\`.\`guildid\` = \`guild_member\`.\`guildid\`
				LEFT JOIN \`${realm.authDatabase}\`.\`account_access\` ON \`account_access\`.\`id\` = \`characters\`.\`account\` AND \`account_access\`.\`RealmID\` IN (-1, ${realm.realmId}) AND \`account_access\`.\`gmlevel\` > 0
				WHERE
					${where}
					AND (\`account_access\`.\`id\` IS NULL OR ? = 0)
			`,
			values: [character, this.armory.config.hideGameMasters ? 1 : 0],
			timeout: this.armory.config.dbQueryTimeout,
		});

		if ((rows as RowDataPacket[]).length === 0) {
			return null;
		}
		return rows[0];
	}

	private async getEquipmentData(realm: string, charGuid: number): Promise<IEquipmentData[]> {
		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT character_inventory.slot, item_instance.itemEntry, item_instance.flags, item_instance.enchantments, item_instance.randomPropertyId
				FROM character_inventory
				JOIN item_instance ON item_instance.guid = character_inventory.item
				WHERE character_inventory.guid = ? AND character_inventory.bag = 0 AND character_inventory.slot IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)
			`,
			values: [charGuid],
			timeout: this.armory.config.dbQueryTimeout,
		});

		const data = rows as RowDataPacket[] as IEquipmentData[];

		for (const row of data) {
			const item = await this.armory.dbc.item().find((item) => item.id === row.itemEntry);
			row.classId = item.classId;
			row.subclassId = item.subclassId;
		}

		return data;
	}

	private async getMounts(realm: string, charGuid: number): Promise<IMount[]> {
		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT spell
				FROM character_spell
				WHERE guid = ? AND spell IN (?)
			`,
			values: [charGuid, this.mountSpells],
			timeout: this.armory.config.dbQueryTimeout,
		});

		return (rows as RowDataPacket[]).map((row) => this.mountBySpellId[row.spell]).filter((m) => m !== undefined);
	}

	private async getModelViewerItems(equipmentData: IEquipmentData[], charClass: number): Promise<number[][]> {
		if (charClass !== 3) {
			// Keep ranged weapon only if the character is a hunter
			equipmentData = equipmentData.filter((row) => row.slot !== 17);
		}
		const visibleEquipment = equipmentData.filter(
			(item) =>
				[0, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18].includes(item.slot) && // visible slots
				item.itemEntry !== 5976, // filter out Guild Tabard (displays blank otherwise)
		);

		const items: number[][] = [];
		for (const equipment of visibleEquipment) {
			const modifiedAppearance = await this.armory.dbc.itemModifiedAppearance().find((row) => row.itemId === equipment.itemEntry);
			if (modifiedAppearance === undefined) {
				continue;
			}
			const appearance = await this.armory.dbc.itemAppearance().find((row) => row.id === modifiedAppearance.itemAppearanceId);
			if (appearance === undefined) {
				continue;
			}

			items.push([this.itemInventoryTypes[equipment.itemEntry], appearance.itemDisplayInfoId]);
		}

		return items;
	}

	private parseEnchantmentsString(enchantments: string): number[] {
		return enchantments
			.trim()
			.split(" ")
			.map((enchant) => parseInt(enchant))
			.filter((enchant) => enchant !== 0);
	}

	private getGemsFromEnchantments(enchantments: string): number[] {
		return this.parseEnchantmentsString(enchantments)
			.filter((enchant) => enchant in this.enchantSrcItems && this.enchantSrcItems[enchant] in this.gemItems)
			.map((enchant) => this.enchantSrcItems[enchant]);
	}

	private filterEnchantments(item: number, enchantments: string): number[] {
		const socketBonus = this.itemSocketBonuses[item];
		return this.parseEnchantmentsString(enchantments).filter(
			(enchant) => enchant in this.enchantSrcItems && !(this.enchantSrcItems[enchant] in this.gemItems) && enchant !== socketBonus,
		);
	}

	private getCustomizationOptions(charData: ICharacterData): ICustomizationOption[] {
		const data = this.armory.characterCustomization.getCharacterCustomizationData(charData.race, charData.gender);
		const options = [];
		const setOptionByChoiceIndex = (optionName: string, choiceIndex: number) => {
			const option = data.Options.find((opt) => opt.Name === optionName);
			if (option !== undefined) {
				const choice = option.Choices.find((choice) => choice.OrderIndex === choiceIndex);
				if (choice !== undefined) {
					options.push({ optionId: option.Id, choiceId: choice.Id });
				}
			}
		};
		const setOptionByChoiceName = (optionName: string, choiceName: string) => {
			const option = data.Options.find((opt) => opt.Name === optionName);
			if (option !== undefined) {
				const choice = option.Choices.find((ch) => ch.Name === choiceName);
				if (choice !== undefined) {
					options.push({ optionId: option.Id, choiceId: choice.Id });
				}
			}
		};
		const setOptionByChoiceId = (optionName: string, choiceId: number) => {
			const option = data.Options.find((opt) => opt.Name === optionName);
			if (option !== undefined) {
				options.push({ optionId: option.Id, choiceId: choiceId });
			}
		};

		const optionMapping = {
			Face: charData.face,
			"Skin Color": charData.skin,
			"Hair Style": charData.hairStyle,
			"Hair Color": charData.hairColor,
		};
		for (const optionName in optionMapping) {
			setOptionByChoiceIndex(optionName, optionMapping[optionName]);
		}

		// Race-specific customization options
		switch (charData.race) {
			case 1: // Human
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Mustache",
						{ 0: "Horseshoe", 1: "Brush", 2: "Horseshoe", 3: "None", 4: "Brush", 5: "Brush", 6: "Horseshoe", 7: "Brush", 8: "None" }[
							charData.facialStyle
						],
					);
					setOptionByChoiceName(
						"Beard",
						{ 0: "Short", 1: "Chin Puff", 2: "Soul Patch", 3: "Goatee", 4: "Goatee", 5: "None", 6: "Goatee", 7: "None", 8: "None" }[
							charData.facialStyle
						],
					);
					setOptionByChoiceName(
						"Sideburns",
						{ 0: "Medium", 1: "None", 2: "None", 3: "Medium", 4: "Long", 5: "Long", 6: "None", 8: "None", 7: "None" }[charData.facialStyle],
					);
					setOptionByChoiceName("Eyebrows", "Natural");
					setOptionByChoiceName("Face Shape", "Narrow");
					setOptionByChoiceId(
						"Eye Color",
						{ 0: 4138, 1: 4140, 2: 4130, 3: 4136, 4: 4141, 5: 4134, 6: 4130, 7: 4138, 8: 4144, 9: 4135, 10: 4126, 11: 4136 }[charData.face],
					);
				} else {
					setOptionByChoiceIndex("Piercings", charData.facialStyle);
					setOptionByChoiceName("Eyebrows", "Natural");
					setOptionByChoiceName("Face Shape", "Narrow");
					setOptionByChoiceName("Makeup", "None");
					setOptionByChoiceName("Necklace", "None");
					setOptionByChoiceId(
						"Eye Color",
						{
							0: 4162,
							1: 4153,
							2: 4161,
							3: 4164,
							4: 4154,
							5: 4160,
							6: 4160,
							7: 4157,
							8: 4152,
							9: 4154,
							10: 4155,
							11: 4165,
							12: 4163,
							13: 4155,
							14: 4151,
						}[charData.face],
					);
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 4534 : 4535);
				}
				break;
			case 3: // Dwarf
				setOptionByChoiceName("Tattoo", "None");
				setOptionByChoiceIndex("Tattoo Color", 0);
				setOptionByChoiceIndex("Eyebrows", 0);
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Mustache",
						{
							0: "Trimmed",
							1: "Bushy",
							2: "Grand",
							3: "Thin Braids",
							4: "Wise",
							5: "Thick Braids",
							6: "Fancy",
							7: "Bold",
							8: "Tied",
							9: "None",
							10: "None",
						}[charData.facialStyle],
					);
					setOptionByChoiceIndex("Beard", charData.facialStyle);
					setOptionByChoiceName("Earrings", "None");
					setOptionByChoiceName("Nose Ring", "None");
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				} else {
					setOptionByChoiceIndex("Earrings", { 0: 0, 1: 1, 2: 2, 3: 3, 4: 0, 5: 4 }[charData.facialStyle]);
					setOptionByChoiceName(
						"Piercings",
						{ 0: "None", 1: "None", 2: "None", 3: "None", 4: "Right Nostril", 5: "None" }[charData.facialStyle],
					);
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 5559 : 5587);
				}
				break;
			case 7: // Gnome
				if (charData.gender === 0) {
					setOptionByChoiceIndex("Mustache", charData.facialStyle > 1 ? charData.facialStyle - 1 : 0);
					setOptionByChoiceIndex("Beard", charData.facialStyle < 7 ? charData.facialStyle : 0);
					setOptionByChoiceIndex("Eyebrows", charData.facialStyle < 6 ? charData.facialStyle : 1);
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				} else {
					setOptionByChoiceIndex("Earrings", charData.facialStyle);
					setOptionByChoiceId("Earring Color", 8796);
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 5629 : 5643);
				}
				break;
			case 4: // Night Elf
				setOptionByChoiceName("Vines", "None");
				setOptionByChoiceIndex("Vine Color", 0);
				setOptionByChoiceName("Ears", "Thin");
				setOptionByChoiceName("Scars", "None");
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Sideburns",
						{ 0: "None", 1: "Groomed", 2: "None", 3: "Short", 4: "Medium", 5: "Groomed" }[charData.facialStyle],
					);
					setOptionByChoiceName("Mustache", { 0: "None", 1: "Groomed", 2: "None", 3: "Thin", 4: "None", 5: "None" }[charData.facialStyle]);
					setOptionByChoiceName("Beard", { 0: "None", 1: "Trimmed", 2: "Full", 3: "None", 4: "Short", 5: "Long" }[charData.facialStyle]);
					setOptionByChoiceName("Eyebrows", { 0: "Shaved", 1: "Short", 2: "Long", 3: "Flat", 4: "Short", 5: "Owl" }[charData.facialStyle]);
				} else {
					setOptionByChoiceName("Eyebrows", "Long");
					setOptionByChoiceIndex("Markings", charData.facialStyle + 1);
					setOptionByChoiceIndex("Markings Color", { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 3, 6: 6, 7: 7 }[charData.hairColor]);
				}
				setOptionByChoiceName("Blindfold", "");
				setOptionByChoiceName("Headdress", "None");
				setOptionByChoiceName("Earrings", "None");
				setOptionByChoiceName("Nose Ring", "None");
				setOptionByChoiceName("Necklace", "None");
				setOptionByChoiceName("Horns", "None");
				setOptionByChoiceName("Tattoo", "None");
				setOptionByChoiceName("Tattoo Color", "None");
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 7618 : 7634);
				} else {
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 7610 : 7619);
				}
				break;
			case 11: // Draenei
				setOptionByChoiceName("Circlet", "None");
				setOptionByChoiceId("Jewelry Color", charData.gender === 0 ? 8707 : 8646);
				setOptionByChoiceName("Horn Decoration", "None");
				setOptionByChoiceName("Tail", charData.gender === 0 ? "Long" : "Short");
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Facial Hair",
						{ 0: "Bare", 1: "Bare", 2: "Burns", 3: "Chops", 4: "Mustache", 5: "Soul Patch", 6: "Handlebar", 7: "Bare" }[
							charData.facialStyle
						],
					);
					setOptionByChoiceName(
						"Tendrils",
						{ 0: "None", 1: "Splayed", 2: "Double", 3: "Fanned", 4: "Single", 5: "Paired", 6: "Uniform", 7: "Twin" }[charData.facialStyle],
					);
				} else {
					setOptionByChoiceName(
						"Horns",
						{ 0: "Sweeping", 1: "Curled", 2: "Curved", 3: "Thick", 4: "Wide", 5: "Grand", 6: "Short" }[charData.facialStyle],
					);
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 6977 : 6979);
				} else {
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 6976 : 6978);
				}
				break;
			case 2: // Orc
				setOptionByChoiceName("Scars", "None");
				setOptionByChoiceName("Grime", "None");
				setOptionByChoiceName("Tattoo", "None");
				setOptionByChoiceName("War Paint", "None");
				setOptionByChoiceName("War Paint Color", "None");
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Beard",
						{
							0: "None",
							1: "Stubble",
							2: "Thick",
							3: "Full",
							4: "Tied",
							5: "Braid",
							6: "Twin Braids",
							7: "None",
							8: "Ringed",
							9: "Split",
							10: "Goatee",
						}[charData.facialStyle],
					);
					setOptionByChoiceName(
						"Sideburns",
						{ 0: "None", 1: "None", 2: "Full", 3: "Low", 4: "Full", 5: "None", 6: "None", 7: "Braids", 8: "None", 9: "Full", 10: "Thick" }[
							charData.facialStyle
						],
					);
					setOptionByChoiceName("Earrings", "None");
					setOptionByChoiceName("Nose Ring", "None");
					setOptionByChoiceName("Tusks", "Natural");
					setOptionByChoiceName("Upright", "Hunched");
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				} else {
					setOptionByChoiceIndex("Earrings", { 0: 0, 1: 1, 2: 2, 3: 0, 4: 1, 5: 2, 6: 4 }[charData.facialStyle]);
					setOptionByChoiceIndex("Nose Ring", { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 0 }[charData.facialStyle]);
					setOptionByChoiceName("Necklace", "None");
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 9289 : 9313);
				}
				break;
			case 5: // Undead
				setOptionByChoiceName("Skin Type", "Bony");
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Jaw Features",
						{
							0: "Intact",
							1: "Rot-Kissed",
							2: "Intact",
							3: "Slackjawed",
							4: "Drooler",
							5: "Intact",
							6: "Slackjawed",
							7: "Drooler",
							8: "Bonejawed",
							9: "Jawsome",
							10: "Toothy",
							11: "Unhinged",
							12: "Cheeky",
							13: "Loose",
							14: "Intact",
							15: "Slackjawed",
							16: "Slobber",
						}[charData.facialStyle],
					);
					setOptionByChoiceIndex(
						"Face Features",
						{ 0: 0, 1: 0, 2: 1, 3: 1, 4: 1, 5: 2, 6: 3, 7: 3, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 4, 15: 4, 16: 0 }[
							charData.facialStyle
						],
					);
					setOptionByChoiceId(
						"Eye Color",
						{
							0: 5330,
							1: 5330,
							2: 6304,
							3: 6304,
							4: 6304,
							5: 5330,
							6: 5330,
							7: 5330,
							8: 5330,
							9: 5330,
							10: 6304,
							11: 6304,
							12: 5330,
							13: 5330,
							14: 5330,
							15: 5330,
							16: 5330,
						}[charData.facialStyle],
					);
				} else {
					setOptionByChoiceName(
						"Face Features",
						{ 0: "None", 1: "None", 2: "Strapped", 3: "Rotting", 4: "None", 5: "None", 6: "None", 7: "Putrid" }[charData.facialStyle],
					);
					setOptionByChoiceName(
						"Jaw Features",
						{ 0: "Intact", 1: "Stitched", 2: "Intact", 3: "Intact", 4: "Bonejawed", 5: "Toothy", 6: "Cheeky", 7: "Intact" }[
							charData.facialStyle
						],
					);
					setOptionByChoiceId(
						"Eye Color",
						{ 0: 5337, 1: 5337, 2: 6305, 3: 5337, 4: 5337, 5: 6305, 6: 5337, 7: 5337 }[charData.facialStyle],
					);
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 5344 : 5345);
				}
				break;
			case 6: // Tauren
				setOptionByChoiceIndex("Horn Style", charData.hairStyle);
				setOptionByChoiceIndex("Horn Color", charData.hairColor);
				setOptionByChoiceName("Foremane", "Short");
				setOptionByChoiceName("Face Paint", "None");
				setOptionByChoiceName("Headdress", "None");
				setOptionByChoiceName("Necklace", "None");
				setOptionByChoiceIndex("Jewelry Color", 0);
				setOptionByChoiceName("Flower", "None");
				setOptionByChoiceName("Body Paint", "None");
				setOptionByChoiceIndex("Paint Color", 0);
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Hair",
						{ 0: "Mane", 1: "Braids", 2: "Chops", 3: "Sideburns", 4: "Mane", 5: "Wrapped", 6: "Braids" }[charData.facialStyle],
					);
					setOptionByChoiceName(
						"Facial Hair",
						{ 0: "Clean", 1: "Braid", 2: "Beard", 3: "Wrapped", 4: "Curtain", 5: "Clean", 6: "Split" }[charData.facialStyle],
					);
					setOptionByChoiceName(
						"Nose Ring",
						{ 0: "None", 1: "Small", 2: "Open", 3: "None", 4: "None", 5: "Bead", 6: "Open" }[charData.facialStyle],
					);
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				} else {
					setOptionByChoiceIndex("Hair", charData.facialStyle);
					setOptionByChoiceName("Earrings", "None");
					setOptionByChoiceName("Nose Ring", "None");
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 7281 : 7289);
				}
				break;
			case 8: // Troll
				setOptionByChoiceName("Body Paint", "None");
				setOptionByChoiceName("Body Paint Color", "None");
				setOptionByChoiceName("Piercing", "None");
				if (charData.gender === 0) {
					setOptionByChoiceName(
						"Tusks",
						{
							0: "Tusked",
							1: "Gougers",
							2: "Mammoth",
							3: "Spears",
							4: "Bridle",
							5: "Tusked",
							6: "Gougers",
							7: "Mammoth",
							8: "Spears",
							9: "Bridle",
							10: "Gougers",
						}[charData.facialStyle],
					);
					setOptionByChoiceName(
						"Face Paint",
						{
							0: "None",
							1: "None",
							2: "None",
							3: "None",
							4: "None",
							5: "Berserker",
							6: "Fangs",
							7: "Mask",
							8: "Oni",
							9: "Prophet",
							10: "War",
						}[charData.facialStyle],
					);
					setOptionByChoiceIndex("Face Paint Color", charData.hairColor + 1);
					setOptionByChoiceName("Earrings", "None");
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				} else {
					setOptionByChoiceIndex("Tusks", charData.facialStyle);
					setOptionByChoiceName("Face Paint", "None");
					setOptionByChoiceIndex("Face Paint Color", 0);
					setOptionByChoiceName("Earrings", "Hoops");
					setOptionByChoiceIndex("Eye Color", 0); // TODO
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 8451 : 8468);
				}
				break;
			case 10: // Blood Elf
				setOptionByChoiceName("Ears", "Long");
				setOptionByChoiceName("Horns", "None");
				setOptionByChoiceName("Blindfold", "None");
				setOptionByChoiceName("Tattoo", "None");
				setOptionByChoiceIndex("Tattoo Color", 0);
				if (charData.gender === 0) {
					setOptionByChoiceIndex("Facial Hair", charData.facialStyle);
				} else {
					setOptionByChoiceIndex("Earrings", charData.facialStyle);
					setOptionByChoiceIndex("Jewelry Color", 0);
					setOptionByChoiceName("Necklace", "None");
					setOptionByChoiceName("Armbands", "None");
					setOptionByChoiceName("Bracelets", "None");
				}
				if (charData.class === 6) {
					// Death Knight
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 6586 : 6605);
				} else {
					setOptionByChoiceId("Eye Color", charData.gender === 0 ? 6570 : 6589);
				}
				break;
		}
		if ([4, 6].includes(charData.race)) {
			// Races that can choose the druid class
			setOptionByChoiceIndex("Bear Form", 0);
			setOptionByChoiceIndex("Cat Form", 0);
			setOptionByChoiceIndex("Aquatic Form", 0);
			setOptionByChoiceIndex("Travel Form", 0);
			setOptionByChoiceIndex("Flight Form", 0);
			setOptionByChoiceIndex("Moonkin Form", 0);
		}

		return options;
	}

	private async getTalents(realm: string, character: number): Promise<number[][]> {
		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT spell, specMask
				FROM character_talent
				WHERE guid = ?
			`,
			values: [character],
			timeout: this.armory.config.dbQueryTimeout,
		});

		const talents: number[][] = [[], []];
		for (const row of rows as RowDataPacket[]) {
			if (row.specMask === 1 || row.specMask === 3) {
				talents[0].push(row.spell);
			}
			if (row.specMask === 2 || row.specMask === 3) {
				talents[1].push(row.spell);
			}
		}

		return talents;
	}

	private async getTalentTrees(classId: number) {
		const items = await this.armory.dbc
			.talentTab()
			.filter((tab) => tab.classMask === Math.pow(2, classId - 1))
			.map(async (tab) => {
				const icon = await this.armory.dbc.spellIcon().find((icon) => icon.id === tab.spellIconId);
				const spells = await this.armory.dbc
					.talent()
					.filter((row) => row.tabId === tab.id)
					.map(async (row) => {
						const spell = await this.armory.dbc.spell().find((spell) => spell.id === row.spellRank0);
						const icon = await this.armory.dbc.spellIcon().find((icon) => icon.id === spell?.spellIconId);
						return { ...row, icon: this.processSpellIconTexture(icon?.textureFilename ?? "") };
					})
					.toArray();
				return {
					name: tab.nameLang0,
					icon: this.processSpellIconTexture(icon.textureFilename),
					spells: await Promise.all(spells),
				};
			})
			.toArray();
		return await Promise.all(items);
	}

	private processSpellIconTexture(texturePath: string): string {
		return texturePath.toLowerCase().replace("interface\\icons\\", "").replace("interface\\spellbook\\", "").replace(/\.$/, "");
	}

	private async getGlyphs(realm: string, character: number): Promise<any[][]> {
		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT guid, talentGroup, glyph1, glyph2, glyph3, glyph4, glyph5, glyph6
				FROM character_glyphs
				WHERE guid = ?
			`,
			values: [character],
			timeout: this.armory.config.dbQueryTimeout,
		});

		const glyphs = [[], []];
		for (const row of rows as RowDataPacket[]) {
			const glyphIds = [row.glyph1, row.glyph2, row.glyph3, row.glyph4, row.glyph5, row.glyph6].filter((id) => id !== 0);
			for (const glyphId of glyphIds) {
				const glyph = await this.armory.dbc.glyphProperties().find((g) => g.id === glyphId);
				if (glyph === undefined) {
					continue;
				}
				glyphs[row.talentGroup].push(glyph.spellId);
			}
		}

		return glyphs;
	}

	private async getAchievements(realm: string, charData: ICharacterData): Promise<{ achievements: any[]; earned: { [key: number]: any } }> {
		const promises = await this.armory.dbc
			.achievement()
			.filter((ach) => ach.faction === -1 || ach.faction === Utils.getFactionFromRaceId(charData.race))
			.map(async (ach) => {
				const icon = await this.armory.dbc.spellIcon().find((icon) => icon.id === ach.iconId);
				return {
					id: ach.id,
					category: ach.category,
					title: ach.titleLang0,
					description: ach.descriptionLang0,
					points: ach.points,
					icon: this.processSpellIconTexture(icon?.textureFilename ?? ""),
				};
			})
			.toArray();
		const achievements = await Promise.all(promises);

		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT achievement, date
				FROM character_achievement
				WHERE guid = ?
			`,
			values: [charData.guid],
			timeout: this.armory.config.dbQueryTimeout,
		});
		const earned = {};
		for (const row of rows as RowDataPacket[]) {
			earned[row.achievement] = {
				date: row.date,
			};
		}

		return {
			achievements,
			earned,
		};
	}

	private async getPvpKills(realm: string, charGuid: number): Promise<{ total: number; today: number; yesterday: number }> {
		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT totalKills, todayKills, yesterdayKills
				FROM characters
				WHERE guid = ?
			`,
			values: [charGuid],
			timeout: this.armory.config.dbQueryTimeout,
		});
		const row = rows[0];

		return {
			total: row.totalKills,
			today: row.todayKills,
			yesterday: row.yesterdayKills,
		};
	}

	private async getArenaTeams(realm: string, charGuid: number): Promise<any[]> {
		const [rows, fields] = await this.armory.getCharactersDb(realm).query({
			sql: `
				SELECT
					arena_team.arenaTeamId AS id, arena_team.name, arena_team.type, arena_team.rating, arena_team.seasonWins, arena_team.seasonGames,
					arena_team.backgroundColor AS background, arena_team.emblemStyle, arena_team.emblemColor, arena_team.borderStyle, arena_team.borderColor
				FROM arena_team_member
				LEFT JOIN arena_team ON arena_team_member.arenaTeamId = arena_team.arenaTeamId
				WHERE guid = ?
				ORDER BY arena_team.type ASC
			`,
			values: [charGuid],
			timeout: this.armory.config.dbQueryTimeout,
		});

		return (rows as RowDataPacket[]).map((row) => {
			row.emblem = Utils.makeEmblemObject(row, false);
			return row;
		});
	}
}
