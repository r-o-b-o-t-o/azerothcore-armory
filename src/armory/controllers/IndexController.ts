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

	public constructor(armory: Armory) {
		this.armory = armory;
	}

	public async index(req: express.Request, res: express.Response): Promise<void> {
		res.render("index.html", {
			title: "Armory",
			realms: this.armory.config.realms.map(r => r.name),
		});
	}

	public async search(req: express.Request, res: express.Response): Promise<void> {
		const realmName = req.query.realm as string;
		const realm = realmName === undefined ?
			this.armory.config.realms[0] :
			this.armory.config.realms.find(r => r.name === realmName);
		if (realm === undefined) {
			res.status(400);
			return;
		}

		const db = this.armory.getCharactersDb(realm.name);
		let [rows, fields] = await db.query(`
			SELECT CCSA.character_set_name FROM information_schema.\`TABLES\` T,
			information_schema.\`COLLATION_CHARACTER_SET_APPLICABILITY\` CCSA
			WHERE CCSA.collation_name = T.table_collation
			AND T.table_schema = "${db.config.database}"
			AND T.table_name = "characters"
		`);
		const charSet = rows[0].character_set_name;

		const ssp = new DataTablesSsp(req.query, db, "characters", "guid", [
			{ name: "name", collation: `${charSet}_general_ci` },
			{ name: "name", table: "guild" },
			{ name: "level" },
			{ name: "race", formatter: (race, row) => `${raceFiles[race]}_${row[6] === 0 ? "male" : "female"}` },
			{ name: "class", formatter: cls => classFiles[cls] },
			{ name: "online", formatter: online => online === 1 },
		]);
		ssp.joins = [
			{ table1: "characters", column1: "guid", table2: "guild_member", column2: "guid", kind: "LEFT" },
			{ table1: "guild_member", column1: "guildid", table2: "guild", column2: "guildid", kind: "LEFT" },
		];
		ssp.extraDataColumns = ["`characters`.`gender`"];

		const result = await ssp
			.where("`deleteInfos_Account` IS NULL")
			.run();

		res.json({
			draw: ssp.draw,
			...result,
		});
	}
}
