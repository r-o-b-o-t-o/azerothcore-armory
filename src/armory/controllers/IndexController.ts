import * as express from "express";

import { Armory } from "../Armory";
import { DataTablesSsp } from "../DataTablesSsp";

const raceFiles = {
	1: "human",
	2: "orc",
	3: "dwarf",
	4: "nightelf",
	5: "scourge",
	6: "tauren",
	7: "gnome",
	8: "troll",
	10: "bloodelf",
	11: "draenei",
};
const classFiles = {
	1: "warrior",
	2: "paladin",
	3: "hunter",
	4: "rogue",
	5: "priest",
	6: "deathknight",
	7: "shaman",
	8: "mage",
	9: "warlock",
	11: "druid",
};

export class IndexController {
	private armory: Armory;
	private charsetCache: { [key: string]: string };

	public constructor(armory: Armory) {
		this.armory = armory;
		this.charsetCache = {};
	}

	public async index(req: express.Request, res: express.Response): Promise<void> {
		res.render("index.html", {
			title: "Armory",
			realms: this.armory.config.realms.map(r => r.name),
		});
	}

	public async search(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
		const realmName = req.query.realm as string;
		const realm = realmName === undefined ?
			this.armory.config.realms[0] :
			this.armory.config.realms.find(r => r.name === realmName);
		if (realm === undefined) {
			return next(400);
		}

		const db = this.armory.getCharactersDb(realm.name);

		if (!(realm.name in this.charsetCache)) {
			let [rows, fields] = await db.query(`
				SELECT CCSA.character_set_name FROM information_schema.\`TABLES\` T,
				information_schema.\`COLLATION_CHARACTER_SET_APPLICABILITY\` CCSA
				WHERE CCSA.collation_name = T.table_collation
				AND T.table_schema = "${db.config.database}"
				AND T.table_name = "characters"
			`);
			this.charsetCache[realm.name] = rows[0].character_set_name;
		}
		const charSet = this.charsetCache[realm.name];

		let ssp = new DataTablesSsp(req.query, db, "characters", "guid", [
			{ name: "name", collation: `${charSet}_general_ci` },
			{ table: "guild", name: "name" },
			{ name: "level" },
			{ name: "class", formatter: cls => classFiles[cls] },
			{ name: "race", formatter: (race, row) => `${raceFiles[race]}_${row[6] === 0 ? "male" : "female"}` },
			{ name: "online", formatter: online => online === 1 },
		]);
		ssp.joins = [
			{ table1: "characters", column1: "guid", table2: "guild_member", column2: "guid", kind: "LEFT" },
			{ table1: "guild_member", column1: "guildid", table2: "guild", column2: "guildid", kind: "LEFT" },
		];
		ssp.extraDataColumns = ["`characters`.`gender`"];

		if (this.armory.config.hideGameMasters) {
			ssp.joins.push({ table1: "characters", column1: "account", table2: "account_access", column2: "id", database2: realm.authDatabase, kind: "LEFT" });
			ssp = ssp.where(`\`account_access\`.\`id\` IS NULL OR \`account_access\`.\`RealmID\` NOT IN (-1, ${realm.realmId}) OR \`account_access\`.\`gmlevel\` = 0`);
		}

		const result = await ssp
			.where("`deleteInfos_Account` IS NULL")
			.run();
		(result as any).realm = realm.name;

		res.json(result);
	}
}
