export enum EFaction {
	Horde = 0,
	Alliance = 1,
}

export class Utils {
	public static raceNames = {
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
	public static classNames = {
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

	public static getFactionFromRaceId(race: number): EFaction {
		return [1, 3, 4, 7, 11].includes(race) ? EFaction.Alliance : EFaction.Horde;
	}
}
