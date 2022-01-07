import * as fs from "fs";
import * as path from "path";

import * as camelCase from "camelcase";

export interface IItemDbc {
	id: number;
	classId: number;
	displayInfoId: number;
	inventoryType: number;
}

export interface IItemRetailDbc {
	id: number;
	inventoryType: number;
}

export interface IItemAppearanceDbc {
	id: number;
	itemDisplayInfoId: number;
}

export interface IItemModifiedAppearanceDbc {
	id: number;
	itemId: number;
	itemAppearanceId: number;
}

export interface IItemDisplayInfoDbc {
	id: number;
	inventoryIcon0: number;
}

export interface IMountDbc {
	id: number;
	sourceSpellId: number;
}

export interface IMountXDisplayDbc {
	id: number;
	creatureDisplayInfoId: number;
	mountId: number;
}

export interface ISpellDbc {
	id: number;
	mechanic: number;
}

export interface ISpellItemEnchantmentDbc {
	id: number;
	srcItemId: number;
}

interface IAsyncGeneratorWithArrayMethods<T> {
	[Symbol.asyncIterator](): AsyncGenerator<T>;
	toArray(): Promise<T[]>;
	map<M>(fn: (t: T) => M): IAsyncGeneratorWithArrayMethods<M>;
	filter(fn: (t: T) => boolean): IAsyncGeneratorWithArrayMethods<T>;
	find(fn: (t: T) => boolean): Promise<T>;
}

class ArrayAsAsyncGenerator<T> implements IAsyncGeneratorWithArrayMethods<T> {
	private data: T[];

	public constructor(data: T[]) {
		this.data = data;
	}

	async toArray(): Promise<T[]> {
		return this.data;
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<T> {
		for (const x of this.data) {
			yield x;
		}
	}

	public map<M>(fn: (t: T) => M): ArrayAsAsyncGenerator<M> {
		return new ArrayAsAsyncGenerator<M>(this.data.map(fn));
	}

	filter(fn: (t: T) => boolean): ArrayAsAsyncGenerator<T> {
		return new ArrayAsAsyncGenerator<T>(this.data.filter(fn));
	}

	async find(fn: (t: T) => boolean): Promise<T> {
		return this.data.find(fn);
	}
}

class AsyncGenWrapper<T> implements IAsyncGeneratorWithArrayMethods<T> {
	private gen: AsyncGenerator<T>;

	public constructor(gen: AsyncGenerator<T>) {
		this.gen = gen;
	}

	public static from<T>(array: T[]): AsyncGenWrapper<T> {
		return new AsyncGenWrapper<T>(async function* () {
			for (const x of array) {
				yield x;
			}
		}());
	}

	public async *[Symbol.asyncIterator](): AsyncGenerator<T> {
		for await (const x of this.gen) {
			yield x;
		}
	}

	public async toArray(): Promise<T[]> {
		const values = [];
		for await (const x of this) {
			values.push(x);
		}
		return values;
	}

	private wrap<X>(g: (that: AsyncGenWrapper<T>) => AsyncGenerator<X>): AsyncGenWrapper<X> {
		return new AsyncGenWrapper<X>(g(this));
	}

	public map<M>(fn: (t: T) => M): AsyncGenWrapper<M> {
		return this.wrap(async function* (me) {
			for await (const x of me) {
				yield fn(x);
			}
		});
	}

	public filter(fn: (t: T) => boolean): AsyncGenWrapper<T> {
		return this.wrap(async function* (me) {
			for await (const x of me) {
				if (fn(x)) {
					yield x;
				}
			}
		});
	}

	public async find(fn: (t: T) => boolean): Promise<T> {
		for await (const x of this) {
			if (fn(x)) {
				return x;
			}
		}
	}
}

class DbcReader<T> {
	private filePath: string;
	private fields: string[];

	public constructor(filePath: string, keepFields: string[] = []) {
		this.filePath = filePath;
		this.fields = keepFields;
	}

	public async *read(): AsyncGenerator<T> {
		const stream = fs.createReadStream(this.filePath);
		const itr = this.readLines(stream);
		const headerLine = await itr.next();
		if (headerLine.done === true) {
			return;
		}

		const headerCols = this.parseCsvLine(headerLine.value)
			.map(header => camelCase(header).replace(/[\[\]]/g, ""));

		for await (const line of itr) {
			const cols = this.parseCsvLine(line)
				.map(value => {
					const parsed: number = parseInt(value, 10);
					return isNaN(parsed) ? value : parsed;
				});
			const row = {};
			headerCols.forEach((header, headerIdx) => {
				if (this.fields.length === 0 || this.fields.includes(header)) {
					row[header] = cols[headerIdx];
				}
			});
			yield row as T;
		}
	}

	private async *readLines(stream: fs.ReadStream): AsyncGenerator<string> {
		let previous = "";

		for await (const chunk of stream) {
			previous += chunk;
			let unixEolIndex: number;
			let winEolIndex: number;

			while ((unixEolIndex = previous.indexOf("\n")) >= 0 || (winEolIndex = previous.indexOf("\r\n")) >= 0) {
				const unix = unixEolIndex >= 0;
				const line = previous.slice(0, (unix ? unixEolIndex : winEolIndex) - 1);
				yield line;
				previous = previous.slice(unix ? (unixEolIndex + 1) : (winEolIndex + 2));
			}
		}

		if (previous.length > 0) {
			yield previous;
		}
	}

	private parseCsvLine(line: string): string[] {
		// Adapted from https://stackoverflow.com/a/14991797
		const arr = [];
		let quote = false; // 'true' means we're inside a quoted field

		// Iterate over each character, keep track of current row and column (of the returned array)
		for (let col = 0, c = 0; c < line.length; c++) {
			let cc = line[c], nc = line[c + 1]; // Current character, next character
			arr[col] = arr[col] || ""; // Create a new column (start with empty string) if necessary

			// If the current character is a quotation mark, and we're inside a
			// quoted field, and the next character is also a quotation mark,
			// add a quotation mark to the current column and skip the next character
			if (cc == '"' && quote && nc == '"') {
				arr[col] += cc; ++c;
				continue;
			}

			// If it's just one quotation mark, begin/end quoted field
			if (cc == '"') {
				quote = !quote;
				continue;
			}

			// If it's a comma and we're not in a quoted field, move on to the next column
			if (cc == ',' && !quote) {
				++col;
				continue;
			}

			// If it's a newline (CRLF) and we're not in a quoted field, move on to the next row
			if (cc == '\r' && nc == '\n' && !quote) {
				break;
			}

			// If it's a newline (LF or CR) and we're not in a quoted field, move on to the next row
			if ((cc == '\n' && !quote) ||
				(cc == '\r' && !quote)) {
				break;
			}

			// Otherwise, append the current character to the current column
			arr[col] += cc;
		}

		return arr;
	}
}

const dir = path.join(process.cwd(), "data");
export const DbcFiles = {
	item: path.join(dir, "Item_3.3.5_12340.csv"),
	itemRetail: path.join(dir, "Item_9.2.0_41462.csv"),
	itemAppearance: path.join(dir, "ItemAppearance_9.2.0_41462.csv"),
	itemModifiedAppearance: path.join(dir, "ItemModifiedAppearance_9.2.0_41462.csv"),
	itemDisplayInfo: path.join(dir, "ItemDisplayInfo_3.3.5_12340.csv"),
	mount: path.join(dir, "Mount_9.2.0_41462.csv"),
	mountDisplay: path.join(dir, "MountXDisplay_9.2.0_41462.csv"),
	spell: path.join(dir, "Spell_3.3.5_12340.csv"),
	spellItemEnchantment: path.join(dir, "SpellItemEnchantment_3.3.5_12340.csv"),
};

const dbcFields = {
	item: ["id", "classId", "displayInfoId", "inventoryType"],
	itemRetail: ["id", "inventoryType"],
	itemAppearance: ["id", "itemDisplayInfoId"],
	itemModifiedAppearance: ["id", "itemId", "itemAppearanceId"],
	itemDisplayInfo: ["id", "inventoryIcon0"],
	mount: ["id", "sourceSpellId"],
	mountDisplay: ["id", "creatureDisplayInfoId", "mountId"],
	spell: ["id", "mechanic"],
	spellItemEnchantment: ["id", "srcItemId"],
};

export class DbcManager {
	private _item: IItemDbc[];
	private _itemRetail: IItemRetailDbc[];
	private _itemAppearance: IItemAppearanceDbc[];
	private _itemModifiedAppearance: IItemModifiedAppearanceDbc[];
	private _itemDisplayInfo: IItemDisplayInfoDbc[];
	private _mount: IMountDbc[];
	private _mountDisplay: IMountXDisplayDbc[];
	private _spell: ISpellDbc[];
	private _spellItemEnchantment: ISpellItemEnchantmentDbc[];

	public async loadAllFiles(): Promise<void> {
		this._item = await this.read<IItemDbc>(DbcFiles.item, dbcFields.item).toArray();
		this._itemRetail = await this.read<IItemRetailDbc>(DbcFiles.itemRetail, dbcFields.itemRetail).toArray();
		this._itemAppearance = await this.read<IItemAppearanceDbc>(DbcFiles.itemAppearance, dbcFields.itemAppearance).toArray();
		this._itemModifiedAppearance = await this.read<IItemModifiedAppearanceDbc>(DbcFiles.itemModifiedAppearance, dbcFields.itemModifiedAppearance).toArray();
		this._itemDisplayInfo = await this.read<IItemDisplayInfoDbc>(DbcFiles.itemDisplayInfo, dbcFields.itemDisplayInfo).toArray();
		this._mount = await this.read<IMountDbc>(DbcFiles.mount, dbcFields.mount).toArray();
		this._mountDisplay = await this.read<IMountXDisplayDbc>(DbcFiles.mountDisplay, dbcFields.mountDisplay).toArray();
		this._spell = await this.read<ISpellDbc>(DbcFiles.spell, dbcFields.spell).toArray();
		this._spellItemEnchantment = await this.read<ISpellItemEnchantmentDbc>(DbcFiles.spellItemEnchantment, dbcFields.spellItemEnchantment).toArray();
	}

	public item() {
		return this.getLoadedDataOrRead(DbcFiles.item, this._item, dbcFields.item);
	}

	public itemRetail() {
		return this.getLoadedDataOrRead(DbcFiles.itemRetail, this._itemRetail, dbcFields.itemRetail);
	}

	public itemAppearance() {
		return this.getLoadedDataOrRead(DbcFiles.itemAppearance, this._itemAppearance, dbcFields.itemAppearance);
	}

	public itemModifiedAppearance() {
		return this.getLoadedDataOrRead(DbcFiles.itemModifiedAppearance, this._itemModifiedAppearance, dbcFields.itemModifiedAppearance);
	}

	public itemDisplayInfo() {
		return this.getLoadedDataOrRead(DbcFiles.itemDisplayInfo, this._itemDisplayInfo, dbcFields.itemDisplayInfo);
	}

	public mount() {
		return this.getLoadedDataOrRead(DbcFiles.mount, this._mount, dbcFields.mount);
	}

	public mountDisplay() {
		return this.getLoadedDataOrRead(DbcFiles.mountDisplay, this._mountDisplay, dbcFields.mountDisplay);
	}

	public spell() {
		return this.getLoadedDataOrRead(DbcFiles.spell, this._spell, dbcFields.spell);
	}

	public spellItemEnchantment() {
		return this.getLoadedDataOrRead(DbcFiles.spellItemEnchantment, this._spellItemEnchantment, dbcFields.spellItemEnchantment);
	}

	private read<T>(file: string, keepFields: string[] = []): AsyncGenWrapper<T> {
		const reader = new DbcReader<T>(file, keepFields);
		return new AsyncGenWrapper(reader.read());
	}

	private getLoadedDataOrRead<T>(path: string, data: T[], keepFields: string[] = []): IAsyncGeneratorWithArrayMethods<T> {
		return data === undefined ? this.read<T>(path, keepFields) : new ArrayAsAsyncGenerator(data);
	}
}
